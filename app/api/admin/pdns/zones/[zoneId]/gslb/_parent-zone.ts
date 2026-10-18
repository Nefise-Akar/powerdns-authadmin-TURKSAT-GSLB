/**
 * app/api/admin/pdns/zones/[zoneId]/gslb/_parent-zone.ts
 *
 * The parent-zone port for per-record GSLB (`lib/gslb/record-sync.ts`). It
 * writes through the same primitives the RRset PATCH route uses - the backend
 * gateway, `replaceRRset` / `deleteRRset` / `zonePatchBody`, the zone event
 * bus, the `record.*` audit rows and the best-effort NOTIFY - so a GSLB switch
 * looks exactly like an operator's record edit to everything downstream. The
 * RRset route itself is not called (no HTTP to our own API) and not changed.
 */

import "server-only";
import { appendAudit } from "@/lib/audit/log";
import type { PdnsServer } from "@/lib/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { redact } from "@/lib/errors/redact";
import type { ParentChange, ZoneRRset } from "@/lib/gslb/record-plan";
import type { ParentZonePort } from "@/lib/gslb/record-sync";
import { logger } from "@/lib/logger";
import { PdnsError, PdnsNotFoundError } from "@/lib/pdns/errors";
import { deleteRRset, replaceRRset, zonePatchBody, type RRsetPatch } from "@/lib/pdns/rrsets";
import { assertEditableZoneKind } from "@/lib/pdns/writable-kind";
import { getBackendGateway } from "@/lib/realtime/backend-gateway";
import { publishZoneEvent } from "@/lib/realtime/event-bus";
import { scheduleImmediatePoll } from "@/lib/realtime/zone-poller";
import { newSystemRequestId, withRequestId } from "@/lib/request-context";

interface Actor {
  id: string;
  email: string;
}

type RequestInfo = Parameters<typeof appendAudit>[0]["request"];

function readComments(rrset: unknown): Array<Record<string, unknown>> {
  if (!rrset || typeof rrset !== "object") return [];
  const raw = (rrset as { comments?: unknown }).comments;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null);
}

function mapPdnsError(err: unknown): never {
  if (err instanceof PdnsNotFoundError) throw new NotFoundError("Zone not found on backend.");
  if (err instanceof PdnsError) throw new ValidationError(`PDNS: ${redact(err.message)}`);
  throw err;
}

export function parentZonePort(args: {
  server: PdnsServer;
  zoneName: string;
  actor: Actor;
  request: RequestInfo;
}): ParentZonePort {
  const client = getBackendGateway(args.server);
  const { zoneName } = args;

  async function readZone() {
    try {
      const zone = await client.getZone(zoneName);
      assertEditableZoneKind(zone.kind);
      return zone;
    } catch (err) {
      return mapPdnsError(err);
    }
  }

  return {
    async read(): Promise<ZoneRRset[]> {
      return (await readZone()).rrsets ?? [];
    },

    async apply(changes: ParentChange[]): Promise<void> {
      if (changes.length === 0) return;
      const zoneBefore = await readZone();
      const before = new Map((zoneBefore.rrsets ?? []).map((rr) => [`${rr.name}|${rr.type}`, rr]));

      const patches: RRsetPatch[] = changes.map((change) => {
        if (change.kind === "delete") return deleteRRset(change.name, change.type);
        return replaceRRset({
          name: change.name,
          type: change.type,
          ttl: change.ttl,
          records: change.records,
          comments: change.comments ?? readComments(before.get(`${change.name}|${change.type}`)),
        });
      });

      try {
        await client.patchZone(zoneName, zonePatchBody(...patches));
      } catch (err) {
        mapPdnsError(err);
      }

      publishZoneEvent({
        type: "zone.updated",
        zone: zoneName,
        serverSlug: args.server.slug,
        actor: args.actor.email,
        at: new Date().toISOString(),
      });
      scheduleImmediatePoll();

      // Same contract as the RRset route: PDNS already applied the change, so
      // a failed audit write is logged, never surfaced as a failed request.
      const results = await Promise.allSettled(
        patches.map((patch) => {
          const prior = before.get(`${patch.name}|${patch.type}`) ?? null;
          const priorSnapshot = prior ? { ...prior, comments: readComments(prior) } : null;
          return appendAudit({
            actor: { type: "user", id: args.actor.id },
            action:
              patch.changetype === "DELETE"
                ? "record.delete"
                : prior === null
                  ? "record.create"
                  : "record.update",
            resource: {
              type: "rrset",
              id: `${args.server.slug}:${zoneName}:${patch.name}|${patch.type}`,
            },
            before: priorSnapshot,
            after:
              patch.changetype === "DELETE"
                ? null
                : {
                    name: patch.name,
                    type: patch.type,
                    ttl: patch.ttl,
                    records: patch.records,
                    comments: patch.comments,
                  },
            request: args.request,
          });
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          logger.warn(
            {
              server: args.server.slug,
              zone: zoneName,
              error: result.reason instanceof Error ? result.reason.message : "unknown",
            },
            "gslb.parent.audit.failed",
          );
        }
      }

      if (zoneBefore.kind === "Master" || zoneBefore.kind === "Primary") {
        void withRequestId(newSystemRequestId(), async () => {
          try {
            await client.notifyZone(zoneName);
          } catch (err) {
            logger.warn(
              {
                server: args.server.slug,
                zone: zoneName,
                error: err instanceof Error ? redact(err.message) : "unknown",
              },
              "gslb.parent.notify.failed",
            );
          }
        });
      }
    },
  };
}
