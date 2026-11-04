/**
 * lib/app-meta.ts
 *
 * App identity surfaced in the UI - the running version.
 * package.json is the single source of truth for the semver, so cutting a
 * release only has to bump one file.
 *
 * Three build kinds, distinguished by the build env the image carries:
 *
 *   • release - image built from a `vX.Y.Z` tag (CI sets APP_RELEASE=true).
 *     The label is "1.1.0".
 *   • commit  - non-release image past the last tag. CI injects the commit SHA
 *     (Dockerfile `runner` stage + the docker job), so the label is
 *     "1.1.0+abc1234" - never claiming to be a release it isn't.
 *   • dev     - no VCS info at all: `npm run dev`, `npm run build && start`, or
 *     a plain `docker build` with no build-args, labelled "1.1.0-dev".
 *
 * Server-only: keeps package.json (scripts, the full dependency tree) out of
 * any client bundle, and reads the build env (APP_GIT_SHA / APP_RELEASE) at
 * runtime on the server.
 */

import "server-only";
import pkg from "@/package.json";
import { env } from "@/lib/env";

/** Short commit SHA baked into the image at build time, or null in local dev. */
const rawSha = env.APP_GIT_SHA?.trim();
const shortSha = rawSha ? rawSha.slice(0, 7) : null;

type BuildKind = "release" | "commit" | "dev";
const buildKind: BuildKind = env.APP_RELEASE ? "release" : shortSha !== null ? "commit" : "dev";

/** True only for an image built from a `vX.Y.Z` release tag. */
export const IS_RELEASE_BUILD: boolean = buildKind === "release";

/** Semver of the running build, e.g. "1.1.0". */
export const APP_VERSION: string = pkg.version;

/** Short commit SHA of the running build, or null when unknown (dev builds). */
export const APP_GIT_SHA: string | null = shortSha;

/**
 * Display label for the sidebar version chip: "1.1.0" for a release,
 * "1.1.0+abc1234" (semver build metadata) for a commit build, or "1.1.0-dev"
 * (semver pre-release) for a local/dev build with no commit info.
 */
export const APP_VERSION_LABEL: string =
  buildKind === "release"
    ? pkg.version
    : buildKind === "commit"
      ? `${pkg.version}+${shortSha}`
      : `${pkg.version}-dev`;
