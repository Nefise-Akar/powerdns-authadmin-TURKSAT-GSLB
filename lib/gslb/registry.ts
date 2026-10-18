/**
 * lib/gslb/registry.ts
 *
 * Turns a `gslb_backends` row into a configured `GslbClient`: reads the row and
 * decrypts the service-account password. This is the *bridge*, not the
 * protocol client - the same sanctioned exception `lib/pdns/registry.ts` has
 * under ADR-0013, so the rest of `lib/gslb/` stays a pure adapter.
 *
 * No client cache: unlike the PDNS client there is no version snapshot to
 * keep warm, and building a client is one AES-GCM decrypt. Not caching also
 * means a rotated password or URL takes effect on the very next call.
 */

/* eslint-disable no-restricted-imports -- Sanctioned lib/gslb→lib/db bridge:
   this module turns a `gslb_backends` row into a configured GslbClient (reads
   the row, decrypts the password). It is the bridge, not the protocol client.
   See ADR-0013 and ADR-0024. */
import "server-only";
import { decrypt } from "@/lib/crypto/encryption";
import { findGslbBackendById } from "@/lib/db/repositories/gslb-backends";
import type { GslbBackend } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import { GslbClient } from "./client";

/** `encrypt`/`decrypt` usage label; the route that writes the envelope uses the same one. */
export const GSLB_PASSWORD_USAGE = "gslb-backend-password";

/**
 * Probe clients fail fast so the admin Test action answers in seconds even
 * when the backend is down; interactive writes keep the default timeout.
 */
const PROBE_TIMEOUT_MS = 5_000;

/** Build a client for an already-loaded row. */
export function getGslbClientForRow(
  row: GslbBackend,
  options: { probe?: boolean; timeoutMs?: number } = {},
): GslbClient {
  return new GslbClient({
    baseUrl: row.baseUrl,
    username: row.username,
    password: decrypt(row.passwordEncrypted, GSLB_PASSWORD_USAGE),
    backendSlug: row.slug,
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : options.probe
        ? { timeoutMs: PROBE_TIMEOUT_MS }
        : {}),
  });
}

/**
 * Load the row and build its client.
 *
 * @throws {NotFoundError} when no backend row matches `id`.
 */
export async function getGslbClient(id: string): Promise<GslbClient> {
  const row = await findGslbBackendById(id);
  if (!row) throw new NotFoundError(`GSLB backend ${id} not found.`);
  return getGslbClientForRow(row);
}
