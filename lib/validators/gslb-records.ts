/**
 * lib/validators/gslb-records.ts
 *
 * Request schemas for switching GSLB on / editing it / switching it off on a
 * zone record (ADR-0024 §3, §5). Member contents are validated against the
 * record kind by the route (it knows the kind from the live zone) through
 * `validateGslbMembers`.
 */

import "server-only";
import { z } from "zod";
import {
  GSLB_MAX_MEMBERS,
  GSLB_MAX_TTL,
  GSLB_MAX_WEIGHT,
  GSLB_MIN_TTL,
  type GslbMember,
  type GslbRecordKind,
} from "@/lib/gslb/model";
import { normalizeMemberContent } from "@/lib/gslb/record-plan";
import { SLUG_PATTERN } from "./common";

const EXPECTED_STATUS_PATTERN = /^\d{3}(-\d{3})?(,\d{3}(-\d{3})?)*$/;
/** A URL path without spaces or characters that would need escaping inside the monitor JSON's URL. */
const HTTP_PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;

const portSchema = z
  .number()
  .int()
  .min(1, "Port must be 1-65535.")
  .max(65535, "Port must be 1-65535.");
const pathSchema = z
  .string()
  .trim()
  .max(200, "Path must be 200 characters or fewer.")
  .regex(HTTP_PATH_PATTERN, "Path must start with / and contain no spaces.");
const expectedStatusSchema = z
  .string()
  .trim()
  .regex(
    EXPECTED_STATUS_PATTERN,
    "Expected status must look like 200, 200-399 or 200,204,300-308.",
  );

export const gslbMonitorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("icmp") }),
  z.object({ type: z.literal("tcp"), port: portSchema }),
  z.object({ type: z.literal("tls"), port: portSchema, tlsVerify: z.boolean() }),
  z.object({ type: z.literal("http"), path: pathSchema, expectedStatus: expectedStatusSchema }),
  z.object({
    type: z.literal("https"),
    path: pathSchema,
    expectedStatus: expectedStatusSchema,
    tlsVerify: z.boolean(),
  }),
]);

export const gslbMemberSchema = z.object({
  content: z.string().trim().min(1, "Every member needs an address or host name.").max(255),
  region: z.string().regex(SLUG_PATTERN, "Unknown region.").nullable(),
  weight: z
    .number()
    .int("Weight must be a whole number.")
    .min(0, `Weight must be 0-${GSLB_MAX_WEIGHT}.`)
    .max(GSLB_MAX_WEIGHT, `Weight must be 0-${GSLB_MAX_WEIGHT}.`),
});

/** Mode, health check, TTL and members of a GSLB record. */
export const gslbSettingsShape = {
  mode: z.enum(["failover", "distribute"]),
  monitor: gslbMonitorSchema,
  ttl: z
    .number()
    .int()
    .min(GSLB_MIN_TTL, `TTL must be ${GSLB_MIN_TTL}-${GSLB_MAX_TTL} seconds.`)
    .max(GSLB_MAX_TTL, `TTL must be ${GSLB_MIN_TTL}-${GSLB_MAX_TTL} seconds.`),
  members: z
    .array(gslbMemberSchema)
    .min(1, "Add at least one member.")
    .max(GSLB_MAX_MEMBERS, `At most ${GSLB_MAX_MEMBERS} members.`),
};

/** ADR-0010: the hashes of the RRsets at the name as the operator saw them. */
const expectedSchema = z
  .array(
    z.object({ type: z.enum(["A", "AAAA", "CNAME"]), hash: z.string().regex(/^[0-9a-f]{16}$/) }),
  )
  .max(3);

const targetShape = {
  serverSlug: z.string().min(1).max(64).optional(),
  /** Owner name, absolute (`www.example.com.`) or relative to the zone. */
  name: z.string().trim().min(1).max(253),
};

export const enableGslbRecordSchema = z.object({
  ...targetShape,
  ...gslbSettingsShape,
  /** Required only for a zone's first GSLB record when several backends are enabled. */
  backendId: z.string().min(1).max(64).optional(),
  expected: expectedSchema,
});

export const updateGslbRecordSchema = z.object({ ...targetShape, ...gslbSettingsShape });

export const disableGslbRecordSchema = z.object(targetShape);

export type EnableGslbRecordInput = z.infer<typeof enableGslbRecordSchema>;
export type UpdateGslbRecordInput = z.infer<typeof updateGslbRecordSchema>;

/**
 * Check + canonicalize members against the record kind: IPv4/IPv6 for an
 * address record, FQDNs for a CNAME record; no content twice (PowerGSLB keys
 * rows on view + content). Errors are keyed by member index.
 */
export function validateGslbMembers(
  kind: GslbRecordKind,
  members: readonly GslbMember[],
  subzone: string,
): { ok: true; members: GslbMember[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const out: GslbMember[] = [];
  const seen = new Set<string>();
  members.forEach((member, index) => {
    const normalized = normalizeMemberContent(kind, member.content);
    if (!normalized.ok) {
      errors.push(`Member ${index + 1}: ${normalized.error}`);
      return;
    }
    if (
      kind === "cname" &&
      (normalized.content === subzone || normalized.content.endsWith(`.${subzone}`))
    ) {
      errors.push(`Member ${index + 1}: a member can't point back into ${subzone}.`);
      return;
    }
    const key = normalized.content.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Member ${index + 1}: '${normalized.content}' is listed twice.`);
      return;
    }
    seen.add(key);
    out.push({ ...member, content: normalized.content });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, members: out };
}
