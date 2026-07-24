import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

export const PINNED_VERCEL_CLI_VERSION = "56.2.0";
const PINNED_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "884e3c4186c9d5faee0e6cf710b112e7e60cdae5d46be13da1b2b0ae9cf11eb0";

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
    rootPackageMetadata.devDependencies?.vercel !== PINNED_VERCEL_CLI_VERSION ||
    rootOverrides === null ||
    typeof rootOverrides !== "object" ||
    Array.isArray(rootOverrides)
  ) {
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
  if (lockfileDigest !== PINNED_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256) {
    throw new Error("Trusted Vercel CLI runtime lockfile is not exact");
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
