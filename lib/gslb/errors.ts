/**
 * lib/gslb/errors.ts
 *
 * One typed error for every PowerGSLB admin-API failure. A single class with a
 * `kind` discriminator (rather than the PDNS subclass tree) because callers
 * branch on the failure class to pick an operator hint - "wrong password",
 * "certificate not trusted", "not a PowerGSLB endpoint" - not on HTTP status.
 *
 * Messages are passed through `lib/errors/redact.ts` before construction; the
 * service-account password never appears in `.message`.
 */

import "server-only";
import { redact } from "@/lib/errors/redact";

export const GSLB_ERROR_KINDS = [
  /** 401/403 - the service-account user or password was rejected. */
  "unauthorized",
  /** DNS failure, refused connection, timeout, or the SSRF guard refused the URL. */
  "unreachable",
  /** TLS handshake failed - usually an untrusted (private) CA or a name mismatch. */
  "tls",
  /** The endpoint answered but not like PowerGSLB (non-JSON, unknown shape, 404). */
  "protocol",
  /** PowerGSLB answered `{"status":"error"}` or a 5xx. */
  "upstream",
] as const;

export type GslbErrorKind = (typeof GSLB_ERROR_KINDS)[number];

export class GslbError extends Error {
  public readonly kind: GslbErrorKind;
  /** HTTP status, or 0 when no response was received. */
  public readonly status: number;

  public constructor(
    kind: GslbErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(redact(message), { cause: options.cause });
    this.name = "GslbError";
    this.kind = kind;
    this.status = options.status ?? 0;
  }
}

/** Narrow a persisted `probeCache.reason` (free text in the DB) back to a kind. */
export function isGslbErrorKind(value: unknown): value is GslbErrorKind {
  return typeof value === "string" && (GSLB_ERROR_KINDS as readonly string[]).includes(value);
}

/** Operator-facing explanation for a failure class, shown next to a failed Test. */
export function gslbFailureHint(kind: GslbErrorKind): string {
  switch (kind) {
    case "unauthorized":
      return "PowerGSLB rejected the service-account user name or password.";
    case "unreachable":
      return "Could not connect to the base URL (DNS, firewall, timeout, or the URL is blocked by the outbound URL policy).";
    case "tls":
      return "TLS handshake failed. If PowerGSLB uses a private CA, add it via NODE_EXTRA_CA_CERTS.";
    case "protocol":
      return "The base URL answered, but not like a PowerGSLB admin API. Check the URL (no path, /admin/w2ui is appended).";
    case "upstream":
      return "PowerGSLB returned an error. See its log for details.";
  }
}
