#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assertVercelCliRuntimeContract } from "./vercel-cli-runtime-contract.mjs";

export const CUSTOM_DEPLOYMENT_ID_ENV = "MENTO_NEXT_DEPLOYMENT_ID";
export const VERCEL_TARGETS = ["app", "governance", "reserve", "ui"];

const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_ROOT_PACKAGE_BYTES = 1024 * 1024;
const MAX_ROOT_LOCKFILE_BYTES = 16 * 1024 * 1024;

function readBoundedCandidatePath(repoRoot, path, maximumBytes, label) {
  try {
    const requestedRoot = resolve(repoRoot);
    const rootEntry = lstatSync(requestedRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      throw new Error("unsafe root");
    }
    const root = realpathSync(requestedRoot);
    const candidate = resolve(requestedRoot, path);
    const canonicalCandidate = realpathSync(candidate);
    const expectedCandidate = resolve(root, path);
    const fromRoot = relative(root, canonicalCandidate);
    const entry = lstatSync(candidate);
    if (
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      fromRoot.length === 0 ||
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.size < 1 ||
      entry.size > maximumBytes ||
      canonicalCandidate !== expectedCandidate
    ) {
      throw new Error("unsafe file");
    }
    const contents = readFileSync(candidate);
    if (contents.byteLength !== entry.size) throw new Error("file changed");
    return contents;
  } catch {
    throw new Error(`${label} is unreadable or unsafe`);
  }
}

export function assertValidDeploymentId(deploymentId) {
  if (typeof deploymentId !== "string" || deploymentId.length === 0) {
    throw new Error("Deployment ID is required");
  }
  if (deploymentId.length > 32) {
    throw new Error("Deployment ID must be at most 32 characters");
  }
  if (!DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
    throw new Error("Deployment ID contains unsupported characters");
  }
  if (deploymentId.startsWith("dpl_")) {
    throw new Error("Deployment ID must not use Vercel's reserved dpl_ prefix");
  }
  return deploymentId;
}

function assertPositiveInteger(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive integer string`);
  }
  return value;
}

function assertRepository(repository) {
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Repository must be an owner/name identifier");
  }
  return repository;
}

function assertCommitSha(commitSha) {
  if (
    typeof commitSha !== "string" ||
    !/^[A-Fa-f0-9]{40,64}$/.test(commitSha)
  ) {
    throw new Error("Commit SHA must be an immutable 40- or 64-digit hex SHA");
  }
  return commitSha.toLowerCase();
}

function stableDigest(parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

// A release identifies the immutable source and validated upstream CI run. It
// survives downstream workflow reruns, unlike mutation transaction IDs and
// journal IDs.
export function generateVercelMainReleaseId({
  repository,
  commitSha,
  upstreamRunId,
}) {
  const digest = stableDigest([
    "vercel-main-release:v1",
    assertRepository(repository),
    assertCommitSha(commitSha),
    assertPositiveInteger(upstreamRunId, "Upstream run ID"),
  ]);
  return assertValidDeploymentId(`mr-${digest.slice(0, 24)}`);
}

// This is the Next/Vercel custom deployment ID for a release candidate. It
// deliberately excludes runAttempt so a retry can discover one candidate.
export function generateVercelMainCandidateDeploymentId({
  repository,
  target,
  commitSha,
  upstreamRunId,
}) {
  if (!VERCEL_TARGETS.includes(target)) {
    throw new Error(`Unknown Vercel target: ${String(target)}`);
  }
  const digest = stableDigest([
    "vercel-main-candidate:v1",
    assertRepository(repository),
    target,
    assertCommitSha(commitSha),
    assertPositiveInteger(upstreamRunId, "Upstream run ID"),
  ]);
  return assertValidDeploymentId(`mr-${target}-${digest.slice(0, 18)}`);
}

export function generateVercelDeploymentId({
  target,
  commitSha,
  runId,
  runAttempt,
}) {
  if (!VERCEL_TARGETS.includes(target)) {
    throw new Error(`Unknown Vercel target: ${String(target)}`);
  }
  const canonicalCommitSha = assertCommitSha(commitSha);
  assertPositiveInteger(runId, "Run ID");
  assertPositiveInteger(runAttempt, "Run attempt");

  const digest = stableDigest([target, canonicalCommitSha, runId, runAttempt]);
  return assertValidDeploymentId(`m-${target}-${digest.slice(0, 19)}`);
}

export function assertPrebuiltDeploymentId(outputDirectory, expectedId) {
  assertValidDeploymentId(expectedId);
  const configPath = outputDirectory.endsWith("config.json")
    ? outputDirectory
    : join(outputDirectory, "config.json");

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new Error(`Missing or invalid prebuilt config: ${configPath}`);
  }

  if (!Object.hasOwn(config, "deploymentId")) {
    throw new Error("Prebuilt config is missing deploymentId");
  }
  if (config.deploymentId !== expectedId) {
    throw new Error("Prebuilt deploymentId does not match the generated ID");
  }
  return expectedId;
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`Unsupported version: ${version}`);
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split(".") ?? null,
  };
}

function comparePrereleaseIdentifiers(candidate, minimum) {
  const candidateIsNumeric = /^(?:0|[1-9][0-9]*)$/.test(candidate);
  const minimumIsNumeric = /^(?:0|[1-9][0-9]*)$/.test(minimum);

  if (candidateIsNumeric && minimumIsNumeric) {
    const candidateNumber = BigInt(candidate);
    const minimumNumber = BigInt(minimum);
    if (candidateNumber === minimumNumber) return 0;
    return candidateNumber > minimumNumber ? 1 : -1;
  }
  if (candidateIsNumeric) return -1;
  if (minimumIsNumeric) return 1;
  if (candidate === minimum) return 0;
  return candidate > minimum ? 1 : -1;
}

export function isVersionGreaterThan(version, minimumExclusive) {
  const candidate = parseVersion(version);
  const minimum = parseVersion(minimumExclusive);
  for (let index = 0; index < candidate.numbers.length; index += 1) {
    if (candidate.numbers[index] !== minimum.numbers[index]) {
      return candidate.numbers[index] > minimum.numbers[index];
    }
  }

  if (candidate.prerelease === null) return minimum.prerelease !== null;
  if (minimum.prerelease === null) return false;

  const identifiers = Math.max(
    candidate.prerelease.length,
    minimum.prerelease.length,
  );
  for (let index = 0; index < identifiers; index += 1) {
    if (candidate.prerelease[index] === undefined) return false;
    if (minimum.prerelease[index] === undefined) return true;
    const comparison = comparePrereleaseIdentifiers(
      candidate.prerelease[index],
      minimum.prerelease[index],
    );
    if (comparison !== 0) return comparison > 0;
  }
  return false;
}

export function readResolvedNextVersion(lockfile) {
  const match = /^ {2}next@(\d+\.\d+\.\d+(?:-[^:]+)?):$/m.exec(lockfile);
  if (!match) throw new Error("Could not resolve Next.js from pnpm-lock.yaml");
  return match[1];
}

function assertDeploymentIdPrerequisitesWithContract(repoRoot, contractPath) {
  const packageJson = JSON.parse(
    readBoundedCandidatePath(
      repoRoot,
      "package.json",
      MAX_ROOT_PACKAGE_BYTES,
      "Root package manifest",
    ).toString("utf8"),
  );
  const rootLockfile = readBoundedCandidatePath(
    repoRoot,
    "pnpm-lock.yaml",
    MAX_ROOT_LOCKFILE_BYTES,
    "Root lockfile",
  ).toString("utf8");
  const nextVersion = readResolvedNextVersion(rootLockfile);
  const vercelVersion = packageJson.devDependencies?.vercel;

  if (
    typeof vercelVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(vercelVersion)
  ) {
    throw new Error("Vercel CLI must be pinned to an exact stable version");
  }
  if (!isVersionGreaterThan(nextVersion, "16.2.0-canary.15")) {
    throw new Error("Resolved Next.js is too old for custom deployment IDs");
  }
  if (!isVersionGreaterThan(vercelVersion, "50.3.3")) {
    throw new Error("Pinned Vercel CLI is too old for custom deployment IDs");
  }
  const escapedVercelVersion = vercelVersion.replaceAll(".", "\\.");
  if (
    !new RegExp(
      `\\n      vercel:\\n        specifier: ${escapedVercelVersion}\\n        version: ${escapedVercelVersion}(?:\\(|\\n)`,
      "u",
    ).test(rootLockfile)
  ) {
    throw new Error("Root Vercel manifest and lockfile are inconsistent");
  }

  const runtimePackageJsonPath = join(
    repoRoot,
    "scripts",
    "vercel-cli-runtime",
    "package.json",
  );
  const vercelCliRuntime = assertVercelCliRuntimeContract({
    ...(contractPath === undefined ? {} : { contractPath }),
    rootPackageJsonPath: join(repoRoot, "package.json"),
    packageJsonPath: runtimePackageJsonPath,
    lockfilePath: join(
      repoRoot,
      "scripts",
      "vercel-cli-runtime",
      "pnpm-lock.yaml",
    ),
  });

  return { next: nextVersion, vercel: vercelVersion, vercelCliRuntime };
}

export function assertDeploymentIdPrerequisites(repoRoot) {
  return assertDeploymentIdPrerequisitesWithContract(repoRoot, undefined);
}

// This check proves only that candidate package and lock data agree with the
// candidate's own digest-bound runtime contract. It does not select the
// protected CLI or grant deployment authority; those remain controller-owned.
export function assertCandidateDeploymentIdPrerequisites(repoRoot) {
  return assertDeploymentIdPrerequisitesWithContract(
    repoRoot,
    join(repoRoot, "scripts", "vercel-cli-runtime", "contract.json"),
  );
}

function parseArguments(argv) {
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return { command: argv[0], options };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const { command, options } = parseArguments(process.argv.slice(2));

  if (command === "deployment-id") {
    process.stdout.write(
      `${generateVercelDeploymentId({
        target: options.target,
        commitSha: options.sha,
        runId: options["run-id"],
        runAttempt: options["run-attempt"],
      })}\n`,
    );
  } else if (command === "main-release-id") {
    process.stdout.write(
      `${generateVercelMainReleaseId({
        repository: options.repository,
        commitSha: options.sha,
        upstreamRunId: options["upstream-run-id"],
      })}\n`,
    );
  } else if (command === "main-candidate-deployment-id") {
    process.stdout.write(
      `${generateVercelMainCandidateDeploymentId({
        repository: options.repository,
        target: options.target,
        commitSha: options.sha,
        upstreamRunId: options["upstream-run-id"],
      })}\n`,
    );
  } else if (command === "assert-output") {
    assertPrebuiltDeploymentId(
      resolve(options.output ?? ".vercel/output"),
      options.expected,
    );
    process.stdout.write("Prebuilt deployment ID verified\n");
  } else if (command === "check-versions") {
    process.stdout.write(
      `${JSON.stringify(
        assertDeploymentIdPrerequisites(
          resolve(options["repo-root"] ?? process.cwd()),
        ),
      )}\n`,
    );
  } else if (command === "check-candidate-versions") {
    process.stdout.write(
      `${JSON.stringify(
        assertCandidateDeploymentIdPrerequisites(
          resolve(options["repo-root"] ?? process.cwd()),
        ),
      )}\n`,
    );
  } else {
    throw new Error(
      "Usage: vercel-prebuilt.mjs deployment-id|main-release-id|main-candidate-deployment-id|assert-output|check-versions|check-candidate-versions",
    );
  }
}
