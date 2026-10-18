/**
 * lib/db/schema/gslb-backends.ts
 *
 * PowerGSLB admin-API connections (ADR-0024). PowerGSLB's own admin surface
 * has no roles and no SSO, so operators never log in to it: the panel holds
 * one service account per backend and enforces RBAC + audit itself.
 *
 * `password_encrypted` uses the same AES-256-GCM envelope as PDNS API keys and
 * OIDC client secrets. The plaintext is never returned over the wire.
 */

import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { pk, timestamps } from "./_helpers";

/**
 * Last operator-triggered connection probe. Written by the Test action only -
 * the list renders the cached verdict instead of round-tripping PowerGSLB on
 * every page view.
 */
export interface GslbProbeCache {
  fetchedAt: string;
  ok: boolean;
  /** Failure class from `GslbError.kind` (unauthorized, unreachable, tls, ...). */
  reason?: string;
  latencyMs?: number;
  counts?: { domains: number; monitors: number; views: number; records: number };
}

export const gslbBackends = pgTable(
  "gslb_backends",
  {
    id: pk(),

    /** URL-safe identifier, immutable after create (log lines + audit refer to it). */
    slug: text("slug").notNull(),

    name: text("name").notNull(),

    description: text("description"),

    /**
     * Admin API root without a trailing slash or path, e.g. `https://powergslb`.
     * The client appends `/admin/w2ui`.
     */
    baseUrl: text("base_url").notNull(),

    /** PowerGSLB service-account user name (HTTP Basic Auth). */
    username: text("username").notNull(),

    /** AES-256-GCM envelope of the service-account password. See lib/crypto/encryption.ts. */
    passwordEncrypted: text("password_encrypted").notNull(),

    /**
     * FQDN of the GSLB nameserver (e.g. `ns1.gslb.example.`), used when the
     * panel delegates the per-zone `gslb.<zone>` subzone. Null until delegation
     * is configured.
     */
    nameserverHost: text("nameserver_host"),

    /** Glue addresses for `nameserverHost` when it lives inside the delegated zone. */
    nameserverAddresses: jsonb("nameserver_addresses").$type<string[]>(),

    /** Soft-disable: the row stays for audit history but is not used for writes. */
    enabled: boolean("enabled").notNull().default(true),

    probeCache: jsonb("probe_cache").$type<GslbProbeCache | null>(),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),

    ...timestamps(),
  },
  (t) => ({
    slugIdx: uniqueIndex("gslb_backends_slug_idx").on(t.slug),
  }),
);

export type GslbBackend = typeof gslbBackends.$inferSelect;
export type NewGslbBackend = typeof gslbBackends.$inferInsert;
