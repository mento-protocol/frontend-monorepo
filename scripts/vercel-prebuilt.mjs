#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CUSTOM_DEPLOYMENT_ID_ENV = "MENTO_NEXT_DEPLOYMENT_ID";
export const VERCEL_TARGETS = ["app", "governance", "reserve", "ui"];

const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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
  if (
    typeof commitSha !== "string" ||
    !/^[A-Fa-f0-9]{40,64}$/.test(commitSha)
  ) {
    throw new Error("Commit SHA must be an immutable 40- or 64-digit hex SHA");
  }
  assertPositiveInteger(runId, "Run ID");
  assertPositiveInteger(runAttempt, "Run attempt");

  const digest = createHash("sha256")
    .update([target, commitSha.toLowerCase(), runId, runAttempt].join("\u0000"))
    .digest("hex");
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

export function assertDeploymentIdPrerequisites(repoRoot) {
  const packageJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );
  const nextVersion = readResolvedNextVersion(
    readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8"),
  );
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

  return { next: nextVersion, vercel: vercelVersion };
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
  } else if (command === "assert-output") {
    assertPrebuiltDeploymentId(
      resolve(options.output ?? ".vercel/output"),
      options.expected,
    );
    process.stdout.write("Prebuilt deployment ID verified\n");
  } else if (command === "check-versions") {
    process.stdout.write(
      `${JSON.stringify(assertDeploymentIdPrerequisites(process.cwd()))}\n`,
    );
  } else {
    throw new Error(
      "Usage: vercel-prebuilt.mjs deployment-id|assert-output|check-versions",
    );
  }
}
