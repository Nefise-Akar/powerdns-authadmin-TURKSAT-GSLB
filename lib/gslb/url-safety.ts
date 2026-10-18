/**
 * lib/gslb/url-safety.ts
 *
 * PowerGSLB-flavored wrapper over the dialect-neutral SSRF guard
 * (`lib/net/url-safety.ts`). The GSLB base URL is operator-supplied and
 * fetched server-side, so it is checked before being persisted and again
 * before every request (DNS-rebinding defense; `http.ts` pins the validated
 * address into the connection).
 *
 * Policy mirrors the PDNS pair:
 *   - `APP_GSLB_ALLOW_PRIVATE_NETWORKS` - loopback / RFC1918 / CGNAT / ULA.
 *     Default permissive in non-prod, strict in prod.
 *   - `APP_GSLB_ALLOW_INSECURE_HTTP` - relax the https-in-prod scheme check.
 * Link-local (incl. 169.254.169.254 cloud metadata) is always blocked.
 */

import "server-only";
import { env, isProduction } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import {
  checkOutboundUrlSafe,
  type OutboundUrlPolicy,
  type UrlSafetyResult,
} from "@/lib/net/url-safety";

export type { UrlSafetyResult };

function gslbPolicy(): OutboundUrlPolicy {
  return {
    allowPrivateNetworks: env.APP_GSLB_ALLOW_PRIVATE_NETWORKS ?? !isProduction,
    allowInsecureHttp: env.APP_GSLB_ALLOW_INSECURE_HTTP === true,
    // Unlike OIDC, a GSLB backend that doesn't resolve is unusable - fail fast
    // on save, the same as a PDNS backend.
    label: "Base URL",
    insecureHttpHint:
      "Set APP_GSLB_ALLOW_INSECURE_HTTP=true to allow http:// when PowerGSLB lives on a private network without TLS.",
    privateNetworkHint:
      "Set APP_GSLB_ALLOW_PRIVATE_NETWORKS=true to allow this in your environment.",
  };
}

/** Validate a GSLB backend URL. Returns a discriminated result. */
export async function checkGslbUrlSafe(urlString: string): Promise<UrlSafetyResult> {
  return checkOutboundUrlSafe(urlString, gslbPolicy());
}

/**
 * Throwing variant for the admin create/update routes.
 *
 * @throws {ValidationError} when the URL resolves to a blocked address or uses
 *   a disallowed scheme.
 */
export async function assertSafeGslbUrl(urlString: string): Promise<void> {
  const result = await checkGslbUrlSafe(urlString);
  if (!result.safe) throw new ValidationError(result.reason);
}
