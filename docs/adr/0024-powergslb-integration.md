# ADR 0024 - PowerGSLB integration: per-record GSLB behind the panel

- **Status:** Proposed
- **Date:** 2026-10-14 (revised 2026-10-18: sister zones and service pools rejected; tear-down added)
- **Deciders:** @nefise

## Context

Operators running several sites want shared services to fail over between them automatically,
steered by health checks and by the caller's site. The chosen engine is
[PowerGSLB](https://github.com/acudovs/powergslb) (2.4.3, MIT): a PowerDNS Remote Backend with its
own MariaDB, health-check threads, views (CIDR / GeoIP) and routing policies.

Three facts shape the design, all verified against a running 2.4.3 container (Phase 0):

1. Its remote backend implements only `lookup` and `getAllDomains`. The PowerDNS HTTP API cannot
   list or write its zones, so `lib/pdns` cannot manage GSLB data. Writes must go to PowerGSLB's own
   admin API (`POST /admin/w2ui`, Basic Auth, form-encoded, full-row `save-record`).
2. Its admin surface has **no roles and no SSO**: every account can do everything, including
   managing users. Exposing it to operators would bypass RBAC, OIDC and our audit trail.
3. A newly created PowerGSLB domain is invisible to its PowerDNS until the zone cache refreshes
   (`zone-cache-refresh-interval`, default 300 s) or `pdns_control rediscover` runs. Records inside an
   existing domain are served immediately.

Requirements agreed with the requester: a per-record on/off switch for A, AAAA and CNAME only; no
separate GSLB page; a DNSSEC-style status indicator on the zones list; health check chosen per
record from presets; site-aware answers with automatic cross-site failover; anyone who may edit the
zone's records may toggle; the panel display is the only notification.

## Decision

We will treat PowerGSLB as a **second kind of backend that only the server talks to**. Operators
never log in to PowerGSLB; the panel holds one service account per GSLB backend and enforces RBAC
and audit itself.

1. **Adapter.** A new `lib/gslb/` is a pure protocol adapter for the w2ui API, mirroring `lib/pdns/`
   (ADR-0004, ADR-0013): no RBAC, audit or DB imports outside a sanctioned registry bridge. Outbound
   URLs pass the shared `lib/net/url-safety.ts` guard behind new `APP_GSLB_ALLOW_PRIVATE_NETWORKS` /
   `APP_GSLB_ALLOW_INSECURE_HTTP` flags; private CAs use `NODE_EXTRA_CA_CERTS`.
2. **Connection settings.** A `gslb_backends` table stores base URL, service-account user, the
   password as an AES-256-GCM envelope (`lib/crypto`), and the GSLB nameserver host + glue IPs used
   for delegation. Managed from the existing admin area, gated by a new `gslb.manage` permission.
   The nameserver host and addresses are frozen (409 naming the zones) while any zone is delegated
   to them; the base URL may change, but only to reach the same PowerGSLB instance.
3. **Topology: one delegated subzone per parent zone, CNAME per record.** The first toggle in zone
   `Z` creates domain `gslb.Z` in PowerGSLB and writes `gslb NS <ns>` plus glue into `Z` through the
   normal PDNS write path. When the nameserver host lies inside `gslb.Z` (`ns1.gslb.Z`), its own
   A/AAAA rows (no health check, `Public` view) are written into the PowerGSLB domain as well, so
   it answers for its own name; they go with the domain on tear-down, and a record whose GSLB name
   would be the nameserver's name is refused. Enabling a record `name` then:
   1. writes the GSLB rows for `name.gslb.Z` (one row per site: content, view, weight, monitor);
   2. replaces the parent RRset(s) at `name` with `CNAME name.gslb.Z.` under ADR-0010 optimistic
      concurrency, rolling step 1 back if this fails;
   3. saves the app row. If that fails, the parent RRsets are restored exactly from the snapshot
      and the GSLB rows deleted; if the restore itself fails the error names the untracked CNAME,
      the original records and the PowerGSLB rows to remove - never a silent leftover.
      Disabling reverses the order: restore plain RRset(s) at the name, then delete the GSLB rows.
      The restored values are the members' current contents, not the snapshot taken at enable
      time, so servers added or changed while GSLB was on are not lost. The snapshot supplies TTLs
      and comments. The apex and owner names that carry other RRsets (CNAME exclusivity) are
      not eligible. A and AAAA at the same name move together. For an ineligible row the switch
      stays visible but disabled, with the reason inline (for example "this name also has a TXT
      record"), so operators are never left guessing why it is missing.
4. **Sites are views.** Nothing is seeded: the panel ships with no regions, and operators define their
   own from an empty list (name → CIDR list, optional `country:` / `continent:` tokens). The panel
   syncs them to PowerGSLB views it owns (prefixed so hand-made views are never touched). Each site's address goes in its own view; all addresses also go in the match-all
   `Public` view, which PowerGSLB serves only when the caller's site has no live record. That gives
   local-first answers with automatic cross-site failover.
   A member's region is pre-selected from its IP: the region whose CIDR rules contain it, longest
   prefix first (geo tokens can't place an IP and are ignored); the operator can override it.
   Saving with regions defined but some members region-less asks first: those servers answer all
   clients, so no user gets a nearby one.
5. **Load-balancing method and health checks.** Each record has an explicit method, chosen in the
   dialog (not hidden under Advanced), modelled on the choices a classic GTM offers:
   - **Global availability** - ordered failover. The member list order is the priority; weights
     are derived from position (`(n - index) * 10`: distinct, so the top tier is exactly the first
     live member) under plain `round-robin`. Region rows and the `Public` fallback rows carry the
     same weights, so cross-site failover follows the global order.
   - **Round robin** - all members equal weight under `round-robin`: every live member of the
     preferred set is returned. PowerGSLB does not rotate per query; the resolver reorders.
   - **Ratio** - the operator's 0-1000 ratios under `weighted-random`, one answer per query.
   - **Persistence** (Round robin only) maps to `sticky-hash` (one answer, PowerGSLB's default
     /24 and /64 prefixes). Sticky-hash treats weight as a tier and global availability is already
     single-answer, so the combination is rejected server-side.
     **CNAME names** are limited by PowerGSLB's "one CNAME record per view" trigger: one target
     per region, and `Public` holds only the first target by priority. They are therefore fixed to
     global availability (the dialog disables the other methods with the reason; the server
     rejects them), take HTTP(S) health checks only, and an "All clients" target must come first.
     Edits match CNAME rows by view, so a new target overwrites the view's row in place. The cost:
     cross-site fallback for a CNAME reaches only that single `Public` target, not every other
     region's target. **Currently switched off:** PowerGSLB 2.4.3's admin save upserts the rrset
     with `INSERT … ON DUPLICATE KEY UPDATE`, and the `rrsets_before_insert` CNAME guard fires
     before the duplicate key is resolved, so a CNAME rrset can't get a second row (or be
     rewritten). Found live on 2026-10-19; `gslbEligibility` refuses CNAME names with that reason
     until PowerGSLB is fixed, and the CNAME code paths above stay for that day.
     There is deliberately **no "last resort"
     option**: when every member is down PowerGSLB already serves all of them ("all down = all up"),
     so a name never goes empty. **Topology is not a method**: it is what regions already do. The
     method is per record, not per region. The method lives in the existing `mode` column
     (`global-availability`, `round-robin`, `round-robin+persistence`, `ratio`) - no migration; the
     legacy `failover` (equal weights → round robin, unequal → global availability ordered by
     weight) and `distribute` (→ ratio) are still read, in records, presets and restored backups.
     Health checks are chosen from managed presets (ICMP, TCP, HTTP, HTTPS, TLS), with HTTP(S) as
     the recommended default (path up to 200 characters, status list up to 64). All monitors and
     routings the panel creates are named `authadmin:*` and derived from their settings. A
     monitor name is readable settings plus `#` and 12 hex digits of a SHA-256 of its exact JSON,
     capped at 253 characters: `monitors.monitor` is UNIQUE under a case-insensitive collation, so
     `/Health` and `/health` must not share a name (monitors under the older names stay in
     PowerGSLB, unused once a record is saved again). One routing object per distinct JSON (`failover` = round-robin,
     `failover-single`, `weighted`, `sticky`; the first three keep their historic names so rows
     written earlier stay valid); anything else in PowerGSLB is never touched.
6. **State in the app DB.** `gslb_zones` binds a zone (server/cluster scope + name) to its backend
   once its `gslb.<zone>` is provisioned and delegated. `gslb_records` holds each managed name, the
   original RRset snapshot and its GSLB settings. `gslb_record_presets` keeps a name's last
   settings after it is switched off, re-offered - never re-applied - when it is switched on again.
   All of it is included in the app backup, the service-account password as ciphertext like PDNS
   API keys.
7. **Owned RRsets and tear-down.** A GSLB-managed name's CNAME and a zone's `gslb` delegation
   change only through GSLB; the generic record API, the record table, DynDNS updates and zone
   deletion refuse them. The locks are derived from app rows only, so they release as soon as the
   rows are gone. Everything is removable from the UI: switch records off, then **Remove GSLB
   setup** on the zone (deletes the `gslb` NS and glue - keeping glue another delegation still
   names - then the PowerGSLB domain, then the app row; a PowerGSLB outage is reported, never
   blocks). Deleting a zone does the same clean-up. A backend can be deleted once nothing uses it;
   the refusal names the remaining regions and zones and where to remove each. Deleting a PowerDNS
   server or cluster is refused (409, zones named) while any of its zones still has a GSLB setup:
   the database cascade would drop the app rows but leave the PowerGSLB domain and parent CNAMEs. Cloning a zone
   copies its GSLB names as plain records from their current members and drops the delegation.
8. **Status.** The panel reads PowerGSLB's read-only `status` table on demand: once per page for
   a zone's records (filtered to its `gslb.<zone>` domain), and once per backend (cached ~20 s) for the zones list, which shows
   `3 records · all up`, `1 record · 2 servers down` or `status unavailable`. Record rows show
   per-member state. The panel is never on the DNS query path.
9. **Permissions and audit.** Toggling and editing GSLB settings on a record require the same
   `record.create` / `record.update` / `record.delete` grants on that zone, at the same scope.
   New audit actions: `gslb.record.enable`, `gslb.record.disable`, `gslb.record.update`,
   `gslb.zone.enable`, `gslb.zone.disable`, `gslb.backend.*`, `gslb.region.*`. PowerGSLB's own
   audit shows only the service account; ours names the person. (`gslb.zone_pair.*` and
   `gslb.pool.*` remain in the vocabulary only so rows from the removed features still render.)
10. **Write safety.** PowerGSLB updates resend the whole row and carry no version, so writes to one
    `(backend, rrset)` are serialised with the existing backend lock and re-read before every save.
    PowerGSLB answers "record not changed" for any update that affects zero rows - an identical
    row or a recid that no longer exists - so the client confirms the row with `get-record` and
    fails when it is gone. Enable and edit both read the rows back and fail when PowerGSLB holds a
    different number than was written.

## Rationale

- **The panel is the only safe front door.** PowerGSLB has no roles or SSO, so a link-out would
  make everyone a full admin of GSLB under a shared account.
- **A CNAME into one subzone per parent zone avoids the zone-cache delay.** That delay applies to new
  domains only, and here each parent zone needs one domain. Per-record NS delegation would create a
  domain per name and need glue per name.
- **A separate PowerDNS + PowerGSLB keeps the blast radius small.** The all-in-one image runs
  `--privileged` with its own database. Putting it beside the main authoritative servers would let a
  GSLB fault take down every zone.
- **Views plus a `Public` fallback reuse PowerGSLB's documented precedence.** Local-first answers with
  failover come from that precedence, so there is no custom logic on the DNS query path.
- **Trade-offs.**
  - GSLB'd names are one CNAME hop longer.
  - The apex cannot be balanced.
  - A failover takes about 40 s with default monitor timing, tunable via
    `POWERGSLB_MONITOR_UPDATE_INTERVAL` and per-check `interval` / `fall`.

## Alternatives considered

- **Link out to PowerGSLB's own UI.** Shared admin account, no OIDC, no RBAC, no attributable audit.
  Rejected.
- **PowerDNS LUA records** (`ifurlup`, `pickclosest`, …). There is nothing to deploy and the panel
  already supports them, but they have no central status view and fewer check types. The requester
  mandated PowerGSLB.
- **Zone-level switch that moves the whole zone into PowerGSLB.** This puts mail, TXT and every other
  record behind GSLB and its availability. Rejected in favour of per-record switches.
- **PowerGSLB as a second backend on the main PowerDNS (`launch=gsqlite3,remote`).** One fewer daemon,
  but it widens the blast radius and puts a privileged container next to production DNS. Rejected.
- **Per-record NS delegation.** It hits the 5-minute zone-cache delay on every toggle and needs glue
  per name. Rejected.
- **Sister zones** (pair two zones and suggest the other site's same-named addresses). Built and
  then removed: with ~49 zones it still duplicated member lists per record, ran a health check per
  copy, and only helped when names matched across zones.
- **Service pools** (admin-defined member sets per service, one shared pool domain per backend,
  records CNAME to a pool). Built and then removed: each customer has its own zones and servers, so
  pools offered little real reuse while adding a concept, a shared domain to provision and tear
  down, and per-team visibility rules to keep tenants from seeing each other's servers. Can be
  revisited if a deployment ever shares services across many zones.

## Consequences

- **Schema.** New tables (`gslb_backends`, `gslb_regions`, `gslb_zones`, `gslb_records`,
  `gslb_record_presets`) need migrations in both dialects. Interim tables for the rejected sister
  zones and service pools are created and dropped again by later migrations; the pool removal
  refuses to run while pool rows exist.
- **Configuration.** New env flags and new permission and audit vocabulary entries.
- **Fork maintenance.** This is a fork-local feature, so upstream merges into the Turksat branch get
  harder.
- **Operations.** Each site should run its own PowerGSLB + PowerDNS, with MariaDB replication between
  them (PowerGSLB documents master-slave and Galera; not yet tested here), so losing one site does
  not take GSLB down. Health-check vantage matters: NAT or proxies can fake TCP handshakes (observed
  under VMware NAT), so HTTP(S) checks are the default.
- **Licensing.** Using GeoIP views requires visible attribution for the bundled DB-IP database
  (CC BY 4.0).
- **Follow-ups.**
  - Collect the per-site CIDR blocks.
  - Agree the failover-time budget.

## References

- PowerGSLB README and source, 2.4.3: remote backend handler, w2ui admin API, `status` table.
- Phase 0 test notes: failover and delegation verified on `gslb.turksat.test`, 2026-10-13/14.
- ADR-0004, ADR-0010, ADR-0013, ADR-0014, ADR-0022, ADR-0023.
