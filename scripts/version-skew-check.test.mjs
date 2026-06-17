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

// pnpm accepts an inline comment on a top-level header; the block-header match
// must tolerate it (else the catalog/packages block is silently missed).
test("parses catalog/packages headers that have inline comments", () => {
  const { exitCode, stderr } = run(
    `packages: # workspace members\n  - app\n\ncatalog: # default catalog\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "2.40.0" } },
    },
  );

  assert(
    exitCode !== 0,
    `expected drift detected despite header comments, got ${exitCode}\n${stderr}`,
  );
  assert(stderr.includes("app/package.json"), `stderr: ${stderr}`);
});

// Cataloged spec with spaces (quoted OR range) must still be parsed + checked.
test("checks cataloged deps whose spec contains spaces (OR range)", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog:\n  react: "^18.0.0 || ^19.0.0"\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { react: "^18.0.0" } },
    },
  );

  assert(exitCode !== 0, `expected drift detected, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("dependencies.react"), `stderr: ${stderr}`);
});

// A glob member with a trailing inline comment must still be expanded.
test("expands glob members that have a trailing inline comment", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "apps/*" # frontend apps\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "apps/web/package.json": {
        name: "web",
        dependencies: { viem: "2.40.0" },
      },
    },
  );

  assert(
    exitCode !== 0,
    `expected drift in commented-glob member, got ${exitCode}\n${stderr}`,
  );
  assert(stderr.includes("apps/web/package.json"), `stderr: ${stderr}`);
});

// Unquoted YAML plain scalar with spaces is a valid catalog range too.
test("checks cataloged deps whose spec is an unquoted range with spaces", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog:\n  react: ^18.0.0 || ^19.0.0\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { react: "^18.0.0" } },
    },
  );
  assert(exitCode !== 0, `expected drift detected, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("dependencies.react"), `stderr: ${stderr}`);
});

// Recursive `**` globs must expand to nested members.
test("expands recursive ** globs to nested members", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "packages/**"\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "packages/group/inner/package.json": {
        name: "inner",
        dependencies: { viem: "2.40.0" },
      },
    },
  );
  assert(exitCode !== 0, `expected nested drift, got ${exitCode}\n${stderr}`);
  assert(
    stderr.includes("packages/group/inner/package.json"),
    `stderr: ${stderr}`,
  );
});

// `catalog:default` is an alias for the default catalog and must be accepted.
test("accepts catalog:default as a default-catalog reference", () => {
  const { exitCode, stdout } = run(
    `packages:\n  - app\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": {
        name: "app",
        dependencies: { viem: "catalog:default" },
      },
    },
  );
  assert(exitCode === 0, `expected exit 0, got ${exitCode}\n${stdout}`);
});

// Negated `!` globs exclude members; drift in an excluded dir must not fail.
test("honors negated workspace globs (excluded members not checked)", () => {
  const { exitCode, stdout } = run(
    `packages:\n  - "packages/*"\n  - "!packages/fixtures"\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "packages/ui/package.json": {
        name: "ui",
        dependencies: { viem: "catalog:" },
      },
      "packages/fixtures/package.json": {
        name: "fixtures",
        dependencies: { viem: "1.0.0" },
      },
    },
  );
  assert(
    exitCode === 0,
    `expected exit 0 (excluded member ignored), got ${exitCode}\n${stdout}`,
  );
});

// Catalog entries indented with 4 spaces (valid YAML, e.g. after a reindent)
// must still be parsed and checked.
test("parses catalog entries indented with four spaces", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog:\n    viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "2.40.0" } },
    },
  );
  assert(exitCode !== 0, `expected drift detected, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("dependencies.viem"), `stderr: ${stderr}`);
});

// Brace-alternation globs (`{apps,packages}/*`, fast-glob style) must expand.
test("expands brace-alternation globs", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "{apps,packages}/*"\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "packages/ui/package.json": {
        name: "ui",
        dependencies: { viem: "2.40.0" },
      },
    },
  );
  assert(
    exitCode !== 0,
    `expected drift in brace-glob member, got ${exitCode}\n${stderr}`,
  );
  assert(stderr.includes("packages/ui/package.json"), `stderr: ${stderr}`);
});

// Named catalogs (`catalogs:`) are not validated — the gate must fail loudly
// (fail-closed) rather than silently pass with a blind spot.
test("fails loudly when named catalogs (catalogs:) are present", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalogs:\n  react18:\n    react: ^18.3.1\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { react: "17.0.2" } },
    },
  );
  assert(
    exitCode !== 0,
    `expected non-zero (named catalogs unsupported), got ${exitCode}\n${stderr}`,
  );
  assert(
    stderr.includes("named") && stderr.includes("catalogs"),
    `stderr: ${stderr}`,
  );
});

// Flow-style top-level catalog (`catalog: { pkg: ver }`) must be parsed, not
// treated as absent (which would be a false green on drift).
test("parses a flow-style catalog and detects drift", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog: { viem: 2.50.4 }\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "2.40.0" } },
    },
  );
  assert(exitCode !== 0, `expected drift detected, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("dependencies.viem"), `stderr: ${stderr}`);
});

test("passes a flow-style catalog when aligned", () => {
  const { exitCode, stdout } = run(
    `packages:\n  - app\n\ncatalog: { viem: 2.50.4 }\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "catalog:" } },
    },
  );
  assert(exitCode === 0, `expected exit 0, got ${exitCode}\n${stdout}`);
});

// Flow-style named catalogs must also trip the fail-closed guard.
test("fails loudly on flow-style named catalogs", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalogs: { react18: { react: ^18.3.1 } }\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { react: "17.0.2" } },
    },
  );
  assert(exitCode !== 0, `expected non-zero, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("catalogs"), `stderr: ${stderr}`);
});

// A comment-only / empty `catalogs:` stub has no real entries, so it must NOT
// trip the fail-closed guard (the default catalog is still checked normally).
test("comment-only catalogs: does not trip the fail-closed guard", () => {
  const { exitCode, stdout } = run(
    `packages:\n  - app\n\ncatalogs:\n  # planned, not used yet\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "catalog:" } },
    },
  );
  assert(
    exitCode === 0,
    `expected exit 0 (comment-only catalogs ignored), got ${exitCode}\n${stdout}`,
  );
});

// A quoted flow-catalog value containing a comma must not be split apart.
test("parses a flow catalog value that contains a quoted comma", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n\ncatalog: { viem: "2.50.4", pkg: ">=1.0.0,<2.0.0" }\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": {
        name: "app",
        dependencies: { pkg: "1.5.0" },
      },
    },
  );
  // `pkg` is cataloged as ">=1.0.0,<2.0.0"; the manifest pins "1.5.0" -> drift.
  assert(exitCode !== 0, `expected drift on pkg, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("dependencies.pkg"), `stderr: ${stderr}`);
});

// A column-0 comment inside `packages:` must not truncate the block.
test("does not stop at a column-0 comment inside packages:", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "apps/*"\n# shared\n  - "packages/*"\n\ncatalog:\n  viem: 2.50.4\n`,
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
  assert(
    exitCode !== 0,
    `expected drift after comment, got ${exitCode}\n${stderr}`,
  );
  assert(stderr.includes("packages/ui/package.json"), `stderr: ${stderr}`);
});

// Globstar must match zero leading directories (`**/web` matches root `web`).
test("globstar matches zero leading directories", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "**/web"\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "web/package.json": { name: "web", dependencies: { viem: "2.40.0" } },
    },
  );
  assert(exitCode !== 0, `expected root web drift, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("web/package.json"), `stderr: ${stderr}`);
});

// Flow-style `packages: ["apps/*", "packages/*"]` must be parsed.
test("parses a flow-style packages sequence", () => {
  const { exitCode, stderr } = run(
    `packages: ["apps/*", "packages/*"]\n\ncatalog:\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "packages/ui/package.json": {
        name: "ui",
        dependencies: { viem: "2.40.0" },
      },
    },
  );
  assert(
    exitCode !== 0,
    `expected drift in flow-seq member, got ${exitCode}\n${stderr}`,
  );
  assert(stderr.includes("packages/ui/package.json"), `stderr: ${stderr}`);
});

// Fail closed when `packages:` is declared with a catalog but matches no
// members (would otherwise silently validate only the root manifest).
test("fails closed when packages: is declared but matches no members", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - "apps/*"\n\ncatalog:\n  viem: 2.50.4\n`,
    { "package.json": { name: "root" } },
  );
  assert(exitCode !== 0, `expected fail-closed, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("no workspace members"), `stderr: ${stderr}`);
});

// Quoted top-level keys are valid YAML pnpm honors — a quoted `catalog:` must
// still be parsed (not silently treated as "no catalog").
test("parses a quoted catalog header", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n"catalog":\n  viem: 2.50.4\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { viem: "1.0.0" } },
    },
  );
  assert(exitCode !== 0, `expected drift detected, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("dependencies.viem"), `stderr: ${stderr}`);
});

// A quoted `catalogs:` must still trip the fail-closed named-catalog guard.
test("fails closed on a quoted named-catalogs header", () => {
  const { exitCode, stderr } = run(
    `packages:\n  - app\n'catalogs':\n  react18:\n    react: ^18.3.1\n`,
    {
      "package.json": { name: "root" },
      "app/package.json": { name: "app", dependencies: { react: "17.0.2" } },
    },
  );
  assert(exitCode !== 0, `expected non-zero, got ${exitCode}\n${stderr}`);
  assert(stderr.includes("catalogs"), `stderr: ${stderr}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
