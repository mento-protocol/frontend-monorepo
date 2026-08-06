import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const PINNED_VERCEL_CLI_VERSION = "56.4.1";
const PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES = Object.freeze({
  "@vercel/backends": "0.8.25",
  "@vercel/container": "0.0.5",
  "@vercel/elysia": "0.1.102",
  "@vercel/express": "0.1.116",
  "@vercel/fastify": "0.1.105",
  "@vercel/go": "3.10.2",
  "@vercel/h3": "0.1.111",
  "@vercel/hono": "0.2.105",
  "@vercel/hydrogen": "1.4.0",
  "@vercel/koa": "0.1.85",
  "@vercel/nestjs": "0.2.106",
  "@vercel/next": "4.20.4",
  "@vercel/node": "5.8.26",
  "@vercel/python": "6.51.0",
  "@vercel/redwood": "2.5.0",
  "@vercel/remix-builder": "5.9.1",
  "@vercel/ruby": "2.5.1",
  "@vercel/rust": "1.4.0",
  "@vercel/static-build": "2.11.8",
  vercel: PINNED_VERCEL_CLI_VERSION,
});
const BRACE_EXPANSION_PATCHED_DEPENDENCY = "brace-expansion@2.1.2";
export const BRACE_EXPANSION_RUNTIME_PATCH_PATH =
  "patches/brace-expansion@2.1.2.patch";
const BRACE_EXPANSION_ROOT_PATCH_PATH =
  "scripts/vercel-cli-runtime/patches/brace-expansion@2.1.2.patch";

// This reviewed pair binds the previous runtime lockfile, override object,
// and brace-expansion patch required by the direct builder graph.
const BRACE_EXPANSION_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "a8341932863259f7abf6dd354911cf4b13beb15b77c98c763377fcfed13f279b";
const BRACE_EXPANSION_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256 =
  "2a30c91c2e6d82386113535d8a0d03e3faeb2d4af0bc032b9200719e036b490a";
export const BRACE_EXPANSION_PATCH_SHA256 =
  "7cf518c5d9dbf4290d0f48d3fa4673d4a163d0088d2d1294e417b9909c111833";

// This reviewed successor binds the 2026-08-05 security-floor rotation: it
// raises the brace-expansion (GHSA-rgw5-rvv9-x895), fast-uri, hono,
// ip-address, postcss, socket.io-parser, undici, and uuid override floors and
// retires the local brace-expansion@2.1.2 patch, superseded by the upstream
// fixed release 2.1.4.
const NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "5c70b093926a8ed722b9a912ea9b4f2a3996e373bde2118be9975baf93c8fa9e";
const NEXT_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256 =
  "d97b2eead9f597f82f99ba4d2a4b8e0a883dad129190f17838838d0209693867";

// This reviewed controller-owned state permits the one-way runtime rotation
// only with its matching canonical override and, when present, patch state. It
// must never be read from candidate source or PR input.
const TRUSTED_VERCEL_CLI_RUNTIME_STATES = Object.freeze([
  Object.freeze({
    lockfileSha256: BRACE_EXPANSION_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    overridesSha256: BRACE_EXPANSION_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256,
    patchSha256: BRACE_EXPANSION_PATCH_SHA256,
    rootPatchSha256: BRACE_EXPANSION_PATCH_SHA256,
  }),
  Object.freeze({
    lockfileSha256: NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    overridesSha256: NEXT_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256,
  }),
]);

function hasExactObjectKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys
      .toSorted()
      .every((expectedKey, index) => actualKeys[index] === expectedKey)
  );
}

function canonicalOverrideSha256(overrides) {
  if (
    overrides === null ||
    typeof overrides !== "object" ||
    Array.isArray(overrides) ||
    Object.entries(overrides).some(
      ([name, value]) =>
        typeof name !== "string" ||
        name.length === 0 ||
        typeof value !== "string" ||
        value.length === 0,
    )
  ) {
    throw new Error("Trusted root Vercel CLI overrides are invalid");
  }
  const canonical = Object.fromEntries(
    Object.entries(overrides).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function assertVercelCliRuntimeContract({
  rootPackageJsonPath,
  packageJsonPath,
  lockfilePath,
  patchFilePath,
  trustedRuntimeStates = TRUSTED_VERCEL_CLI_RUNTIME_STATES,
}) {
  const rootPackageMetadata = JSON.parse(
    readFileSync(rootPackageJsonPath, "utf8"),
  );
  const packageMetadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const rootPnpm = rootPackageMetadata.pnpm;
  const rootOverrides = rootPnpm?.overrides;
  if (
    rootPackageMetadata.devDependencies?.vercel !== PINNED_VERCEL_CLI_VERSION
  ) {
    throw new Error("Trusted root Vercel CLI contract is invalid");
  }
  let rootOverridesSha256;
  try {
    rootOverridesSha256 = canonicalOverrideSha256(rootOverrides);
  } catch {
    throw new Error("Trusted root Vercel CLI contract is invalid");
  }
  const lockfileContents = readFileSync(lockfilePath);
  const lockfileDigest = createHash("sha256")
    .update(lockfileContents)
    .digest("hex");
  const trustedRuntimeState = trustedRuntimeStates.find(
    (state) => state?.lockfileSha256 === lockfileDigest,
  );
  if (trustedRuntimeState === undefined) {
    throw new Error("Trusted Vercel CLI runtime lockfile is not exact");
  }
  const hasRuntimePatch = trustedRuntimeState.patchSha256 !== undefined;
  const hasRootPatch = trustedRuntimeState.rootPatchSha256 !== undefined;
  const expectedPnpmKeys = hasRuntimePatch
    ? ["overrides", "patchedDependencies"]
    : ["overrides"];
  const expectedPatchedDependencies = hasRuntimePatch
    ? {
        [BRACE_EXPANSION_PATCHED_DEPENDENCY]:
          BRACE_EXPANSION_RUNTIME_PATCH_PATH,
      }
    : undefined;
  const expectedRootPatchedDependencies = hasRootPatch
    ? {
        [BRACE_EXPANSION_PATCHED_DEPENDENCY]: BRACE_EXPANSION_ROOT_PATCH_PATH,
      }
    : undefined;
  if (
    !hasExactObjectKeys(packageMetadata, [
      "dependencies",
      "description",
      "name",
      "pnpm",
      "private",
      "version",
    ]) ||
    packageMetadata.name !== "@mento-protocol/vercel-cli-runtime" ||
    packageMetadata.version !== "0.0.0" ||
    packageMetadata.private !== true ||
    packageMetadata.description !==
      "Standalone pinned Vercel CLI runtime for protected GitHub Actions deployments" ||
    !hasExactObjectKeys(
      packageMetadata.dependencies,
      Object.keys(PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES),
    ) ||
    !isDeepStrictEqual(
      packageMetadata.dependencies,
      PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES,
    ) ||
    !hasExactObjectKeys(packageMetadata.pnpm, expectedPnpmKeys) ||
    !isDeepStrictEqual(packageMetadata.pnpm.overrides, rootOverrides) ||
    !isDeepStrictEqual(
      packageMetadata.pnpm.patchedDependencies,
      expectedPatchedDependencies,
    ) ||
    !isDeepStrictEqual(
      rootPnpm.patchedDependencies,
      expectedRootPatchedDependencies,
    )
  ) {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }
  if (rootOverridesSha256 !== trustedRuntimeState.overridesSha256) {
    throw new Error(
      "Trusted Vercel CLI runtime lockfile and overrides are not an approved pair",
    );
  }
  if (hasRootPatch) {
    let rootPatchDigest;
    try {
      rootPatchDigest = createHash("sha256")
        .update(
          readFileSync(
            join(dirname(rootPackageJsonPath), BRACE_EXPANSION_ROOT_PATCH_PATH),
          ),
        )
        .digest("hex");
    } catch {
      throw new Error("Trusted root brace-expansion patch is missing");
    }
    if (rootPatchDigest !== trustedRuntimeState.rootPatchSha256) {
      throw new Error("Trusted root brace-expansion patch is not exact");
    }
  }
  if (hasRuntimePatch) {
    if (typeof patchFilePath !== "string") {
      throw new Error("Trusted Vercel CLI runtime patch is missing");
    }
    const patchDigest = createHash("sha256")
      .update(readFileSync(patchFilePath))
      .digest("hex");
    if (patchDigest !== trustedRuntimeState.patchSha256) {
      throw new Error("Trusted Vercel CLI runtime patch is not exact");
    }
  } else if (patchFilePath !== undefined) {
    throw new Error("Trusted Vercel CLI runtime patch is unexpected");
  }
  const lockfileText = lockfileContents.toString("utf8");
  if (
    !lockfileText.startsWith("lockfileVersion: '9.0'\n") ||
    !new RegExp(
      `\\n      vercel:\\n        specifier: ${PINNED_VERCEL_CLI_VERSION}\\n        version: ${PINNED_VERCEL_CLI_VERSION}(?:\\(|\\n)`,
      "u",
    ).test(lockfileText) ||
    /(?:specifier|version):\s*(?:workspace:|link:|file:|git\+|github:)|\btarball:|\brepo:|\btype:\s*git\b/u.test(
      lockfileText,
    )
  ) {
    throw new Error("Trusted Vercel CLI runtime lockfile structure is invalid");
  }

  return {
    lockfileSha256: lockfileDigest,
    patchRequired: hasRuntimePatch,
    vercel: PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES.vercel,
  };
}
