import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

const pnpmDirectory = join(process.cwd(), "node_modules", ".pnpm");

function installedPackage(name, version, { patched = false } = {}) {
  assert.ok(existsSync(pnpmDirectory), "pnpm dependencies must be installed");
  const entry = readdirSync(pnpmDirectory).find(
    (candidate) =>
      candidate.startsWith(`${name}@${version}`) &&
      (!patched || candidate.includes("_patch_hash=")),
  );
  assert.ok(entry, `${name}@${version} must be installed`);
  return join(pnpmDirectory, entry, "node_modules", name);
}

function totalLength(expansions) {
  return expansions.reduce((total, expansion) => total + expansion.length, 0);
}

test("patched brace-expansion 2.1.2 preserves minimatch v3 behavior", () => {
  const braceExpansionPackage = installedPackage("brace-expansion", "2.1.2", {
    patched: true,
  });
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);
  const minimatchRequire = createRequire(
    join(installedPackage("minimatch", "3.1.5"), "package.json"),
  );
  const minimatch = minimatchRequire(installedPackage("minimatch", "3.1.5"));

  assert.match(minimatchRequire.resolve("brace-expansion"), /_patch_hash=/);
  assert.deepEqual(braceExpansion("src/{app,{lib,test}}/{a,b}.js"), [
    "src/app/a.js",
    "src/app/b.js",
    "src/lib/a.js",
    "src/lib/b.js",
    "src/test/a.js",
    "src/test/b.js",
  ]);
  assert.deepEqual(braceExpansion("{a,b}{c},}"), ["ac}", "bc}"]);
  assert.deepEqual(braceExpansion("{a,b}{,c}"), ["a", "ac", "b", "bc"]);
  assert.equal(minimatch("src/lib/a.js", "src/{app,lib}/?.js"), true);
  assert.equal(minimatch("src/test/a.js", "src/{app,lib}/?.js"), false);
});

test("patched brace-expansion bounds chained output length and count", () => {
  const braceExpansionPackage = installedPackage("brace-expansion", "2.1.2", {
    patched: true,
  });
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);

  const long = braceExpansion("{a,b}".repeat(1_500));
  assert.ok(long.length > 0);
  assert.ok(long.every((expansion) => /^[ab]+$/.test(expansion)));
  assert.ok(totalLength(long) <= 4_000_000);

  // Empty/one-character choices evade a length-only cap. The patched default
  // count limit also bounds this high-cardinality input.
  const short = braceExpansion("{,a}".repeat(1_500));
  assert.ok(short.length <= 100_000);
  assert.ok(totalLength(short) <= 4_000_000);

  const explicit = braceExpansion("{a,b}".repeat(20), {
    max: 3,
    maxLength: 100,
  });
  assert.equal(explicit.length, 3);
  assert.ok(totalLength(explicit) <= 100);

  // Each nested comma arm can reach the explicit cap by itself. Run many arms
  // under a constrained heap so retaining one full capped array per arm fails
  // deterministically, while a shared remaining budget completes.
  const constrained = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=32",
      "-e",
      `
        const braceExpansion = require(process.argv[1]);
        const arm = "{,a}".repeat(14);
        const pattern = \`{\${Array.from({ length: 200 }, () => arm).join(",")}}\`;
        const expansions = braceExpansion(pattern, {
          max: 10_000,
          maxLength: 400_000,
        });
        if (expansions.length === 0 || expansions.length > 10_000) process.exit(1);
      `,
      braceExpansionPackage,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(
    constrained.status,
    0,
    `nested comma arms exceeded the shared budget:\n${constrained.stderr}`,
  );
});
