/* eslint-disable turbo/no-undeclared-env-vars -- The Bash-validator harness preserves the host executable search path. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
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
const processorPath = ".github/workflows/dependabot-process.yml";
const dependabotReviewPath = ".github/workflows/dependabot-claude-review.yml";
const humanReviewPath = ".github/workflows/claude-code-review.yml";
const intake = workflow(intakePath);
const processor = workflow(processorPath);
const dependabotReview = workflow(dependabotReviewPath);
const humanReview = workflow(humanReviewPath);

const claudeAction =
  "anthropics/claude-code-action@be7b93b1907a4abad570368f3c74b6fe3807510b";
const claudePluginMarketplace =
  "https://github.com/anthropics/claude-code.git#2bb60696142b493eafaeacfe00eac51d16c50c4f";

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
    [processorPath, 2],
    [dependabotReviewPath, 5],
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
        ...(eventPayload === undefined ? {} : { EVENT_PATH: eventPath }),
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
    workflows: ["Dependabot Intake"],
    types: ["completed"],
  });
  assert.deepEqual(processor.on.repository_dispatch, {
    types: ["dependabot-process"],
  });
  assert.deepEqual(processor.on.schedule, [{ cron: "43 * * * *" }]);
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
  assert.match(processor["run-name"], /target=ignored/);

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
  assert.match(target.run, /\["scope"\]/);
  assert.doesNotMatch(target.run, /clientPayload\.(?:repository|schema)/);
  assert.match(target.run, /dependabot-intake:v1/);
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
    "${{ env.DEPENDABOT_PROCESSOR_MODE }}",
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
    `pr_numbers=701\nexpected_head_sha=${"a".repeat(40)}\n`,
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

test("both jobs materialize only the exact trusted processor source", () => {
  for (const jobName of ["evaluate", "process"]) {
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
    assert.match(step.run, /resolved_sha.*WORKFLOW_SHA/s);
    assert.doesNotMatch(step.run, forbiddenCandidateSurfaces);
  }
});

test("process job classifies exact merge mode with case-sensitive shell equality", () => {
  const processJob = processor.jobs.process;
  const mode = processJob.steps.find(
    (step) => step.name === "Classify exact processor mode",
  );
  assert.ok(mode);
  assert.equal(processJob.steps[0], mode);
  assert.equal(mode.id, "mode");
  assert.equal(mode.shell, "bash");
  assert.deepEqual(mode.env, {
    RAW_PROCESSOR_MODE: "${{ env.DEPENDABOT_PROCESSOR_MODE }}",
  });
  assert.equal(Object.hasOwn(mode, "uses"), false);
  assert.doesNotMatch(JSON.stringify(mode), /secrets\.|github\.token/);
  assert.match(mode.run, /test "\$RAW_PROCESSOR_MODE" = "merge"/);

  for (const [rawMode, expectedMerge] of [
    ["merge", true],
    ["Merge", false],
    ["MERGE", false],
    [" merge ", false],
    ["", false],
    ["observe", false],
    ["assist", false],
  ]) {
    const result = runBashStep(mode, { RAW_PROCESSOR_MODE: rawMode });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.githubOutput,
      `merge=${expectedMerge}\n`,
      JSON.stringify(rawMode),
    );
  }
});

test("privileged processing revalidates without candidate code or data", () => {
  const processJob = processor.jobs.process;
  assert.equal(processJob.needs, "evaluate");
  assert.equal(processJob.if, "needs.evaluate.result == 'success'");
  assert.deepEqual(processJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "write",
    statuses: "read",
  });

  const requireMergeCredentials = processJob.steps.find(
    (step) => step.name === "Require merge App credentials in merge mode",
  );
  assert.ok(requireMergeCredentials);
  assert.equal(
    requireMergeCredentials.if,
    "fromJSON(steps.mode.outputs.merge)",
  );
  assert.deepEqual(requireMergeCredentials.env, {
    MERGE_APP_CLIENT_ID: "${{ vars.DEPENDABOT_PROCESSOR_MERGE_APP_CLIENT_ID }}",
    MERGE_APP_PRIVATE_KEY:
      "${{ secrets.DEPENDABOT_PROCESSOR_MERGE_APP_PRIVATE_KEY }}",
  });
  assert.match(requireMergeCredentials.run, /test -n "\$MERGE_APP_CLIENT_ID"/);
  assert.match(
    requireMergeCredentials.run,
    /test -n "\$MERGE_APP_PRIVATE_KEY"/,
  );

  const mergeToken = processJob.steps.find(
    (step) => step.name === "Create repository-scoped merge token",
  );
  assert.ok(mergeToken);
  assert.equal(mergeToken.id, "merge-token");
  assert.equal(mergeToken.if, "fromJSON(steps.mode.outputs.merge)");
  assert.equal(
    mergeToken.uses,
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
  );
  assert.deepEqual(mergeToken.with, {
    "client-id": "${{ vars.DEPENDABOT_PROCESSOR_MERGE_APP_CLIENT_ID }}",
    "private-key": "${{ secrets.DEPENDABOT_PROCESSOR_MERGE_APP_PRIVATE_KEY }}",
    owner: "mento-protocol",
    repositories: "frontend-monorepo",
    "permission-contents": "write",
    "permission-pull-requests": "write",
  });
  assert.deepEqual(
    processJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [mergeToken],
  );

  const invocation = processJob.steps.find(
    (step) =>
      step.name === "Re-query exact heads and process the current sweep",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+--live\s+--publish-checks/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ env.DEPENDABOT_PROCESSOR_MODE }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_MERGE_TOKEN,
    "${{ steps.merge-token.outputs.token }}",
  );
  assert.notEqual(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    invocation.env.DEPENDABOT_PROCESSOR_MERGE_TOKEN,
  );

  const raw = JSON.stringify(processJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /--admin\b/);
});

test("Dependabot Claude review follows only authenticated intake runs", () => {
  assert.equal(dependabotReview.name, "Dependabot Claude Review");
  assert.deepEqual(dependabotReview.on, {
    workflow_run: {
      workflows: ["Dependabot Intake"],
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
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(preflightJob.outputs, {
    head_ref: "${{ steps.intake.outputs.head_ref }}",
    head_sha: "${{ steps.intake.outputs.head_sha }}",
    identity_digest: "${{ steps.pr.outputs.identity_digest }}",
    pr_number: "${{ steps.intake.outputs.pr_number }}",
  });

  const [intake, pr] = preflightJob.steps;
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
  assert.equal(review.with.allowed_bots, "dependabot[bot]");
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
  assert.match(publish.run, /\.findings\[\].*tojson/s);
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
    `pr_number=701\nhead_ref=dependabot/npm_and_yarn/runtime-packages-123abc\nhead_sha=${"a".repeat(40)}\n`,
  );
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

  const review = job.steps.find((step) => step.uses === claudeAction);
  assert.ok(review);
  assert.equal(review.with.plugin_marketplaces, claudePluginMarketplace);
  assert.equal(Object.hasOwn(review.with, "allowed_bots"), false);
});

test("the processor is the sole Dependabot merge authority", () => {
  const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
  const legacyWorkflow = new URL(
    "../.github/workflows/dependabot-auto-merge.yml",
    import.meta.url,
  );
  assert.equal(existsSync(legacyWorkflow), false);

  for (const filename of readdirSync(workflowDirectory)) {
    if (!/\.ya?ml$/.test(filename) || filename === "dependabot-process.yml") {
      continue;
    }
    const raw = read(`.github/workflows/${filename}`);
    assert.doesNotMatch(
      raw,
      /gh pr (?:merge|review)|enablePullRequestAutoMerge|pulls\.merge/,
      `${filename} must not independently approve or merge Dependabot PRs`,
    );
  }
});
