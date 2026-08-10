import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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

// The security overrides move every brace-expansion <2.1.4 consumer,
// including minimatch v3's native 1.x range, onto the upstream fixed release
// 2.1.4. That release ships the same a1bd339 expansion bounds the local
// 2.1.2 patch used to carry, so the patch is retired and these tests now
// codify the upstream 2.1.4 contract.
function minimatchV3BraceExpansionPackage() {
  const minimatchPackage = installedPackage("minimatch", "3.1.5");
  const minimatchRequire = createRequire(
    join(minimatchPackage, "package.json"),
  );
  const braceExpansionPackage = dirname(
    minimatchRequire.resolve("brace-expansion/package.json"),
  );

  assert.match(braceExpansionPackage, /brace-expansion@2\.1\.4(?:\/|$)/);
  return braceExpansionPackage;
}

function totalLength(expansions) {
  return expansions.reduce((total, expansion) => total + expansion.length, 0);
}

test("upstream brace-expansion 2.1.4 preserves minimatch v3 behavior", () => {
  const braceExpansionPackage = minimatchV3BraceExpansionPackage();
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);
  const minimatchRequire = createRequire(
    join(installedPackage("minimatch", "3.1.5"), "package.json"),
  );
  const minimatch = minimatchRequire(installedPackage("minimatch", "3.1.5"));

  assert.deepEqual(braceExpansion("src/{app,{lib,test}}/{a,b}.js"), [
    "src/app/a.js",
    "src/app/b.js",
    "src/lib/a.js",
    "src/lib/b.js",
    "src/test/a.js",
    "src/test/b.js",
  ]);
  // Upstream 2.1.3+ changed this unbalanced-brace edge from the 1.x/2.1.2
  // output (["ac}", "bc}"]): the dangling ",}" tail now also produces the
  // bare alternatives. Glob consumers never emit unbalanced braces, so the
  // ecosystem-canonical upstream output is codified here.
  assert.deepEqual(braceExpansion("{a,b}{c},}"), ["ac}", "a", "bc}", "b"]);
  assert.deepEqual(braceExpansion("{a,b}{c},}", { max: 2 }), ["ac}", "a"]);
  assert.deepEqual(braceExpansion("{a,b}{,c}"), ["a", "ac", "b", "bc"]);
  assert.equal(minimatch("src/lib/a.js", "src/{app,lib}/?.js"), true);
  assert.equal(minimatch("src/test/a.js", "src/{app,lib}/?.js"), false);
});

test("upstream brace-expansion 2.1.4 bounds chained output length and count", () => {
  const braceExpansionPackage = minimatchV3BraceExpansionPackage();
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

  // A chain of all-empty groups must produce no expansions without exhausting
  // the constrained heap. Upstream 2.1.4 lacks the retired patch's shared
  // empty-suffix memoization, so its recombination work grows quadratically
  // with the group count — keep this instance small enough to stay fast while
  // still proving the count/discard bound.
  const saturatedEmptySuffix = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=32",
      "-e",
      `
        const braceExpansion = require(process.argv[1]);
        const expansions = braceExpansion("{,}".repeat(1_000), {
          max: 100_000,
          maxLength: 4_000_000,
        });
        if (expansions.length !== 0) process.exit(1);
      `,
      braceExpansionPackage,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(
    saturatedEmptySuffix.status,
    0,
    `saturated empty suffix exceeded the work bound:\n${saturatedEmptySuffix.stderr}`,
  );
});

test("upstream brace-expansion 2.1.4 applies caps while retaining sequences", () => {
  const braceExpansionPackage = minimatchV3BraceExpansionPackage();
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
  // For chained empty-arm groups, upstream 2.1.4's bounded prefix differs
  // from the retired local patch in which combinations survive the cap; the
  // count bound itself is what matters and still holds.
  assert.deepEqual(braceExpansion("{,a}{,a}{,a}", { max: 3 }), [
    "a",
    "a",
    "aa",
  ]);
  assert.deepEqual(braceExpansion("{,a}{,a}{a,}", { max: 3 }), [
    "a",
    "aa",
    "a",
  ]);
  assert.deepEqual(braceExpansion("{,a}{a,}{,a}", { max: 3 }), [
    "a",
    "aa",
    "a",
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

test("upstream brace-expansion 2.1.4 retains within-cap semantics", () => {
  const braceExpansionPackage = minimatchV3BraceExpansionPackage();
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

test("upstream brace-expansion 2.1.4 returns no expansions when max is zero", () => {
  const braceExpansionPackage = minimatchV3BraceExpansionPackage();
  const braceExpansion = createRequire(
    join(braceExpansionPackage, "package.json"),
  )(braceExpansionPackage);

  // The retired local patch passed literals through a zero cap; upstream
  // 2.1.4 applies the cap uniformly and returns an empty result instead.
  for (const literal of ["a", "a{b}", "a{b}c", "{}", "{a}"]) {
    assert.deepEqual(braceExpansion(literal, { max: 0 }), []);
  }
});
