/**
 * lib/validators/common.ts
 *
 * Zod fragments shared across the per-feature validators. Dependency-free
 * (no "server-only") so both server schemas and any client-side typing can
 * import them.
 */

import { z } from "zod";

/**
 * URL-safe slug: lowercase alphanumerics with internal dashes, no leading or
 * trailing dash, 1–64 chars. Used for team / OIDC-provider / PDNS-server /
 * zone-template slugs.
 */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const slugSchema = z
  .string()
  .min(1, "Slug is required.")
  .max(64, "Slug must be 64 characters or fewer.")
  .regex(
    SLUG_PATTERN,
    "Slug must use lowercase letters, digits, and dashes only (no leading or trailing dash).",
  );

/**
 * DNS TTL: a 32-bit unsigned integer of seconds. Shared by the RRset and
 * zone-template record validators.
 */
export const ttlSchema = z
  .number()
  .int()
  .min(0, "TTL must be ≥ 0.")
  .max(2_147_483_647, "TTL is too large.");

/**
 * Suggest a slug from a display name: Turkish letters and other diacritics
 * folded to ASCII (`İstanbul Şube` → `istanbul-sube`), lower-cased, every
 * run of other characters turned into one dash, trimmed to 64 characters.
 * Forms use it to fill the slug until the operator edits it by hand; the
 * result still goes through `slugSchema` on the server.
 */
export function slugify(name: string): string {
  const folded = name
    // Dotless ı and dotted İ don't decompose under NFD; map them first.
    .replace(/[ıİ]/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}
