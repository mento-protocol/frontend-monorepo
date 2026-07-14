import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { planCiForPaths } from "./ci-change-plan.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptAbsolutePath = fileURLToPath(
  new URL("./ci-change-plan.mjs", import.meta.url),
);
const scriptPath = relative(repoRoot, scriptAbsolutePath);

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

test("rename from source into docs still runs full quality", () => {
  const directory = mkdtempSync(join(tmpdir(), "ci-change-plan-"));
  const source = join(directory, "apps/app.mento.org/app/page.tsx");
  const destination = join(directory, "docs/page.md");

  try {
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "export default function Page() {}\n");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=CI Plan Test",
        "-c",
        "user.email=ci-plan@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "initial",
      ],
      { cwd: directory },
    );

    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
    execFileSync("git", ["add", "--all"], { cwd: directory });

    const changedPaths = execFileSync(
      "git",
      ["diff", "--cached", "--no-renames", "--name-only", "-z"],
      { cwd: directory },
    );
    const output = execFileSync(
      process.execPath,
      [scriptAbsolutePath, "--null"],
      {
        cwd: directory,
        encoding: "utf8",
        input: changedPaths,
      },
    );

    assert.match(output, /^run_quality=true$/m);
    assert.match(output, /^changed_count=2$/m);
    assert.match(output, /^reason=code-or-policy-change$/m);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("workflow executes the planner from the trusted base after bootstrap", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  assert.match(
    workflow,
    /\[\[ "\$BASE_SHA" =~ \^0\+\$ \]\] \|\| ! git cat-file -e "\$BASE_SHA:\$planner"/,
  );
  assert.match(workflow, /echo "run_quality=true"/);
  assert.match(workflow, /echo "changed_count=unknown"/);
  assert.match(workflow, /echo "reason=planner-bootstrap-full-quality"/);
  assert.match(workflow, /running full quality checks/);
  assert.doesNotMatch(workflow, /using the checked-out copy/);
  assert.match(workflow, /git show "\$BASE_SHA:\$planner"/);
  assert.match(workflow, /node "\$trusted_planner" --null/);
  assert.match(workflow, /git diff --no-renames --name-only -z/);
  assert.match(workflow, /run: pnpm ci:change-plan:test/);
});

test("documentation-only changes retain the always-on Trunk static checks", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const staticJob = /^ {2}static:\n([\s\S]*?)^ {2}ci:/m.exec(workflow)?.[1];
  assert.ok(staticJob, "the workflow must define the static analysis job");

  assert.doesNotMatch(
    staticJob,
    /^ {4}if: needs\.changes\.outputs\.run_quality == 'true'$/m,
    "the static job must run for documentation-only changes",
  );
  assert.match(
    staticJob,
    /- name: Install pnpm dependencies\n {8}uses: \.\/\.github\/actions\/pnpm-install/,
    "Trunk's repository plugins require dependencies on every diff",
  );
  for (const stepName of ["Type check", "Knip"]) {
    assert.match(
      staticJob,
      new RegExp(
        `- name: ${stepName}\\n {8}if: needs\\.changes\\.outputs\\.run_quality == 'true'`,
      ),
      `${stepName} should remain limited to full-quality runs`,
    );
  }
  assert.match(
    staticJob,
    /- name: Trunk Code Quality\n {8}uses: trunk-io\/trunk-action@/,
    "Trunk must remain unconditional inside the always-on static job",
  );
  assert.match(
    workflow,
    /Static analysis result was '\$STATIC_RESULT'; expected 'success'/,
    "the required sentinel must demand successful static analysis",
  );
});
