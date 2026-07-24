import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAIN_DEPLOYMENT_MODE,
  MAIN_DEPLOYMENT_SCHEMA,
  MAIN_FAILURE_EVIDENCE_SCHEMA,
  MAIN_STAGE_SCHEMA,
  assertMainDeploymentHandoff,
  assertMainFinalResults,
  assertMainStageResult,
  assertProtectedSnapshotMatchesPlan,
  assertUploadedPreparedJournal,
  classifyRemoteMainFreshness,
  createMainAppBuildProof,
  createMainAppCandidateExpectation,
  createMainAppTransactionMetadata,
  createMainDeploymentPlan,
  createMainDeploymentEvidence,
  createMainDeploymentFailureEvidence,
  createMainJournalArtifactIdentity,
  createMainWorkflowRunUrl,
  createMainLegacyAliasSpec,
  createMainProtectedAliasSpec,
  createMainStageResult,
  createMainTransactionInputs,
  createPreparedMainJournal,
  parseMainDeploymentArguments,
  readRemoteMainSha,
  recoverMainShadowTransaction,
  renderMainDeploymentEvidence,
  renderMainDeploymentFailureEvidence,
  runMainShadowTransaction,
  validateMainDeploymentSource,
  validateMainStageJobs,
  validateMainWorkflowContext,
} from "./vercel-main-deployment.mjs";
import {
  createMainTransactionId,
  mainTransactionJournalArtifactName,
} from "./vercel-main-transaction.mjs";
import { generateVercelDeploymentId } from "./vercel-prebuilt.mjs";

const SHA = "dddddddddddddddddddddddddddddddddddddddd";
const OTHER_SHA = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const PARENT = "cccccccccccccccccccccccccccccccccccccccc";
const WORKFLOW_RUN_URL =
  "https://github.com/mento-protocol/frontend-monorepo/actions/runs/800";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/vercel-main-plan/valid-priors.json", import.meta.url),
    "utf8",
  ),
);
const projectIds = fixture.projectIds;

function allProtectedStates() {
  const source = structuredClone(fixture);
  const states = Object.values(source.priorStates).flatMap(
    (group) => group.states,
  );
  states.push({
    alias: "v2-app.mento.org",
    deploymentId: "dpl_legacyV2123",
    deploymentUrl: "https://appmento-jbhj7crjl-mentolabs.vercel.app",
    creatorUsername: "chapati",
    projectId: projectIds.app,
    projectName: "app.mento.org",
    readyState: "READY",
    target: "production",
    customEnvironmentSlug: null,
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "v2",
      sha: "9999999999999999999999999999999999999999",
    },
    aliases: [
      "appmentoorg-git-v2-mentolabs.vercel.app",
      "appmentoorg-mentolabs.vercel.app",
      "appmentoorg.vercel.app",
      "v2-app.mento.org",
    ],
  });
  return states.sort((left, right) => left.alias.localeCompare(right.alias));
}

function planningSnapshot() {
  return {
    schema: "vercel-main-planning-snapshot:v1",
    states: allProtectedStates().filter(
      (state) => state.alias !== "v2-app.mento.org",
    ),
  };
}

function legacySnapshot() {
  return allProtectedStates().filter(
    (state) => state.alias === "v2-app.mento.org",
  );
}

function gitAdapter() {
  return {
    resolveCommit(value) {
      return value;
    },
    isAncestor() {
      return true;
    },
    firstParent() {
      return PARENT;
    },
  };
}

function upstream() {
  return {
    runId: "123456",
    runAttempt: "2",
    runUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456",
    buildAndTestJobUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456/job/654321",
  };
}

function plan({
  deployments = ["app", "governance", "reserve", "ui"],
  legacyAliases = null,
} = {}) {
  const legacy = legacySnapshot();
  if (legacyAliases !== null) legacy[0].aliases = legacyAliases;
  return createMainDeploymentPlan({
    mode: MAIN_DEPLOYMENT_MODE,
    deploySha: SHA,
    projectIds,
    planningSnapshot: planningSnapshot(),
    legacySnapshot: legacy,
    upstream: upstream(),
    gitAdapter: gitAdapter(),
    runPlanner: ({ base, head }) => ({
      base,
      head,
      deployments,
      reason:
        deployments.length === 0 ? "non-runtime-only" : "affected-packages",
    }),
  });
}

function stagedState(target) {
  const generated = {
    governance: "governancementoorg-mentolabs.vercel.app",
    reserve: "reservementoorg-mentolabs.vercel.app",
    ui: "uimentoorg-mentolabs.vercel.app",
  };
  const immutable = `${target}-candidate.vercel.app`;
  return {
    alias: immutable,
    deploymentId: `dpl_${target}Candidate123`,
    deploymentUrl: `https://${immutable}`,
    creatorUsername: null,
    projectId: projectIds[target],
    projectName: `${target}.mento.org`,
    readyState: "READY",
    target: "production",
    customEnvironmentSlug: null,
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "main",
      sha: SHA,
    },
    aliases: [generated[target]],
  };
}

function stageResult(target, deploymentPlan = plan()) {
  return createMainStageResult({
    target,
    plan: deploymentPlan,
    state: stagedState(target),
    runId: "800",
    runAttempt: "3",
    smokePassed: true,
    protectedMappingsUnchanged: true,
  });
}

function stageJobs(deploymentPlan = plan()) {
  return Object.fromEntries(
    ["governance", "reserve", "ui"].map((target) => {
      const selected = deploymentPlan.planning.plan.includes(target);
      return [
        target,
        {
          result: selected ? "success" : "skipped",
          handoff: selected ? stageResult(target, deploymentPlan) : null,
        },
      ];
    }),
  );
}

function appProof() {
  return createMainAppBuildProof({
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
    projectId: projectIds.app,
    nextDeploymentId: generateVercelDeploymentId({
      target: "app",
      commitSha: SHA,
      runId: "800",
      runAttempt: "3",
    }),
  });
}

test("protected spec binds every reviewed main alias and legacy v2", () => {
  const spec = createMainProtectedAliasSpec({ projectIds });
  const legacy = createMainLegacyAliasSpec({ projectIds });
  assert.equal(spec.length, 5);
  assert.deepEqual(
    spec.map((entry) => entry.alias),
    [
      "app.mento.org",
      "appmentoorg-env-v3-mentolabs.vercel.app",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
    ],
  );
  assert.equal(
    spec.filter((entry) => entry.projectName === "app.mento.org").length,
    2,
  );
  assert.deepEqual(legacy, [
    {
      alias: "v2-app.mento.org",
      projectId: projectIds.app,
      projectName: "app.mento.org",
      target: "production",
      customEnvironmentSlug: null,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "v2",
      },
    },
  ]);
});

test("controller CLI accepts only each command's exact non-duplicated options", () => {
  const valid = [
    ["validate-context"],
    ["validate-source"],
    ["create-spec", "--scope", "main", "--output", "/tmp/spec.json"],
    ["evidence", "--output", "/tmp/evidence.json"],
    ["failure-evidence", "--output", "/tmp/failure-evidence.json"],
    [
      "plan",
      "--planning-snapshot",
      "/tmp/main.json",
      "--legacy-snapshot",
      "/tmp/legacy.json",
      "--output",
      "/tmp/plan.json",
    ],
    ["freshness"],
    ["journal-name"],
    [
      "revalidate-prior",
      "--planning-snapshot",
      "/tmp/main.json",
      "--legacy-snapshot",
      "/tmp/legacy.json",
    ],
    ["app-build-proof", "--output", "/tmp/app.json"],
    [
      "app-candidate-expectation",
      "--journal",
      "/tmp/journal.json",
      "--output",
      "/tmp/expected.json",
    ],
    [
      "stage-result",
      "--state",
      "/tmp/state.json",
      "--output",
      "/tmp/result.json",
    ],
    ["validate-stages"],
    ["prepare-journal", "--output", "/tmp/journal.json"],
    ["run-shadow", "--journal", "/tmp/journal.json"],
    ["recover-shadow", "--journal", "/tmp/journal.json"],
    ["final"],
  ];
  for (const argv of valid) {
    assert.equal(parseMainDeploymentArguments(argv).command, argv[0]);
  }
  for (const argv of [
    [],
    ["unknown"],
    ["validate-context", "--extra", "x"],
    ["plan", "--output", "/tmp/plan.json"],
    [
      "create-spec",
      "--scope",
      "main",
      "--scope",
      "legacy",
      "--output",
      "/tmp/spec.json",
    ],
    ["stage-result", "--state", "--output", "/tmp/result.json"],
    ["freshness", "extra"],
  ]) {
    assert.throws(() => parseMainDeploymentArguments(argv));
  }
});

test("journal artifact identity is recoverable without coordinator outputs", () => {
  const journal = createPreparedMainJournal({
    plan: plan(),
    stageJobs: stageJobs(),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(
    createMainJournalArtifactIdentity({
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
    }),
    {
      transactionId: journal.transactionId,
      artifactName: mainTransactionJournalArtifactName(journal),
    },
  );
  assert.throws(
    () =>
      createMainJournalArtifactIdentity({
        deploySha: SHA,
        runId: "800",
        runAttempt: "0",
      }),
    /Run attempt/,
  );
});

test("canonical evidence records planning, candidates, timings, cache, journal, and recovery without raw responses", () => {
  const deploymentPlan = plan();
  const jobs = stageJobs(deploymentPlan);
  const identity = createMainJournalArtifactIdentity({
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
  });
  const stages = Object.fromEntries(
    ["governance", "reserve", "ui"].map((target, index) => [
      target,
      {
        handoff: jobs[target].handoff,
        nextDeploymentId: generateVercelDeploymentId({
          target,
          commitSha: SHA,
          runId: "800",
          runAttempt: "3",
        }),
        metrics: {
          buildDurationMs: String(10_000 + index),
          deployDurationMs: String(2_000 + index),
          totalDurationMs: String(20_000 + index),
          turboCacheHits: String(3 + index),
          turboCacheMisses: String(1 + index),
        },
      },
    ]),
  );
  const evidence = createMainDeploymentEvidence({
    plan: deploymentPlan,
    stages,
    app: {
      nextDeploymentId: appProof().nextDeploymentId,
      metrics: {
        buildDurationMs: "12000",
        totalDurationMs: "18000",
        turboCacheHits: "5",
        turboCacheMisses: "2",
      },
    },
    coordinator: {
      outcome: "shadow-prepared",
      transactionId: identity.transactionId,
      artifactName: identity.artifactName,
      artifactId: "98123",
      totalDurationMs: "25000",
    },
    recovery: { outcome: "verified-no-mutation" },
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
  });
  assert.equal(evidence.schema, "vercel-main-evidence:v1");
  assert.equal(evidence.workflowRunUrl, WORKFLOW_RUN_URL);
  assert.deepEqual(evidence.planning.priors, deploymentPlan.planning.priors);
  assert.deepEqual(evidence.planning.ranges, deploymentPlan.planning.ranges);
  assert.deepEqual(evidence.planning.reasons, deploymentPlan.planning.reasons);
  assert.deepEqual(evidence.planning.plan, deploymentPlan.planning.plan);
  assert.equal(
    evidence.stages.governance.candidate.deploymentId,
    jobs.governance.handoff.candidate.deploymentId,
  );
  assert.equal(evidence.stages.reserve.metrics.deployDurationMs, "2001");
  assert.equal(evidence.app.outcome, "build-only");
  assert.equal(evidence.workflowDefinitionSha, SHA);
  assert.equal(evidence.upstream.buildAndTestConclusion, "success");
  assert.equal(evidence.journal.artifactName, identity.artifactName);
  assert.equal(evidence.journal.journalArtifactId, "98123");
  assert.equal(evidence.journal.sequence, 0);
  assert.equal(evidence.journal.status, "prepared");
  assert.equal(evidence.legacy.alias, "v2-app.mento.org");
  assert.equal(evidence.legacy.ref, "v2");
  assert.equal(evidence.legacy.readyState, "READY");
  assert.equal(evidence.legacy.health, "passed");
  assert.deepEqual(evidence.stages.governance.verification, {
    canonicalState: "passed",
    immutableSmoke: "passed",
    protectedMappings: "unchanged",
  });
  assert.equal(evidence.recovery.outcome, "verified-no-mutation");
  assert.deepEqual(evidence.freshness, {
    beforeAppPreparation: "fresh",
    beforeTransaction: "fresh",
  });
  assert.deepEqual(evidence.ordinaryRollbackStateTargets, []);
  const summary = renderMainDeploymentEvidence(evidence);
  assert.match(summary, /Served deployment priors/);
  assert.match(summary, /Served-SHA ranges and selection reasons/);
  assert.match(summary, /Candidate evidence/);
  assert.match(
    summary,
    /Public-serving activation, alias, promotion, rollback, and recovery commands: `0`/,
  );
  assert.match(summary, /Unaliased ordinary staging uploads/);
  assert.match(summary, /legacy-app/);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /creatorUsername|VERCEL_TOKEN|SENTRY_AUTH_TOKEN|github_event|rawResponse/,
  );

  assert.throws(
    () =>
      createMainDeploymentEvidence({
        plan: deploymentPlan,
        stages,
        app: {
          nextDeploymentId: "wrong-next-id",
          metrics: {
            buildDurationMs: "12000",
            totalDurationMs: "18000",
            turboCacheHits: "5",
            turboCacheMisses: "2",
          },
        },
        coordinator: {
          outcome: "shadow-prepared",
          transactionId: identity.transactionId,
          artifactName: identity.artifactName,
          artifactId: "98123",
          totalDurationMs: "25000",
        },
        recovery: { outcome: "verified-no-mutation" },
        runId: "800",
        runAttempt: "3",
        workflowRunUrl: WORKFLOW_RUN_URL,
      }),
    /wrong custom Next ID/,
  );
  assert.throws(
    () =>
      createMainDeploymentEvidence({
        plan: deploymentPlan,
        stages,
        app: {
          nextDeploymentId: appProof().nextDeploymentId,
          metrics: {
            buildDurationMs: "12000",
            totalDurationMs: "18000",
            turboCacheHits: "5",
            turboCacheMisses: "2",
          },
        },
        coordinator: {
          outcome: "shadow-prepared",
          transactionId: identity.transactionId,
          artifactName: identity.artifactName,
          artifactId: "98123",
          totalDurationMs: "25000",
          rawResponse: { token: "forbidden" },
        },
        recovery: { outcome: "verified-no-mutation" },
        runId: "800",
        runAttempt: "3",
        workflowRunUrl: WORKFLOW_RUN_URL,
      }),
    /forbidden or missing fields/,
  );
});

test("failure evidence records the complete redacted job graph without parsing planner output", () => {
  const jobs = {
    waitForCi: "success",
    plan: "success",
    stageGovernance: "failure",
    stageReserve: "cancelled",
    stageUi: "skipped",
    coordinator: "skipped",
    recovery: "success",
  };
  const evidence = createMainDeploymentFailureEvidence({
    eventHeadSha: SHA,
    verifiedDeploySha: SHA,
    planOutput: '{"token":"must-not-be-embedded"',
    jobs,
    workflowDefinitionSha: SHA,
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
  });
  assert.equal(evidence.schema, MAIN_FAILURE_EVIDENCE_SCHEMA);
  assert.equal(evidence.outcome, "failed");
  assert.equal(evidence.eventHeadSha, SHA);
  assert.equal(evidence.verifiedDeploySha, SHA);
  assert.equal(evidence.planOutputPresent, true);
  assert.deepEqual(evidence.jobs, jobs);
  assert.equal(evidence.publicServingMutationCommands, 0);
  assert.doesNotMatch(JSON.stringify(evidence), /must-not-be-embedded|token/);
  const summary = renderMainDeploymentFailureEvidence(evidence);
  assert.match(summary, /Vercel main deployment failure evidence/);
  assert.match(summary, /stageGovernance \| `failure`/);
  assert.match(summary, /does not authorize activation/);
  assert.match(
    summary,
    /Public-serving activation, alias, promotion, rollback, and recovery commands: `0`/,
  );

  const unavailable = createMainDeploymentFailureEvidence({
    eventHeadSha: "malformed",
    verifiedDeploySha: SHA,
    planOutput: "",
    jobs: {
      waitForCi: "failure",
      plan: "skipped",
      stageGovernance: "skipped",
      stageReserve: "skipped",
      stageUi: "skipped",
      coordinator: "skipped",
      recovery: "success",
    },
    workflowDefinitionSha: SHA,
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
  });
  assert.equal(unavailable.eventHeadSha, null);
  assert.equal(unavailable.verifiedDeploySha, null);
  assert.equal(unavailable.planOutputPresent, false);
  assert.match(
    renderMainDeploymentFailureEvidence(unavailable),
    /Verified deploy SHA: unavailable/,
  );

  assert.throws(
    () =>
      createMainDeploymentFailureEvidence({
        eventHeadSha: SHA,
        verifiedDeploySha: SHA,
        planOutput: "",
        jobs: { ...jobs, plan: "unknown" },
        workflowDefinitionSha: SHA,
        runId: "800",
        runAttempt: "3",
        workflowRunUrl: WORKFLOW_RUN_URL,
      }),
    /Failure evidence job results is invalid for plan/,
  );
  assert.throws(
    () =>
      renderMainDeploymentFailureEvidence({
        ...evidence,
        rawResponse: { token: "forbidden" },
      }),
    /forbidden or missing fields/,
  );
});

test("canonical evidence accepts no-target and superseded-before-journal outcomes without invented artifacts", () => {
  for (const { deploymentPlan, outcome } of [
    { deploymentPlan: plan({ deployments: [] }), outcome: "no-target" },
    {
      deploymentPlan: plan({ deployments: ["app"] }),
      outcome: "superseded-before-journal",
    },
  ]) {
    const evidence = createMainDeploymentEvidence({
      plan: deploymentPlan,
      stages: {
        governance: null,
        reserve: null,
        ui: null,
      },
      app: null,
      coordinator: {
        outcome,
        transactionId: null,
        artifactName: null,
        artifactId: null,
        totalDurationMs: "1500",
      },
      recovery: { outcome: "not-required" },
      runId: "800",
      runAttempt: "3",
      workflowRunUrl: WORKFLOW_RUN_URL,
    });
    assert.equal(evidence.coordinator.outcome, outcome);
    assert.equal(evidence.journal, null);
    assert.equal(evidence.app, null);
    assert.deepEqual(
      evidence.freshness,
      outcome === "no-target"
        ? {
            beforeAppPreparation: "not-run",
            beforeTransaction: "not-run",
          }
        : {
            beforeAppPreparation: "superseded",
            beforeTransaction: "not-run",
          },
    );
  }
});

test("downstream workflow URL is exact and repository-bound", () => {
  assert.equal(
    createMainWorkflowRunUrl({
      serverUrl: "https://github.com",
      repository: "mento-protocol/frontend-monorepo",
      runId: "800",
    }),
    WORKFLOW_RUN_URL,
  );
  for (const override of [
    { serverUrl: "https://github.example.com" },
    { repository: "fork/frontend-monorepo" },
    { runId: "0" },
  ]) {
    assert.throws(() =>
      createMainWorkflowRunUrl({
        serverUrl: "https://github.com",
        repository: "mento-protocol/frontend-monorepo",
        runId: "800",
        ...override,
      }),
    );
  }
});

test("evidence CLI entrypoint writes canonical run JSON and summary from the exact Actions environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-evidence-"));
  try {
    const output = join(directory, "evidence.json");
    const summary = join(directory, "summary.md");
    writeFileSync(summary, "", { encoding: "utf8", mode: 0o600 });
    const deploymentPlan = plan();
    const jobs = stageJobs(deploymentPlan);
    const identity = createMainJournalArtifactIdentity({
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
    });
    const values = {
      ...process.env,
      PLAN_JSON: JSON.stringify(deploymentPlan),
      GITHUB_RUN_ID: "800",
      GITHUB_RUN_ATTEMPT: "3",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
      GITHUB_STEP_SUMMARY: summary,
      COORDINATOR_OUTCOME: "shadow-prepared",
      COORDINATOR_TOTAL_DURATION_MS: "25000",
      TRANSACTION_ID: identity.transactionId,
      JOURNAL_ARTIFACT_NAME: identity.artifactName,
      JOURNAL_ARTIFACT_ID: "98123",
      RECOVERY_OUTCOME: "verified-no-mutation",
      EVIDENCE_APP_NEXT_DEPLOYMENT_ID: appProof().nextDeploymentId,
      EVIDENCE_APP_BUILD_DURATION_MS: "12000",
      EVIDENCE_APP_TOTAL_DURATION_MS: "18000",
      EVIDENCE_APP_TURBO_CACHE_HITS: "5",
      EVIDENCE_APP_TURBO_CACHE_MISSES: "2",
    };
    for (const [index, target] of ["governance", "reserve", "ui"].entries()) {
      const prefix = `EVIDENCE_${target.toUpperCase()}`;
      values[`${prefix}_RESULT`] = "success";
      values[`${prefix}_HANDOFF`] = JSON.stringify(jobs[target].handoff);
      values[`${prefix}_NEXT_DEPLOYMENT_ID`] = generateVercelDeploymentId({
        target,
        commitSha: SHA,
        runId: "800",
        runAttempt: "3",
      });
      values[`${prefix}_BUILD_DURATION_MS`] = String(10_000 + index);
      values[`${prefix}_DEPLOY_DURATION_MS`] = String(2_000 + index);
      values[`${prefix}_TOTAL_DURATION_MS`] = String(20_000 + index);
      values[`${prefix}_TURBO_CACHE_HITS`] = String(3 + index);
      values[`${prefix}_TURBO_CACHE_MISSES`] = String(1 + index);
    }
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./vercel-main-deployment.mjs", import.meta.url)),
        "evidence",
        "--output",
        output,
      ],
      { encoding: "utf8", env: values },
    );
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(evidence.workflowRunUrl, WORKFLOW_RUN_URL);
    assert.equal(evidence.workflowDefinitionSha, SHA);
    assert.deepEqual(evidence.ordinaryRollbackStateTargets, []);
    const rendered = readFileSync(summary, "utf8");
    assert.match(rendered, new RegExp(WORKFLOW_RUN_URL.replaceAll("/", "\\/")));
    assert.match(rendered, /Ordinary rollback-state targets: none/);
    assert.match(
      rendered,
      /Freshness barriers: before App preparation `fresh`; before transaction `fresh`/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure-evidence CLI writes one canonical report when the planner output is unavailable", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "vercel-main-failure-evidence-"),
  );
  try {
    const output = join(directory, "evidence.json");
    const summary = join(directory, "summary.md");
    writeFileSync(summary, "", { encoding: "utf8", mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./vercel-main-deployment.mjs", import.meta.url)),
        "failure-evidence",
        "--output",
        output,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          EVENT_HEAD_SHA: SHA,
          DEPLOY_SHA: "",
          PLAN_JSON: "",
          GITHUB_WORKFLOW_SHA: SHA,
          GITHUB_RUN_ID: "800",
          GITHUB_RUN_ATTEMPT: "3",
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
          GITHUB_STEP_SUMMARY: summary,
          WAIT_FOR_CI_RESULT: "failure",
          PLAN_RESULT: "skipped",
          STAGE_GOVERNANCE_RESULT: "skipped",
          STAGE_RESERVE_RESULT: "skipped",
          STAGE_UI_RESULT: "skipped",
          COORDINATOR_RESULT: "skipped",
          RECOVERY_RESULT: "success",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(evidence.schema, MAIN_FAILURE_EVIDENCE_SCHEMA);
    assert.equal(evidence.eventHeadSha, SHA);
    assert.equal(evidence.verifiedDeploySha, null);
    assert.equal(evidence.planOutputPresent, false);
    assert.deepEqual(evidence.jobs, {
      waitForCi: "failure",
      plan: "skipped",
      stageGovernance: "skipped",
      stageReserve: "skipped",
      stageUi: "skipped",
      coordinator: "skipped",
      recovery: "success",
    });
    const rendered = readFileSync(summary, "utf8");
    assert.match(rendered, /Planner output: unavailable/);
    assert.match(rendered, /waitForCi \| `failure`/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("plan handoff binds upstream receipt, protected state, served-SHA plan, and legacy prior", () => {
  const result = plan();
  assert.equal(result.schema, MAIN_DEPLOYMENT_SCHEMA);
  assert.equal(result.mode, "shadow");
  assert.equal(result.deploySha, SHA);
  assert.deepEqual(result.planning.plan, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(result.protectedSnapshot.states.length, 5);
  assert.equal(result.legacySnapshot.length, 1);
  assert.deepEqual(result.legacyPrior, {
    deploymentId: "dpl_legacyV2123",
    deploymentUrl: "https://appmento-jbhj7crjl-mentolabs.vercel.app",
    aliases: ["v2-app.mento.org"],
  });
  assert.deepEqual(assertMainDeploymentHandoff(result), result);
  assert.throws(
    () =>
      assertMainDeploymentHandoff({
        ...result,
        token: "forbidden",
      }),
    /forbidden or missing fields/,
  );
});

for (const [name, mutate, reason] of [
  [
    "missing Git",
    (snapshot) => {
      for (const state of snapshot.states.filter((entry) =>
        entry.alias.startsWith("app"),
      )) {
        state.git = null;
      }
    },
    "served-git-metadata-missing",
  ],
  [
    "malformed Git",
    (snapshot) => {
      for (const state of snapshot.states.filter((entry) =>
        entry.alias.startsWith("app"),
      )) {
        state.git = {};
      }
    },
    "served-git-metadata-malformed",
  ],
  [
    "wrong repository",
    (snapshot) => {
      for (const state of snapshot.states.filter((entry) =>
        entry.alias.startsWith("app"),
      )) {
        state.git.repo = "other-repository";
      }
    },
    "served-git-metadata-wrong-source",
  ],
  [
    "wrong ref",
    (snapshot) => {
      for (const state of snapshot.states.filter((entry) =>
        entry.alias.startsWith("app"),
      )) {
        state.git.ref = "v2";
      }
    },
    "served-git-metadata-wrong-source",
  ],
  [
    "cross-alias conflict",
    (snapshot) => {
      snapshot.states.find(
        (entry) => entry.alias === "appmentoorg-env-v3-mentolabs.vercel.app",
      ).git.sha = "9".repeat(40);
    },
    "served-git-metadata-conflicting",
  ],
]) {
  test(`controller passes sanitized ${name} through to target-local fail-closed planning`, () => {
    const snapshot = planningSnapshot();
    mutate(snapshot);
    const result = createMainDeploymentPlan({
      mode: MAIN_DEPLOYMENT_MODE,
      deploySha: SHA,
      projectIds,
      planningSnapshot: snapshot,
      legacySnapshot: legacySnapshot(),
      upstream: upstream(),
      gitAdapter: gitAdapter(),
      runPlanner: ({ base, head }) => ({
        base,
        head,
        deployments: [],
        reason: "non-runtime-only",
      }),
    });
    assert.deepEqual(result.planning.plan, ["app"]);
    assert.equal(result.planning.reasons[0].reason, reason);
  });
}

test("workflow context and source proof bind the default-branch definition to DEPLOY_SHA", () => {
  assert.equal(
    validateMainWorkflowContext({
      repository: "mento-protocol/frontend-monorepo",
      eventName: "workflow_run",
      workflowRef:
        "mento-protocol/frontend-monorepo/.github/workflows/vercel-main-deployment.yml@refs/heads/main",
      workflowSha: SHA,
      deploySha: SHA,
    }),
    SHA,
  );
  assert.throws(
    () =>
      validateMainWorkflowContext({
        repository: "mento-protocol/frontend-monorepo",
        eventName: "workflow_run",
        workflowRef:
          "mento-protocol/frontend-monorepo/.github/workflows/vercel-main-deployment.yml@refs/pull/522/merge",
        workflowSha: SHA,
        deploySha: SHA,
      }),
    /not the exact DEPLOY_SHA/,
  );

  const calls = [];
  validateMainDeploymentSource({
    repoRoot: "/trusted/source",
    deploySha: SHA,
    workflowSha: SHA,
    execute(command, args) {
      calls.push([command, args]);
      const gitArgs = args.slice(2);
      if (gitArgs[0] === "rev-parse") return `${SHA}\n`;
      return "";
    },
  });
  assert.ok(calls.some(([, args]) => args[2] === "merge-base"));
  assert.throws(
    () =>
      validateMainDeploymentSource({
        repoRoot: "/trusted/source",
        deploySha: SHA,
        workflowSha: OTHER_SHA,
        execute: () => assert.fail("git must stay inert"),
      }),
    /GITHUB_WORKFLOW_SHA/,
  );
});

test("stage handoffs contain only canonical candidate identity and completed verification", () => {
  const result = stageResult("governance");
  assert.equal(result.schema, MAIN_STAGE_SCHEMA);
  assert.equal(result.target, "governance");
  assert.equal(result.candidate.deploymentId, "dpl_governanceCandidate123");
  assert.equal(result.candidate.discovery, null);
  assert.equal(result.verification.immutableSmoke, "passed");
  assert.deepEqual(
    assertMainStageResult(result, {
      plan: plan(),
      expectedTarget: "governance",
    }),
    result,
  );
  assert.throws(
    () =>
      createMainStageResult({
        target: "governance",
        plan: plan(),
        state: stagedState("governance"),
        runId: "800",
        runAttempt: "3",
        smokePassed: false,
        protectedMappingsUnchanged: true,
      }),
    /verification is incomplete/,
  );
});

test("selected stages must succeed and unselected stages must be skipped", () => {
  const selected = plan({ deployments: ["governance"] });
  assert.equal(
    validateMainStageJobs({
      plan: selected,
      jobs: stageJobs(selected),
      runId: "800",
      runAttempt: "3",
    }).outcome,
    "eligible",
  );
  assert.throws(
    () =>
      validateMainStageJobs({
        plan: selected,
        runId: "800",
        runAttempt: "3",
        jobs: {
          ...stageJobs(selected),
          governance: { result: "skipped", handoff: null },
        },
      }),
    /did not succeed/,
  );
  assert.throws(
    () =>
      validateMainStageJobs({
        plan: selected,
        runId: "800",
        runAttempt: "3",
        jobs: {
          ...stageJobs(selected),
          reserve: {
            result: "success",
            handoff: stageResult("reserve", plan()),
          },
        },
      }),
    /was not cleanly skipped/,
  );
  const noTargets = plan({ deployments: [] });
  assert.equal(
    validateMainStageJobs({
      plan: noTargets,
      jobs: stageJobs(noTargets),
      runId: "800",
      runAttempt: "3",
    }).outcome,
    "no-target",
  );
});

test("protected rollback identity remains stable while ordinary generated aliases move", () => {
  const legacyAliases = [
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
    "v2-app.mento.org",
  ];
  const deploymentPlanWithGeneratedLegacyAlias = plan({ legacyAliases });
  assert.deepEqual(deploymentPlanWithGeneratedLegacyAlias.legacyPrior.aliases, [
    "v2-app.mento.org",
  ]);
  for (const aliases of [
    // Missing protected, branch, scope, or project-default aliases.
    ...legacyAliases.map((missing) =>
      legacyAliases.filter((alias) => alias !== missing),
    ),
    // Wrong project, branch, scope, project default, or DNS suffix.
    legacyAliases.map((alias) =>
      alias === "appmentoorg-git-v2-mentolabs.vercel.app"
        ? "otherproject-git-v2-mentolabs.vercel.app"
        : alias,
    ),
    legacyAliases.map((alias) =>
      alias === "appmentoorg-git-v2-mentolabs.vercel.app"
        ? "appmentoorg-git-main-mentolabs.vercel.app"
        : alias,
    ),
    legacyAliases.map((alias) =>
      alias === "appmentoorg-mentolabs.vercel.app"
        ? "appmentoorg-other.vercel.app"
        : alias,
    ),
    legacyAliases.map((alias) =>
      alias === "appmentoorg.vercel.app" ? "appmento.vercel.app" : alias,
    ),
    legacyAliases.map((alias) =>
      alias === "appmentoorg.vercel.app"
        ? "appmentoorg.vercel.app.attacker.example"
        : alias,
    ),
    // Creator aliases and immutable deployment hosts are not API aliases.
    [...legacyAliases, "appmentoorg-chapati-mentolabs.vercel.app"],
    [
      "appmento-jbhj7crjl-mentolabs.vercel.app",
      "appmentoorg-git-v2-mentolabs.vercel.app",
      "appmentoorg-mentolabs.vercel.app",
      "v2-app.mento.org",
    ],
  ]) {
    assert.throws(
      () => plan({ legacyAliases: aliases.toSorted() }),
      /Legacy app generated-alias topology mismatch/,
    );
  }
  const deploymentPlan = plan();
  assert.deepEqual(
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: planningSnapshot(),
      legacySnapshot: legacySnapshot(),
    }),
    {
      protectedSnapshot: deploymentPlan.protectedSnapshot,
      legacySnapshot: deploymentPlan.legacySnapshot,
    },
  );
  const drifted = structuredClone(planningSnapshot());
  drifted.states[0].deploymentId = "dpl_operatorMove123";
  assert.throws(
    () =>
      assertProtectedSnapshotMatchesPlan({
        plan: deploymentPlan,
        planningSnapshot: drifted,
        legacySnapshot: legacySnapshot(),
      }),
    /drifted/,
  );
  for (const mutate of [
    (snapshot) => {
      snapshot.states[0].deploymentUrl = "https://operator-move.vercel.app";
    },
    (snapshot) => {
      snapshot.states[0].projectId = "prj_operator123";
    },
    (snapshot) => {
      snapshot.states[0].customEnvironmentSlug = "other";
    },
    (snapshot) => {
      snapshot.states[0].aliases = ["appmentoorg-env-v3-mentolabs.vercel.app"];
    },
  ]) {
    const changed = structuredClone(planningSnapshot());
    mutate(changed);
    assert.throws(() =>
      assertProtectedSnapshotMatchesPlan({
        plan: deploymentPlan,
        planningSnapshot: changed,
        legacySnapshot: legacySnapshot(),
      }),
    );
  }
  const refreshedGitEvidence = structuredClone(planningSnapshot());
  refreshedGitEvidence.states[0].git = null;
  assert.doesNotThrow(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: refreshedGitEvidence,
      legacySnapshot: legacySnapshot(),
    }),
  );
  const ordinaryGeneratedAliasesMoved = structuredClone(planningSnapshot());
  const governance = ordinaryGeneratedAliasesMoved.states.find(
    (state) => state.alias === "governance.mento.org",
  );
  governance.aliases = ["governance.mento.org"];
  governance.creatorUsername = null;
  assert.doesNotThrow(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: ordinaryGeneratedAliasesMoved,
      legacySnapshot: legacySnapshot(),
    }),
  );
  const legacyGeneratedAliases = structuredClone(legacySnapshot());
  legacyGeneratedAliases[0].aliases = legacyAliases;
  assert.doesNotThrow(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlanWithGeneratedLegacyAlias,
      planningSnapshot: planningSnapshot(),
      legacySnapshot: legacyGeneratedAliases,
    }),
  );
  const missingLegacyAlias = structuredClone(legacySnapshot());
  missingLegacyAlias[0].aliases = [
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
  ];
  assert.throws(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: planningSnapshot(),
      legacySnapshot: missingLegacyAlias,
    }),
  );
  for (const mutate of [
    (state) => {
      state.deploymentId = "dpl_operatorMove123";
    },
    (state) => {
      state.aliases = [
        "appmentoorg-git-v2-other.vercel.app",
        "appmentoorg-mentolabs.vercel.app",
        "appmentoorg.vercel.app",
        "v2-app.mento.org",
      ];
    },
  ]) {
    const changed = structuredClone(legacyGeneratedAliases);
    mutate(changed[0]);
    assert.throws(() =>
      assertProtectedSnapshotMatchesPlan({
        plan: deploymentPlanWithGeneratedLegacyAlias,
        planningSnapshot: planningSnapshot(),
        legacySnapshot: changed,
      }),
    );
  }
  for (const mutate of [
    (state) => {
      state.deploymentId = "dpl_operatorMove123";
    },
    (state) => {
      state.deploymentUrl = "https://operator-move.vercel.app";
    },
    (state) => {
      state.projectId = "prj_operator123";
    },
    (state) => {
      state.customEnvironmentSlug = "unexpected";
    },
    (state) => {
      state.alias = "governance-other.mento.org";
    },
  ]) {
    const changed = structuredClone(planningSnapshot());
    const state = changed.states.find(
      (entry) => entry.alias === "governance.mento.org",
    );
    mutate(state);
    assert.throws(() =>
      assertProtectedSnapshotMatchesPlan({
        plan: deploymentPlan,
        planningSnapshot: changed,
        legacySnapshot: legacySnapshot(),
      }),
    );
  }
  for (const sanitizedGit of [null, {}]) {
    const captured = planningSnapshot();
    for (const state of captured.states.filter((entry) =>
      entry.alias.startsWith("app"),
    )) {
      state.git = sanitizedGit;
    }
    const ambiguityPlan = createMainDeploymentPlan({
      mode: MAIN_DEPLOYMENT_MODE,
      deploySha: SHA,
      projectIds,
      planningSnapshot: captured,
      legacySnapshot: legacySnapshot(),
      upstream: upstream(),
      gitAdapter: gitAdapter(),
      runPlanner: ({ base, head }) => ({
        base,
        head,
        deployments: [],
        reason: "non-runtime-only",
      }),
    });
    assert.doesNotThrow(() =>
      assertProtectedSnapshotMatchesPlan({
        plan: ambiguityPlan,
        planningSnapshot: planningSnapshot(),
        legacySnapshot: legacySnapshot(),
      }),
    );
  }
});

test("remote-main freshness uses one bounded exact ls-remote ref", () => {
  const calls = [];
  assert.equal(
    readRemoteMainSha({
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout: `${SHA}\trefs/heads/main\n`,
        };
      },
    }),
    SHA,
  );
  assert.deepEqual(calls[0].args, [
    "ls-remote",
    "--exit-code",
    "origin",
    "refs/heads/main",
  ]);
  assert.deepEqual(
    classifyRemoteMainFreshness({ deploySha: SHA, remoteSha: SHA }),
    {
      status: "fresh",
      sha: SHA,
    },
  );
  assert.equal(
    classifyRemoteMainFreshness({ deploySha: SHA, remoteSha: OTHER_SHA })
      .status,
    "superseded",
  );
  assert.throws(
    () =>
      readRemoteMainSha({
        attempts: 3,
        spawn: () => ({ status: 1, stdout: "" }),
      }),
    /could not be proven/,
  );
});

test("legacy generated-alias topology mismatch is a copy-safe diagnostic", () => {
  const legacy = legacySnapshot();
  legacy[0].aliases = [
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg-unexpected-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
    "v2-app.mento.org",
  ].sort();
  let error;
  try {
    createMainDeploymentPlan({
      mode: MAIN_DEPLOYMENT_MODE,
      deploySha: SHA,
      projectIds,
      planningSnapshot: planningSnapshot(),
      legacySnapshot: legacy,
      upstream: upstream(),
      gitAdapter: gitAdapter(),
      runPlanner: ({ base, head }) => ({
        base,
        head,
        deployments: ["app"],
        reason: "affected-packages",
      }),
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error);
  assert.equal(
    error.message,
    'Legacy app generated-alias topology mismatch: {"actualAliases":["appmentoorg-git-v2-mentolabs.vercel.app","appmentoorg-mentolabs.vercel.app","appmentoorg-unexpected-mentolabs.vercel.app","appmentoorg.vercel.app","v2-app.mento.org"],"creatorUsername":"chapati","expectedAliasTopologies":[["appmentoorg-git-v2-mentolabs.vercel.app","appmentoorg-mentolabs.vercel.app","appmentoorg.vercel.app","v2-app.mento.org"]]}',
  );
  for (const rawValue of [
    "dpl_legacyV2123",
    "https://appmento-jbhj7crjl-mentolabs.vercel.app",
    projectIds.app,
    "9999999999999999999999999999999999999999",
  ]) {
    assert.doesNotMatch(error.message, new RegExp(rawValue));
  }

  const alternateCreator = legacySnapshot();
  alternateCreator[0].creatorUsername = "other-author";
  assert.doesNotThrow(() =>
    createMainDeploymentPlan({
      mode: MAIN_DEPLOYMENT_MODE,
      deploySha: SHA,
      projectIds,
      planningSnapshot: planningSnapshot(),
      legacySnapshot: alternateCreator,
      upstream: upstream(),
      gitAdapter: gitAdapter(),
      runPlanner: ({ base, head }) => ({
        base,
        head,
        deployments: ["app"],
        reason: "affected-packages",
      }),
    }),
  );

  const wrongProject = legacySnapshot();
  wrongProject[0].projectId = "prj_wrongProject123";
  assert.throws(
    () =>
      createMainDeploymentPlan({
        mode: MAIN_DEPLOYMENT_MODE,
        deploySha: SHA,
        projectIds,
        planningSnapshot: planningSnapshot(),
        legacySnapshot: wrongProject,
        upstream: upstream(),
        gitAdapter: gitAdapter(),
        runPlanner: ({ base, head }) => ({
          base,
          head,
          deployments: ["app"],
          reason: "affected-packages",
        }),
      }),
    /Legacy app rollback state is ambiguous/,
  );
});

test("transaction inputs preserve ordered priors and make app build-only discovery explicit", () => {
  const deploymentPlan = plan();
  const inputs = createMainTransactionInputs({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(Object.keys(inputs.prior), [
    "app",
    "governance",
    "reserve",
    "ui",
    "legacy-app",
  ]);
  assert.deepEqual(Object.keys(inputs.candidates), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(inputs.candidates.app.deploymentId, null);
  assert.equal(inputs.candidates.app.discovery.customEnvironmentSlug, "v3");
  assert.equal(
    inputs.candidates.app.discovery.transactionId,
    createMainTransactionId(inputs.identity),
  );
  assert.deepEqual(
    appProof().metadata,
    createMainAppTransactionMetadata({
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
      transactionId: inputs.candidates.app.discovery.transactionId,
      nextDeploymentId: appProof().nextDeploymentId,
    }),
  );
  assert.equal(appProof().deployReachable, false);
  assert.equal(appProof().sentryAuthToken, "");
  assert.throws(
    () =>
      createMainTransactionInputs({
        plan: deploymentPlan,
        stageJobs: stageJobs(deploymentPlan),
        appBuildProof: {
          ...appProof(),
          deployReachable: true,
        },
        runId: "800",
        runAttempt: "3",
      }),
    /build proof is invalid/,
  );
  for (const transactionKey of ["999-3-governance", "800-4-governance"]) {
    const staleJobs = structuredClone(stageJobs(deploymentPlan));
    staleJobs.governance.handoff.transactionKey = transactionKey;
    assert.throws(
      () =>
        createMainTransactionInputs({
          plan: deploymentPlan,
          stageJobs: staleJobs,
          appBuildProof: appProof(),
          runId: "800",
          runAttempt: "3",
        }),
      /does not match the coordinator attempt/,
    );
  }
});

test("prepared artifact acknowledgment binds positive artifact ID, exact name, and exact bytes", () => {
  const deploymentPlan = plan();
  const journal = createPreparedMainJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  const bytes = `${JSON.stringify(journal)}\n`;
  const artifactName = mainTransactionJournalArtifactName(journal);
  assert.deepEqual(
    createMainAppCandidateExpectation({
      journal,
      projectId: projectIds.app,
    }),
    {
      projectId: projectIds.app,
      projectName: "app.mento.org",
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
      transactionId: journal.transactionId,
      customEnvironmentSlug: "v3",
      nextDeploymentId: appProof().nextDeploymentId,
    },
  );
  assert.deepEqual(
    assertUploadedPreparedJournal({
      journal,
      journalBytes: bytes,
      artifactName,
      artifactId: "98123",
    }),
    {
      acknowledged: true,
      artifactName,
      artifactId: "98123",
    },
  );
  for (const override of [
    { journalBytes: `${JSON.stringify({ ...journal, status: "started" })}\n` },
    { artifactName: `${artifactName}-other` },
    { artifactId: "0" },
  ]) {
    assert.throws(
      () =>
        assertUploadedPreparedJournal({
          journal,
          journalBytes: bytes,
          artifactName,
          artifactId: "98123",
          ...override,
        }),
      /does not acknowledge these exact bytes/,
    );
  }
});

test("shadow transaction exercises freshness, journal acknowledgment, and recovery decision without mutations", async () => {
  const deploymentPlan = plan();
  const journal = createPreparedMainJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  const result = await runMainShadowTransaction({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
    journalBytes: `${JSON.stringify(journal)}\n`,
    artifactName: mainTransactionJournalArtifactName(journal),
    artifactId: "91919",
    readRemoteMain: () => SHA,
  });
  assert.equal(result.outcome, "shadow-prepared");
  assert.equal(result.mutationCallbacksCalled, 0);
  assert.equal(result.recoveryDecision.decision, "verify-only");

  const stale = await runMainShadowTransaction({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
    journalBytes: `${JSON.stringify(journal)}\n`,
    artifactName: mainTransactionJournalArtifactName(journal),
    artifactId: "91919",
    readRemoteMain: () => OTHER_SHA,
  });
  assert.equal(stale.outcome, "superseded-after-journal");
  assert.deepEqual(stale.journal, journal);
  assert.equal(
    recoverMainShadowTransaction({
      journal: stale.journal,
      expectedIdentity: {
        repository: "mento-protocol/frontend-monorepo",
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
      },
    }).outcome,
    "verified-no-mutation",
  );
});

test("shadow recovery remains verify-only and final sentinel accepts only safe PR A outcomes", () => {
  const deploymentPlan = plan();
  const journal = createPreparedMainJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  const recovery = recoverMainShadowTransaction({
    journal,
    expectedIdentity: {
      repository: "mento-protocol/frontend-monorepo",
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
    },
  });
  assert.equal(recovery.outcome, "verified-no-mutation");
  assert.equal(recovery.decision, "verify-only");

  assert.deepEqual(
    assertMainFinalResults({
      plan: deploymentPlan,
      jobs: {
        waitForCi: "success",
        plan: "success",
        stageGovernance: "success",
        stageReserve: "success",
        stageUi: "success",
        coordinator: "success",
        recovery: "success",
      },
      coordinatorOutcome: "shadow-prepared",
      recoveryOutcome: "verified-no-mutation",
    }),
    { outcome: "shadow-prepared" },
  );
  assert.throws(
    () =>
      assertMainFinalResults({
        plan: deploymentPlan,
        jobs: {
          waitForCi: "success",
          plan: "success",
          stageGovernance: "success",
          stageReserve: "success",
          stageUi: "failure",
          coordinator: "success",
          recovery: "success",
        },
        coordinatorOutcome: "shadow-prepared",
        recoveryOutcome: "verified-no-mutation",
      }),
    /did not succeed|invalid for ui/,
  );
  assert.deepEqual(
    assertMainFinalResults({
      plan: deploymentPlan,
      jobs: {
        waitForCi: "success",
        plan: "success",
        stageGovernance: "success",
        stageReserve: "success",
        stageUi: "success",
        coordinator: "success",
        recovery: "success",
      },
      coordinatorOutcome: "superseded-after-journal",
      recoveryOutcome: "verified-no-mutation",
    }),
    { outcome: "superseded-after-journal" },
  );
  assert.throws(
    () =>
      assertMainFinalResults({
        plan: deploymentPlan,
        jobs: {
          waitForCi: "success",
          plan: "success",
          stageGovernance: "success",
          stageReserve: "success",
          stageUi: "success",
          coordinator: "success",
          recovery: "success",
        },
        coordinatorOutcome: "superseded-after-journal",
        recoveryOutcome: "not-required",
      }),
    /not recovery-verified/,
  );
});
