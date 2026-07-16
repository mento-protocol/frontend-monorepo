#!/usr/bin/env node
/** Fixture tests for scripts/check-github-action-pins.mjs. */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { parse } from "yaml";

const SCRIPT = resolve("scripts/check-github-action-pins.mjs");
const PINNED_SHA = "0123456789abcdef0123456789abcdef01234567";
const POLICY_WORKFLOW_PATHS = [
  ".github/workflows/action-pins.yml",
  ".github/workflows/action-pins-source.yml",
];
const POLICY_WORKFLOW_FIXTURES = new Map(
  POLICY_WORKFLOW_PATHS.map((path) => [
    path,
    readFileSync(resolve(path), "utf8"),
  ]),
);
const VERCEL_PREVIEW_CONTROLLER_PATH =
  ".github/workflows/vercel-preview-controller.yml";
const VERCEL_PREVIEW_CONTROLLER_FIXTURE = readFileSync(
  resolve(VERCEL_PREVIEW_CONTROLLER_PATH),
  "utf8",
);
const tests = [];

/** @param {string} name @param {() => void} run */
function test(name, run) {
  tests.push({ name, run });
}

/** @param {string} name */
function fixtureRoot(name) {
  const root = mkdtempSync(join(tmpdir(), `action-pin-${name}-`));
  for (const path of POLICY_WORKFLOW_PATHS) {
    write(root, path, POLICY_WORKFLOW_FIXTURES.get(path));
  }
  return root;
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

/** @param {string} haystack @param {string} needle @param {string} message */
function excludes(haystack, needle, message) {
  if (haystack.includes(needle)) {
    throw new Error(`${message}: unexpectedly found ${needle}\n${haystack}`);
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
      "All 5 workflow/composite-action YAML files",
      "recursive scan count",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("enforces the default-branch Vercel controller dispatch contract", () => {
  const root = fixtureRoot("vercel-controller-dispatch-pass");
  try {
    write(
      root,
      VERCEL_PREVIEW_CONTROLLER_PATH,
      VERCEL_PREVIEW_CONTROLLER_FIXTURE,
    );
    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects branch-selectable Vercel controller dispatch", () => {
  const root = fixtureRoot("vercel-controller-workflow-dispatch-fail");
  try {
    const mutated = VERCEL_PREVIEW_CONTROLLER_FIXTURE.replace(
      / {2}repository_dispatch:\n {4}types: \[vercel-preview-bootstrap, vercel-preview-reconcile\]\n/,
      "  workflow_dispatch:\n",
    );
    write(root, VERCEL_PREVIEW_CONTROLLER_PATH, mutated);
    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "invalid Vercel preview controller dispatch policy",
      "branch-selectable controller trigger",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects widened Vercel controller repository event types", () => {
  const root = fixtureRoot("vercel-controller-event-type-fail");
  try {
    const mutated = VERCEL_PREVIEW_CONTROLLER_FIXTURE.replace(
      "types: [vercel-preview-bootstrap, vercel-preview-reconcile]",
      "types: [vercel-preview-bootstrap, vercel-preview-reconcile, arbitrary]",
    );
    write(root, VERCEL_PREVIEW_CONTROLLER_PATH, mutated);
    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "must use only the default-branch repository dispatch contract",
      "repository event allowlist",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects widened Vercel controller pull request activity types", () => {
  const root = fixtureRoot("vercel-controller-pull-request-type-fail");
  try {
    const mutated = VERCEL_PREVIEW_CONTROLLER_FIXTURE.replace(
      "types: [opened, edited, synchronize, reopened, closed]",
      "types: [opened, edited, synchronize, reopened, closed, labeled]",
    );
    write(root, VERCEL_PREVIEW_CONTROLLER_PATH, mutated);
    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "must use only the default-branch repository dispatch contract",
      "pull request activity allowlist",
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

test("rejects symlinked local action manifests", () => {
  const root = fixtureRoot("local-symlink-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: ./.github/actions/linked
`,
    );
    write(
      root,
      "shared/action.yml",
      `
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v6
`,
    );
    const link = join(root, ".github/actions/linked/action.yml");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync("../../../shared/action.yml", link);

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "unsafe local action manifest",
      "symlinked manifest",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects local action references without a materialized manifest", () => {
  const root = fixtureRoot("local-missing-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: ./tools/actions/missing
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "does not contain action.yml or action.yaml",
      "missing local action manifest",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects local action paths that escape the repository root", () => {
  const root = fixtureRoot("local-escape-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: ../outside
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "local action path escapes the repository root",
      "escaping local action",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts existing local reusable workflows", () => {
  const root = fixtureRoot("local-workflow-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  call:
    uses: ./.github/workflows/reusable.yml
`,
    );
    write(
      root,
      ".github/workflows/reusable.yml",
      `
on: workflow_call
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing local reusable workflows", () => {
  const root = fixtureRoot("local-workflow-missing-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  call:
    uses: ./.github/workflows/missing.yml
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "unsafe local reusable workflow",
      "missing local reusable workflow",
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

test("rejects mutable flow-style reusable workflow jobs", () => {
  const root = fixtureRoot("flow-reusable-job-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  call: { uses: org/repo/.github/workflows/reuse.yml@v1 }
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "uses: org/repo/.github/workflows/reuse.yml@v1",
      "flow-style reusable workflow",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts pinned flow-style reusable workflow jobs", () => {
  const root = fixtureRoot("flow-reusable-job-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  call: { uses: org/repo/.github/workflows/reuse.yml@${PINNED_SHA} } # v1.2.3
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
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

test("ignores uses input names in nested block mappings", () => {
  const root = fixtureRoot("nested-block-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
        with:
          uses: "some-input"
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resumes scanning after nested block mappings", () => {
  const root = fixtureRoot("after-nested-block-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
        with:
          uses: "some-input"
      - uses: actions/cache@v6
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/cache@v6", "following action step");
    excludes(result.stderr, "some-input", "nested input name");
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

test("rejects mutable actions behind quoted structural keys", () => {
  const root = fixtureRoot("quoted-structure-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
"jobs":
  test:
    "steps":
      - "uses": actions/checkout@v7
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "quoted structure");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable actions in indentless step sequences", () => {
  const root = fixtureRoot("indentless-steps-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
    - uses: actions/checkout@v7
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "indentless step");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable actions in fully flow-style workflows", () => {
  const root = fixtureRoot("fully-flow-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs: { test: { steps: [{ uses: actions/checkout@v7 }] } }
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "fully flow step");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable reusable jobs in multiline flow mappings", () => {
  const root = fixtureRoot("multiline-flow-job-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  call: {
    uses: org/repo/.github/workflows/reuse.yml@v1
  }
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "uses: org/repo/.github/workflows/reuse.yml@v1",
      "multiline flow job",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects mutable actions behind explicit, alias, and tagged uses keys", () => {
  const root = fixtureRoot("semantic-keys-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
name: &uses-key uses
jobs:
  test:
    steps:
      - ? "uses"
        : actions/checkout@v7
      - ? *uses-key
        : actions/setup-node@v6
      - !!str uses: actions/cache@v6
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "uses: actions/checkout@v7", "explicit key");
    contains(result.stderr, "uses: actions/setup-node@v6", "alias key");
    contains(result.stderr, "uses: actions/cache@v6", "tagged key");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects duplicate semantic uses keys introduced by aliases", () => {
  const root = fixtureRoot("duplicate-alias-key-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
name: &uses-key uses
jobs:
  test:
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
        ? *uses-key
        : actions/cache@v6
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "duplicate semantic `uses` keys",
      "alias duplicate",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unresolved structural aliases", () => {
  const root = fixtureRoot("unresolved-alias-fail");
  try {
    write(root, ".github/workflows/ci.yml", "jobs: *missing\n");

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      "unresolved YAML alias `*missing`",
      "missing alias",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores nested paths that only happen to end in steps.uses", () => {
  const root = fixtureRoot("exact-paths-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    strategy:
      matrix:
        include:
          - steps:
              uses: matrix-input
    steps:
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
        with:
          steps:
            uses: action-input
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects pinned multiline uses values", () => {
  const root = fixtureRoot("pinned-multiline-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  test:
    steps:
      - uses:
          actions/checkout@${PINNED_SHA} # v7.0.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      `.github/workflows/ci.yml:5 uses: actions/checkout@${PINNED_SHA}`,
      "pinned multiline value",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects folded and literal uses scalars", () => {
  for (const [name, indicator] of [
    ["folded", ">-"],
    ["literal", "|-"],
  ]) {
    const root = fixtureRoot(`${name}-scalar-fail`);
    try {
      write(
        root,
        ".github/workflows/ci.yml",
        `
jobs:
  test:
    steps:
      - uses: ${indicator} # v7.0.0
          actions/checkout@${PINNED_SHA}
`,
      );

      const result = runChecker(root);
      equal(result.status, 1, result.stdout);
      contains(
        result.stderr,
        `.github/workflows/ci.yml:5 uses: actions/checkout@${PINNED_SHA}`,
        `${name} scalar`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("does not share one release comment across multiple actions", () => {
  const root = fixtureRoot("shared-comment-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs: { test: { steps: [{ uses: org/first@${PINNED_SHA} }, { uses: org/second@${PINNED_SHA} }] } } # v1.2.3
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, `uses: org/first@${PINNED_SHA}`, "first action");
    contains(result.stderr, `uses: org/second@${PINNED_SHA}`, "second action");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires alias values to document the executable use site", () => {
  const root = fixtureRoot("alias-comment-fail");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
name: &checkout-ref actions/checkout@${PINNED_SHA} # v7.0.0
jobs:
  test:
    steps:
      - uses: *checkout-ref
`,
    );

    const result = runChecker(root);
    equal(result.status, 1, result.stdout);
    contains(
      result.stderr,
      `uses: actions/checkout@${PINNED_SHA}`,
      "alias use",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts documented alias values at the executable use site", () => {
  const root = fixtureRoot("alias-comment-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
name: &checkout-ref actions/checkout@${PINNED_SHA}
jobs:
  test:
    steps:
      - uses: *checkout-ref # v7.0.0
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deduplicates reused anchored step sequences", () => {
  const root = fixtureRoot("reused-step-sequence-pass");
  try {
    write(
      root,
      ".github/workflows/ci.yml",
      `
jobs:
  first:
    steps: &shared-steps
      - uses: actions/checkout@${PINNED_SHA} # v7.0.0
  second:
    steps: *shared-steps
`,
    );

    const result = runChecker(root);
    equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires policy paths to be regular files", () => {
  const directoryRoot = fixtureRoot("policy-directory-fail");
  try {
    const path = join(directoryRoot, ".github/workflows/action-pins.yml");
    rmSync(path);
    mkdirSync(path);

    const result = runChecker(directoryRoot);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "action-pins.yml", "directory policy path");
  } finally {
    rmSync(directoryRoot, { recursive: true, force: true });
  }

  const symlinkRoot = fixtureRoot("policy-symlink-fail");
  try {
    const path = join(symlinkRoot, ".github/workflows/action-pins.yml");
    rmSync(path);
    symlinkSync(
      join(symlinkRoot, ".github/workflows/action-pins-source.yml"),
      path,
    );

    const result = runChecker(symlinkRoot);
    equal(result.status, 1, result.stdout);
    contains(result.stderr, "action-pins.yml", "symlink policy path");
  } finally {
    rmSync(symlinkRoot, { recursive: true, force: true });
  }
});

test("requires both action-pin policy workflows", () => {
  for (const path of POLICY_WORKFLOW_PATHS) {
    const root = fixtureRoot("missing-policy");
    try {
      rmSync(join(root, path));

      const result = runChecker(root);
      equal(result.status, 1, result.stdout);
      contains(result.stderr, path, "missing policy workflow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects same-name no-op replacements for both policy workflows", () => {
  for (const [path, name, jobId, checkName] of [
    [
      ".github/workflows/action-pins.yml",
      "GitHub Actions Policy",
      "action-pins",
      "Action Pin Policy",
    ],
    [
      ".github/workflows/action-pins-source.yml",
      "GitHub Actions Policy Source",
      "policy-source",
      "Action Pin Policy Source",
    ],
  ]) {
    const root = fixtureRoot("noop-policy-fail");
    try {
      write(
        root,
        path,
        `
name: ${name}
on: pull_request
permissions:
  contents: read
jobs:
  ${jobId}:
    name: ${checkName}
    runs-on: ubuntu-latest
    steps:
      - run: true
`,
      );

      const result = runChecker(root);
      equal(result.status, 1, result.stdout);
      contains(result.stderr, path, "policy path");
      contains(
        result.stderr,
        "invalid action-pin policy workflow",
        "trusted structure failure",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("allows immutable action SHA bumps in canonical policy workflows", () => {
  for (const path of POLICY_WORKFLOW_PATHS) {
    const root = fixtureRoot("policy-sha-bump-pass");
    try {
      const updated = POLICY_WORKFLOW_FIXTURES.get(path).replace(
        /@[0-9a-f]{40}/,
        `@${PINNED_SHA}`,
      );
      write(root, path, updated);

      const result = runChecker(root);
      equal(result.status, 0, result.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("isolates trusted enforcement from PR-head source validation", () => {
  const trusted = readFileSync(
    resolve(".github/workflows/action-pins.yml"),
    "utf8",
  );
  const source = readFileSync(
    resolve(".github/workflows/action-pins-source.yml"),
    "utf8",
  );
  const trustedWorkflow = parse(trusted);
  const sourceWorkflow = parse(source);
  const trustedSteps = trustedWorkflow.jobs["action-pins"].steps;
  const sourceSteps = sourceWorkflow.jobs["policy-source"].steps;

  contains(trusted, "pull_request_target:", "trusted trigger");
  excludes(trusted, "\n  pull_request:", "trusted workflow PR-head trigger");
  contains(source, "\n  pull_request:", "source-validation trigger");
  excludes(source, "pull_request_target:", "source workflow trusted trigger");
  contains(source, "persist-credentials: false", "credential-free checkout");
  excludes(trusted, "Check out pull request", "untrusted checkout step");
  excludes(trusted, "allow-unsafe-pr-checkout", "unsafe checkout opt-in");
  const trustedCheckouts = trustedSteps.filter((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  equal(trustedCheckouts.length, 1, "only one trusted checkout");
  equal(
    trustedCheckouts[0].with.ref,
    "${{ github.event.pull_request.base.sha }}",
    "checkout stays on exact base SHA",
  );
  excludes(trusted, "download-artifact", "untrusted artifact download");
  excludes(trusted, "unzip", "untrusted archive extraction");
  for (const step of trustedSteps.filter((candidate) => candidate.run)) {
    equal(
      step["working-directory"],
      "trusted-base",
      `${step.name} runs only trusted code`,
    );
  }
  contains(
    trustedSteps.find((step) => step.name === "Setup PNPM").uses,
    "pnpm/action-setup@",
    "trusted PNPM setup",
  );
  contains(
    sourceSteps.find((step) => step.name === "Setup PNPM").uses,
    "pnpm/action-setup@",
    "source PNPM setup",
  );
  contains(
    trustedSteps.find(
      (step) => step.name === "Install trusted policy dependencies",
    ).run,
    "--frozen-lockfile --ignore-scripts --filter .",
    "trusted dependency install",
  );
  contains(
    sourceSteps.find(
      (step) => step.name === "Install proposed policy dependencies",
    ).run,
    "--frozen-lockfile --ignore-scripts --filter .",
    "source dependency install",
  );
  const fetchStep = trustedSteps.find(
    (step) => step.name === "Fetch pull request Actions YAML",
  );
  equal(
    fetchStep.run,
    "node scripts/fetch-action-pin-yaml.mjs",
    "trusted fetcher",
  );
  equal(
    fetchStep.env.GITHUB_TOKEN,
    "${{ github.token }}",
    "fetch-only token env",
  );
  equal(
    trustedSteps.filter((step) => step.env?.GITHUB_TOKEN).length,
    1,
    "token is exposed only to the trusted fetch step",
  );
  equal(
    fetchStep.env.PR_HEAD_REPOSITORY,
    "${{ github.event.pull_request.head.repo.full_name }}",
    "exact fork repository input",
  );
  equal(
    fetchStep.env.PR_HEAD_SHA,
    "${{ github.event.pull_request.head.sha }}",
    "exact PR head SHA input",
  );
  equal(
    fetchStep.env.ACTION_PIN_OUTPUT_DIR,
    "${{ runner.temp }}/action-pin-pr-head",
    "isolated materializer output",
  );
  equal(
    trustedSteps.find((step) => step.name === "Enforce immutable action pins")
      .env.GITHUB_ACTION_PINS_ROOT,
    "${{ runner.temp }}/action-pin-pr-head",
    "materialized scanner root",
  );
  excludes(source, "Enforce proposed", "source validation wording");
  equal(
    trustedWorkflow.jobs["action-pins"].name ===
      sourceWorkflow.jobs["policy-source"].name,
    false,
    "distinct required check names",
  );
  contains(
    source,
    "pnpm ci:action-pins:test",
    "proposed scanner and fetcher tests",
  );
  contains(
    source,
    "node scripts/check-github-action-pins.mjs",
    "proposed policy scan",
  );
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
