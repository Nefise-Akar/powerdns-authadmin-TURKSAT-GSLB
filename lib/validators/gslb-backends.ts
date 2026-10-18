/**
 * lib/validators/gslb-backends.ts
 *
 * Zod schemas for the PowerGSLB backend admin form (ADR-0024).
 *
 * The password is write-only: required on create, optional on update where a
 * blank value means "keep the stored one" (the form never receives it back).
 */

import "server-only";
import { isIP } from "node:net";
import { z } from "zod";
import { slugSchema } from "./common";

/** Bounds the glue list - a nameserver rarely has more than a v4 + v6 pair per site. */
const MAX_NAMESERVER_ADDRESSES = 16;

/**
 * The admin API root only: scheme + host (+ port). The client appends
 * `/admin/w2ui`, so a path here is almost always a pasted `/admin/` UI URL,
 * which would produce `/admin//admin/w2ui`. A trailing slash is tolerated and
 * stripped so the stored value is canonical.
 */
const baseUrlSchema = z
  .string()
  .trim()
  .url("Base URL must be a full URL including scheme (e.g. https://powergslb).")
  .refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "Base URL must use http:// or https://.",
  )
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    // Credentials in the URL would end up in log lines and audit snapshots and
    // bypass the encrypted password column.
    if (parsed.username !== "" || parsed.password !== "") {
      ctx.addIssue({
        code: "custom",
        message: "Base URL must not contain a username or password - use the fields below.",
      });
    }
    if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
      ctx.addIssue({
        code: "custom",
        message:
          "Base URL must be the server root without a path (e.g. https://powergslb) - /admin/w2ui is appended automatically.",
      });
    }
  })
  .transform((value) => value.replace(/\/+$/, ""));

const nameSchema = z.string().trim().min(1, "Name is required.").max(120);

const descriptionSchema = z
  .string()
  .max(500, "Description must be 500 characters or fewer.")
  .transform((s) => (s.trim() === "" ? null : s.trim()));

/**
 * PowerGSLB splits the Basic Auth pair on the first `:`, so a colon in the user
 * name can never authenticate.
 */
const usernameSchema = z
  .string()
  .trim()
  .min(1, "Username is required.")
  .max(255)
  .refine((s) => !s.includes(":"), "Username must not contain ':'.");

/** Not trimmed: whitespace can be part of a real password. */
const passwordSchema = z.string().min(1, "Password is required.").max(1024);

const LABEL_PATTERN = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/**
 * Nameserver FQDN, normalized to lower case with the trailing dot that the
 * PDNS NS/glue records written in Part 2 need. Blank clears it.
 */
const nameserverHostSchema = z
  .string()
  .trim()
  .max(254)
  .transform((s) => s.toLowerCase().replace(/\.$/, ""))
  .refine(
    (s) =>
      s === "" ||
      (s.length <= 253 &&
        s.split(".").length >= 2 &&
        s.split(".").every((l) => LABEL_PATTERN.test(l))),
    "Nameserver host must be a fully-qualified host name (e.g. ns1.gslb.example.com).",
  )
  .transform((s) => (s === "" ? null : `${s}.`));

const nameserverAddressesSchema = z
  .array(
    z
      .string()
      .trim()
      .refine((s) => isIP(s) !== 0, "Each nameserver address must be an IPv4 or IPv6 address."),
  )
  .max(MAX_NAMESERVER_ADDRESSES, `At most ${MAX_NAMESERVER_ADDRESSES} addresses.`)
  .transform((list) => (list.length === 0 ? null : [...new Set(list)]));

export const createGslbBackendSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  description: descriptionSchema.nullable().optional(),
  baseUrl: baseUrlSchema,
  username: usernameSchema,
  password: passwordSchema,
  nameserverHost: nameserverHostSchema.nullable().optional(),
  nameserverAddresses: nameserverAddressesSchema.nullable().optional(),
  enabled: z.boolean().default(true),
});

export type CreateGslbBackendInput = z.infer<typeof createGslbBackendSchema>;

export const updateGslbBackendSchema = z.object({
  name: nameSchema.optional(),
  /** `null` or blank clears; omit to leave unchanged. */
  description: descriptionSchema.nullable().optional(),
  baseUrl: baseUrlSchema.optional(),
  username: usernameSchema.optional(),
  /** Omit or send blank to keep the stored password; a value rotates it. */
  password: z
    .string()
    .max(1024)
    .optional()
    .transform((s) => (s === "" ? undefined : s)),
  nameserverHost: nameserverHostSchema.nullable().optional(),
  nameserverAddresses: nameserverAddressesSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});

export type UpdateGslbBackendInput = z.infer<typeof updateGslbBackendSchema>;
