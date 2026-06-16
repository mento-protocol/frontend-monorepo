#!/usr/bin/env node
/**
 * Fixture-driven tests for scripts/lockfile-lint.mjs.
 *
 * Each test writes a minimal synthetic pnpm-lock.yaml (and optional .npmrc /
 * pnpm-workspace.yaml) to a temp directory, then runs the script against it
 * via spawnSync. Asserts on exit code and stdout/stderr substrings.
 *
 * Ported from monitoring-monorepo (gates 1 + 2 only; the override-floor gate
 * is not part of the frontend port). Adds a remote-tarball-exemption test.
 *
 * Run: node scripts/lockfile-lint.test.mjs
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

// ── helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passed++;
  } catch (/** @type {unknown} */ err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  \x1b[31m✖\x1b[0m ${name}`);
    console.error(`    ${msg}`);
    failed++;
  }
}

/**
 * @param {boolean} condition
 * @param {string} msg
 */
function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

const SCRIPT = new URL("./lockfile-lint.mjs", import.meta.url).pathname;

/** A valid sha512 hash that passes the length + format check. */
const VALID_SHA512 =
  "sha512-nhCBV3quEgesuf7c7KYfperqSS14T8bYuvJ8PcLJp6znkZpFc0AuW4qBtr8eKVyPPe/8RSr7sglCWPU5eaxwKQ==";

/**
 * Builds a minimal pnpm v9 lockfile string.
 *
 * @param {Array<{name: string, integrity?: string}>} pkgs
 * @returns {string}
 */
function makeLockfile(pkgs) {
  const entries = pkgs
    .map(({ name, integrity }) => {
      const res = integrity
        ? `    resolution: {integrity: ${integrity}}`
        : `    resolution: {}`;
      return `\n  ${name}:\n${res}\n`;
    })
    .join("");

  return (
    `lockfileVersion: '9.0'\n\nimporters:\n\n  .:` +
    `\n    devDependencies:\n      typescript:\n        specifier: ^5.0.0\n        version: 5.0.0\n` +
    `\npackages:\n${entries}\nsnapshots:\n\n  typescript@5.0.0: {}\n`
  );
}

/**
 * Run the lockfile-lint script in a temp directory.
 *
 * @param {string} lockfileContent
 * @param {Record<string, string>} [extraFiles]  rel-path → content
 * @returns {{ exitCode: number; stdout: string; stderr: string }}
 */
function run(lockfileContent, extraFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-lint-test-"));
  try {
    writeFileSync(join(dir, "pnpm-lock.yaml"), lockfileContent, "utf8");
    // Minimal pnpm-workspace.yaml (no registries: block).
    if (!extraFiles["pnpm-workspace.yaml"]) {
      writeFileSync(
        join(dir, "pnpm-workspace.yaml"),
        "packages:\n  - shared-config\n",
        "utf8",
      );
    }
    for (const [rel, content] of Object.entries(extraFiles)) {
      const abs = join(dir, rel);
      mkdirSync(/** @type {string} */ (abs.split("/").slice(0, -1).join("/")), {
        recursive: true,
      });
      writeFileSync(abs, content, "utf8");
    }
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, LOCKFILE_LINT_ROOT: dir },
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

// ── tests ─────────────────────────────────────────────────────────────────────

console.log("\nlockfile-lint.mjs fixture tests\n");

// 1. Happy path — single valid package.
test("passes for a valid lockfile with sha512 integrity", () => {
  const { exitCode, stdout } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
  );
  assert(exitCode === 0, `Expected exit 0, got ${exitCode}`);
  assert(stdout.includes("valid sha512"), `stdout: ${stdout}`);
  assert(stdout.includes("passed"), `stdout: ${stdout}`);
});

// 2. Multiple packages all valid.
test("passes for multiple packages all with valid sha512", () => {
  const { exitCode } = run(
    makeLockfile([
      { name: "typescript@5.0.0", integrity: VALID_SHA512 },
      { name: "zod@3.0.0", integrity: VALID_SHA512 },
    ]),
  );
  assert(exitCode === 0, `Expected exit 0, got ${exitCode}`);
});

// 3. Missing integrity — resolution block without integrity key.
test("fails when a package has no integrity field", () => {
  const lockfile = `lockfileVersion: '9.0'\n\nimporters:\n\npackages:\n\n  typescript@5.0.0:\n    resolution: {}\n\nsnapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("resolution block without a sha512"),
    `expected missing-integrity error, got: ${out}`,
  );
});

// 4. Invalid integrity format — sha256 instead of sha512.
test("fails when integrity is sha256 (wrong hash type)", () => {
  const { exitCode, stderr, stdout } = run(
    makeLockfile([
      {
        name: "typescript@5.0.0",
        integrity: "sha256-abc123==",
      },
    ]),
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("resolution block without a sha512") ||
      out.includes("Invalid integrity"),
    `expected integrity error, got: ${out}`,
  );
});

// 5. Custom registry in root .npmrc.
test("fails when root .npmrc has a non-npmjs registry", () => {
  const { exitCode, stderr, stdout } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    { ".npmrc": "registry=https://registry.verdaccio.local/\n" },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("non-npmjs registry detected"),
    `expected registry error: ${out}`,
  );
});

// 6. Official registry in .npmrc — should pass.
test("passes when .npmrc sets registry=https://registry.npmjs.org", () => {
  const { exitCode } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    { ".npmrc": "registry=https://registry.npmjs.org\n" },
  );
  assert(exitCode === 0, `Expected exit 0, got ${exitCode}`);
});

// 7. Official registry with trailing slash — should pass.
test("passes when .npmrc sets registry=https://registry.npmjs.org/", () => {
  const { exitCode } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    { ".npmrc": "registry=https://registry.npmjs.org/\n" },
  );
  assert(exitCode === 0, `Expected exit 0, got ${exitCode}`);
});

// 8. Scoped registry pointing off-npmjs.
test("fails when .npmrc has a scoped non-npmjs registry", () => {
  const { exitCode, stderr, stdout } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    { ".npmrc": "@myorg:registry=https://private.npm.myorg.com/\n" },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("scope-specific non-npmjs registry"),
    `expected scope-registry error: ${out}`,
  );
});

// 9. pnpm-workspace.yaml with registries: block.
test("fails when pnpm-workspace.yaml has a registries: block", () => {
  const { exitCode, stderr, stdout } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      "pnpm-workspace.yaml":
        "packages:\n  - shared-config\nregistries:\n  default: https://private.registry.example/\n",
    },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("registries:"),
    `expected registries block error: ${out}`,
  );
});

// 10. .npmrc with a comment — should not false-positive.
test("ignores commented-out registry lines in .npmrc", () => {
  const { exitCode } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    { ".npmrc": "# registry=https://verdaccio.example.com\n" },
  );
  assert(exitCode === 0, `Expected exit 0, got ${exitCode}`);
});

// 11. Wrong lockfile version — should fail fast.
test("fails when lockfile version is not 9.x", () => {
  const { exitCode, stderr, stdout } = run(
    `lockfileVersion: '6.0'\n\npackages:\n\n  typescript@5.0.0:\n    resolution: {integrity: ${VALID_SHA512}}\n\nsnapshots:\n`,
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("Unexpected lockfile version"),
    `expected version error: ${out}`,
  );
});

// 12. Sub-package .npmrc is checked too.
test("fails when a sub-package .npmrc has a non-npmjs registry", () => {
  const { exitCode, stderr, stdout } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      "apps/some-app/.npmrc":
        "registry=https://my-private-registry.example.com/\n",
    },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("non-npmjs registry detected"),
    `expected sub-package registry error: ${out}`,
  );
});

// 13. Missing pnpm-lock.yaml — should fail cleanly.
test("fails cleanly when pnpm-lock.yaml does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-lint-test-"));
  try {
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      "packages:\n  - shared-config\n",
      "utf8",
    );
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, LOCKFILE_LINT_ROOT: dir },
    });
    const exitCode = result.status ?? 1;
    assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
    const out = (result.stdout ?? "") + (result.stderr ?? "");
    assert(out.includes("not found"), `expected not-found error: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 14. Lookalike scoped registry must be rejected (exact-canonical-host check).
test("fails when scope-specific registry is a lookalike (registry.npmjs.org.evil.com)", () => {
  const { exitCode, stdout, stderr } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      ".npmrc":
        "@mento-protocol:registry=https://registry.npmjs.org.evil.com/\n",
    },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("scope-specific non-npmjs registry"),
    `expected lookalike rejection: ${out}`,
  );
});

// 15. A nested workspace `.npmrc` must still be discovered via repo walk.
test("discovers .npmrc in any nested workspace directory", () => {
  const { exitCode, stdout, stderr } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      "tools/some-future-pkg/.npmrc":
        "registry=https://my-private-registry.example.com/\n",
    },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("non-npmjs registry detected"),
    `expected nested-npmrc detection: ${out}`,
  );
});

// 16. A package entry with NO `resolution:` block at all must fail.
test("fails when a package entry has no resolution block", () => {
  const lockfile = `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\npackages:\n\n  typescript@5.0.0:\n    resolution: {integrity: ${VALID_SHA512}}\n\n  no-resolution-pkg@1.0.0:\n    engines: {node: '>=18'}\n\nsnapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("NO resolution block"),
    `expected missing-resolution detection: ${out}`,
  );
});

// 17. Local file: dependencies (no integrity) must be exempted, not flagged.
test("passes when packages: contains a local file: dependency without integrity", () => {
  const lockfile = `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\npackages:\n\n  typescript@5.0.0:\n    resolution: {integrity: ${VALID_SHA512}}\n\n  internal-pkg@file:packages/internal-pkg:\n    resolution: {directory: packages/internal-pkg, type: directory}\n\nsnapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(
    exitCode === 0,
    `Expected exit 0, got ${exitCode}\n${stdout}\n${stderr}`,
  );
  assert(
    stdout.includes("exempted from the integrity check") ||
      stdout.includes("registry-tarball packages"),
    `expected file-dep exemption message: ${stdout}`,
  );
});

// 18. Frontend adaptation: a remote HTTPS-tarball entry (github codeload, no
// integrity) — like `@metamask/jazzicon` — must be exempted, not flagged.
test("passes when packages: contains a remote https tarball dependency without integrity", () => {
  const lockfile =
    `lockfileVersion: '9.0'\n\nimporters:\n\npackages:\n\n` +
    `  typescript@5.0.0:\n    resolution: {integrity: ${VALID_SHA512}}\n\n` +
    `  '@metamask/jazzicon@https://codeload.github.com/jmrossy/jazzicon/tar.gz/7a8df28':\n` +
    `    resolution: {tarball: https://codeload.github.com/jmrossy/jazzicon/tar.gz/7a8df28}\n\n` +
    `snapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(
    exitCode === 0,
    `Expected exit 0, got ${exitCode}\n${stdout}\n${stderr}`,
  );
  assert(
    stdout.includes("remote-tarball deps exempted"),
    `expected remote-tarball exemption message: ${stdout}`,
  );
});

// 19. Parser-out-of-sync must fail loudly, not silently pass with 0 packages.
test("fails loudly when the parser matches zero entries against a non-empty packages: section", () => {
  const lockfile = `lockfileVersion: '9.0'\n\nimporters:\n\npackages:\n\n  some-future-key-shape:\n    resolution: {integrity: ${VALID_SHA512}}\n\nsnapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(
    exitCode !== 0,
    `Expected non-zero exit, got ${exitCode}\n${stdout}\n${stderr}`,
  );
  const out = stdout + stderr;
  assert(
    out.includes("regex is likely out of sync") ||
      out.includes("no top-level package"),
    `expected parser-out-of-sync error: ${out}`,
  );
});

// 20. pnpm-workspace.yaml top-level `registry:` key pointing off-npmjs.
test("fails when pnpm-workspace.yaml top-level registry: points off-npmjs", () => {
  const { exitCode, stdout, stderr } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      "pnpm-workspace.yaml":
        "packages:\n  - shared-config\nregistry: https://evil.example.com/\n",
    },
  );
  assert(exitCode !== 0, `Expected non-zero exit, got ${exitCode}`);
  const out = stdout + stderr;
  assert(
    out.includes("non-npmjs default registry"),
    `expected top-level registry rejection: ${out}`,
  );
});

// 21. Reject SHA-512 integrity longer than the canonical 88-char base64 shape.
test("fails when SHA-512 integrity is longer than canonical 88-char base64", () => {
  const overlong = "sha512-" + "A".repeat(100) + "==";
  const lockfile = `lockfileVersion: '9.0'\n\nimporters:\n\npackages:\n\n  typescript@5.0.0:\n    resolution: {integrity: ${overlong}}\n\nsnapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(
    exitCode !== 0,
    `Expected non-zero exit, got ${exitCode}\n${stdout}\n${stderr}`,
  );
});

// 22. A colon-bearing git package entry must be counted (so missing integrity
// is detected) — git is NOT exempted like file:/link: or remote tarballs.
test("counts colon-bearing git package entries (so missing integrity is detected)", () => {
  const lockfile = `lockfileVersion: '9.0'\n\nimporters:\n\npackages:\n\n  typescript@5.0.0:\n    resolution: {integrity: ${VALID_SHA512}}\n\n  some-pkg@git+file://path/to/dep:\n    resolution: {repo: file://path/to/dep, type: git, commit: abc123}\n\nsnapshots:\n`;
  const { exitCode, stdout, stderr } = run(lockfile);
  assert(
    exitCode !== 0,
    `Expected non-zero exit, got ${exitCode}\n${stdout}\n${stderr}`,
  );
});

// 23. Quoted `'registry':` in pnpm-workspace.yaml must be validated.
test("fails when pnpm-workspace.yaml quoted 'registry': points off-npmjs", () => {
  const { exitCode, stdout, stderr } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      "pnpm-workspace.yaml":
        'packages:\n  - shared-config\n"registry": https://evil.example.com/\n',
    },
  );
  assert(
    exitCode !== 0,
    `Expected non-zero exit, got ${exitCode}\n${stdout}\n${stderr}`,
  );
});

// 24. Quoted `"registry"=...` in .npmrc must be validated.
test('fails when .npmrc uses quoted "registry"= override pointing off-npmjs', () => {
  const { exitCode, stdout, stderr } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      ".npmrc": '"registry"=https://evil.example.com/\n',
    },
  );
  assert(
    exitCode !== 0,
    `Expected non-zero exit, got ${exitCode}\n${stdout}\n${stderr}`,
  );
});

// 25. A `.npmrc` that's a symlink must be read.
test("reads .npmrc when it's a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "lockfile-lint-test-"));
  try {
    writeFileSync(
      join(dir, "pnpm-lock.yaml"),
      makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
      "utf8",
    );
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      "packages:\n  - shared-config\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "evilrc"),
      "registry=https://evil.example.com/\n",
      "utf8",
    );
    symlinkSync("evilrc", join(dir, ".npmrc"));
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, LOCKFILE_LINT_ROOT: dir },
    });
    const exitCode = result.status ?? 1;
    assert(
      exitCode !== 0,
      `Expected non-zero exit, got ${exitCode}\n${result.stdout}\n${result.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 26. `.npmrc` with `userconfig=path` indirection must be rejected outright.
test("fails when .npmrc uses userconfig= indirection", () => {
  const { exitCode, stdout, stderr } = run(
    makeLockfile([{ name: "typescript@5.0.0", integrity: VALID_SHA512 }]),
    {
      ".npmrc": "userconfig=./evilrc\n",
    },
  );
  assert(
    exitCode !== 0,
    `Expected non-zero exit, got ${exitCode}\n${stdout}\n${stderr}`,
  );
  const out = stdout + stderr;
  assert(
    out.includes("forbidden") || out.includes("userconfig"),
    `expected userconfig rejection: ${out}`,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
