import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";

const pnpmDirectory = join(process.cwd(), "node_modules", ".pnpm");

function installedPackage(name, version) {
  assert.ok(existsSync(pnpmDirectory), "pnpm dependencies must be installed");
  const entry = readdirSync(pnpmDirectory).find((candidate) =>
    candidate.startsWith(`${name}@${version}`),
  );
  assert.ok(entry, `${name}@${version} must be installed`);
  return join(pnpmDirectory, entry, "node_modules", name);
}

function patchedBraceExpansionPackage() {
  const minimatchPackage = installedPackage("minimatch", "3.1.5");
  const minimatchRequire = createRequire(
    join(minimatchPackage, "package.json"),
  );
  const braceExpansionPackage = dirname(
    minimatchRequire.resolve("brace-expansion/package.json"),
  );
  const runtimePatch = join(
    process.cwd(),
    "patches",
    "brace-expansion@2.1.2.patch",
  );
  const patchPath = existsSync(runtimePatch)
    ? runtimePatch
    : join(
        process.cwd(),
        "scripts",
        "vercel-cli-runtime",
        "patches",
        "brace-expansion@2.1.2.patch",
      );
  const patchHash = createHash("sha256")
    .update(readFileSync(patchPath))
    .digest("hex");

  assert.match(
    braceExpansionPackage,
    new RegExp(`brace-expansion@2\\.1\\.2_patch_hash=${patchHash}`),
  );
  return braceExpansionPackage;
}

function totalLength(expansions) {
  return expansions.reduce((total, expansion) => total + expansion.length, 0);
}

test("patched brace-expansion 2.1.2 preserves minimatch v3 behavior", () => {
  const braceExpansionPackage = patchedBraceExpansionPackage();
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
  assert.deepEqual(braceExpansion("{a,b}{c},}", { max: 2 }), ["ac}", "bc}"]);
  assert.deepEqual(braceExpansion("{a,b}{,c}"), ["a", "ac", "b", "bc"]);
  assert.equal(minimatch("src/lib/a.js", "src/{app,lib}/?.js"), true);
  assert.equal(minimatch("src/test/a.js", "src/{app,lib}/?.js"), false);
});

test("patched brace-expansion bounds chained output length and count", () => {
  const braceExpansionPackage = patchedBraceExpansionPackage();
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

  // Each outer group independently reaches the count cap. Retaining every
  // group's expanded values exhausts the constrained heap; lazy descriptors
  // expand one group immediately before its reverse-pass combine.
  const consecutiveGroups = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=32",
      "-e",
      `
        const braceExpansion = require(process.argv[1]);
        const arm = "{,a}".repeat(14);
        const group = \`{\${Array.from({ length: 200 }, () => arm).join(",")}}\`;
        const expansions = braceExpansion(\`x\${group.repeat(200)}\`, {
          max: 10_000,
          maxLength: 4_000_000,
        });
        if (expansions.length === 0 || expansions.length > 10_000) process.exit(1);
        if (expansions.reduce((length, item) => length + item.length, 0) > 4_000_000) {
          process.exit(1);
        }
      `,
      braceExpansionPackage,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(
    consecutiveGroups.status,
    0,
    `consecutive outer groups exceeded the shared budget:\n${consecutiveGroups.stderr}`,
  );

  // Once an empty-valued group has saturated the count budget, every earlier
  // empty-first group reproduces the same suffix. Rebuilding it for each of
  // 10,000 descriptors turns a small pattern into seconds of redundant work.
  const saturatedEmptySuffix = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=32",
      "-e",
      `
        const braceExpansion = require(process.argv[1]);
        const expansions = braceExpansion("{,}".repeat(10_000), {
          max: 100_000,
          maxLength: 4_000_000,
        });
        if (expansions.length !== 0) process.exit(1);
      `,
      braceExpansionPackage,
    ],
    {
      encoding: "utf8",
      timeout: 2_000,
    },
  );
  assert.equal(
    saturatedEmptySuffix.status,
    0,
    `saturated empty suffix exceeded the work bound:\n${saturatedEmptySuffix.stderr}`,
  );
});

test("patched brace-expansion applies caps while retaining sequences", () => {
  const braceExpansionPackage = patchedBraceExpansionPackage();
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);

  // An empty top-level alternative is discarded, so it must not consume the
  // caller's count budget before the non-empty arm is considered.
  assert.deepEqual(braceExpansion("{,a}"), ["a"]);
  assert.deepEqual(braceExpansion("{,a}", { max: 1 }), ["a"]);
  assert.deepEqual(braceExpansion("x{,a}", { max: 1 }), ["x"]);
  assert.deepEqual(braceExpansion("{,a}{,a}", { max: 1 }), ["a"]);
  assert.deepEqual(braceExpansion("{a,{,a}}", { max: 2 }), ["a", "a"]);
  assert.deepEqual(braceExpansion("{,a}{,a}{,a}", { max: 3 }), ["a", "a", "a"]);
  assert.deepEqual(braceExpansion("{,a}{,a}{a,}", { max: 3 }), [
    "a",
    "aa",
    "aa",
  ]);
  assert.deepEqual(braceExpansion("{,a}{a,}{,a}", { max: 3 }), [
    "a",
    "aa",
    "aa",
  ]);

  // The padded strings are deliberately much wider than the retained budget.
  // Without a sequence-local length check, the pre-combine array exceeds the
  // constrained heap even though final output is capped at 4 KiB.
  const constrained = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=32",
      "-e",
      `
        const braceExpansion = require(process.argv[1]);
        const zeros = "0".repeat(1_023);
        const expansions = braceExpansion(
          \`{\${zeros}1..\${zeros}99999}\`,
          { max: 100_000, maxLength: 4_096 },
        );
        if (expansions.length !== 3) process.exit(1);
        if (expansions.some((expansion) => expansion.length !== 1_028)) {
          process.exit(1);
        }
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
    `padded sequence exceeded the remaining length budget:\n${constrained.stderr}`,
  );
});

test("patched brace-expansion retains upstream within-cap semantics", () => {
  const braceExpansionPackage = patchedBraceExpansionPackage();
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);

  // Uncapped expected output comes from an independent 2.1.2 tarball; capped
  // cases codify the bounded prefix contract. Keep this corpus below every
  // security cap while covering ordering and the grammar edges moved here.
  const corpus = [
    ["{,a}", {}, ["a"]],
    ["{,a}{,a}", {}, ["a", "a", "aa"]],
    ["{,a}{,a}", { max: 0 }, []],
    ["{,a}{,a}", { max: 1 }, ["a"]],
    ["{,a}{,a}", { max: 2 }, ["a", "a"]],
    ["${a,b}{c,d}", {}, ["${a,b}c", "${a,b}d"]],
    ["x{a}y{b,c}", {}, ["x{a}yb", "x{a}yc"]],
    ["{a,{b,c}}", {}, ["a", "b", "c"]],
    ["{a,b}{c,d}", {}, ["ac", "ad", "bc", "bd"]],
    ["{1..3}", {}, ["1", "2", "3"]],
    ["{01..03}", {}, ["01", "02", "03"]],
    ["{003..001}", {}, ["003", "002", "001"]],
  ];

  for (const [pattern, options, expected] of corpus) {
    assert.deepEqual(braceExpansion(pattern, options), expected, pattern);
  }
});

test("patched brace-expansion preserves literal output when max is zero", () => {
  const braceExpansionPackage = patchedBraceExpansionPackage();
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);

  for (const literal of ["a", "a{b}", "a{b}c", "{}", "{a}"]) {
    assert.deepEqual(braceExpansion(literal, { max: 0 }), [literal]);
  }
});
