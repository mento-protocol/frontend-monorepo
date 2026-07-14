import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { planCiForPaths } from "./ci-change-plan.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = relative(
  repoRoot,
  fileURLToPath(new URL("./ci-change-plan.mjs", import.meta.url)),
);

test("skips expensive quality jobs for documentation-only changes", () => {
  assert.deepEqual(planCiForPaths(["README.md", "docs/wallet-testing.md"]), {
    changedCount: 2,
    reason: "documentation-only",
    runQuality: false,
  });
});

test("treats Markdown guidance outside docs as documentation", () => {
  assert.equal(
    planCiForPaths(["AGENTS.md", ".github/pull_request_template.md"])
      .runQuality,
    false,
  );
});

test("runs quality for source, configuration, and workflow changes", () => {
  for (const path of [
    "apps/app.mento.org/app/page.tsx",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    ".github/actions/pnpm-install/action.yml",
  ]) {
    assert.equal(planCiForPaths([path]).runQuality, true, path);
  }
});

test("runs quality for mixed documentation and source changes", () => {
  const plan = planCiForPaths(["README.md", "packages/web3/src/index.ts"]);
  assert.equal(plan.runQuality, true);
  assert.equal(plan.reason, "code-or-policy-change");
});

test("fails safe to full quality for an empty or unusable diff", () => {
  assert.deepEqual(planCiForPaths([]), {
    changedCount: 0,
    reason: "empty-diff-full-quality",
    runQuality: true,
  });
});

test("CLI parses the NUL-delimited git diff format used by CI", () => {
  const output = execFileSync(process.execPath, [scriptPath, "--null"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "README.md\0docs/diagram.svg\0",
  });

  assert.match(output, /^run_quality=false$/m);
  assert.match(output, /^changed_count=2$/m);
  assert.match(output, /^reason=documentation-only$/m);
});

test("CLI fails safe when stdin is empty", () => {
  const output = execFileSync(process.execPath, [scriptPath, "--null"], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "",
  });

  assert.match(output, /^run_quality=true$/m);
  assert.match(output, /^reason=empty-diff-full-quality$/m);
});

test("workflow executes the planner from the trusted base after bootstrap", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /git cat-file -e "\$BASE_SHA:\$planner"/);
  assert.match(workflow, /git show "\$BASE_SHA:\$planner"/);
  assert.match(workflow, /git diff --name-only -z/);
});
