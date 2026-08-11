/* eslint-disable turbo/no-undeclared-env-vars -- The Bash-validator harness preserves the host executable search path. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function workflow(relativePath) {
  return parse(read(relativePath), { uniqueKeys: true });
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function dependabotPatternMatches(pattern, dependency) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`).test(dependency);
}

const intakePath = ".github/workflows/dependabot-intake.yml";
const preparedIntakePath =
  ".github/workflows/dependabot-prepared-head-intake.yml";
const processorPath = ".github/workflows/dependabot-process.yml";
const repairPath = ".github/workflows/dependabot-prepare-repair.yml";
const preparedDispatchPath =
  ".github/workflows/dependabot-prepared-head-dispatch.yml";
const dependabotReviewPath = ".github/workflows/dependabot-claude-review.yml";
const humanReviewPath = ".github/workflows/claude-code-review.yml";
const intake = workflow(intakePath);
const processor = workflow(processorPath);
const repair = workflow(repairPath);
const preparedDispatch = workflow(preparedDispatchPath);
const dependabotReview = workflow(dependabotReviewPath);
const humanReview = workflow(humanReviewPath);

const claudeAction =
  "anthropics/claude-code-action@be7b93b1907a4abad570368f3c74b6fe3807510b";
const claudePluginMarketplace = "./.claude-code-plugin-marketplace";
const claudeCodeReviewPlugin = `${claudePluginMarketplace}/plugins/code-review`;
const claudePluginMarketplaceRef = "2bb60696142b493eafaeacfe00eac51d16c50c4f";

const forbiddenCandidateSurfaces =
  /actions\/(?:download-artifact|upload-artifact|cache)@|cache-dependency-path|gh pr checkout|git (?:checkout|switch|fetch)|node_modules|pnpm install|npm (?:ci|install)|yarn install/;

test("workflow parsing rejects duplicate YAML keys", () => {
  assert.throws(
    () =>
      parse("steps:\n  - run: first\n    run: second\n", {
        uniqueKeys: true,
      }),
    /Map keys must be unique/,
  );
});

test("sensitive Actions updates stay out of the routine Dependabot group", () => {
  const config = parse(read(".github/dependabot.yml"), { uniqueKeys: true });
  const actionsConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "github-actions",
  );
  const routine = actionsConfig.groups["github-actions-routine"];
  const manual = actionsConfig.groups["github-actions-manual"];
  assert.deepEqual(
    manual.patterns,
    routine["exclude-patterns"],
    "the manual group must exactly mirror the routine exclusions",
  );

  const actionDependencies = new Set();
  const githubRoot = fileURLToPath(new URL("../.github/", import.meta.url));
  for (const path of filesBelow(githubRoot).filter((entry) =>
    /\.ya?ml$/.test(entry),
  )) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
      const dependency = match[1].replace(/^['"]|['"]$/g, "").split("@")[0];
      if (!dependency.startsWith("./") && dependency.includes("/")) {
        actionDependencies.add(dependency);
      }
    }
  }

  const sensitive = [...actionDependencies]
    .filter((dependency) =>
      /(?:create-github-app-token|dependency-review|anthropic|claude|codex|copilot|codeql|dependabot|osv|scorecard|security|harden-runner|trivy|snyk|attest|reviewer|review-action)/i.test(
        dependency,
      ),
    )
    .sort();
  assert.deepEqual(sensitive, [
    "actions/create-github-app-token",
    "actions/dependency-review-action",
    "anthropics/claude-code-action",
    "github/codeql-action/upload-sarif",
    "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml",
    "ossf/scorecard-action",
  ]);
  for (const dependency of sensitive) {
    assert.ok(
      routine["exclude-patterns"].some((pattern) =>
        dependabotPatternMatches(pattern, dependency),
      ),
      `${dependency} must be excluded from the routine group`,
    );
  }
});

test("embedded workflow JavaScript parses before GitHub executes it", () => {
  const expectedModuleCounts = new Map([
    [processorPath, 3],
    [dependabotReviewPath, 6],
    [preparedIntakePath, 1],
    [repairPath, 2],
  ]);
  for (const [path, expectedCount] of expectedModuleCounts) {
    const modules = [
      ...read(path).matchAll(
        /node --input-type=module --eval '\n([\s\S]*?)\n\s*'(?:\s+"\$[A-Za-z_][A-Za-z0-9_]*")?/g,
      ),
    ];
    assert.equal(modules.length, expectedCount, path);
    for (const [, source] of modules) {
      const result = spawnSync("node", ["--input-type=module", "--check"], {
        encoding: "utf8",
        input: source,
      });
      assert.equal(result.status, 0, `${path}: ${result.stderr}`);
    }
  }
});

function runBashStep(step, env, eventPayload) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-workflow-test-"),
  );
  const githubOutput = join(temporaryDirectory, "github-output");
  const eventPath = join(temporaryDirectory, "event.json");
  try {
    if (eventPayload !== undefined) {
      writeFileSync(eventPath, JSON.stringify(eventPayload));
    }
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: githubOutput,
        ...env,
        ...(eventPayload === undefined ? {} : { GITHUB_EVENT_PATH: eventPath }),
      },
    });
    return {
      ...result,
      githubOutput: existsSync(githubOutput)
        ? readFileSync(githubOutput, "utf8")
        : "",
    };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function liveIntakeEnvironment(overrides = {}) {
  const headSha = "a".repeat(40);
  return {
    DEFAULT_BRANCH: "main",
    INTAKE_ACTOR_LOGIN: "dependabot[bot]",
    INTAKE_ACTOR_ID: "49699333",
    INTAKE_ACTOR_TYPE: "Bot",
    INTAKE_CONCLUSION: "success",
    INTAKE_EVENT: "pull_request_target",
    INTAKE_HEAD_BRANCH: "dependabot/npm_and_yarn/runtime-packages-123abc",
    INTAKE_HEAD_REPOSITORY: "mento-protocol/frontend-monorepo",
    INTAKE_HEAD_SHA: headSha,
    INTAKE_PATH: ".github/workflows/dependabot-intake.yml",
    INTAKE_PULL_REQUESTS_JSON: JSON.stringify([
      {
        number: 701,
        head: {
          ref: "dependabot/npm_and_yarn/runtime-packages-123abc",
          sha: headSha,
        },
        base: { ref: "main" },
      },
    ]),
    INTAKE_TITLE: `dependabot-intake:v1 | repository=mento-protocol/frontend-monorepo | pr=701 | sha=${headSha} | action=synchronize | receipt=true`,
    INTAKE_TRIGGERING_ACTOR_LOGIN: "dependabot[bot]",
    INTAKE_TRIGGERING_ACTOR_TYPE: "Bot",
    INTAKE_STATUS: "completed",
    INTAKE_RUN_ATTEMPT: "1",
    INTAKE_RUN_ID: "123456789",
    INTAKE_WORKFLOW: "Dependabot Intake",
    EXPECTED_PREPARE_BOT_ID: "123456",
    EXPECTED_PREPARE_BOT_LOGIN: "mento-dependabot-prepare[bot]",
    REPOSITORY: "mento-protocol/frontend-monorepo",
    ...overrides,
  };
}

function liveRepositoryDispatchPayload(overrides = {}) {
  return {
    action: "dependabot-process",
    client_payload: { scope: "open" },
    repository: {
      default_branch: "main",
      full_name: "mento-protocol/frontend-monorepo",
    },
    sender: {
      login: "mento-operator",
      type: "User",
    },
    ...overrides,
  };
}

function liveRepositoryDispatchEnvironment() {
  return {
    DEFAULT_BRANCH: "main",
    EVENT_NAME: "repository_dispatch",
    REPOSITORY: "mento-protocol/frontend-monorepo",
  };
}

test("intake is an exact credentialless metadata receipt", () => {
  assert.equal(intake.name, "Dependabot Intake");
  assert.deepEqual(intake.on, {
    pull_request_target: {
      types: ["opened", "synchronize", "reopened"],
    },
  });
  assert.deepEqual(intake.permissions, {});
  assert.match(
    intake["run-name"],
    /^\$\{\{ format\('dependabot-intake:v1 \| repository=\{0\} \| pr=\{1\} \| sha=\{2\} \| action=\{3\} \| receipt=\{4\}'/,
  );

  const job = intake.jobs["validate-receipt"];
  assert.equal(Object.hasOwn(job, "permissions"), false);
  assert.equal(job.steps.length, 1);
  assert.equal(Object.hasOwn(job.steps[0], "uses"), false);
  assert.match(job.if, /dependabot\[bot\].*dependabot\//s);
  assert.deepEqual(Object.keys(job.steps[0].env).sort(), [
    "ACTION",
    "AUTHOR",
    "BASE_REF",
    "DEFAULT_BRANCH",
    "HEAD_REF",
    "HEAD_REPOSITORY",
    "HEAD_SHA",
    "PR_NUMBER",
    "REPOSITORY",
  ]);
  assert.match(job.steps[0].run, /mento-protocol\/frontend-monorepo/);
  assert.match(job.steps[0].run, /dependabot\[bot\]/);
  assert.match(job.steps[0].run, /HEAD_REPOSITORY.*REPOSITORY/);
  assert.match(job.steps[0].run, /DEFAULT_BRANCH.*main/);
  assert.match(job.steps[0].run, /BASE_REF.*main/);
  assert.match(job.steps[0].run, /HEAD_REF.*dependabot\/\*/);
  assert.match(job.steps[0].run, /\[0-9a-f\]\{40\}/);
  assert.match(job.steps[0].run, /opened\|synchronize\|reopened/);

  const raw = JSON.stringify(intake);
  assert.doesNotMatch(
    raw,
    /secrets\.|github\.token|GITHUB_TOKEN|\buses:|actions\/|gh api|curl|wget|artifact|checkout|cache/,
  );
});

test("processor has only trusted automatic and strict repository triggers", () => {
  assert.equal(processor.name, "Dependabot Processor");
  assert.deepEqual(Object.keys(processor.on), [
    "workflow_run",
    "repository_dispatch",
    "schedule",
  ]);
  assert.deepEqual(processor.on.workflow_run, {
    workflows: [
      "Dependabot Intake",
      "Dependabot Prepared Head Intake",
      "Dependabot Claude Review",
    ],
    types: ["completed"],
  });
  assert.deepEqual(processor.on.repository_dispatch, {
    types: ["dependabot-process"],
  });
  assert.deepEqual(processor.on.schedule, [
    { cron: "3,13,23,33,43,53 * * * *" },
  ]);
  assert.deepEqual(processor.permissions, {});
  assert.deepEqual(processor.concurrency, {
    group: "dependabot-processor",
    "cancel-in-progress": false,
    queue: "max",
  });
  assert.equal(
    processor.env.DEPENDABOT_PROCESSOR_MODE,
    "${{ vars.DEPENDABOT_PROCESSOR_MODE }}",
  );
  assert.match(
    processor["run-name"],
    /receipt=\{0\}.*workflow_run\.display_title/s,
  );
  assert.doesNotMatch(processor["run-name"], /workflow_run\.pull_requests/);
  assert.match(processor["run-name"], /target=scope=open/);

  const raw = read(processorPath);
  assert.doesNotMatch(raw, /workflow_dispatch|\binputs\./);
  assert.doesNotMatch(raw, /--admin\b/);
});

test("read-only evaluation authenticates every trigger before live collection", () => {
  const evaluate = processor.jobs.evaluate;
  assert.deepEqual(evaluate.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });
  assert.match(
    evaluate.if,
    /github\.repository == 'mento-protocol\/frontend-monorepo'/,
  );
  assert.match(
    evaluate.if,
    /endsWith\(github\.event\.workflow_run\.display_title, 'receipt=true'\)/,
  );
  assert.match(evaluate.if, /Dependabot Prepared Head Intake/);
  assert.match(evaluate.if, /Dependabot Claude Review/);
  assert.match(evaluate.if, /github\.event\.action == 'dependabot-process'/);
  assert.doesNotMatch(evaluate.if, /client_payload/);
  assert.doesNotMatch(
    evaluate.if,
    /workflow_run\.(?:path|event|conclusion|head_repository|head_branch)/,
  );

  const target = evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  assert.ok(target);
  assert.match(target.run, /Object\.keys\(clientPayload\)\.sort\(\)/);
  assert.match(target.run, /process\.env\.GITHUB_EVENT_PATH/);
  assert.equal(Object.hasOwn(target.env, "EVENT_PATH"), false);
  assert.equal(Object.hasOwn(target.env, "GITHUB_EVENT_PATH"), false);
  assert.doesNotMatch(JSON.stringify(target.env), /github\.event_path/);
  assert.match(target.run, /\["scope"\]/);
  assert.doesNotMatch(target.run, /clientPayload\.(?:repository|schema)/);
  assert.match(target.run, /dependabot-intake:v1/);
  assert.match(target.run, /dependabot-prepared-head:v1/);
  assert.match(target.run, /dependabot-claude-review:v1/);
  assert.match(target.run, /success\|failure/);
  assert.match(target.run, /\[0-9a-f\]\{40\}/);
  assert.match(target.run, /INTAKE_ACTOR_LOGIN.*dependabot\[bot\]/);
  assert.match(target.run, /INTAKE_ACTOR_TYPE.*Bot/);
  assert.match(target.run, /INTAKE_HEAD_BRANCH.*dependabot\/\*/);
  assert.match(target.run, /INTAKE_HEAD_SHA.*receipt_head_sha/s);
  assert.match(target.run, /linked\.length > 1/);
  assert.match(target.run, /pullRequest\?\.head\?\.sha/);

  const invocation = evaluate.steps.find((step) =>
    String(step.run ?? "").includes("evaluate"),
  );
  assert.ok(invocation);
  assert.match(invocation.run, /evaluate\s+--live/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ steps.mode.outputs.processor_mode }}",
  );
});

test("processor accepts a live-shaped Dependabot intake receipt", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(target, {
    ...liveIntakeEnvironment(),
    EVENT_NAME: "workflow_run",
    EVENT_PATH: "/dev/null",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_numbers=701\nexpected_head_sha=${"a".repeat(40)}\nfollowup_kind=native-intake\noperation_code=\noperation_check_id=\noperation_digest=\n`,
  );
});

test("processor rejects an intake whose upstream head differs from its receipt", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(target, {
    ...liveIntakeEnvironment({ INTAKE_HEAD_SHA: "b".repeat(40) }),
    EVENT_NAME: "workflow_run",
    EVENT_PATH: "/dev/null",
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.githubOutput, "");
});

test("processor accepts an exact prepared-head intake completion", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const headSha = "b".repeat(40);
  const digest = "d".repeat(64);
  const result = runBashStep(target, {
    ...liveIntakeEnvironment(),
    EVENT_NAME: "workflow_run",
    INTAKE_ACTOR_ID: "123456",
    INTAKE_ACTOR_LOGIN: "mento-dependabot-prepare[bot]",
    INTAKE_CONCLUSION: "success",
    INTAKE_EVENT: "repository_dispatch",
    INTAKE_HEAD_BRANCH: "main",
    INTAKE_HEAD_SHA: "c".repeat(40),
    INTAKE_PATH: ".github/workflows/dependabot-prepared-head-intake.yml",
    INTAKE_PULL_REQUESTS_JSON: "[]",
    INTAKE_TITLE: `dependabot-prepared-head:v1|p=701|h=${headSha}|o=p|c=321|d=${digest}|ok=true`,
    INTAKE_WORKFLOW: "Dependabot Prepared Head Intake",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_numbers=701\nexpected_head_sha=${headSha}\nfollowup_kind=prepared-intake\noperation_code=p\noperation_check_id=321\noperation_digest=${digest}\n`,
  );
});

test("processor wakes on a failed exact Claude reviewer completion", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const headSha = "a".repeat(40);
  const result = runBashStep(target, {
    ...liveIntakeEnvironment(),
    EVENT_NAME: "workflow_run",
    INTAKE_CONCLUSION: "failure",
    INTAKE_EVENT: "workflow_run",
    INTAKE_HEAD_BRANCH: "main",
    INTAKE_HEAD_SHA: "c".repeat(40),
    INTAKE_PATH: ".github/workflows/dependabot-claude-review.yml",
    INTAKE_TITLE: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=mento-protocol/frontend-monorepo | pr=701 | sha=${headSha} | action=synchronize | receipt=true`,
    INTAKE_WORKFLOW: "Dependabot Claude Review",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_numbers=701\nexpected_head_sha=${headSha}\nfollowup_kind=claude-review\noperation_code=\noperation_check_id=\noperation_digest=\n`,
  );
});

test("processor accepts a live-shaped repository dispatch envelope", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(
    target,
    liveRepositoryDispatchEnvironment(),
    liveRepositoryDispatchPayload(),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.githubOutput, "pr_numbers=all\nexpected_head_sha=\n");
});

test("processor fails closed without the runner event path", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(target, liveRepositoryDispatchEnvironment());

  assert.notEqual(result.status, 0);
  assert.equal(result.githubOutput, "");
});

test("processor rejects malformed repository dispatch envelopes", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const invalidPayloads = [
    {
      name: "extra client-payload key",
      payload: liveRepositoryDispatchPayload({
        client_payload: { scope: "open", mode: "merge" },
      }),
    },
    {
      name: "wrong scope",
      payload: liveRepositoryDispatchPayload({
        client_payload: { scope: "selected" },
      }),
    },
    {
      name: "wrong action",
      payload: liveRepositoryDispatchPayload({
        action: "dependabot-repair",
      }),
    },
  ];

  for (const { name, payload } of invalidPayloads) {
    const result = runBashStep(
      target,
      liveRepositoryDispatchEnvironment(),
      payload,
    );
    assert.notEqual(result.status, 0, name);
    assert.equal(result.githubOutput, "", name);
  }
});

test("every processor phase materializes only the exact trusted sources", () => {
  for (const jobName of [
    "evaluate",
    "process",
    "prepare-validate",
    "prepare-request",
    "prepare-mutate",
    "prepare-finalize",
  ]) {
    const job = processor.jobs[jobName];
    const step = job.steps.find(
      (candidate) =>
        candidate.name ===
        "Materialize the processor from the exact trusted workflow SHA",
    );
    assert.ok(step, `${jobName} must materialize the processor`);
    assert.equal(Object.hasOwn(step, "uses"), false);
    assert.equal(step.env.WORKFLOW_SHA, "${{ github.workflow_sha }}");
    assert.equal(step.env.REPOSITORY, "${{ github.repository }}");
    assert.match(step.run, /commits\/\$WORKFLOW_SHA/);
    assert.match(
      step.run,
      /contents\/scripts\/dependabot-processor\.mjs\?ref=\$WORKFLOW_SHA/,
    );
    assert.match(
      step.run,
      /trusted_receipts="\$trusted_root\/dependabot-preparation-receipts\.mjs"/,
    );
    assert.match(
      step.run,
      /contents\/scripts\/dependabot-preparation-receipts\.mjs\?ref=\$WORKFLOW_SHA/,
    );
    assert.match(step.run, /test -s "\$trusted_processor"/);
    assert.match(step.run, /test -s "\$trusted_receipts"/);
    assert.match(step.run, /chmod 0400 "\$trusted_receipts"/);
    assert.match(step.run, /resolved_sha.*WORKFLOW_SHA/s);
    assert.doesNotMatch(step.run, forbiddenCandidateSurfaces);
  }
});

test("the exact-SHA processor materialization imports its receipt dependency", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-processor-materialization-"),
  );
  const mockBin = join(temporaryDirectory, "bin");
  const mockGh = join(mockBin, "gh");
  const processorSourcePath = fileURLToPath(
    new URL("../scripts/dependabot-processor.mjs", import.meta.url),
  );
  const receiptsSourcePath = fileURLToPath(
    new URL("../scripts/dependabot-preparation-receipts.mjs", import.meta.url),
  );
  const workflowSha = "d".repeat(40);

  try {
    mkdirSync(mockBin, { recursive: true });
    writeFileSync(
      mockGh,
      `#!/usr/bin/env bash
set -euo pipefail
test "$GH_TOKEN" = "$EXPECTED_READ_TOKEN"
for argument in "$@"; do
  if [[ "$argument" == repos/*/commits/* ]]; then
    printf '%s\\n' "$WORKFLOW_SHA"
    exit 0
  fi
  if [[ "$argument" == *"contents/scripts/dependabot-processor.mjs?ref="* ]]; then
    /bin/cat "$MOCK_PROCESSOR_SOURCE"
    exit 0
  fi
  if [[ "$argument" == *"contents/scripts/dependabot-preparation-receipts.mjs?ref="* ]]; then
    /bin/cat "$MOCK_RECEIPTS_SOURCE"
    exit 0
  fi
done
exit 64
`,
    );
    chmodSync(mockGh, 0o500);

    for (const jobName of [
      "evaluate",
      "process",
      "prepare-validate",
      "prepare-request",
      "prepare-mutate",
      "prepare-finalize",
    ]) {
      const step = processor.jobs[jobName].steps.find(
        (candidate) =>
          candidate.name ===
          "Materialize the processor from the exact trusted workflow SHA",
      );
      const runnerTemp = join(temporaryDirectory, jobName);
      mkdirSync(runnerTemp, { recursive: true });
      const result = runBashStep(step, {
        EXPECTED_READ_TOKEN: "normal-read-token",
        GH_TOKEN: "normal-read-token",
        MOCK_PROCESSOR_SOURCE: processorSourcePath,
        MOCK_RECEIPTS_SOURCE: receiptsSourcePath,
        PATH: `${mockBin}:${process.env.PATH}`,
        REPOSITORY: "mento-protocol/frontend-monorepo",
        RUNNER_TEMP: runnerTemp,
        WORKFLOW_SHA: workflowSha,
      });
      assert.equal(result.status, 0, `${jobName}: ${result.stderr}`);

      const trustedRoot = join(runnerTemp, "dependabot-processor");
      const trustedProcessor = join(trustedRoot, "dependabot-processor.mjs");
      const trustedReceipts = join(
        trustedRoot,
        "dependabot-preparation-receipts.mjs",
      );
      assert.equal(result.githubOutput, `path=${trustedProcessor}\n`, jobName);
      assert.equal(
        readFileSync(trustedProcessor, "utf8"),
        readFileSync(processorSourcePath, "utf8"),
        jobName,
      );
      assert.equal(
        readFileSync(trustedReceipts, "utf8"),
        readFileSync(receiptsSourcePath, "utf8"),
        jobName,
      );

      const imported = spawnSync(
        "node",
        [
          "--input-type=module",
          "--eval",
          'import { pathToFileURL } from "node:url"; await import(pathToFileURL(process.argv[2]).href);',
          "materialization-test",
          trustedProcessor,
        ],
        { encoding: "utf8" },
      );
      assert.equal(imported.status, 0, `${jobName}: ${imported.stderr}`);
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("processor normalizes only exact human-merge-only modes", () => {
  const evaluateJob = processor.jobs.evaluate;
  const mode = evaluateJob.steps.find(
    (step) =>
      step.name === "Normalize the exact processor mode without credentials",
  );
  assert.ok(mode);
  assert.equal(mode.id, "mode");
  assert.equal(mode.shell, "bash");
  assert.deepEqual(mode.env, {
    RAW_PROCESSOR_MODE: "${{ env.DEPENDABOT_PROCESSOR_MODE }}",
  });
  assert.equal(Object.hasOwn(mode, "uses"), false);
  assert.doesNotMatch(JSON.stringify(mode), /secrets\.|github\.token/);
  assert.match(mode.run, /observe\|assist\|prepare/);
  assert.match(mode.run, /processor_mode="observe"/);

  for (const [rawMode, expectedMode, expectedPrepare] of [
    ["observe", "observe", false],
    ["assist", "assist", false],
    ["prepare", "prepare", true],
    ["merge", "observe", false],
    ["Prepare", "observe", false],
    ["PREPARE", "observe", false],
    [" prepare ", "observe", false],
    ["", "observe", false],
    ["unknown", "observe", false],
  ]) {
    const result = runBashStep(mode, { RAW_PROCESSOR_MODE: rawMode });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.githubOutput,
      `processor_mode=${expectedMode}\nprepare=${expectedPrepare}\n`,
      JSON.stringify(rawMode),
    );
  }

  assert.deepEqual(evaluateJob.outputs, {
    expected_head_sha: "${{ steps.target.outputs.expected_head_sha }}",
    pr_numbers: "${{ steps.target.outputs.pr_numbers }}",
    processor_mode: "${{ steps.mode.outputs.processor_mode }}",
    prepare: "${{ steps.mode.outputs.prepare }}",
  });

  const invocation = evaluateJob.steps.find((step) =>
    String(step.run ?? "").includes("evaluate"),
  );
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ steps.mode.outputs.processor_mode }}",
  );
});

test("observe and assist processing have no branch-write App credential", () => {
  const processJob = processor.jobs.process;
  assert.equal(processJob.needs, "evaluate");
  assert.match(processJob.if, /needs\.evaluate\.result == 'success'/);
  assert.match(processJob.if, /needs\.evaluate\.outputs\.prepare != 'true'/);
  assert.deepEqual(processJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "write",
    statuses: "read",
  });
  assert.deepEqual(
    processJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [],
  );

  const invocation = processJob.steps.find(
    (step) =>
      step.name === "Re-query exact heads and process the current sweep",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+--live\s+--publish-checks/);
  assert.match(invocation.run, /--phase finalize/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ needs.evaluate.outputs.processor_mode }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    Object.hasOwn(invocation.env, "DEPENDABOT_PROCESSOR_REPAIR_TOKEN"),
    false,
  );

  const raw = JSON.stringify(processJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /PREPARE_APP|REPAIR_TOKEN|secrets\./);
  assert.doesNotMatch(raw, /--admin\b/);
});

test("prepare validation repeats the live plan without secrets or write authority", () => {
  const validateJob = processor.jobs["prepare-validate"];
  assert.equal(validateJob.needs, "evaluate");
  assert.match(validateJob.if, /needs\.evaluate\.outputs\.prepare == 'true'/);
  assert.deepEqual(validateJob.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });

  const invocation = validateJob.steps.find(
    (step) =>
      step.name === "Revalidate the prepare plan without mutation authority",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /evaluate\s+--live/);
  assert.match(invocation.run, /--mode prepare/);
  assert.match(invocation.run, /--expected-head-sha/);

  const raw = JSON.stringify(validateJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(
    raw,
    /secrets\.|PREPARE_APP|REPAIR_TOKEN|checks:write|contents:write/,
  );
});

test("refresh request publication has checks authority but no branch credential", () => {
  const requestJob = processor.jobs["prepare-request"];
  assert.deepEqual(requestJob.needs, ["evaluate", "prepare-validate"]);
  assert.match(requestJob.if, /needs\.prepare-validate\.result == 'success'/);
  assert.deepEqual(requestJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });
  assert.deepEqual(requestJob.outputs, {
    refresh_pending: "${{ steps.plan.outputs.refresh_pending }}",
    refresh_requested: "${{ steps.plan.outputs.refresh_requested }}",
  });
  const invocation = requestJob.steps.find(
    (step) =>
      step.name === "Publish only an exact-head refresh request when required",
  );
  assert.ok(invocation);
  assert.equal(invocation.id, "request");
  assert.match(invocation.run, /process[\s\S]*--publish-checks/);
  assert.match(invocation.run, /--phase request/);
  assert.match(invocation.run, /--mode prepare/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );
  assert.match(invocation.run, /> "\$REQUEST_RESULT_PATH"/);

  const plan = requestJob.steps.find(
    (step) => step.name === "Classify the authenticated request-phase result",
  );
  assert.ok(plan);
  assert.equal(plan.id, "plan");
  assert.match(plan.run, /dependabot-processor:v2/);
  assert.match(plan.run, /result\?\.mode !== "prepare"/);
  assert.match(plan.run, /result\?\.phase !== "request"/);
  assert.match(plan.run, /mutation\?\.kind !== "refresh-requested"/);
  assert.match(plan.run, /refresh_pending=/);
  assert.match(plan.run, /refresh_requested=/);
  assert.doesNotMatch(
    JSON.stringify(requestJob),
    /create-github-app-token|PREPARE_APP_CLIENT_ID|PREPARE_APP_PRIVATE_KEY|REPAIR_TOKEN|REPAIR_APP|secrets\./,
  );
});

test("prepare jobs mint a branch token only for a trusted pending refresh", () => {
  const requestJob = processor.jobs["prepare-request"];
  const plan = requestJob.steps.find((step) => step.id === "plan");
  const runPlan = (prepareCandidate, mutations = []) => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dependabot-request-plan-test-"),
    );
    const resultPath = join(temporaryDirectory, "result.json");
    const outputPath = join(temporaryDirectory, "output");
    try {
      writeFileSync(
        resultPath,
        JSON.stringify({
          mode: "prepare",
          mutations,
          phase: "request",
          prepareCandidate,
          schema: "dependabot-processor:v2",
        }),
      );
      const result = spawnSync("bash", ["-c", plan.run], {
        encoding: "utf8",
        env: {
          GITHUB_OUTPUT: outputPath,
          PATH: process.env.PATH,
          REQUEST_RESULT_PATH: resultPath,
        },
      });
      return {
        ...result,
        output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
      };
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  };

  const nativeGreen = runPlan({
    disposition: "prepare-candidate",
    headSha: "a".repeat(40),
    pullRequestNumber: 731,
  });
  assert.equal(nativeGreen.status, 0, nativeGreen.stderr);
  assert.equal(
    nativeGreen.output,
    "refresh_pending=false\nrefresh_requested=false\n",
  );

  const pending = runPlan({
    disposition: "refresh-pending",
    headSha: "a".repeat(40),
    pullRequestNumber: 731,
  });
  assert.equal(pending.status, 0, pending.stderr);
  assert.equal(
    pending.output,
    "refresh_pending=true\nrefresh_requested=false\n",
  );

  const requested = runPlan(
    {
      disposition: "refresh-required",
      headSha: "a".repeat(40),
      pullRequestNumber: 731,
    },
    [{ kind: "refresh-requested" }],
  );
  assert.equal(requested.status, 0, requested.stderr);
  assert.equal(
    requested.output,
    "refresh_pending=false\nrefresh_requested=true\n",
  );

  const mutateJob = processor.jobs["prepare-mutate"];
  assert.match(
    mutateJob.if,
    /needs\.prepare-request\.outputs\.refresh_pending == 'true'/,
  );
  const finalizeJob = processor.jobs["prepare-finalize"];
  assert.match(finalizeJob.if, /^always\(\)/);
  assert.match(
    finalizeJob.if,
    /needs\.prepare-request\.outputs\.refresh_requested != 'true'/,
  );
  assert.match(finalizeJob.if, /needs\.prepare-mutate\.result == 'skipped'/);
});

test("only the prepare mutator receives the refresh-capable App token", () => {
  const mutateJob = processor.jobs["prepare-mutate"];
  assert.deepEqual(mutateJob.needs, ["evaluate", "prepare-request"]);
  assert.match(mutateJob.if, /needs\.evaluate\.outputs\.prepare == 'true'/);
  assert.match(mutateJob.if, /needs\.prepare-request\.result == 'success'/);
  assert.match(
    mutateJob.if,
    /needs\.prepare-request\.outputs\.refresh_pending == 'true'/,
  );
  assert.deepEqual(mutateJob.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });

  const requireCredentials = mutateJob.steps.find(
    (step) =>
      step.name === "Require exact Prepare App identity and credentials",
  );
  assert.ok(requireCredentials);
  assert.deepEqual(requireCredentials.env, {
    PREPARE_APP_CLIENT_ID:
      "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
    PREPARE_APP_SLUG: "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
    PREPARE_APP_PRIVATE_KEY:
      "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
    PREPARE_BOT_ID: "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
    PREPARE_BOT_LOGIN: "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  });
  assert.match(requireCredentials.run, /PREPARE_BOT_ID.*\^\[1-9\]\[0-9\]\*\$/);
  assert.match(requireCredentials.run, /PREPARE_APP_SLUG.*\[a-z0-9-\]/);
  assert.match(requireCredentials.run, /PREPARE_BOT_LOGIN.*PREPARE_APP_SLUG/);

  const prepareToken = mutateJob.steps.find(
    (step) => step.name === "Create repository-scoped Prepare App token",
  );
  assert.ok(prepareToken);
  assert.equal(prepareToken.id, "prepare-token");
  assert.equal(
    prepareToken.uses,
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
  );
  assert.deepEqual(prepareToken.with, {
    "client-id": "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
    "private-key":
      "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
    owner: "mento-protocol",
    repositories: "frontend-monorepo",
    "permission-contents": "write",
    "permission-pull-requests": "write",
  });
  assert.equal(Object.hasOwn(prepareToken.with, "skip-token-revoke"), false);
  assert.deepEqual(
    mutateJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [prepareToken],
  );

  const identity = mutateJob.steps.find(
    (step) =>
      step.name === "Bind the token to the exact Prepare App bot identity",
  );
  assert.ok(identity);
  assert.equal(
    identity.env.ACTUAL_APP_SLUG,
    "${{ steps.prepare-token.outputs.app-slug }}",
  );
  assert.equal(
    identity.env.ACTUAL_INSTALLATION_ID,
    "${{ steps.prepare-token.outputs.installation-id }}",
  );
  assert.match(identity.run, /gh api "users\/\$EXPECTED_BOT_LOGIN"/);
  assert.match(identity.run, /actual_bot_id.*EXPECTED_BOT_ID/s);
  assert.match(identity.run, /actual_bot_login.*EXPECTED_BOT_LOGIN/s);

  const invocation = mutateJob.steps.find(
    (step) =>
      step.name === "Re-query exact heads and apply refresh-only mutation",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+--live/);
  assert.doesNotMatch(invocation.run, /--publish-checks/);
  assert.match(invocation.run, /--phase mutate/);
  assert.match(invocation.run, /--mode prepare/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_REPAIR_TOKEN,
    "${{ steps.prepare-token.outputs.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );

  for (const [jobName, job] of Object.entries(processor.jobs)) {
    if (jobName === "prepare-mutate") continue;
    assert.doesNotMatch(
      JSON.stringify(job),
      /DEPENDABOT_PROCESSOR_PREPARE_APP_(?:CLIENT_ID|PRIVATE_KEY)|DEPENDABOT_PROCESSOR_REPAIR_TOKEN/,
      jobName,
    );
  }

  for (const [jobName, job] of Object.entries(processor.jobs)) {
    const rawJob = JSON.stringify(job);
    if (
      rawJob.includes("create-github-app-token") ||
      rawJob.includes("DEPENDABOT_PROCESSOR_REPAIR_TOKEN")
    ) {
      assert.notEqual(job.permissions?.checks, "write", jobName);
    }
  }

  const raw = JSON.stringify(mutateJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /--admin\b/);
  assert.doesNotMatch(raw, /approvePullRequest|Dependabot ALL CLEAR/);
  assert.doesNotMatch(raw, /PREPARE_APP_ID|REPAIR_APP_ID/);
});

test("prepare finalization has approval authority but no branch-write credential", () => {
  const finalizeJob = processor.jobs["prepare-finalize"];
  assert.deepEqual(finalizeJob.needs, [
    "evaluate",
    "prepare-request",
    "prepare-mutate",
  ]);
  assert.match(finalizeJob.if, /^always\(\)/);
  assert.match(finalizeJob.if, /needs\.evaluate\.outputs\.prepare == 'true'/);
  assert.match(finalizeJob.if, /needs\.prepare-request\.result == 'success'/);
  assert.match(
    finalizeJob.if,
    /needs\.prepare-request\.outputs\.refresh_requested != 'true'/,
  );
  assert.match(finalizeJob.if, /needs\.prepare-mutate\.result == 'success'/);
  assert.match(finalizeJob.if, /needs\.prepare-mutate\.result == 'skipped'/);
  assert.deepEqual(finalizeJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "write",
    statuses: "read",
  });
  assert.deepEqual(
    finalizeJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [],
  );

  const invocation = finalizeJob.steps.find(
    (step) =>
      step.name === "Recollect exact state and publish human-only readiness",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+\\/);
  assert.match(invocation.run, /--phase finalize/);
  assert.match(invocation.run, /--mode prepare/);
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );

  const raw = JSON.stringify(finalizeJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(
    raw,
    /PREPARE_APP_CLIENT_ID|PREPARE_APP_PRIVATE_KEY|REPAIR_TOKEN|REPAIR_APP|create-github-app-token|secrets\./,
  );
});

test("the processor workflow contains no merge or native auto-merge authority", () => {
  const raw = read(processorPath);
  assert.doesNotMatch(
    raw,
    /DEPENDABOT_PROCESSOR_MERGE_|MERGE_APP_PRIVATE_KEY|MERGE_TOKEN/,
  );
  assert.doesNotMatch(
    raw,
    /gh pr merge|pulls\.merge|mergePullRequest|enablePullRequestAutoMerge/,
  );
});

test("repair planning, validation, mutation, and receipt publication stay isolated", () => {
  assert.equal(repair.name, "Dependabot Prepare Repair");
  assert.deepEqual(repair.on, {
    repository_dispatch: {
      types: ["dependabot-prepare-repair", "dependabot-prepare-repair-recover"],
    },
  });
  assert.deepEqual(repair.permissions, {});
  assert.doesNotMatch(read(repairPath), /workflow_dispatch/);
  assert.match(
    repair["run-name"],
    /pr=\{0\}.*head=\{1\}.*check=\{2\}.*digest=\{3\}/s,
  );
  assert.match(repair["run-name"], /retry=\{4\}/);

  const preflight = repair.jobs.preflight;
  const plan = repair.jobs.plan;
  const validate = repair.jobs.validate;
  const stage = repair.jobs.stage;
  const intent = repair.jobs.intent;
  const mutate = repair.jobs.mutate;
  const receipt = repair.jobs.receipt;
  const recovery = repair.jobs.recovery;
  const readPermissions = {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  };
  assert.deepEqual(preflight.permissions, readPermissions);
  assert.deepEqual(plan.permissions, readPermissions);
  assert.deepEqual(validate.permissions, readPermissions);
  assert.deepEqual(stage.permissions, readPermissions);
  assert.deepEqual(mutate.permissions, readPermissions);
  assert.deepEqual(intent.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(receipt.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(recovery.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    "pull-requests": "read",
  });

  const envelope = preflight.steps[0];
  assert.equal(Object.hasOwn(envelope.env, "GH_TOKEN"), false);
  assert.doesNotMatch(JSON.stringify(envelope), /secrets\.|github\.token/);
  assert.match(envelope.run, /process\.env\.GITHUB_EVENT_PATH/);
  assert.match(envelope.run, /Object\.keys\(payload\)\.length > 10/);
  assert.match(envelope.run, /dependabot-prepare-repair:v1/);
  assert.match(envelope.run, /processorReceipt/);
  assert.match(envelope.run, /retryCount/);

  const checkout = plan.steps[0];
  const planner = plan.steps[1];
  assert.deepEqual(checkout.with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });
  assert.equal(planner.uses, claudeAction);
  assert.equal(
    planner.with.allowed_bots,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );
  assert.equal(planner.with.github_token, "${{ github.token }}");
  assert.match(planner.with.additional_permissions, /actions: read/);
  assert.match(planner.with.additional_permissions, /checks: read/);
  assert.match(planner.with.prompt, /BEGIN UNTRUSTED REPAIR PACKET/);
  assert.match(planner.with.prompt, /needs\.preflight\.outputs\.packet_json/);
  assert.doesNotMatch(planner.with.prompt, /packet_base64/);
  assert.match(planner.with.claude_args, /Bash,Edit,Write,NotebookEdit/);
  assert.match(planner.with.claude_args, /"maxLength":8192/);

  assert.doesNotMatch(
    JSON.stringify(validate),
    /secrets\.|contents:write|checks:write/,
  );
  assert.match(
    validate.steps.at(-1).run,
    /validate-repair-plan[\s\S]*--packet-base64[\s\S]*--plan-json/,
  );

  for (const appJob of [stage, mutate]) {
    const repairToken = appJob.steps.find(
      (step) => step.name === "Create repository-scoped Repair App token",
    );
    assert.ok(repairToken);
    assert.deepEqual(repairToken.with, {
      "client-id": "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
      "private-key":
        "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
      owner: "mento-protocol",
      repositories: "frontend-monorepo",
      "permission-contents": "write",
    });
    assert.equal(
      Object.hasOwn(repairToken.with, "permission-pull-requests"),
      false,
    );
    assert.equal(Object.hasOwn(repairToken.with, "skip-token-revoke"), false);
    const publisher = appJob.steps.at(-1);
    assert.equal(publisher.env.GH_TOKEN, "${{ github.token }}");
    assert.notEqual(
      publisher.env.GH_TOKEN,
      "${{ steps.repair-token.outputs.token }}",
    );
    assert.equal(publisher.env.GH_READ_TOKEN, "${{ github.token }}");
    assert.equal(
      publisher.env.GH_WRITE_TOKEN,
      "${{ steps.repair-token.outputs.token }}",
    );
  }
  assert.match(stage.steps.at(-1).run, /stage-repair/);
  assert.match(stage.steps.at(-1).run, /--retry-count/);
  assert.match(mutate.steps.at(-1).run, /apply-repair-intent/);
  assert.match(mutate.steps.at(-1).run, /--intent-check-id/);
  assert.doesNotMatch(
    JSON.stringify(mutate),
    /checks:write|pull-requests:write/,
  );

  assert.ok(intent.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.match(intent.steps.at(-1).run, /publish-repair-intent/);
  assert.doesNotMatch(
    JSON.stringify(intent),
    /PREPARE_APP_PRIVATE_KEY|repair-token|GH_WRITE_TOKEN|secrets\.|dispatches/,
  );

  assert.ok(receipt.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.match(receipt.steps.at(-1).run, /publish-repair-receipt/);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /PREPARE_APP_PRIVATE_KEY|repair-token|GH_WRITE_TOKEN|secrets\.|dispatches/,
  );
  const recoveryEnvelope = recovery.steps[0];
  assert.equal(Object.hasOwn(recoveryEnvelope.env, "GH_TOKEN"), false);
  assert.doesNotMatch(
    JSON.stringify(recoveryEnvelope),
    /secrets\.|github\.token/,
  );
  assert.match(recoveryEnvelope.run, /dependabot-repair-recovery:v1/);
  assert.match(recoveryEnvelope.run, /Object\.keys\(payload\)\.length > 10/);
  assert.match(recoveryEnvelope.run, /retryCount/);
  assert.ok(recovery.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.match(recovery.steps.at(-1).run, /recover-repair/);
  assert.doesNotMatch(
    JSON.stringify(recovery),
    /PREPARE_APP_CLIENT_ID|PREPARE_APP_PRIVATE_KEY|repair-token|GH_WRITE_TOKEN|secrets\.|contents:write|dispatches/,
  );
  for (const [jobName, job] of Object.entries(repair.jobs)) {
    if (jobName !== "plan") {
      assert.doesNotMatch(JSON.stringify(job), /CLAUDE_CODE_OAUTH_TOKEN/);
    }
    if (!new Set(["mutate", "stage"]).has(jobName)) {
      assert.doesNotMatch(
        JSON.stringify(job),
        /DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY|GH_WRITE_TOKEN/,
      );
    }
  }

  const raw = read(repairPath);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(
    raw,
    /gh pr merge|pulls\.merge|mergePullRequest|enablePullRequestAutoMerge|APPROVE|\/reviews|\/comments/,
  );
  const helper = read("scripts/dependabot-preparation-receipts.mjs");
  const stageHelper = helper.slice(
    helper.indexOf("async function commandStageRepair"),
    helper.indexOf("function loadIntentArgument"),
  );
  const moveHelper = helper.slice(
    helper.indexOf("async function commandApplyRepairIntent"),
    helper.indexOf("async function commandPublishRepairReceipt"),
  );
  const recoveryHelper = helper.slice(
    helper.indexOf("async function commandRecoverRepair"),
    helper.indexOf("async function commandTerminalDispatchPlan"),
  );
  assert.doesNotMatch(stageHelper, /"PATCH"|git\/refs\/heads/);
  assert.match(moveHelper, /"PATCH"/);
  assert.doesNotMatch(
    recoveryHelper,
    /GH_WRITE_TOKEN|"PATCH"|git\/refs\/heads\/.*"PATCH"/,
  );
});

test("terminal dispatch accepts successful Processor and exact terminal Repair outcomes", () => {
  assert.equal(preparedDispatch.name, "Dependabot Prepared Head Dispatch");
  assert.deepEqual(preparedDispatch.on, {
    workflow_run: {
      workflows: ["Dependabot Processor", "Dependabot Prepare Repair"],
      types: ["completed"],
    },
  });
  assert.deepEqual(preparedDispatch.permissions, {});
  const plan = preparedDispatch.jobs.plan;
  const dispatch = preparedDispatch.jobs.dispatch;
  assert.match(plan.if, /workflow_run\.status == 'completed'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'success'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'failure'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'cancelled'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'timed_out'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'startup_failure'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'action_required'/);
  assert.doesNotMatch(
    plan.if,
    /workflow_run\.conclusion == '(?:neutral|skipped|stale)'/,
  );
  assert.deepEqual(plan.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  });
  assert.doesNotMatch(
    JSON.stringify(plan),
    /secrets\.|create-github-app-token/,
  );
  assert.match(plan.steps[0].run, /SOURCE_STATUS.*completed/s);
  assert.match(plan.steps[0].run, /SOURCE_CONCLUSION.*success/s);
  assert.match(plan.steps[0].run, /dependabot-process\.yml@main/);
  assert.match(plan.steps[0].run, /dependabot-prepare-repair\.yml@main/);
  assert.match(
    plan.steps[0].run,
    /success\|action_required\|failure\|cancelled\|startup_failure\|timed_out/,
  );
  assert.match(plan.steps[0].run, /dependabot-repair-recover:v1/);
  assert.match(plan.steps[0].run, /retry=\[0-2\]/);
  assert.match(plan.steps.at(-1).run, /terminal-dispatch-plan/);

  const token = dispatch.steps[0];
  assert.equal(
    token.uses,
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
  );
  assert.deepEqual(token.with, {
    "client-id": "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
    "private-key":
      "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
    owner: "mento-protocol",
    repositories: "frontend-monorepo",
    "permission-contents": "write",
  });
  assert.equal(Object.hasOwn(token.with, "skip-token-revoke"), false);
  assert.match(dispatch.steps.at(-1).run, /dispatch-terminal-event/);
  assert.doesNotMatch(
    read(preparedDispatchPath),
    /workflow_dispatch|checks: write|pull-requests: write|gh pr merge|APPROVE|ALL CLEAR|enablePullRequestAutoMerge|\/reviews|\/comments/,
  );
});

test("Dependabot Claude review follows only authenticated intake runs", () => {
  assert.equal(dependabotReview.name, "Dependabot Claude Review");
  assert.deepEqual(dependabotReview.on, {
    workflow_run: {
      workflows: ["Dependabot Intake", "Dependabot Prepared Head Intake"],
      types: ["completed"],
    },
  });
  assert.deepEqual(dependabotReview.permissions, {});
  assert.equal(
    dependabotReview["run-name"],
    "${{ format('dependabot-claude-review:v1 | source={0}', github.event.workflow_run.display_title) }}",
  );

  const preflightJob = dependabotReview.jobs.preflight;
  const reviewJob = dependabotReview.jobs.review;
  const publishJob = dependabotReview.jobs.publish;
  assert.equal(preflightJob.name, "dependabot-claude-review-preflight");
  assert.match(preflightJob.if, /mento-protocol\/frontend-monorepo/);
  assert.match(preflightJob.if, /receipt=true/);
  assert.deepEqual(preflightJob.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(preflightJob.outputs, {
    head_ref: "${{ steps.pr.outputs.head_ref }}",
    head_sha: "${{ steps.intake.outputs.head_sha }}",
    identity_digest: "${{ steps.pr.outputs.identity_digest }}",
    operation: "${{ steps.intake.outputs.operation }}",
    operation_check_id: "${{ steps.intake.outputs.operation_check_id }}",
    operation_digest: "${{ steps.intake.outputs.operation_digest }}",
    pr_number: "${{ steps.intake.outputs.pr_number }}",
    review_actor_login: "${{ steps.intake.outputs.review_actor_login }}",
    source_kind: "${{ steps.intake.outputs.source_kind }}",
  });

  const [intake, pr, preparedValidator, preparedLineage] = preflightJob.steps;
  assert.equal(intake.id, "intake");
  assert.equal(Object.hasOwn(intake, "uses"), false);
  assert.equal(Object.hasOwn(intake.env, "GH_TOKEN"), false);
  assert.doesNotMatch(JSON.stringify(intake), /secrets\.|github\.token/);
  assert.match(intake.run, /INTAKE_CONCLUSION.*success/);
  assert.match(intake.run, /INTAKE_EVENT.*pull_request_target/);
  assert.match(intake.run, /INTAKE_ACTOR_LOGIN.*dependabot\[bot\]/);
  assert.match(intake.run, /INTAKE_ACTOR_TYPE.*Bot/);
  assert.match(intake.run, /INTAKE_TRIGGERING_ACTOR_LOGIN/);
  assert.match(intake.run, /INTAKE_HEAD_REPOSITORY.*REPOSITORY/);
  assert.match(intake.run, /INTAKE_HEAD_BRANCH.*dependabot\/\*/);
  assert.match(intake.run, /INTAKE_HEAD_SHA.*receipt_head_sha/s);
  assert.match(intake.run, /linked\.length > 1/);
  assert.match(intake.run, /pullRequest\?\.number/);
  assert.match(intake.run, /pullRequest\?\.head\?\.sha/);
  assert.match(intake.run, /dependabot-intake:v1/);
  assert.match(intake.run, /dependabot-intake\.yml@main/);
  assert.match(intake.run, /Dependabot Prepared Head Intake/);
  assert.match(intake.run, /dependabot-prepared-head:v1/);
  assert.match(intake.run, /EXPECTED_PREPARE_BOT_ID/);

  assert.equal(pr.id, "pr");
  assert.equal(Object.hasOwn(pr, "uses"), false);
  assert.equal(pr.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    pr.env.EXPECTED_HEAD_SHA,
    "${{ steps.intake.outputs.head_sha }}",
  );
  assert.match(pr.run, /repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER/);
  assert.match(pr.run, /state !== "open"/);
  assert.match(pr.run, /draft !== false/);
  assert.match(pr.run, /dependabot\[bot\]/);
  assert.equal(
    pr.env.EXPECTED_HEAD_REF,
    "${{ steps.intake.outputs.head_ref }}",
  );
  assert.match(pr.run, /head\?\.ref !== expectedHeadRef/);
  assert.match(pr.run, /base\?\.ref !== "main"/);
  assert.match(pr.run, /head\?\.sha !== expectedHeadSha/);
  assert.match(pr.run, /identity_digest/);
  assert.match(pr.run, /commits\/\$EXPECTED_HEAD_SHA/);
  assert.match(pr.run, /web-flow/);
  assert.match(pr.run, /verification\?\.verified !== true/);
  assert.match(pr.run, /verification\?\.reason !== "valid"/);
  assert.equal(
    preparedValidator.if,
    "steps.intake.outputs.source_kind == 'prepared'",
  );
  assert.match(
    preparedValidator.run,
    /contents\/scripts\/dependabot-prepared-review\.mjs\?ref=\$WORKFLOW_SHA/,
  );
  assert.equal(
    preparedLineage.if,
    "steps.intake.outputs.source_kind == 'prepared'",
  );
  assert.match(
    preparedLineage.run,
    /--check-id "\$EXPECTED_OPERATION_CHECK_ID"/,
  );
  assert.match(preparedLineage.run, /--digest "\$EXPECTED_OPERATION_DIGEST"/);

  assert.equal(reviewJob.name, "dependabot-claude-review-agent");
  assert.equal(reviewJob.needs, "preflight");
  assert.equal(reviewJob.if, "needs.preflight.result == 'success'");
  assert.deepEqual(reviewJob.permissions, {
    contents: "read",
    issues: "read",
    "pull-requests": "read",
  });
  assert.equal(Object.hasOwn(reviewJob.permissions, "checks"), false);
  assert.equal(Object.hasOwn(reviewJob.permissions, "id-token"), false);
  assert.equal(
    reviewJob.outputs.structured_output,
    "${{ steps.claude-review.outputs.structured_output }}",
  );

  const [immediate, checkout, review] = reviewJob.steps;
  assert.equal(Object.hasOwn(immediate, "uses"), false);
  assert.equal(immediate.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    immediate.env.EXPECTED_HEAD_REF,
    "${{ needs.preflight.outputs.head_ref }}",
  );
  assert.match(immediate.run, /EXPECTED_IDENTITY_DIGEST/);
  assert.match(immediate.run, /head\?\.ref !== expectedHeadRef/);
  assert.match(immediate.run, /head\?\.sha !== expectedHeadSha/);

  assert.equal(
    checkout.uses,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assert.deepEqual(checkout.with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });

  assert.equal(review.id, "claude-review");
  assert.equal(review.uses, claudeAction);
  assert.equal(
    review.with.allowed_bots,
    "${{ needs.preflight.outputs.review_actor_login }}",
  );
  assert.equal(review.with.github_token, "${{ github.token }}");
  assert.equal(Object.hasOwn(review.with, "plugin_marketplaces"), false);
  assert.equal(Object.hasOwn(review.with, "plugins"), false);
  assert.match(
    review.with.prompt,
    /pull\/\$\{\{ needs\.preflight\.outputs\.pr_number \}\}/,
  );
  assert.match(
    review.with.prompt,
    /head.*needs\.preflight\.outputs\.head_sha/s,
  );
  assert.match(review.with.prompt, /Do not make any.*mutation/s);
  assert.match(review.with.claude_code_oauth_token, /secrets\./);
  assert.match(review.with.claude_args, /--json-schema/);
  assert.match(review.with.claude_args, /dependabot-claude-review-result:v1/);
  assert.match(review.with.claude_args, /"maxItems":20/);
  assert.match(review.with.claude_args, /"additionalProperties":false/);

  assert.equal(publishJob.name, "dependabot-claude-review-publisher");
  assert.deepEqual(publishJob.needs, ["preflight", "review"]);
  assert.match(
    publishJob.if,
    /always\(\).*needs\.preflight\.result == 'success'/,
  );
  assert.deepEqual(publishJob.permissions, {
    actions: "read",
    checks: "write",
    "pull-requests": "read",
  });
  assert.ok(publishJob.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.doesNotMatch(
    JSON.stringify(publishJob),
    /secrets\.|claude-code-action/,
  );

  const [postflight, publish] = publishJob.steps;
  assert.equal(postflight.id, "postflight");
  assert.equal(
    postflight.env.EXPECTED_HEAD_REF,
    "${{ needs.preflight.outputs.head_ref }}",
  );
  assert.match(postflight.run, /repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER/);
  assert.match(postflight.run, /EXPECTED_IDENTITY_DIGEST/);
  assert.match(postflight.run, /head\?\.ref !== expectedHeadRef/);
  assert.match(postflight.run, /head\?\.sha !== expectedHeadSha/);
  assert.match(postflight.run, /stable=true/);

  assert.equal(publish.if, "${{ always() }}");
  assert.equal(
    publish.env.EXPECTED_HEAD_SHA,
    "${{ needs.preflight.outputs.head_sha }}",
  );
  assert.equal(
    publish.env.CHECK_DETAILS_URL,
    "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
  );
  assert.equal(
    publish.env.CHECK_EXTERNAL_ID,
    "dependabot-claude-review:v1:pr=${{ needs.preflight.outputs.pr_number }}:sha=${{ needs.preflight.outputs.head_sha }}:run=${{ github.run_id }}:attempt=${{ github.run_attempt }}",
  );
  assert.equal(
    publish.env.REVIEW_OUTPUT,
    "${{ needs.review.outputs.structured_output }}",
  );
  assert.match(publish.run, /repos\/\$REPOSITORY\/check-runs/);
  assert.match(publish.run, /name: "claude-review"/);
  assert.match(publish.run, /head_sha: \$headSha/);
  assert.match(publish.run, /details_url: \$detailsUrl/);
  assert.match(publish.run, /external_id: \$externalId/);
  assert.match(publish.run, /dependabot-claude-review-result:v1/);
  assert.match(publish.run, /reviewCompleted == true/);
  assert.match(publish.run, /verdict == "clean"/);
  assert.match(publish.run, /findings \| length\) == 0/);
  assert.match(publish.run, /all\(\.findings\[\];/);
  assert.match(publish.run, /jq -S -c '\.'/);
  assert.match(publish.run, /--arg text "\$text"/);
  assert.match(publish.run, /text: \$text/);
  assert.match(publish.run, /POST_IDENTITY_STABLE.*true/s);
  assert.match(publish.run, /test "\$conclusion" = "success"/);

  assert.match(checkout.uses, /@[0-9a-f]{40}$/);
  assert.match(review.uses, /@[0-9a-f]{40}$/);

  const raw = read(dependabotReviewPath);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /github\.event\.pull_request/);
});

test("Dependabot Claude review authenticates live upstream head metadata", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment(),
    INTAKE_WORKFLOW: "Dependabot Intake",
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_number=701\nhead_ref=dependabot/npm_and_yarn/runtime-packages-123abc\nhead_sha=${"a".repeat(40)}\noperation=\noperation_check_id=\noperation_digest=\nreview_actor_login=dependabot[bot]\nsource_kind=dependabot\n`,
  );
});

test("native Dependabot review needs no Prepare App configuration", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment({
      EXPECTED_PREPARE_APP_SLUG: "",
      EXPECTED_PREPARE_BOT_ID: "",
      EXPECTED_PREPARE_BOT_LOGIN: "",
    }),
    INTAKE_WORKFLOW: "Dependabot Intake",
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.githubOutput, /review_actor_login=dependabot\[bot\]/);
});

test("Dependabot Claude review allows an omitted linked PR after receipt authentication", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment({ INTAKE_PULL_REQUESTS_JSON: "[]" }),
    INTAKE_WORKFLOW: "Dependabot Intake",
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stderr);
});

test("Dependabot Claude review rejects an upstream head and receipt mismatch", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment({ INTAKE_HEAD_SHA: "b".repeat(40) }),
    INTAKE_WORKFLOW: "Dependabot Intake",
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.githubOutput, "");
});

test("human Claude review cannot shadow the Dependabot review check", () => {
  const job = humanReview.jobs["claude-review-human"];
  assert.ok(job);
  assert.equal(job.name, "claude-review-human");
  assert.match(job.if, /head\.repo\.full_name == github\.repository/);
  assert.match(job.if, /pull_request\.user\.type == 'User'/);
  assert.equal(humanReview.jobs["claude-review"], undefined);

  const guardIndex = job.steps.findIndex(
    (step) => step.name === "Reject candidate marketplace path collision",
  );
  const marketplaceCheckoutIndex = job.steps.findIndex(
    (step) => step.name === "Checkout pinned Claude plugin marketplace",
  );
  assert.ok(guardIndex >= 0);
  assert.equal(marketplaceCheckoutIndex, guardIndex + 1);
  const marketplaceGuard = job.steps[guardIndex];
  assert.match(marketplaceGuard.run, /GITHUB_WORKSPACE/);
  assert.match(marketplaceGuard.run, /-e "\$marketplace_path"/);
  assert.match(marketplaceGuard.run, /-L "\$marketplace_path"/);

  const marketplaceCheckout = job.steps[marketplaceCheckoutIndex];
  assert.ok(marketplaceCheckout);
  assert.equal(
    marketplaceCheckout.uses,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assert.equal(marketplaceCheckout.with.repository, "anthropics/claude-code");
  assert.equal(marketplaceCheckout.with.ref, claudePluginMarketplaceRef);
  assert.equal(marketplaceCheckout.with.path, claudePluginMarketplace.slice(2));
  assert.equal(marketplaceCheckout.with["persist-credentials"], false);
  assert.deepEqual(
    marketplaceCheckout.with["sparse-checkout"].trim().split("\n"),
    [".claude-plugin", "plugins/code-review"],
  );

  const marketplaceVerification = job.steps[marketplaceCheckoutIndex + 1];
  assert.equal(
    marketplaceVerification.name,
    "Verify pinned Claude plugin marketplace",
  );
  assert.equal(
    marketplaceVerification.env.EXPECTED_MARKETPLACE_SHA,
    claudePluginMarketplaceRef,
  );
  assert.match(marketplaceVerification.run, /! -L "\$marketplace_path"/);
  assert.match(
    marketplaceVerification.run,
    /git -C "\$marketplace_path" rev-parse HEAD/,
  );

  const review = job.steps.find((step) => step.uses === claudeAction);
  assert.ok(review);
  assert.equal(
    review.with.claude_args,
    `--plugin-dir ${claudeCodeReviewPlugin}`,
  );
  assert.equal(Object.hasOwn(review.with, "plugin_marketplaces"), false);
  assert.equal(Object.hasOwn(review.with, "plugins"), false);
  assert.equal(Object.hasOwn(review.with, "allowed_bots"), false);
});

test("human Claude review rejects a candidate marketplace symlink", () => {
  const guard = humanReview.jobs["claude-review-human"].steps.find(
    (step) => step.name === "Reject candidate marketplace path collision",
  );
  assert.ok(guard);

  const workspace = mkdtempSync(join(tmpdir(), "claude-review-workspace-"));
  try {
    const redirect = join(workspace, "redirect");
    mkdirSync(redirect);
    symlinkSync(
      redirect,
      join(workspace, claudePluginMarketplace.slice(2)),
      "dir",
    );
    const result = spawnSync("bash", ["-c", guard.run], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_WORKSPACE: workspace },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Candidate content occupies/);
    assert.deepEqual(readdirSync(redirect), []);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("no workflow can automatically merge Dependabot pull requests", () => {
  const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
  const legacyWorkflow = new URL(
    "../.github/workflows/dependabot-auto-merge.yml",
    import.meta.url,
  );
  assert.equal(existsSync(legacyWorkflow), false);

  const forbiddenMergeAuthority =
    /gh\s+pr\s+merge|enablePullRequestAutoMerge|mergePullRequest|\/pulls\/[^\s"'`]*\/merge|pulls\.merge|DEPENDABOT_PROCESSOR_MERGE_/;
  const trustedSources = [
    "scripts/dependabot-preparation-receipts.mjs",
    "scripts/dependabot-prepared-review.mjs",
    "scripts/dependabot-processor.mjs",
  ];
  for (const source of trustedSources) {
    assert.doesNotMatch(
      read(source),
      forbiddenMergeAuthority,
      `${source} must not merge or enable native auto-merge for Dependabot PRs`,
    );
  }

  for (const filename of readdirSync(workflowDirectory)) {
    if (!/\.ya?ml$/.test(filename)) {
      continue;
    }
    const raw = read(`.github/workflows/${filename}`);
    assert.doesNotMatch(
      raw,
      forbiddenMergeAuthority,
      `${filename} must not merge or enable native auto-merge for Dependabot PRs`,
    );
  }
});
