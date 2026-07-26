import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export const PINNED_VERCEL_CLI_VERSION = "56.2.0";
const BRACE_EXPANSION_PATCHED_DEPENDENCY = "brace-expansion@2.1.2";
export const BRACE_EXPANSION_RUNTIME_PATCH_PATH =
  "patches/brace-expansion@2.1.2.patch";
const BRACE_EXPANSION_ROOT_PATCH_PATH =
  "scripts/vercel-cli-runtime/patches/brace-expansion@2.1.2.patch";

// This one reviewed successor binds the runtime lockfile, override object, and
// patch bytes. Replace all three together for any later reviewed patch update.
const NEXT_BRACE_EXPANSION_RUNTIME_LOCKFILE_SHA256 =
  "34a95c137dde8278ee54abf81f2c3cc54effc40f25c95f28a4fba80a8225d982";
const NEXT_BRACE_EXPANSION_RUNTIME_OVERRIDE_SHA256 =
  "2a30c91c2e6d82386113535d8a0d03e3faeb2d4af0bc032b9200719e036b490a";
export const BRACE_EXPANSION_PATCH_SHA256 =
  "36cc1afb1cde27a55fa0d111d0134cb5f1eee9201b0ded7990e0b3654113f24b";

// This reviewed controller-owned state permits the one-way runtime rotation
// only with its matching canonical override and, when present, patch state. It
// must never be read from candidate source or PR input.
const TRUSTED_VERCEL_CLI_RUNTIME_STATES = Object.freeze([
  Object.freeze({
    lockfileSha256:
      "505674eac656c26fce2fe912a2b14228f8f4f3edd4b3d6d7b0f2c9f08c276d76",
    overridesSha256:
      "1470e9d2fb8aefb32cd1cfa0f8e6b626663b8ac0de27b52f2e646240c1ece08e",
  }),
  Object.freeze({
    lockfileSha256:
      "884e3c4186c9d5faee0e6cf710b112e7e60cdae5d46be13da1b2b0ae9cf11eb0",
    overridesSha256:
      "0941482390a44f7e16c1f7182469e01162434f9e274059d53d6ebbef2ebed695",
  }),
  Object.freeze({
    lockfileSha256: NEXT_BRACE_EXPANSION_RUNTIME_LOCKFILE_SHA256,
    overridesSha256: NEXT_BRACE_EXPANSION_RUNTIME_OVERRIDE_SHA256,
    patchSha256: BRACE_EXPANSION_PATCH_SHA256,
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
  const hasBraceExpansionPatch = trustedRuntimeState.patchSha256 !== undefined;
  const expectedPnpmKeys = hasBraceExpansionPatch
    ? ["overrides", "patchedDependencies"]
    : ["overrides"];
  const expectedPatchedDependencies = hasBraceExpansionPatch
    ? {
        [BRACE_EXPANSION_PATCHED_DEPENDENCY]:
          BRACE_EXPANSION_RUNTIME_PATCH_PATH,
      }
    : undefined;
  const expectedRootPatchedDependencies = hasBraceExpansionPatch
    ? { [BRACE_EXPANSION_PATCHED_DEPENDENCY]: BRACE_EXPANSION_ROOT_PATCH_PATH }
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
    !hasExactObjectKeys(packageMetadata.dependencies, ["vercel"]) ||
    packageMetadata.dependencies.vercel !== PINNED_VERCEL_CLI_VERSION ||
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
  if (hasBraceExpansionPatch) {
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
    !lockfileText.includes(
      `\n  .:\n    dependencies:\n      vercel:\n        specifier: ${PINNED_VERCEL_CLI_VERSION}\n        version: ${PINNED_VERCEL_CLI_VERSION}`,
    ) ||
    /(?:specifier|version):\s*(?:workspace:|link:|file:|git\+|github:)|\btarball:|\brepo:|\btype:\s*git\b/u.test(
      lockfileText,
    )
  ) {
    throw new Error("Trusted Vercel CLI runtime lockfile structure is invalid");
  }

  return {
    lockfileSha256: lockfileDigest,
    patchRequired: hasBraceExpansionPatch,
    vercel: packageMetadata.dependencies.vercel,
  };
}
