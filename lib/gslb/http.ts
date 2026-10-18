/**
 * lib/gslb/http.ts
 *
 * Low-level transport for the PowerGSLB w2ui admin API. Every call is a
 * form-encoded `POST <baseUrl>/admin/w2ui` with HTTP Basic Auth. Handles:
 *   - the SSRF guard re-check + address pinning (DNS-rebinding defense),
 *   - a per-request timeout,
 *   - error normalization into `GslbError` kinds,
 *   - Zod validation of the reply envelope (third-party response boundary).
 *
 * No retries, unlike `lib/pdns/http.ts`: `save-record` with `recid=0` is a
 * non-idempotent insert and PowerGSLB returns no row id, so a retried insert
 * after a lost reply would silently duplicate the row. Callers re-read and
 * decide instead.
 *
 * The Authorization header is built per request from the decrypted password
 * and is never logged; log lines carry the backend slug, command and table only.
 */

import "server-only";
import { fetch as undiciFetch, type Agent } from "undici";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { buildPinnedDispatcher } from "@/lib/net/pinned-fetch";
import { GslbError } from "./errors";
import { checkGslbUrlSafe } from "./url-safety";

/** Appended to the stored base URL; the admin API has no other entry point. */
export const GSLB_ADMIN_PATH = "/admin/w2ui";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * PowerGSLB's admin server is a threaded stdlib HTTP/1.1 server, so no H2 and
 * no long keep-alive: the pinned dispatcher is single-use anyway.
 */
const GSLB_AGENT_OPTIONS: Agent.Options = {
  connectTimeout: DEFAULT_TIMEOUT_MS,
  headersTimeout: DEFAULT_TIMEOUT_MS,
  bodyTimeout: DEFAULT_TIMEOUT_MS,
};

/**
 * Node TLS error codes that mean "the certificate was not accepted", as
 * opposed to a plain connection failure. Surfaced as `kind: "tls"` so the
 * operator is pointed at NODE_EXTRA_CA_CERTS rather than the firewall.
 */
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_SSL_WRONG_VERSION_NUMBER",
]);

export interface GslbHttpConfig {
  /** Admin API root, no trailing slash, no path. */
  baseUrl: string;
  username: string;
  /** Already decrypted by the caller (see `registry.ts`). */
  password: string;
  /** Backend slug - included in log fields. */
  backendSlug: string;
  timeoutMs?: number;
}

export interface GslbRequestInit {
  /** w2ui command, e.g. `get-records`. */
  cmd: "get-records" | "get-record" | "get-items" | "save-record" | "delete-records";
  /** Table token. */
  data: string;
  /** Extra form fields (`recid`, `limit`, `record[name]`, `selected[0]`, ...). */
  params?: Array<[string, string]>;
  signal?: AbortSignal;
}

const envelopeSchema = z.discriminatedUnion("status", [
  z.looseObject({ status: z.literal("success") }),
  z.looseObject({ status: z.literal("error"), message: z.string().optional() }),
]);

/**
 * Execute one admin-API command and return the parsed `success` envelope.
 * Callers narrow the payload (`records`, `record`, `total`) with their own
 * schema.
 *
 * @throws {GslbError} on transport, TLS, auth, protocol or `status: "error"`.
 */
export async function gslbRequest(
  config: GslbHttpConfig,
  init: GslbRequestInit,
): Promise<Record<string, unknown>> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${GSLB_ADMIN_PATH}`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = logger.child({ gslbBackend: config.backendSlug, cmd: init.cmd, data: init.data });

  const safety = await checkGslbUrlSafe(url);
  if (!safety.safe) {
    throw new GslbError("unreachable", `Refusing to call unsafe URL: ${safety.reason}`);
  }
  const dispatcher = buildPinnedDispatcher(safety.addresses, GSLB_AGENT_OPTIONS);

  const form = new URLSearchParams();
  form.set("cmd", init.cmd);
  form.set("data", init.data);
  for (const [key, value] of init.params ?? []) form.append(key, value);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([controller.signal, init.signal])
    : controller.signal;

  const start = Date.now();
  let status: number;
  let text: string;
  try {
    const response = await undiciFetch(url, {
      method: "POST",
      signal,
      dispatcher,
      headers: {
        Authorization: basicAuthHeader(config.username, config.password),
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      // SSRF guard: the guard validated only this URL; never follow a 3xx to
      // an address it didn't check. PowerGSLB never redirects the API path.
      redirect: "error",
    });
    status = response.status;
    text = await response.text();
  } catch (err) {
    const error = classifyTransportError(err, controller.signal.aborted, timeoutMs);
    log.warn(
      { ms: Date.now() - start, kind: error.kind, error: error.message },
      "gslb.request.failed",
    );
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    // Single-use: it carries this request's pinned address.
    void dispatcher.close().catch(() => undefined);
  }

  const elapsed = Date.now() - start;
  try {
    const envelope = parseEnvelope(status, text);
    log.info({ ms: elapsed, status }, "gslb.request.ok");
    return envelope;
  } catch (err) {
    if (err instanceof GslbError) {
      log.warn({ ms: elapsed, status, kind: err.kind, error: err.message }, "gslb.request.failed");
    }
    throw err;
  }
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function parseEnvelope(status: number, text: string): Record<string, unknown> {
  if (status === 401 || status === 403) {
    throw new GslbError("unauthorized", "PowerGSLB rejected the credentials.", { status });
  }
  if (status >= 500) {
    throw new GslbError("upstream", `PowerGSLB returned HTTP ${status}.`, { status });
  }
  if (status < 200 || status >= 300) {
    // 404 and friends: something answered, but the admin API isn't at this path.
    throw new GslbError("protocol", `Unexpected HTTP ${status} from the admin API.`, { status });
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GslbError("protocol", "Admin API reply is not JSON.", { status });
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new GslbError("protocol", "Admin API reply has an unknown shape.", { status });
  }
  if (parsed.data.status === "error") {
    const message = parsed.data.message ?? "unknown";
    throw new GslbError("upstream", `PowerGSLB error: ${message}`, { status });
  }
  return parsed.data;
}

/**
 * Walk the undici error / `.cause` chain for a Node error code so a TLS
 * rejection is told apart from a refused connection.
 */
function classifyTransportError(err: unknown, timedOut: boolean, timeoutMs: number): GslbError {
  if (timedOut) {
    return new GslbError("unreachable", `Timed out after ${timeoutMs} ms.`, { cause: err });
  }
  const parts: string[] = [];
  let tls = false;
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string") {
      if (TLS_ERROR_CODES.has(code) || code.startsWith("ERR_SSL_") || code.startsWith("ERR_TLS_")) {
        tls = true;
      }
      parts.push(`${current.message} (${code})`);
    } else {
      parts.push(current.message);
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  const message = parts.length > 0 ? parts.join(" -> ") : "transport failure";
  return new GslbError(tls ? "tls" : "unreachable", message, { cause: err });
}
