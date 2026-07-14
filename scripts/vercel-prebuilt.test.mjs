import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertDeploymentIdPrerequisites,
  assertPrebuiltDeploymentId,
  assertValidDeploymentId,
  CUSTOM_DEPLOYMENT_ID_ENV,
  generateVercelDeploymentId,
  isVersionGreaterThan,
  VERCEL_TARGETS,
} from "./vercel-prebuilt.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(
  new URL("./vercel-prebuilt.mjs", import.meta.url),
);
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

function deploymentId(overrides = {}) {
  return generateVercelDeploymentId({
    target: "app",
    commitSha: COMMIT_SHA,
    runId: "123456789",
    runAttempt: "1",
    ...overrides,
  });
}

test("generated IDs satisfy every Vercel constraint for every target", () => {
  for (const target of VERCEL_TARGETS) {
    const value = deploymentId({ target });
    assert.ok(value.length <= 32, `${target}: ${value}`);
    assert.match(value, /^[A-Za-z0-9_-]+$/);
    assert.equal(value.startsWith("dpl_"), false);
    assert.equal(assertValidDeploymentId(value), value);
  }
});

test("generated IDs are stable within a workflow attempt", () => {
  assert.equal(deploymentId(), deploymentId());
});

test("generated IDs differ across target, SHA, run, and rerun attempt", () => {
  const baseline = deploymentId();
  const variants = [
    deploymentId({ target: "reserve" }),
    deploymentId({ commitSha: `1${COMMIT_SHA.slice(1)}` }),
    deploymentId({ runId: "123456790" }),
    deploymentId({ runAttempt: "2" }),
  ];
  assert.equal(new Set([baseline, ...variants]).size, variants.length + 1);
});

test("deployment ID input validation rejects mutable or malformed identity", () => {
  for (const overrides of [
    { target: "unknown" },
    { commitSha: "main" },
    { runId: "0" },
    { runAttempt: "retry" },
  ]) {
    assert.throws(() => deploymentId(overrides));
  }
  assert.throws(() => assertValidDeploymentId("dpl_reserved"));
  assert.throws(() => assertValidDeploymentId("invalid value"));
  assert.throws(() => assertValidDeploymentId("x".repeat(33)));
});

test("generated ID propagates into and is asserted from prebuilt config", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-output-"));
  const outputDirectory = join(directory, ".vercel", "output");
  const expected = deploymentId();
  try {
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(
      join(outputDirectory, "config.json"),
      JSON.stringify({ version: 3, deploymentId: expected }),
    );
    assert.equal(
      assertPrebuiltDeploymentId(outputDirectory, expected),
      expected,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("prebuilt assertion rejects missing, malformed, or mismatched output", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-output-"));
  const expected = deploymentId();
  try {
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /Missing or invalid prebuilt config/,
    );
    writeFileSync(join(directory, "config.json"), "not json");
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /Missing or invalid prebuilt config/,
    );
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({ version: 3 }),
    );
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /missing deploymentId/,
    );
    writeFileSync(
      join(directory, "config.json"),
      JSON.stringify({
        version: 3,
        deploymentId: deploymentId({ runAttempt: "2" }),
      }),
    );
    assert.throws(
      () => assertPrebuiltDeploymentId(directory, expected),
      /does not match/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("resolved Next.js and exact Vercel CLI satisfy custom-ID prerequisites", () => {
  assert.deepEqual(assertDeploymentIdPrerequisites(repoRoot), {
    next: "16.2.10",
    vercel: "56.2.0",
  });
  assert.equal(isVersionGreaterThan("16.2.10", "16.2.0-canary.15"), true);
  assert.equal(isVersionGreaterThan("56.2.0", "50.3.3"), true);
});

test("prerelease comparison follows numeric SemVer identifier ordering", () => {
  const minimum = "16.2.0-canary.15";
  assert.equal(isVersionGreaterThan("16.2.0-canary.9", minimum), false);
  assert.equal(isVersionGreaterThan("16.2.0-canary.15", minimum), false);
  assert.equal(isVersionGreaterThan("16.2.0-canary.100", minimum), true);
  assert.equal(isVersionGreaterThan("16.2.0-canary.15.1", minimum), true);
  assert.equal(isVersionGreaterThan("16.2.0", minimum), true);
});

test("all Next configs and app Turbo inputs use one custom ID variable", () => {
  for (const target of VERCEL_TARGETS) {
    const appDirectory =
      target === "app" ? "app.mento.org" : `${target}.mento.org`;
    const nextConfig = readFileSync(
      new URL(`../apps/${appDirectory}/next.config.ts`, import.meta.url),
      "utf8",
    );
    const turboConfig = readFileSync(
      new URL(`../apps/${appDirectory}/turbo.json`, import.meta.url),
      "utf8",
    );
    assert.match(
      nextConfig,
      new RegExp(`process\\.env\\.${CUSTOM_DEPLOYMENT_ID_ENV}`),
    );
    assert.match(nextConfig, /deploymentId/);
    assert.match(turboConfig, new RegExp(CUSTOM_DEPLOYMENT_ID_ENV));
  }
});

test("CLI computes the same ID as the library", () => {
  const output = execFileSync(
    process.execPath,
    [
      scriptPath,
      "deployment-id",
      "--target",
      "app",
      "--sha",
      COMMIT_SHA,
      "--run-id",
      "123456789",
      "--run-attempt",
      "1",
    ],
    { encoding: "utf8" },
  ).trim();
  assert.equal(output, deploymentId());
});
