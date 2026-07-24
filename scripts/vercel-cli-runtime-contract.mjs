import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export const PINNED_VERCEL_CLI_VERSION = "56.2.0";
// This reviewed controller-owned map permits the one-way #645 lockfile
// rotation only with its matching canonical override state. It must never be
// read from candidate source or PR input.
const TRUSTED_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256_BY_LOCKFILE_SHA256 = new Map([
  [
    "505674eac656c26fce2fe912a2b14228f8f4f3edd4b3d6d7b0f2c9f08c276d76",
    "1470e9d2fb8aefb32cd1cfa0f8e6b626663b8ac0de27b52f2e646240c1ece08e",
  ],
  [
    "884e3c4186c9d5faee0e6cf710b112e7e60cdae5d46be13da1b2b0ae9cf11eb0",
    "0941482390a44f7e16c1f7182469e01162434f9e274059d53d6ebbef2ebed695",
  ],
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
}) {
  const rootPackageMetadata = JSON.parse(
    readFileSync(rootPackageJsonPath, "utf8"),
  );
  const packageMetadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const rootOverrides = rootPackageMetadata.pnpm?.overrides;
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
    !hasExactObjectKeys(packageMetadata.pnpm, ["overrides"]) ||
    !isDeepStrictEqual(packageMetadata.pnpm.overrides, rootOverrides)
  ) {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }

  const lockfileContents = readFileSync(lockfilePath);
  const lockfileDigest = createHash("sha256")
    .update(lockfileContents)
    .digest("hex");
  const expectedOverridesSha256 =
    TRUSTED_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256_BY_LOCKFILE_SHA256.get(
      lockfileDigest,
    );
  if (expectedOverridesSha256 === undefined) {
    throw new Error("Trusted Vercel CLI runtime lockfile is not exact");
  }
  if (rootOverridesSha256 !== expectedOverridesSha256) {
    throw new Error(
      "Trusted Vercel CLI runtime lockfile and overrides are not an approved pair",
    );
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
    vercel: packageMetadata.dependencies.vercel,
  };
}
