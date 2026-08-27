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

test("default-branch pushes force full quality before change planning", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const pushGuard = workflow.indexOf('if [[ "$EVENT_NAME" == "push" ]]');
  const plannerGuard = workflow.indexOf('if [[ "$BASE_SHA" =~ ^0+$ ]]');

  assert.match(workflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.notEqual(
    pushGuard,
    -1,
    "the workflow must guard default-branch pushes",
  );
  assert.notEqual(
    plannerGuard,
    -1,
    "the workflow must retain planner bootstrap",
  );
  assert.ok(
    pushGuard < plannerGuard,
    "default-branch pushes must short-circuit before diff planning",
  );

  const pushBlock = workflow.slice(pushGuard, plannerGuard);
  assert.match(pushBlock, /echo "run_quality=true"/);
  assert.match(pushBlock, /echo "changed_count=unknown"/);
  assert.match(pushBlock, /echo "reason=default-branch-push-full-quality"/);
  assert.match(
    pushBlock,
    /Default-branch pushes always run full quality checks/,
  );
  assert.match(pushBlock, /exit 0/);
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

// The two unit shards must stay an exact partition of the root `pnpm test`
// command. Proving (a) `test` is literally the two shard scripts, (b) each CI
// shard runs exactly one of them, and (c) the shards share no sub-suite makes
// "no suite was dropped" structural: a suite can only leave a shard by leaving
// the canonical local command with it.
const SHARD_SCRIPTS = ["test:ci:workspaces", "test:ci:vercel"];

function readPackageScripts() {
  return JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ).scripts;
}

function subSuites(scripts, name) {
  return (scripts[name].match(/pnpm [\w:-]+/g) ?? []).map((token) =>
    token.slice("pnpm ".length),
  );
}

test("the root test command is exactly the two CI unit shards", () => {
  const scripts = readPackageScripts();

  assert.equal(
    scripts.test,
    `pnpm ${SHARD_SCRIPTS[0]} && pnpm ${SHARD_SCRIPTS[1]}`,
    "`pnpm test` must stay the union of the CI shards so local and CI coverage cannot diverge",
  );

  const seen = new Map();
  for (const shard of SHARD_SCRIPTS) {
    assert.ok(scripts[shard], `${shard} must exist`);
    for (const suite of subSuites(scripts, shard)) {
      assert.ok(
        scripts[suite],
        `${shard} references an undefined script: ${suite}`,
      );
      assert.equal(
        seen.has(suite),
        false,
        `${suite} runs in both shards; the shards must partition the suite`,
      );
      seen.set(suite, shard);
    }
  }

  assert.match(
    scripts["test:ci:workspaces"],
    /turbo run test$/,
    "the workspace shard must still run the vitest workspace projects",
  );
});

test("both unit shards are gated on the quality plan and feed the sentinel", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );

  const shardJobs = {
    "test-workspaces": "test:ci:workspaces",
    "test-vercel": "test:ci:vercel",
  };

  for (const [jobId, script] of Object.entries(shardJobs)) {
    const job = new RegExp(`^ {2}${jobId}:\\n([\\s\\S]*?)^ {2}\\w`, "m").exec(
      workflow,
    )?.[1];
    assert.ok(job, `the workflow must define the ${jobId} shard`);
    assert.match(
      job,
      /^ {4}if: needs\.changes\.outputs\.run_quality == 'true'$/m,
      `${jobId} must skip exactly when the planner reports a documentation-only diff`,
    );
    assert.match(
      job,
      /- name: Install pnpm dependencies\n {8}uses: \.\/\.github\/actions\/pnpm-install/,
      `${jobId} must install through the trusted composite action`,
    );
    assert.match(
      job,
      new RegExp(`run: pnpm ${script.replaceAll(":", "\\:")}$`, "m"),
      `${jobId} must run the ${script} shard`,
    );
  }

  assert.match(
    workflow,
    /^ {4}needs: \[changes, build, test-workspaces, test-vercel, static\]$/m,
    "the required sentinel must record both shards",
  );
  assert.doesNotMatch(
    workflow,
    /needs\.test\./,
    "the single unsharded test job must be gone from the sentinel wiring",
  );
  for (const label of ["workspaces", "Vercel contracts"]) {
    assert.ok(
      workflow.includes(`"Unit tests (${label}):$TEST_`),
      `the sentinel must require the '${label}' shard result`,
    );
  }
  assert.match(
    workflow,
    /TEST_VERCEL_RESULT: \$\{\{ needs\.test-vercel\.result \}\}/,
  );
  assert.match(
    workflow,
    /TEST_WORKSPACES_RESULT: \$\{\{ needs\.test-workspaces\.result \}\}/,
  );
});
