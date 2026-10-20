#!/usr/bin/env node
/**
 * Rotate the standalone Vercel CLI runtime after a root `pnpm.overrides`
 * change (docs/vercel-deployments.md, "Pinned prerequisites").
 *
 *   1. Copy the root `pnpm.overrides` into
 *      `scripts/vercel-cli-runtime/package.json`.
 *   2. Regenerate the runtime lockfile with
 *      `pnpm install --lockfile-only --ignore-workspace`.
 *   3. Recompute `lockfileSha256`, `manifestSha256`, `overridesSha256` and
 *      `runtimeDependenciesSha256` in `contract.json`.
 *   4. Check the result with `assertVercelCliRuntimeContract`.
 *
 * `vercelVersion` and `registryIntegrity` are never changed here: a Vercel CLI
 * upgrade stays a reviewed manual edit. Review the regenerated runtime
 * lockfile with `pnpm lockfile:edge-diff --lockfile
 * scripts/vercel-cli-runtime/pnpm-lock.yaml` before you commit it.
 *
 * Usage: pnpm vercel:cli-runtime:rotate
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  assertVercelCliRuntimeContract,
  canonicalStringMapSha256,
  sha256,
} from "./vercel-cli-runtime-contract.mjs";

const ROTATED_DIGEST_KEYS = Object.freeze([
  "lockfileSha256",
  "manifestSha256",
  "overridesSha256",
  "runtimeDependenciesSha256",
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runtimePaths(repositoryRoot) {
  const runtimeRoot = join(repositoryRoot, "scripts", "vercel-cli-runtime");
  return {
    rootPackageJsonPath: join(repositoryRoot, "package.json"),
    runtimeRoot,
    packageJsonPath: join(runtimeRoot, "package.json"),
    lockfilePath: join(runtimeRoot, "pnpm-lock.yaml"),
    contractPath: join(runtimeRoot, "contract.json"),
  };
}

function regenerateRuntimeLockfile(runtimeRoot) {
  execFileSync("pnpm", ["install", "--lockfile-only", "--ignore-workspace"], {
    cwd: runtimeRoot,
    stdio: "inherit",
  });
}

/**
 * @param {object} options
 * @param {string} options.repositoryRoot
 * @param {(runtimeRoot: string) => void} [options.install] lockfile regenerator
 * @returns {{ overridesChanged: boolean, changes: string[] }}
 */
export function rotateVercelCliRuntimeContract({
  repositoryRoot,
  install = regenerateRuntimeLockfile,
}) {
  const paths = runtimePaths(repositoryRoot);
  const rootOverrides = readJson(paths.rootPackageJsonPath).pnpm?.overrides;
  const runtimePackage = readJson(paths.packageJsonPath);
  const overridesChanged = !isDeepStrictEqual(
    runtimePackage.pnpm?.overrides,
    rootOverrides,
  );
  if (overridesChanged) {
    runtimePackage.pnpm = { ...runtimePackage.pnpm, overrides: rootOverrides };
    writeJson(paths.packageJsonPath, runtimePackage);
  }

  install(paths.runtimeRoot);

  const contract = readJson(paths.contractPath);
  const next = {
    ...contract,
    lockfileSha256: sha256(readFileSync(paths.lockfilePath)),
    manifestSha256: sha256(readFileSync(paths.packageJsonPath)),
    overridesSha256: canonicalStringMapSha256(
      rootOverrides,
      "Root pnpm.overrides",
    ),
    runtimeDependenciesSha256: canonicalStringMapSha256(
      readJson(paths.packageJsonPath).dependencies,
      "Vercel CLI runtime dependencies",
    ),
  };
  const changes = ROTATED_DIGEST_KEYS.filter(
    (key) => contract[key] !== next[key],
  ).map((key) => `${key}: ${contract[key]} -> ${next[key]}`);
  if (changes.length > 0) writeJson(paths.contractPath, next);

  assertVercelCliRuntimeContract({
    rootPackageJsonPath: paths.rootPackageJsonPath,
    packageJsonPath: paths.packageJsonPath,
    lockfilePath: paths.lockfilePath,
    contractPath: paths.contractPath,
    runtimeRootPath: repositoryRoot,
  });
  return { overridesChanged, changes };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const { overridesChanged, changes } = rotateVercelCliRuntimeContract({
    repositoryRoot: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  });
  console.log(
    overridesChanged
      ? "Mirrored root pnpm.overrides into the runtime manifest."
      : "Runtime manifest overrides already match the root.",
  );
  for (const change of changes) console.log(change);
  console.log(
    changes.length > 0
      ? "Contract rotated and verified."
      : "Contract already current and verified.",
  );
}
