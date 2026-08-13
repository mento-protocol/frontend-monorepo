import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
// This reviewed pair binds the current August 2026 security-floor runtime. It
// raises the brace-expansion, DOMPurify, fast-uri, Hono, ip-address, js-yaml,
// nanoid, PostCSS, socket.io-parser, Undici, and uuid floors and retires the
// local brace-expansion@2.1.2 patch in favor of upstream 2.1.4. It also includes
// the override moving Next to ^16.2.12 alongside the catalog (PR #715).
const CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "957ccb3b8431add07a144e77966b4a05733aaca6f21cd071c937861fc10189d4";
const CURRENT_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256 =
  "301165d803f4cc7db4524ea3a7a02b33db772505c04fdc9025860b244bcb447b";

// This reviewed successor raises only the nanoid floor from 3.3.17 to 3.3.18.
// The controller must land this bridge before the matching root and standalone
// payload. Remove the current pair immediately after that payload is proven on
// the default branch.
const NEXT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256 =
  "2dbd0eba57b119870bcd2ba43f6cf726bb52c85d8ec03f4999030e9931e5ed36";
const NEXT_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256 =
  "11fc5e7476b6d15ddf6bf8d6956f6566346637f34e0b11e23849e92011b2bf31";

// This controller-owned mapping permits only each reviewed lockfile with its
// matching canonical root override object. Candidate or PR-authored source
// cannot supply or extend it.
const TRUSTED_VERCEL_CLI_RUNTIME_STATES = Object.freeze([
  Object.freeze({
    lockfileSha256: CURRENT_VERCEL_CLI_RUNTIME_LOCKFILE_SHA256,
    overridesSha256: CURRENT_VERCEL_CLI_RUNTIME_OVERRIDE_SHA256,
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
  const trustedRuntimeState = TRUSTED_VERCEL_CLI_RUNTIME_STATES.find(
    (state) => state.lockfileSha256 === lockfileDigest,
  );
  if (trustedRuntimeState === undefined) {
    throw new Error("Trusted Vercel CLI runtime lockfile is not exact");
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
    !hasExactObjectKeys(
      packageMetadata.dependencies,
      Object.keys(PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES),
    ) ||
    !isDeepStrictEqual(
      packageMetadata.dependencies,
      PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES,
    ) ||
    !hasExactObjectKeys(packageMetadata.pnpm, ["overrides"]) ||
    !isDeepStrictEqual(packageMetadata.pnpm.overrides, rootOverrides) ||
    packageMetadata.pnpm.patchedDependencies !== undefined ||
    rootPnpm.patchedDependencies !== undefined
  ) {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }
  if (rootOverridesSha256 !== trustedRuntimeState.overridesSha256) {
    throw new Error(
      "Trusted Vercel CLI runtime lockfile and overrides are not an approved pair",
    );
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
    vercel: PINNED_VERCEL_CLI_RUNTIME_DEPENDENCIES.vercel,
  };
}
