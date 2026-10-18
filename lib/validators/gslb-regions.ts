/**
 * lib/validators/gslb-regions.ts
 *
 * Zod schemas for the GSLB region admin form (ADR-0024 §4). Rule tokens are
 * validated and normalized by `./gslb-region-rules.ts`; the parsed `rules` is
 * the canonical list that is stored and pushed to PowerGSLB.
 */

import "server-only";
import { z } from "zod";
import { slugSchema } from "./common";
import { normalizeRuleTokens } from "./gslb-region-rules";

/** Generous for a site's prefixes; the 255-char PowerGSLB rule cap bites first anyway. */
const MAX_RULE_TOKENS = 64;

const rulesSchema = z
  .array(z.string().max(100, "Each rule must be 100 characters or fewer."))
  .max(MAX_RULE_TOKENS, `At most ${MAX_RULE_TOKENS} rules.`)
  .transform((raw, ctx) => {
    const result = normalizeRuleTokens(raw);
    if (!result.ok) {
      for (const message of result.errors) ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return result.tokens;
  });

const nameSchema = z.string().trim().min(1, "Name is required.").max(120);

const descriptionSchema = z
  .string()
  .max(500, "Description must be 500 characters or fewer.")
  .transform((s) => (s.trim() === "" ? null : s.trim()));

export const createGslbRegionSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema.nullable().optional(),
  rules: rulesSchema,
});

export type CreateGslbRegionInput = z.infer<typeof createGslbRegionSchema>;

/** Slug is immutable: it names the remote view that GSLB records point at. */
export const updateGslbRegionSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  rules: rulesSchema.optional(),
});

export type UpdateGslbRegionInput = z.infer<typeof updateGslbRegionSchema>;
