#!/usr/bin/env node
/**
 * Fixture-driven tests for scripts/version-skew-check.mjs.
 *
 * Each test writes a minimal synthetic workspace and package manifests to a
 * temp directory, then runs the script via spawnSync.
 *
 * Run: node scripts/version-skew-check.test.mjs
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
    passed += 1;
  } catch (/** @type {unknown} */ err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`not ok ${name}`);
    console.error(`  ${message}`);
    failed += 1;
  }
}

/**
 * @param {boolean} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const SCRIPT = new URL("./version-skew-check.mjs", import.meta.url).pathname;

/**
 * @param {string} dir
 * @param {string} rel
 * @param {unknown} json
 */
function writeJson(dir, rel, json) {
  const abs = join(dir, rel);
  mkdirSync(abs.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

/**
 * @param {string} workspaceYaml
 * @param {Record<string, unknown>} manifests
 * @returns {{ exitCode: number; stdout: string; stderr: string }}
 */
function run(workspaceYaml, manifests) {
  const dir = mkdtempSync(join(tmpdir(), "version-skew-check-test-"));

  try {
    writeFileSync(join(dir, "pnpm-workspace.yaml"), workspaceYaml, "utf8");
    for (const [manifestPath, manifest] of Object.entries(manifests)) {
      writeJson(dir, manifestPath, manifest);
    }

    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, SKEW_CHECK_ROOT: dir },
    });

    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\nversion-skew-check.mjs fixture tests\n");

test("passes when catalog and literal pins match", () => {
  const { exitCode, stdout } = run(
    `packages:\n  - app\n  - worker\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root", devDependencies: { viem: "catalog:" } },
      "app/package.json": { name: "app", dependencies: { viem: "catalog:" } },
      "worker/package.json": {
        name: "worker",
        dependencies: { viem: "2.50.4" },
      },
    },
  );

  assert(exitCode === 0, `expected exit 0, got ${exitCode}`);
  assert(stdout.includes("all catalog-pinned"), `stdout: ${stdout}`);
});

test("fails when a member drifts from the catalog", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "2.47.0" } },
    },
  );

  assert(exitCode !== 0, `expected non-zero exit, got ${exitCode}`);
  assert(stderr.includes("app/package.json"), `stderr: ${stderr}`);
  assert(stderr.includes("2.47.0"), `stderr: ${stderr}`);
});

test("fails when a devDependency drifts from the catalog", () => {
  const { exitCode, stderr } = run(
    `packages:\n    - app\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": {
        name: "app",
        devDependencies: { viem: "2.49.0" },
      },
    },
  );

  assert(exitCode !== 0, `expected non-zero exit, got ${exitCode}`);
  assert(stderr.includes("devDependencies.viem"), `stderr: ${stderr}`);
  assert(stderr.includes("2.49.0"), `stderr: ${stderr}`);
});

test("fails when an optionalDependency drifts from the catalog", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": {
        name: "app",
        optionalDependencies: { viem: "2.48.0" },
      },
    },
  );

  assert(exitCode !== 0, `expected non-zero exit, got ${exitCode}`);
  assert(stderr.includes("optionalDependencies.viem"), `stderr: ${stderr}`);
  assert(stderr.includes("2.48.0"), `stderr: ${stderr}`);
});

test("passes when the workspace has no catalog", () => {
  const { exitCode, stdout } = run(`packages:\n  - app\n`, {
    "package.json": { name: "root" },
    "app/package.json": { name: "app", dependencies: { viem: "2.47.0" } },
  });

  assert(exitCode === 0, `expected exit 0, got ${exitCode}`);
  assert(stdout.includes("no catalog entries"), `stdout: ${stdout}`);
});

// Frontend adaptation: glob members (`apps/*`, `packages/*`) must be expanded.
// Without expansion the script would silently skip every member (false green).
test("expands glob packages and detects drift inside them", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "apps/*"\n  - "packages/*"\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "apps/web/package.json": {
        name: "web",
        dependencies: { viem: "catalog:" },
      },
      "packages/ui/package.json": {
        name: "ui",
        dependencies: { viem: "2.40.0" },
      },
    },
  );

  assert(exitCode !== 0, `expected non-zero exit, got ${exitCode}`);
  assert(stderr.includes("packages/ui/package.json"), `stderr: ${stderr}`);
  assert(stderr.includes("2.40.0"), `stderr: ${stderr}`);
});

test("passes when glob members are all catalog-aligned", () => {
  const { exitCode, stdout } = run(
    `packages:\n  - "apps/*"\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "apps/web/package.json": {
        name: "web",
        dependencies: { viem: "catalog:" },
      },
      "apps/admin/package.json": {
        name: "admin",
        dependencies: { viem: "2.50.4" },
      },
    },
  );

  assert(exitCode === 0, `expected exit 0, got ${exitCode}`);
  assert(stdout.includes("all catalog-pinned"), `stdout: ${stdout}`);
});

// A catalog value with a git ref (`github:org/repo#sha`) must NOT be truncated
// at the `#` — otherwise a full pin falsely fails and a truncated pin passes.
test("does not truncate catalog values containing a git ref (#)", () => {
  const ws = `packages:\n  - app\n\ncatalog:\n  jazz: github:org/jazz#abc123\n`;
  const okRun = run(ws, {
    "package.json": { name: "root" },
    "app/package.json": {
      name: "app",
      dependencies: { jazz: "github:org/jazz#abc123" },
    },
  });
  assert(
    okRun.exitCode === 0,
    `expected exit 0 for full git-ref pin, got ${okRun.exitCode}\n${okRun.stderr}`,
  );
  const badRun = run(ws, {
    "package.json": { name: "root" },
    "app/package.json": {
      name: "app",
      dependencies: { jazz: "github:org/jazz" },
    },
  });
  assert(
    badRun.exitCode !== 0,
    `expected non-zero for truncated pin, got ${badRun.exitCode}`,
  );
});

test("fails when a peerDependency drifts from the catalog", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog:\n  react: 19.2.5\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": {
        name: "app",
        peerDependencies: { react: "18.0.0" },
      },
    },
  );

  assert(exitCode !== 0, `expected non-zero exit, got ${exitCode}`);
  assert(stderr.includes("peerDependencies.react"), `stderr: ${stderr}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
