/**
 * lib/gslb/record-sync.ts
 *
 * Write ordering for GSLB records and GSLB domains (ADR-0024 §3, §10).
 * The parent zone (the normal PDNS write path) and the app DB are injected as
 * ports, so this module stays a DB-free adapter and every ordering / rollback
 * rule is unit-tested against fakes.
 *
 * Invariant: a parent CNAME never points at an empty GSLB name.
 *   enable : domain setup → monitor/routing → rows (+ read back) → parent
 *            CNAME → persist. A failed parent write deletes the rows again.
 *   update : rows only (diffed: update/insert before delete), parent untouched.
 *   disable: parent restore (refused unless our CNAME is still there) → rows
 *            deleted → persist.
 *   remove domain: parent delegation removed → PowerGSLB domain deleted (a
 *            PowerGSLB failure is reported, never blocks) → persist.
 *
 * Every step for one backend runs under `withGslbBackendLock`: PowerGSLB has
 * no row versions, so concurrent read-modify-writes must take turns.
 */

import "server-only";
import { logger } from "@/lib/logger";
import type { GslbClient } from "./client";
import {
  applyRowDiff,
  assertRequiredTypes,
  assertViewsExist,
  deleteOwnedDomain,
  deleteRowsAt,
  ensureDomain,
  ensureOwnedObject,
  ensurePublicView,
  listRows,
} from "./objects";
import type {
  GslbMember,
  GslbMode,
  GslbMonitorConfig,
  GslbRecordKind,
  GslbRRsetSnapshot,
} from "./model";
import {
  canonicalName,
  diffRows,
  gslbEligibility,
  initialSerial,
  monitorsForMembers,
  NONE_MONITOR,
  parentPointsAtGslb,
  planDelegation,
  planDelegationRemoval,
  planMemberRows,
  planParentEnable,
  planParentRestore,
  planSubzoneApexRows,
  ROUTINGS,
  routingFor,
  targetName,
  type GslbTarget,
  type ParentChange,
  type RecordPlanInput,
  type ZoneRRset,
} from "./record-plan";
import { withGslbBackendLock } from "./region-sync";

/** A zone, read and written through the app's normal PDNS path. */
export interface ParentZonePort {
  /** Current RRsets of the zone (fresh read). */
  read(): Promise<ZoneRRset[]>;
  /** Apply the changes as one PATCH (with the usual record audit trail). */
  apply(changes: ParentChange[]): Promise<void>;
}

/** A refusal the operator can act on (maps to HTTP 409). Nothing was changed. */
export class GslbPlanError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GslbPlanError";
  }
}

export interface GslbRecordSettings {
  mode: GslbMode;
  monitor: GslbMonitorConfig;
  ttl: number;
  members: GslbMember[];
}

export interface ZoneDelegation {
  nameserverHost: string | null;
  nameserverAddresses: string[] | null;
}

function atName(rrsets: readonly ZoneRRset[], name: string): ZoneRRset[] {
  const owner = canonicalName(name);
  return rrsets.filter((rr) => canonicalName(rr.name) === owner);
}

function domainOf(target: GslbTarget): string {
  return canonicalName(target.domain).slice(0, -1);
}

function planInput(
  target: GslbTarget,
  kind: GslbRecordKind,
  settings: GslbRecordSettings,
): RecordPlanInput {
  return { target, kind, ...settings };
}

async function ensureRowObjects(client: GslbClient, input: RecordPlanInput): Promise<void> {
  const rows = planMemberRows(input);
  await assertRequiredTypes(client);
  await ensurePublicView(client);
  await assertViewsExist(
    client,
    rows.map((row) => row.view),
  );
  for (const monitor of monitorsForMembers(input)) {
    await ensureOwnedObject(client, "monitors", monitor);
  }
  await ensureOwnedObject(client, "routings", routingFor(input.mode, input.kind));
}

/**
 * Idempotent GSLB domain setup: PowerGSLB domain `subzone` with SOA + NS, and
 * its delegation (NS + in-bailiwick glue) in `parent`. Used for a zone's own
 * `gslb.<zone>`.
 *
 * @throws {GslbPlanError} when the backend has no nameserver configured or the
 *   parent already has something else at/under `subzone`.
 */
export async function ensureGslbDomain(args: {
  client: GslbClient;
  /** Zone the domain is delegated from (its hostmaster goes into the SOA). */
  parentZoneName: string;
  subzone: string;
  delegation: ZoneDelegation;
  parent: ParentZonePort;
  liveParent?: readonly ZoneRRset[];
  now?: Date;
}): Promise<{ delegationChanged: boolean }> {
  const { nameserverHost, nameserverAddresses } = args.delegation;
  if (!nameserverHost || !nameserverAddresses || nameserverAddresses.length === 0) {
    throw new GslbPlanError(
      "This GSLB backend has no nameserver host and addresses. Set them on the GSLB backend page first - GSLB domains are delegated to that nameserver.",
    );
  }
  const liveParent = args.liveParent ?? (await args.parent.read());
  const delegation = planDelegation({
    subzone: args.subzone,
    rrsets: liveParent,
    nameserverHost,
    nameserverAddresses,
  });
  if (!delegation.ok) throw new GslbPlanError(delegation.reason);

  await assertRequiredTypes(args.client);
  await ensurePublicView(args.client);
  await ensureOwnedObject(args.client, "monitors", NONE_MONITOR);
  await ensureOwnedObject(args.client, "routings", ROUTINGS.failover);

  const apexRows = planSubzoneApexRows({
    zoneName: args.parentZoneName,
    subzone: args.subzone,
    nameserverHost,
    serial: initialSerial(args.now ?? new Date()),
  });
  const domain = apexRows[0]!.domain;
  await ensureDomain(
    args.client,
    domain,
    `Managed by PowerDNS-AuthAdmin (delegated from ${canonicalName(args.parentZoneName)})`,
  );
  const apex = await listRows(args.client, domain, "@");
  for (const row of apexRows) {
    if (!apex.some((existing) => existing.name_type.toUpperCase() === row.name_type)) {
      await args.client.saveRecord("records", 0, { ...row });
    }
  }

  if (delegation.changes.length > 0) await args.parent.apply(delegation.changes);
  return { delegationChanged: delegation.changes.length > 0 };
}

export interface EnableResult {
  kind: GslbRecordKind;
  snapshot: GslbRRsetSnapshot[];
  originalTypes: string[];
  remoteRowIds: number[];
  delegationChanged: boolean;
}

interface RecordArgs {
  backendId: string;
  client: GslbClient;
  zoneName: string;
  name: string;
  kind: GslbRecordKind;
  parent: ParentZonePort;
  /** Throws when the live RRsets at `name` differ from what the operator saw (ADR-0010). */
  assertUnchanged: (liveAtName: readonly ZoneRRset[]) => void;
}

function parentChecker(args: RecordArgs) {
  return (rrsets: readonly ZoneRRset[]) => {
    const eligibility = gslbEligibility(rrsets, args.zoneName, args.name);
    if (!eligibility.eligible) throw new GslbPlanError(eligibility.reason);
    if (eligibility.kind !== args.kind) {
      throw new GslbPlanError(
        "The record type changed since the page was loaded. Reload and try again.",
      );
    }
    args.assertUnchanged(atName(rrsets, args.name));
  };
}

/**
 * Switch GSLB on for `name` with its members at `target`
 * (`<name>.gslb.<zone>`).
 *
 * @param zoneEnabled whether the zone's GSLB setup (`gslb_zones` row) exists.
 * @param persistZone called once the subzone is set up when `zoneEnabled` was
 *   false - creates the `gslb_zones` row.
 * @throws {GslbPlanError} for refusals; nothing is left half-written.
 */
export async function enableGslbRecord(
  args: RecordArgs & {
    target: GslbTarget;
    settings: GslbRecordSettings;
    delegation: ZoneDelegation;
    zoneEnabled: boolean;
    persistZone: () => Promise<void>;
    persistRecord: (result: EnableResult) => Promise<void>;
    now?: Date;
  },
): Promise<EnableResult> {
  return withGslbBackendLock(args.backendId, async () => {
    const checkParent = parentChecker(args);
    const live = await args.parent.read();
    checkParent(live);

    const zone = await ensureGslbDomain({
      client: args.client,
      parentZoneName: args.zoneName,
      subzone: args.target.domain,
      delegation: args.delegation,
      parent: args.parent,
      liveParent: live,
      ...(args.now ? { now: args.now } : {}),
    });
    if (!args.zoneEnabled) await args.persistZone();

    const input = planInput(args.target, args.kind, args.settings);
    const rows = planMemberRows(input);
    await ensureRowObjects(args.client, input);

    const domain = domainOf(args.target);
    const label = args.target.label;
    // Leftovers can only be orphans - nothing CNAMEs here yet - so clear them.
    await deleteRowsAt(args.client, domain, label);

    try {
      await applyRowDiff(args.client, diffRows([], rows));
      const written = await listRows(args.client, domain, label);
      if (written.length !== rows.length) {
        throw new GslbPlanError(
          `PowerGSLB stored ${written.length} of ${rows.length} rows for ${label}. Nothing was switched over.`,
        );
      }

      // Re-read right before the switch: GSLB writes take seconds, and the
      // parent must still be what the operator saw.
      const fresh = await args.parent.read();
      checkParent(fresh);
      const plan = planParentEnable({
        name: args.name,
        target: targetName(args.target),
        liveAtName: atName(fresh, args.name),
      });
      await args.parent.apply(plan.changes);

      const result: EnableResult = {
        kind: args.kind,
        snapshot: plan.snapshot,
        originalTypes: plan.types,
        remoteRowIds: written.map((row) => row.recid),
        delegationChanged: zone.delegationChanged,
      };
      await args.persistRecord(result);
      return result;
    } catch (err) {
      // Roll the rows back only while nothing points at them yet. Once the
      // parent CNAME is in place (persist failed) the rows must stay.
      const parentSwitched = await args.parent
        .read()
        .then((rrsets) =>
          parentPointsAtGslb(atName(rrsets, args.name), args.name, targetName(args.target)),
        )
        .catch(() => true);
      if (!parentSwitched) {
        await deleteRowsAt(args.client, domain, label).catch((cleanupError: unknown) => {
          logger.error(
            {
              zone: args.zoneName,
              name: args.name,
              error: cleanupError instanceof Error ? cleanupError.message : "unknown",
            },
            "gslb.record.enable.rollback-failed",
          );
        });
      }
      throw err;
    }
  });
}

/** Diff a name's rows to the plan (updates/inserts before deletes); returns ids read back. */
async function writeRows(client: GslbClient, input: RecordPlanInput): Promise<number[]> {
  const rows = planMemberRows(input);
  await ensureRowObjects(client, input);
  const domain = domainOf(input.target);
  const existing = await listRows(client, domain, input.target.label);
  await applyRowDiff(client, diffRows(existing, rows));
  const written = await listRows(client, domain, input.target.label);
  return written.map((row) => row.recid);
}

/**
 * Rewrite a record's PowerGSLB rows for new settings. The parent CNAME
 * is not touched. Returns the row ids read back.
 */
export async function updateGslbRecord(args: {
  backendId: string;
  client: GslbClient;
  target: GslbTarget;
  kind: GslbRecordKind;
  settings: GslbRecordSettings;
  persistRecord: (remoteRowIds: number[]) => Promise<void>;
}): Promise<number[]> {
  return withGslbBackendLock(args.backendId, async () => {
    const remoteRowIds = await writeRows(
      args.client,
      planInput(args.target, args.kind, args.settings),
    );
    await args.persistRecord(remoteRowIds);
    return remoteRowIds;
  });
}

export interface DisableResult {
  /** False when the parent was restored but deleting the PowerGSLB rows failed. */
  remoteCleaned: boolean;
}

/**
 * Switch GSLB off: restore the parent, then remove the PowerGSLB rows, then
 * the app row. The zone's subzone stays (removed separately, once no record
 * uses it).
 *
 * @throws {GslbPlanError} when the parent no longer holds our CNAME.
 */
export async function disableGslbRecord(args: {
  backendId: string;
  client: GslbClient;
  zoneName: string;
  name: string;
  target: GslbTarget;
  kind: GslbRecordKind;
  members: readonly GslbMember[];
  snapshot: readonly GslbRRsetSnapshot[];
  parent: ParentZonePort;
  persistRemoval: () => Promise<void>;
}): Promise<DisableResult> {
  return withGslbBackendLock(args.backendId, async () => {
    const live = await args.parent.read();
    const plan = planParentRestore({
      name: args.name,
      target: targetName(args.target),
      liveAtName: atName(live, args.name),
      kind: args.kind,
      members: args.members,
      snapshot: args.snapshot,
    });
    if (!plan.ok) throw new GslbPlanError(plan.reason);
    await args.parent.apply(plan.changes);

    let remoteCleaned = true;
    try {
      await deleteRowsAt(args.client, domainOf(args.target), args.target.label);
    } catch (err) {
      // The parent no longer points here, so leftover rows are inert; the
      // next enable of this name clears them.
      remoteCleaned = false;
      logger.warn(
        {
          zone: args.zoneName,
          name: args.name,
          error: err instanceof Error ? err.message : "unknown",
        },
        "gslb.record.disable.cleanup-failed",
      );
    }
    await args.persistRemoval();
    return { remoteCleaned };
  });
}

export interface DomainRemovalResult {
  /** Parent-zone RRsets deleted (NS, and glue no other delegation needs). */
  parentChanges: ParentChange[];
  /**
   * Null when PowerGSLB was cleaned; otherwise why it wasn't. The parent
   * side and the app row are removed regardless, so a PowerGSLB outage can
   * never leave the zone locked.
   */
  remoteLeftover: string | null;
}

/**
 * Tear down a GSLB domain the panel provisioned: the delegation in its
 * parent zone first (so nothing points at the domain any more), then the
 * domain in PowerGSLB, then the app row (`persist`). The caller has already
 * refused while records still use the domain.
 *
 * @param parent null when the parent zone itself is gone (zone deleted).
 * @param ownsNoRecords re-checked under the lock, right before anything is
 *   removed, so a record switched on concurrently blocks the removal.
 */
export async function removeGslbDomain(args: {
  backendId: string;
  /** Null when the backend row is gone - only the zone side and app row are cleaned. */
  client: GslbClient | null;
  subzone: string;
  nameserverHost: string | null;
  parent: ParentZonePort | null;
  ownsNoRecords: () => Promise<boolean>;
  persist: (result: DomainRemovalResult) => Promise<void>;
}): Promise<DomainRemovalResult> {
  return withGslbBackendLock(args.backendId, async () => {
    if (!(await args.ownsNoRecords())) {
      throw new GslbPlanError("GSLB records still use this domain. Switch them off first.");
    }
    let parentChanges: ParentChange[] = [];
    if (args.parent) {
      parentChanges = planDelegationRemoval({
        subzone: args.subzone,
        nameserverHost: args.nameserverHost,
        rrsets: await args.parent.read(),
      });
      if (parentChanges.length > 0) await args.parent.apply(parentChanges);
    }
    let remoteLeftover: string | null = null;
    try {
      if (!args.client) throw new Error("the GSLB backend no longer exists");
      await deleteOwnedDomain(args.client, domainOf({ domain: args.subzone, label: "@" }));
    } catch (err) {
      remoteLeftover =
        err instanceof Error
          ? `PowerGSLB could not be cleaned (${err.message}); domain ${canonicalName(args.subzone)} is left there.`
          : "PowerGSLB could not be cleaned.";
      logger.warn(
        { subzone: args.subzone, error: remoteLeftover },
        "gslb.domain.remove.remote-failed",
      );
    }
    const result = { parentChanges, remoteLeftover };
    await args.persist(result);
    return result;
  });
}
