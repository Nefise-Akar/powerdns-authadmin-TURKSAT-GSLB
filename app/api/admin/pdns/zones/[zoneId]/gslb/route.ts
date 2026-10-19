/**
 * app/api/admin/pdns/zones/[zoneId]/gslb/route.ts
 *
 * Per-record GSLB switch (ADR-0024 §3).
 *
 * POST   - switch GSLB on for a name: zone setup on first use (PowerGSLB
 *          domain `gslb.<zone>` + parent delegation), PowerGSLB rows for the
 *          members, then the parent RRset(s) become `CNAME <name>.gslb.<zone>.`
 * PATCH  - edit an enabled name's members / method / health check / TTL. Only
 *          PowerGSLB rows change; the parent CNAME is untouched.
 * DELETE - switch it off (`?serverSlug=&name=`): restore the parent RRsets,
 *          then delete the PowerGSLB rows. The zone's subzone stays until
 *          "Remove GSLB setup" (`./setup`).
 *
 * Auth: record.create + record.update + record.delete on the zone (see
 * `_context.ts`). Ordering, locking and rollback live in
 * `lib/gslb/record-sync.ts`; every write is audited as `gslb.*` here and as
 * the normal `record.*` rows by the parent-zone port.
 */

import { headers } from "next/headers";
import { ZodError } from "zod";
import { appendAudit } from "@/lib/audit/log";
import { getRequestContext } from "@/lib/client-ip";
import { db, type DbExecutor } from "@/lib/db";
import { findGslbBackendById, listAllGslbBackends } from "@/lib/db/repositories/gslb-backends";
import {
  deleteGslbRecordRow,
  findGslbRecord,
  findGslbZone,
  insertGslbRecord,
  insertGslbZone,
  saveGslbRecordPreset,
  updateGslbRecordRow,
} from "@/lib/db/repositories/gslb-records";
import { listGslbRegions } from "@/lib/db/repositories/gslb-regions";
import type { GslbBackend, GslbZone } from "@/lib/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  decodeMode,
  deriveWeights,
  encodeMode,
  type GslbMember,
  type GslbRecordKind,
} from "@/lib/gslb/model";
import { gslbEligibility, recordTarget, subzoneFor } from "@/lib/gslb/record-plan";
import {
  disableGslbRecord,
  enableGslbRecord,
  updateGslbRecord,
  type GslbRecordSettings,
} from "@/lib/gslb/record-sync";
import { getGslbClientForRow } from "@/lib/gslb/registry";
import {
  disableGslbRecordSchema,
  enableGslbRecordSchema,
  updateGslbRecordSchema,
  validateGslbMembers,
} from "@/lib/validators/gslb-records";
import { gslbRouteErrorResponse } from "@/app/api/admin/gslb-backends/_shared";
import {
  expectedRRsetGuard,
  gslbRecordAuditSnapshot,
  ownerName,
  resolveGslbRouteContext,
  type GslbRouteContext,
} from "./_context";
import { parentZonePort } from "./_parent-zone";

interface RouteContext {
  params: Promise<{ zoneId: string }>;
}

function parseBody<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ValidationError("Invalid input.", { fieldErrors: err.flatten().fieldErrors });
    }
    throw err;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

async function requestInfo() {
  return getRequestContext(await headers());
}

/** Members checked against the kind and against the backend's regions. */
async function checkedMembers(
  backend: GslbBackend,
  kind: GslbRecordKind,
  members: GslbMember[],
  zoneName: string,
): Promise<GslbMember[]> {
  const result = validateGslbMembers(kind, members, subzoneFor(zoneName));
  if (!result.ok) {
    throw new ValidationError("Invalid members.", { fieldErrors: { members: result.errors } });
  }
  const regions = new Set((await listGslbRegions(backend.id)).map((r) => r.slug));
  const unknown = result.members.find((m) => m.region !== null && !regions.has(m.region));
  if (unknown) {
    throw new ValidationError(
      `Region "${unknown.region}" doesn't belong to GSLB backend ${backend.name}.`,
    );
  }
  return result.members;
}

/** The zone's backend if GSLB is already on in it, else the operator's pick. */
async function chooseBackend(
  zone: GslbZone | null,
  requested: string | undefined,
): Promise<GslbBackend> {
  if (zone) {
    const backend = await findGslbBackendById(zone.backendId);
    if (!backend) throw new NotFoundError("This zone's GSLB backend no longer exists.");
    if (requested && requested !== backend.id) {
      throw new ConflictError(`GSLB in this zone already runs on backend "${backend.name}".`);
    }
    if (!backend.enabled) throw new ConflictError(`GSLB backend "${backend.name}" is disabled.`);
    return backend;
  }
  const enabled = (await listAllGslbBackends()).filter((b) => b.enabled);
  if (requested) {
    const backend = enabled.find((b) => b.id === requested);
    if (!backend) throw new ValidationError("Unknown or disabled GSLB backend.");
    return backend;
  }
  if (enabled.length === 0) throw new ConflictError("No GSLB backend is enabled.");
  if (enabled.length > 1) throw new ValidationError("Choose a GSLB backend.");
  return enabled[0]!;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const raw = await readJson(request);
    const ctx = await resolveGslbRouteContext(
      request,
      (await context.params).zoneId,
      raw["serverSlug"],
    );
    const input = parseBody(enableGslbRecordSchema, raw);
    const name = ownerName(input.name, ctx.zoneName);
    const reqInfo = await requestInfo();

    const existingZone = await findGslbZone(ctx.scope, ctx.zoneName);
    if (existingZone && (await findGslbRecord(existingZone.id, name))) {
      throw new ConflictError("GSLB is already on for this name.");
    }
    const backend = await chooseBackend(existingZone, input.backendId);

    const parent = parentZonePort({
      server: ctx.server,
      zoneName: ctx.zoneName,
      actor: ctx.user,
      request: reqInfo,
    });
    const eligibility = gslbEligibility(await parent.read(), ctx.zoneName, name);
    if (!eligibility.eligible) throw new ConflictError(eligibility.reason);
    const kind = eligibility.kind;
    const common = {
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      zoneName: ctx.zoneName,
      name,
      kind,
      parent,
      assertUnchanged: expectedRRsetGuard(input.expected),
    };

    let gslbZoneId = existingZone?.id ?? null;
    const ensureZoneRow = async (tx: DbExecutor) => {
      if (gslbZoneId) return gslbZoneId;
      const zone = await insertGslbZone(
        {
          scope: ctx.scope,
          zoneName: ctx.zoneName,
          backendId: backend.id,
          subzone: subzoneFor(ctx.zoneName),
          createdBy: ctx.user.id,
        },
        tx,
      );
      gslbZoneId = zone.id;
      return zone.id;
    };

    const settings: GslbRecordSettings = {
      method: input.method,
      persistence: input.persistence,
      monitor: input.monitor,
      ttl: input.ttl,
      // Stored with the weights the method actually writes (order / equal / ratio).
      members: deriveWeights(
        input.method,
        await checkedMembers(backend, kind, input.members, ctx.zoneName),
      ),
    };
    const zoneEnabled = existingZone !== null;
    const result = await enableGslbRecord({
      ...common,
      target: recordTarget(name, ctx.zoneName),
      settings,
      delegation: {
        nameserverHost: backend.nameserverHost,
        nameserverAddresses: backend.nameserverAddresses ?? null,
      },
      zoneEnabled,
      persistZone: async () => {
        await db.transaction(async (tx) => {
          await ensureZoneRow(tx);
          await appendAudit(
            {
              actor: { type: "user", id: ctx.user.id },
              action: "gslb.zone.enable",
              resource: { type: "zone", id: `${ctx.server.slug}:${ctx.zoneName}` },
              after: {
                zone: ctx.zoneName,
                subzone: subzoneFor(ctx.zoneName),
                backendId: backend.id,
                nameserverHost: backend.nameserverHost,
                nameserverAddresses: backend.nameserverAddresses,
              },
              request: reqInfo,
            },
            tx,
          );
        });
      },
      persistRecord: async (enabled) => {
        await db.transaction(async (tx) => {
          const zoneId = await ensureZoneRow(tx);
          const row = await insertGslbRecord(
            {
              gslbZoneId: zoneId,
              backendId: backend.id,
              name,
              kind,
              originalTypes: enabled.originalTypes,
              originalRrsets: enabled.snapshot,
              mode: encodeMode(settings),
              monitor: settings.monitor,
              ttl: settings.ttl,
              members: settings.members,
              remoteRowIds: enabled.remoteRowIds,
              createdBy: ctx.user.id,
            },
            tx,
          );
          await appendAudit(
            {
              actor: { type: "user", id: ctx.user.id },
              action: "gslb.record.enable",
              resource: { type: "gslb_record", id: row.id },
              before: { name, rrsets: enabled.snapshot },
              after: gslbRecordAuditSnapshot(row),
              request: reqInfo,
            },
            tx,
          );
        });
      },
    });

    return Response.json(
      { ok: true, newZone: !zoneEnabled, delegationChanged: result.delegationChanged },
      { status: 201 },
    );
  } catch (err) {
    return gslbRouteErrorResponse(err, "gslb.record.enable.error");
  }
}

/** Load the zone + record rows an edit / disable acts on. */
async function loadManaged(ctx: GslbRouteContext, name: string) {
  const zone = await findGslbZone(ctx.scope, ctx.zoneName);
  const record = zone ? await findGslbRecord(zone.id, name) : null;
  if (!zone || !record) throw new NotFoundError("GSLB is not on for this name.");
  const backend = await findGslbBackendById(record.backendId);
  if (!backend) throw new NotFoundError("This record's GSLB backend no longer exists.");
  return { zone, record, backend };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const raw = await readJson(request);
    const ctx = await resolveGslbRouteContext(
      request,
      (await context.params).zoneId,
      raw["serverSlug"],
    );
    const input = parseBody(updateGslbRecordSchema, raw);
    const name = ownerName(input.name, ctx.zoneName);
    const reqInfo = await requestInfo();
    const { record, backend } = await loadManaged(ctx, name);
    if (!backend.enabled) throw new ConflictError(`GSLB backend "${backend.name}" is disabled.`);

    const settings: GslbRecordSettings = {
      method: input.method,
      persistence: input.persistence,
      monitor: input.monitor,
      ttl: input.ttl,
      members: deriveWeights(
        input.method,
        await checkedMembers(backend, record.kind, input.members, ctx.zoneName),
      ),
    };

    await updateGslbRecord({
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      target: recordTarget(name, ctx.zoneName),
      kind: record.kind,
      settings,
      persistRecord: async (remoteRowIds) => {
        await db.transaction(async (tx) => {
          const row = await updateGslbRecordRow(
            record.id,
            {
              mode: encodeMode(settings),
              monitor: settings.monitor,
              ttl: settings.ttl,
              members: settings.members,
              remoteRowIds,
            },
            tx,
          );
          if (!row) throw new NotFoundError("GSLB record vanished while saving.");
          await appendAudit(
            {
              actor: { type: "user", id: ctx.user.id },
              action: "gslb.record.update",
              resource: { type: "gslb_record", id: record.id },
              before: gslbRecordAuditSnapshot(record),
              after: gslbRecordAuditSnapshot(row),
              request: reqInfo,
            },
            tx,
          );
        });
      },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return gslbRouteErrorResponse(err, "gslb.record.update.error");
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    const serverSlug = url.searchParams.get("serverSlug");
    const ctx = await resolveGslbRouteContext(request, (await context.params).zoneId, serverSlug);
    const input = parseBody(disableGslbRecordSchema, {
      name: url.searchParams.get("name") ?? "",
      ...(serverSlug ? { serverSlug } : {}),
    });
    const name = ownerName(input.name, ctx.zoneName);
    const reqInfo = await requestInfo();
    // A disabled backend may still be switched off - that is how an operator
    // backs out of GSLB; only new writes are refused for it.
    const { record, backend } = await loadManaged(ctx, name);

    const result = await disableGslbRecord({
      backendId: backend.id,
      client: getGslbClientForRow(backend),
      zoneName: ctx.zoneName,
      name,
      target: recordTarget(name, ctx.zoneName),
      kind: record.kind,
      members: record.members,
      snapshot: record.originalRrsets,
      parent: parentZonePort({
        server: ctx.server,
        zoneName: ctx.zoneName,
        actor: ctx.user,
        request: reqInfo,
      }),
      persistRemoval: async () => {
        await db.transaction(async (tx) => {
          await deleteGslbRecordRow(record.id, tx);
          // Keep the settings so switching back on can offer them again.
          const remembered = decodeMode(record.mode, record.members);
          await saveGslbRecordPreset(
            {
              scope: ctx.scope,
              zoneName: ctx.zoneName,
              name,
              settings: {
                backendId: record.backendId,
                // Stored as the current method (legacy rows are mapped), with the
                // members in priority order so global availability round-trips.
                mode: encodeMode(remembered),
                monitor: record.monitor,
                ttl: record.ttl,
                members: remembered.members,
              },
              createdBy: ctx.user.id,
            },
            tx,
          );
          await appendAudit(
            {
              actor: { type: "user", id: ctx.user.id },
              action: "gslb.record.disable",
              resource: { type: "gslb_record", id: record.id },
              before: gslbRecordAuditSnapshot(record),
              request: reqInfo,
            },
            tx,
          );
        });
      },
    });
    return Response.json({ ok: true, remoteCleaned: result.remoteCleaned });
  } catch (err) {
    return gslbRouteErrorResponse(err, "gslb.record.disable.error");
  }
}
