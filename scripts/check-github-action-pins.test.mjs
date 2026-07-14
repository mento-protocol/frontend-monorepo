#!/usr/bin/env node
/** Fixture tests for scripts/check-github-action-pins.mjs. */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const SCRIPT = resolve("scripts/check-github-action-pins.mjs");
const PINNED_SHA = "0123456789abcdef0123456789abcdef01234567";
const tests = [];

/** @param {string} name @param {() => void} run */
function test(name, run) {
  tests.push({ name, run });
}

/** @param {string} name */
function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), `action-pin-${name}-`));
}

/** @param {string} root @param {string} path @param {string} content */
function write(root, path, content) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

/** @param {string} root */
function runChecker(root) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: resolve("."),
    env: { ...process.env, GITHUB_ACTION_PINS_ROOT: root },
    encoding: "utf8",
  });
}

/** @param {unknown} actual @param {unknown} expected @param {string} message */
function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

/** @param {string} haystack @param {string} needle @param {string} message */
function contains(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(`${message}: missing ${needle}\n${haystack}`);
  }
}

test("accepts documented SHA pins and recursive local actions", () => {
  const root = fixtureRoot("pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
      - { uses: actions/cache@${PINNED_SHA} } # v6.1.0
      - uses: ./.github/actions/setup
`,
    );
    write(
      root,
      ".github/actions/setup/action.yml",
      `
runs:
  using: composite
  steps:
    - uses: ./tools/actions/nested
`,
    );
    write(
      root,
      "tools/actions/nested/action.yaml",
      `
runs:
  using: composite
  steps:
    - uses: 'actions/setup-node@${PINNED_SHA}' # v6.4.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
    contains(
      result.stdout,
      "All 3 workflow/composite-action YAML files",
      "recursive scan count",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable workflow tags with quoted keys and values", () => {
  const root = fixtureRoot("workflow-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@v7
      - "uses": actions/setup-node@v6
      - uses: 'actions/cache@main'
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "ci.yml:5 uses: actions/checkout@v7", "tag");
    contains(result.stderr, "ci.yml:6 uses: actions/setup-node@v6", "key");
    contains(result.stderr, "ci.yml:7 uses: actions/cache@main", "value");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects multiline uses values", () => {
  const root = fixtureRoot("multiline-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses:
          actions/checkout@v7
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      ".github/workflows/ci.yml:5 uses:",
      "multiline key location",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable tags in composite actions", () => {
  const root = fixtureRoot("composite-fail");
  try {
    write(
      root,
      ".github/actions/setup/action.yml",
      `
runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v4
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      ".github/actions/setup/action.yml:5 uses: pnpm/action-setup@v4",
      "composite location",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable tags reached through local action references", () => {
  const root = fixtureRoot("local-target-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: ./tools/actions/custom
`,
    );
    write(
      root,
      "tools/actions/custom/action.yml",
      `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v6
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "tools/actions/custom/action.yml:5 uses: actions/setup-node@v6",
      "referenced manifest location",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable flow-style steps", () => {
  const root = fixtureRoot("flow-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - { uses: actions/checkout@v7 }
      - { uses: actions/cache@v6 } # v6.1.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "first flow step");
    contains(result.stderr, "uses: actions/cache@v6", "second flow step");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects flow-style uses before later uses-like text", () => {
  const root = fixtureRoot("flow-decoy-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - { uses: actions/checkout@v7, name: "uses: ./ignored" }
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "uses: actions/checkout@v7",
      "first flow mapping field",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects explicit uses keys in flow-style steps", () => {
  const root = fixtureRoot("flow-explicit-key-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - { ? uses : actions/checkout@v7 }
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "explicit flow key");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores uses input names in nested flow mappings", () => {
  const root = fixtureRoot("nested-flow-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
        with: { uses: "some-input" }
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable uses keys with YAML anchors", () => {
  const root = fixtureRoot("anchor-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - &checkout uses: actions/checkout@v7
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "anchored uses key");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores uses-like text inside block scalars", () => {
  const root = fixtureRoot("block-scalars-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - run: |
          echo "example:"
          - uses: actions/checkout@v7
        shell: bash
      - run: >-
          uses: actions/cache@v6
      - uses: actions/setup-node@${PINNED_SHA} # v6.4.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resumes scanning after block scalars", () => {
  const root = fixtureRoot("after-block-scalar-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - run: |
          uses: actions/cache@v6
      - uses: actions/checkout@v7
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      ".github/workflows/ci.yml:7 uses: actions/checkout@v7",
      "step after block scalar",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects SHA pins without release-tag comments", () => {
  const root = fixtureRoot("missing-comment");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA}
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      `.github/workflows/ci.yml:5 uses: actions/checkout@${PINNED_SHA}`,
      "missing comment location",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects non-version comments", () => {
  const root = fixtureRoot("bad-comment");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA} # pinned
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@", "non-version comment");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing refs and short SHAs", () => {
  const root = fixtureRoot("bad-ref");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/cache
      - uses: actions/setup-node@0123456789abcdef # v6.4.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/cache", "missing ref");
    contains(
      result.stderr,
      "uses: actions/setup-node@0123456789abcdef",
      "short SHA",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}

if (failures > 0) process.exit(1);

console.log(`\n${tests.length} github action pin tests passed.`);
