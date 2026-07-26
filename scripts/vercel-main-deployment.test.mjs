import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createActiveDeploymentStateProof } from "./vercel-deployment-state.mjs";
import {
  MAIN_ACTIVE_DEPLOYMENT_MODE,
  MAIN_ACTIVE_EVIDENCE_SCHEMA,
  MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
  MAIN_DEPLOYMENT_MODE,
  MAIN_DEPLOYMENT_SCHEMA,
  MAIN_FAILURE_EVIDENCE_SCHEMA,
  MAIN_OWNERSHIP_MODES,
  MAIN_STAGE_SCHEMA,
  assertMainActiveJournalHistory,
  assertMainDeploymentHandoff,
  assertMainFinalResults,
  assertMainStageResult,
  assertProtectedSnapshotMatchesPlan,
  assertUploadedPreparedJournal,
  classifyRemoteMainFreshness,
  createMainAppBuildProof,
  createMainAppCandidateExpectation,
  createMainAppTransactionMetadata,
  createMainActiveDeploymentEvidence,
  createMainActiveFreshness,
  createMainActiveAliasMappingSet,
  createMainActiveDeploymentStateSpec,
  createMainActiveDeploymentFailureEvidence,
  createMainActiveJournalHistoryIdentity,
  createMainActivePlanning,
  createMainActivePublicSmokes,
  createMainActiveTransactionInputs,
  createMainDeploymentPlan,
  createMainDeploymentEvidence,
  createMainDeploymentFailureEvidence,
  createMainJournalArtifactIdentity,
  createMainWorkflowRunUrl,
  createMainLegacyAliasSpec,
  createMainProtectedAliasSpec,
  createMainStageResult,
  createMainTransactionInputs,
  createPreparedMainActiveJournal,
  createPreparedMainJournal,
  evaluateMainActiveFinalResults,
  parseMainDeploymentArguments,
  planMainActiveRecovery,
  readRemoteMainSha,
  recoverMainShadowTransaction,
  renderMainActiveDeploymentEvidence,
  renderMainActiveDeploymentFailureEvidence,
  renderMainDeploymentEvidence,
  renderMainDeploymentFailureEvidence,
  runMainActiveRecovery,
  runMainActiveTransaction,
  runMainDeploymentCli,
  runMainShadowTransaction,
  validateMainDeploymentSource,
  validateMainStageJobs,
  validateMainWorkflowContext,
} from "./vercel-main-deployment.mjs";
import {
  attachDiscoveredAppCandidate,
  classifyMainTransactionMapping,
  createMainTransactionId,
  mainTransactionJournalArtifactName,
  startMainTransactionOperation,
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
  mode = MAIN_DEPLOYMENT_MODE,
  mainOwnershipMode = Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      mode === MAIN_ACTIVE_DEPLOYMENT_MODE
        ? MAIN_OWNERSHIP_MODES.GITHUB
        : MAIN_OWNERSHIP_MODES.SHADOW,
    ]),
  ),
} = {}) {
  return createMainDeploymentPlan({
    mode,
    mainOwnershipMode,
    deploySha: SHA,
    projectIds,
    planningSnapshot: planningSnapshot(),
    legacySnapshot: legacySnapshot(),
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

function activePlan(options = {}) {
  return plan({ ...options, mode: MAIN_ACTIVE_DEPLOYMENT_MODE });
}

function ownership(overrides = {}) {
  return {
    app: MAIN_OWNERSHIP_MODES.GITHUB,
    governance: MAIN_OWNERSHIP_MODES.GITHUB,
    reserve: MAIN_OWNERSHIP_MODES.GITHUB,
    ui: MAIN_OWNERSHIP_MODES.GITHUB,
    ...overrides,
  };
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
      const selected = deploymentPlan.planning.stagedTargets.includes(target);
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

function mapping(alias, deployment) {
  return {
    alias,
    deploymentId: deployment.deploymentId,
    deploymentUrl: deployment.deploymentUrl,
  };
}

function activeHarness({
  deploymentPlan = null,
  ownershipMap = ownership(),
  appAliasesMovedByDeploy = [],
} = {}) {
  const reviewedPlan =
    deploymentPlan ?? activePlan({ mainOwnershipMode: ownershipMap });
  const inputs = createMainActiveTransactionInputs({
    plan: reviewedPlan,
    stageJobs: stageJobs(reviewedPlan),
    appBuildProof: reviewedPlan.planning.stagedTargets.includes("app")
      ? appProof()
      : null,
    runId: "800",
    runAttempt: "3",
  });
  const mappings = new Map(
    Object.values(inputs.prior).flatMap((record) =>
      record.aliases.map((alias) => [alias, mapping(alias, record)]),
    ),
  );
  const journalHistory = [];
  let appDeployed = false;
  const appCandidate =
    inputs.candidates.app === null
      ? null
      : {
          deploymentId: "dpl_appCandidate123",
          deploymentUrl: "https://app-candidate.vercel.app",
          ...inputs.candidates.app.discovery,
        };
  const appCandidateMapping =
    appCandidate === null
      ? null
      : {
          ...appCandidate,
          aliases: [...inputs.prior.app.aliases],
        };
  const candidateFor = (target) =>
    target === "app" ? appCandidateMapping : inputs.candidates[target];
  const mappingState = (context) => {
    const operation = context.operation ?? context.intent;
    if (operation.type === "app_v3_deploy") {
      return appDeployed ? "candidate" : "prior";
    }
    const aliases = operation.alias
      ? [operation.alias]
      : inputs.prior[operation.target].aliases;
    return classifyMainTransactionMapping({
      aliases,
      currentMappings: aliases.map((alias) => mappings.get(alias)),
      prior: inputs.prior[operation.target],
      candidate: candidateFor(operation.target),
    });
  };
  const adapters = {
    assertFreshness: async () => ({ sha: SHA }),
    uploadJournal: async ({ artifactName, journal }) => {
      journalHistory.push(structuredClone(journal));
      return {
        acknowledged: true,
        artifactName,
        artifactId: String(5000 + journal.sequence),
      };
    },
    promote: async ({ operation }) => {
      for (const alias of inputs.prior[operation.target].aliases) {
        mappings.set(
          alias,
          mapping(alias, inputs.candidates[operation.target]),
        );
      }
      return { outcome: "success" };
    },
    deployAppV3: async () => {
      appDeployed = true;
      for (const alias of appAliasesMovedByDeploy) {
        mappings.set(alias, mapping(alias, appCandidate));
      }
      return { outcome: "success", candidate: appCandidate };
    },
    assignAlias: async ({ operation }) => {
      mappings.set(operation.alias, mapping(operation.alias, appCandidate));
      return { outcome: "success" };
    },
    inspectMapping: async (context) => ({
      mappingState: mappingState(context),
    }),
    verifyMapping: async (context) => ({
      mappingState: mappingState(context),
    }),
    inspectProtectedMappings: async () => ({
      currentMappings: [...mappings.values()],
    }),
  };
  return {
    adapters,
    appBuildProof: reviewedPlan.planning.stagedTargets.includes("app")
      ? appProof()
      : null,
    inputs,
    journalHistory,
    mappings,
    ownershipMap,
    plan: reviewedPlan,
    stageJobs: stageJobs(reviewedPlan),
  };
}

function activeFinalMappings(harness) {
  return [...harness.mappings.values()];
}

function activePublicSmokes(planning) {
  const urls = {
    app: "https://app.mento.org/",
    governance: "https://governance.mento.org/",
    reserve: "https://reserve.mento.org/",
    ui: "https://ui.mento.org/",
  };
  return Object.fromEntries(
    Object.keys(urls).map((target) => [
      target,
      planning.activeTargets.includes(target)
        ? { publicUrl: urls[target], servedSha: SHA, status: "passed" }
        : { publicUrl: urls[target], servedSha: null, status: "not-required" },
    ]),
  );
}

function activeStateProof({
  deploymentPlan,
  journalHistory,
  jobs,
  runId,
  runAttempt,
}) {
  const spec = createMainActiveDeploymentStateSpec({
    plan: deploymentPlan,
    journalHistory,
    stageJobs: jobs,
    runId,
    runAttempt,
  });
  const deployments = Object.fromEntries(
    Object.entries(spec.projects).map(([target, project]) => {
      if (project.deploymentId === null) return [target, []];
      return [
        target,
        [
          {
            deploymentId: project.deploymentId,
            response: {
              id: project.deploymentId,
              url: project.deploymentUrl,
              projectId: project.projectId,
              name: project.projectName,
              readyState: "READY",
              target: project.target,
              customEnvironment:
                project.customEnvironmentSlug === null
                  ? null
                  : { slug: project.customEnvironmentSlug },
              source: "cli",
              meta: {
                githubCommitOrg: "mento-protocol",
                githubCommitRepo: "frontend-monorepo",
                githubCommitRef: "main",
                githubCommitSha: spec.deploySha,
                ...(target === "app"
                  ? {
                      mentoTransactionId: spec.transactionId,
                      mentoRunId: spec.runId,
                      mentoRunAttempt: spec.runAttempt,
                      mentoNextDeploymentId: "nextBuild123",
                    }
                  : {
                      mentoTransaction: `${spec.runId}-${spec.runAttempt}-${target}`,
                    }),
              },
              git: {
                org: "mento-protocol",
                repo: "frontend-monorepo",
                ref: "main",
                sha: spec.deploySha,
              },
            },
          },
        ],
      ];
    }),
  );
  return createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: {
      source: "git",
      state: {
        alias: spec.legacyAppV2.alias,
        deploymentId: spec.legacyAppV2.deployment,
        deploymentUrl: spec.legacyAppV2.deploymentUrl,
        creatorUsername: null,
        projectId: spec.legacyAppV2.projectId,
        projectName: spec.legacyAppV2.projectName,
        readyState: "READY",
        target: "production",
        customEnvironmentSlug: null,
        git: { ...spec.legacyAppV2.git },
        aliases: [spec.legacyAppV2.alias],
      },
    },
  });
}

function activeJobs(deploymentPlan, overrides = {}) {
  return {
    waitForCi: "success",
    plan: "success",
    stageGovernance: deploymentPlan.planning.stagedTargets.includes(
      "governance",
    )
      ? "success"
      : "skipped",
    stageReserve: deploymentPlan.planning.stagedTargets.includes("reserve")
      ? "success"
      : "skipped",
    stageUi: deploymentPlan.planning.stagedTargets.includes("ui")
      ? "success"
      : "skipped",
    coordinator: "success",
    recovery: "success",
    ...overrides,
  };
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
    ["active-journal-identity"],
    ["active-freshness", "--output", "/tmp/freshness.json"],
    [
      "active-journal-receipt",
      "--artifact-id",
      "123",
      "--artifact-name",
      "artifact",
      "--journal",
      "/tmp/journal.json",
      "--output",
      "/tmp/receipt.json",
    ],
    ["active-event-initialize", "--output", "/tmp/event.json"],
    [
      "active-command-descriptor",
      "--authorization",
      "/tmp/authorization.json",
      "--output",
      "/tmp/command.json",
    ],
    ["active-app-candidate-matches-none", "--output", "/tmp/matches.json"],
    [
      "active-app-candidate-matches-one",
      "--candidate",
      "/tmp/candidate.json",
      "--output",
      "/tmp/matches.json",
    ],
    [
      "active-app-deployment",
      "--state",
      "/tmp/state.json",
      "--output",
      "/tmp/deployment.json",
    ],
    ...["dispatch", "authorize"].map((kind) => [
      `active-event-${kind}`,
      "--current-mappings",
      "/tmp/mappings.json",
      "--freshness",
      "/tmp/freshness.json",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
    ]),
    [
      "active-event-command-returned",
      "--authorization",
      "/tmp/authorization.json",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
      "--result",
      "/tmp/result.json",
    ],
    [
      "active-event-verify",
      "--authorization",
      "/tmp/authorization.json",
      "--current-mappings",
      "/tmp/mappings.json",
      "--freshness",
      "/tmp/freshness.json",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
    ],
    [
      "active-event-verify-app",
      "--app-candidate-matches",
      "/tmp/matches.json",
      "--app-deployment",
      "/tmp/deployment.json",
      "--authorization",
      "/tmp/authorization.json",
      "--current-mappings",
      "/tmp/mappings.json",
      "--freshness",
      "/tmp/freshness.json",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
    ],
    [
      "active-event-finalize",
      "--current-mappings",
      "/tmp/mappings.json",
      "--freshness",
      "/tmp/freshness.json",
      "--output",
      "/tmp/event.json",
      "--public-smokes",
      "/tmp/smokes.json",
      "--receipt",
      "/tmp/receipt.json",
      "--state-proof",
      "/tmp/state-proof.json",
    ],
    [
      "active-recovery-event-initialize",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
    ],
    ...["dispatch", "authorize", "verify"].map((kind) => [
      `active-recovery-event-${kind}`,
      "--current-mappings",
      "/tmp/mappings.json",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
    ]),
    [
      "active-recovery-event-command-returned",
      "--authorization",
      "/tmp/authorization.json",
      "--output",
      "/tmp/event.json",
      "--receipt",
      "/tmp/receipt.json",
      "--result",
      "/tmp/result.json",
    ],
    [
      "active-journal-history",
      "--artifacts",
      "/tmp/artifacts",
      "--output",
      "/tmp/history.json",
    ],
    [
      "active-state-spec",
      "--journal-history",
      "/tmp/history.json",
      "--output",
      "/tmp/state-spec.json",
    ],
    [
      "active-mapping-spec",
      "--journal-history",
      "/tmp/history.json",
      "--output",
      "/tmp/mapping-spec.json",
    ],
    [
      "active-public-smokes",
      "--app",
      "/tmp/app.json",
      "--governance",
      "/tmp/governance.json",
      "--output",
      "/tmp/smokes.json",
      "--reserve",
      "/tmp/reserve.json",
      "--ui",
      "/tmp/ui.json",
    ],
    [
      "active-public-smoke-target",
      "--output",
      "/tmp/app-smoke.json",
      "--served-sha",
      SHA,
      "--status",
      "passed",
      "--target",
      "app",
    ],
    [
      "run-active",
      "--event",
      "/tmp/event.json",
      "--journal-history",
      "/tmp/history.json",
      "--journal-output",
      "/tmp/journal.json",
      "--output",
      "/tmp/active.json",
    ],
    [
      "plan-active-recovery",
      "--journal-history",
      "/tmp/history.json",
      "--current-mappings",
      "/tmp/mappings.json",
      "--app-candidate-matches",
      "/tmp/app-matches.json",
      "--output",
      "/tmp/recovery-plan.json",
    ],
    [
      "run-active-recovery",
      "--event",
      "/tmp/recovery-event.json",
      "--journal-history",
      "/tmp/history.json",
      "--journal-output",
      "/tmp/recovery-journal.json",
      "--plan",
      "/tmp/recovery-plan.json",
      "--output",
      "/tmp/recovery.json",
    ],
    ["final-active"],
    [
      "active-evidence",
      "--journal-history",
      "/tmp/history.json",
      "--final-mappings",
      "/tmp/mappings.json",
      "--output",
      "/tmp/evidence.json",
      "--state-proof",
      "/tmp/state-proof.json",
    ],
    [
      "active-failure-evidence",
      "--journal-history",
      "/tmp/history.json",
      "--output",
      "/tmp/failure.json",
      "--state-proof",
      "/tmp/state-proof.json",
    ],
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

test("run-active CLI dispatches one reducer event and writes one optional journal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-active-cli-"));
  try {
    const reviewedPlan = activePlan({ deployments: ["governance"] });
    const jobs = stageJobs(reviewedPlan);
    const eventPath = join(directory, "event.json");
    const historyPath = join(directory, "history.json");
    const outputPath = join(directory, "transition.json");
    const journalPath = join(directory, "journal.json");
    const githubOutput = join(directory, "github-output.txt");
    await runMainDeploymentCli({
      argv: ["active-event-initialize", "--output", eventPath],
      values: {},
    });
    writeFileSync(historyPath, "[]\n");
    const result = await runMainDeploymentCli({
      argv: [
        "run-active",
        "--event",
        eventPath,
        "--journal-history",
        historyPath,
        "--journal-output",
        journalPath,
        "--output",
        outputPath,
      ],
      values: {
        PLAN_JSON: JSON.stringify(reviewedPlan),
        GITHUB_OUTPUT: githubOutput,
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        STAGE_GOVERNANCE_RESULT: jobs.governance.result,
        STAGE_GOVERNANCE_HANDOFF: JSON.stringify(jobs.governance.handoff),
        STAGE_RESERVE_RESULT: jobs.reserve.result,
        STAGE_RESERVE_HANDOFF: "",
        STAGE_UI_RESULT: jobs.ui.result,
        STAGE_UI_HANDOFF: "",
        VERCEL_PROJECT_ID_APP: projectIds.app,
        VERCEL_PROJECT_ID_GOVERNANCE: projectIds.governance,
        VERCEL_PROJECT_ID_RESERVE: projectIds.reserve,
        VERCEL_PROJECT_ID_UI: projectIds.ui,
      },
    });
    assert.equal(result.transitionKind, "journal");
    assert.equal(result.journal.sequence, 0);
    assert.equal(
      JSON.parse(readFileSync(journalPath, "utf8")).status,
      "prepared",
    );
    assert.equal(
      Object.hasOwn(JSON.parse(readFileSync(outputPath, "utf8")), "journal"),
      false,
    );
    assert.match(
      readFileSync(githubOutput, "utf8"),
      /transition_kind=journal[\s\S]*next_action=upload-journal/,
    );

    const receiptPath = join(directory, "receipt.json");
    await runMainDeploymentCli({
      argv: [
        "active-journal-receipt",
        "--artifact-id",
        "12345",
        "--artifact-name",
        mainTransactionJournalArtifactName(result.journal),
        "--journal",
        journalPath,
        "--output",
        receiptPath,
      ],
      values: { GITHUB_OUTPUT: githubOutput },
    });
    const mappingsPath = join(directory, "mappings.json");
    const freshnessPath = join(directory, "freshness.json");
    writeFileSync(
      freshnessPath,
      `${JSON.stringify(
        createMainActiveFreshness({ deploySha: SHA, observedSha: SHA }),
      )}\n`,
    );
    writeFileSync(
      mappingsPath,
      `${JSON.stringify(
        Object.values(result.journal.prior).flatMap((captured) =>
          captured.aliases.map((alias) => mapping(alias, captured)),
        ),
      )}\n`,
    );
    const dispatchEventPath = join(directory, "dispatch-event.json");
    await runMainDeploymentCli({
      argv: [
        "active-event-dispatch",
        "--current-mappings",
        mappingsPath,
        "--freshness",
        freshnessPath,
        "--output",
        dispatchEventPath,
        "--receipt",
        receiptPath,
      ],
      values: {},
    });
    writeFileSync(historyPath, `${JSON.stringify([result.journal])}\n`);
    const dispatchJournalPath = join(directory, "dispatch-journal.json");
    const dispatch = await runMainDeploymentCli({
      argv: [
        "run-active",
        "--event",
        dispatchEventPath,
        "--journal-history",
        historyPath,
        "--journal-output",
        dispatchJournalPath,
        "--output",
        join(directory, "dispatch-transition.json"),
      ],
      values: {
        PLAN_JSON: JSON.stringify(reviewedPlan),
        GITHUB_OUTPUT: githubOutput,
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        STAGE_GOVERNANCE_RESULT: jobs.governance.result,
        STAGE_GOVERNANCE_HANDOFF: JSON.stringify(jobs.governance.handoff),
        STAGE_RESERVE_RESULT: jobs.reserve.result,
        STAGE_RESERVE_HANDOFF: "",
        STAGE_UI_RESULT: jobs.ui.result,
        STAGE_UI_HANDOFF: "",
        VERCEL_PROJECT_ID_APP: projectIds.app,
        VERCEL_PROJECT_ID_GOVERNANCE: projectIds.governance,
        VERCEL_PROJECT_ID_RESERVE: projectIds.reserve,
        VERCEL_PROJECT_ID_UI: projectIds.ui,
      },
    });
    assert.equal(dispatch.journal.status, "started");
    assert.equal(dispatch.afterUploadAction, "authorize");
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
      mainOwnershipMode: ownership({
        app: MAIN_OWNERSHIP_MODES.SHADOW,
        governance: MAIN_OWNERSHIP_MODES.SHADOW,
        reserve: MAIN_OWNERSHIP_MODES.SHADOW,
        ui: MAIN_OWNERSHIP_MODES.SHADOW,
      }),
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
  const deploymentPlan = plan();
  const incompleteLegacyTopology = legacySnapshot();
  incompleteLegacyTopology[0].aliases = ["v2-app.mento.org"];
  assert.throws(
    () =>
      createMainDeploymentPlan({
        mode: MAIN_DEPLOYMENT_MODE,
        mainOwnershipMode: ownership({
          app: MAIN_OWNERSHIP_MODES.SHADOW,
          governance: MAIN_OWNERSHIP_MODES.SHADOW,
          reserve: MAIN_OWNERSHIP_MODES.SHADOW,
          ui: MAIN_OWNERSHIP_MODES.SHADOW,
        }),
        deploySha: SHA,
        projectIds,
        planningSnapshot: planningSnapshot(),
        legacySnapshot: incompleteLegacyTopology,
        upstream: upstream(),
        gitAdapter: gitAdapter(),
        runPlanner: ({ base, head }) => ({
          base,
          head,
          deployments: ["app"],
          reason: "affected-packages",
        }),
      }),
    /Legacy app generated-alias topology mismatch/,
  );
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
  const legacyAliasDrift = structuredClone(legacySnapshot());
  legacyAliasDrift[0].aliases = [
    "v2-app.mento.org",
    "unexpected-legacy-alias.vercel.app",
  ];
  assert.throws(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: planningSnapshot(),
      legacySnapshot: legacyAliasDrift,
    }),
  );
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
      mainOwnershipMode: ownership({
        app: MAIN_OWNERSHIP_MODES.SHADOW,
        governance: MAIN_OWNERSHIP_MODES.SHADOW,
        reserve: MAIN_OWNERSHIP_MODES.SHADOW,
        ui: MAIN_OWNERSHIP_MODES.SHADOW,
      }),
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

test("active planning stages shadow-owned targets without making them forward candidates", () => {
  const mainOwnershipMode = ownership({
    governance: MAIN_OWNERSHIP_MODES.SHADOW,
  });
  const deploymentPlan = activePlan({ mainOwnershipMode });
  const planning = createMainActivePlanning({
    plan: deploymentPlan,
  });
  assert.deepEqual(planning.stagedTargets, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(planning.activeTargets, ["app", "reserve", "ui"]);
  assert.deepEqual(planning.shadowTargets, ["governance"]);

  const inputs = createMainActiveTransactionInputs({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(inputs.candidates.governance, null);
  assert.notEqual(inputs.candidates.reserve, null);
  assert.deepEqual(
    createPreparedMainActiveJournal({
      plan: deploymentPlan,
      stageJobs: stageJobs(deploymentPlan),
      appBuildProof: appProof(),
      runId: "800",
      runAttempt: "3",
    }).candidates,
    inputs.candidates,
  );
  assert.throws(
    () =>
      createMainActivePlanning({
        plan: {
          ...deploymentPlan,
          planning: {
            ...deploymentPlan.planning,
            mainOwnershipMode: {
              ...mainOwnershipMode,
              app: "active",
            },
          },
        },
      }),
    /app main ownership mode must be github or shadow/,
  );
});

test("active state spec binds the highest journal and exact stage handoffs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-state-spec-"));
  try {
    const deploymentPlan = activePlan({
      mainOwnershipMode: ownership({
        reserve: MAIN_OWNERSHIP_MODES.SHADOW,
      }),
    });
    const jobs = stageJobs(deploymentPlan);
    const prepared = createPreparedMainActiveJournal({
      plan: deploymentPlan,
      stageJobs: jobs,
      appBuildProof: appProof(),
      runId: "800",
      runAttempt: "3",
    });
    const highest = attachDiscoveredAppCandidate(prepared, {
      deploymentId: "dpl_appCandidate123",
      deploymentUrl: "https://app-candidate.vercel.app",
      ...prepared.candidates.app.discovery,
    });
    const expected = createMainActiveDeploymentStateSpec({
      plan: deploymentPlan,
      journalHistory: [prepared, highest],
      stageJobs: jobs,
      runId: "800",
      runAttempt: "3",
    });
    assert.equal(expected.schema, "vercel-active-deployment-state-spec:v2");
    assert.deepEqual(expected.activeTargets, ["app", "governance", "ui"]);
    assert.deepEqual(expected.shadowTargets, ["reserve"]);
    assert.equal(expected.projects.app.deploymentId, "dpl_appCandidate123");
    assert.equal(
      expected.projects.reserve.deploymentId,
      jobs.reserve.handoff.candidate.deploymentId,
    );
    assert.equal(
      expected.projects.reserve.expectedDisposition,
      "githubShadowStage",
    );
    assert.equal(
      expected.legacyAppV2.deployment,
      deploymentPlan.legacySnapshot[0].deploymentId,
    );
    assert.deepEqual(
      createMainActiveAliasMappingSet({
        plan: deploymentPlan,
        journalHistory: [prepared, highest],
        runId: "800",
        runAttempt: "3",
      }).aliases,
      [
        "app.mento.org",
        "appmentoorg-env-v3-mentolabs.vercel.app",
        "governance.mento.org",
        "reserve.mento.org",
        "ui.mento.org",
        "v2-app.mento.org",
      ],
    );
    assert.throws(
      () =>
        createMainActiveDeploymentStateSpec({
          plan: deploymentPlan,
          journalHistory: [prepared],
          stageJobs: jobs,
          runId: "800",
          runAttempt: "3",
        }),
      /app candidate is incomplete or inconsistent/,
    );

    const journalHistoryPath = join(directory, "journal-history.json");
    const outputPath = join(directory, "state-spec.json");
    const githubOutput = join(directory, "github-output.txt");
    writeFileSync(
      journalHistoryPath,
      `${JSON.stringify([prepared, highest])}\n`,
    );
    const actual = await runMainDeploymentCli({
      argv: [
        "active-state-spec",
        "--journal-history",
        journalHistoryPath,
        "--output",
        outputPath,
      ],
      values: {
        PLAN_JSON: JSON.stringify(deploymentPlan),
        STAGE_GOVERNANCE_RESULT: jobs.governance.result,
        STAGE_GOVERNANCE_HANDOFF: JSON.stringify(jobs.governance.handoff),
        STAGE_RESERVE_RESULT: jobs.reserve.result,
        STAGE_RESERVE_HANDOFF: JSON.stringify(jobs.reserve.handoff),
        STAGE_UI_RESULT: jobs.ui.result,
        STAGE_UI_HANDOFF: JSON.stringify(jobs.ui.handoff),
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_OUTPUT: githubOutput,
      },
    });
    assert.deepEqual(actual, expected);
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), expected);
    assert.match(
      readFileSync(githubOutput, "utf8"),
      /transaction_id=main-[a-f0-9]{32}/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active public smoke materializer derives exact target records from the plan", () => {
  const deploymentPlan = activePlan({
    mainOwnershipMode: ownership({ reserve: MAIN_OWNERSHIP_MODES.SHADOW }),
  });
  const targetResults = Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      deploymentPlan.planning.activeTargets.includes(target)
        ? { status: "passed", servedSha: SHA }
        : { status: "not-required", servedSha: null },
    ]),
  );
  const smokes = createMainActivePublicSmokes({
    plan: deploymentPlan,
    targetResults,
  });
  assert.deepEqual(smokes.reserve, {
    publicUrl: "https://reserve.mento.org/",
    servedSha: null,
    status: "not-required",
  });
  assert.throws(
    () =>
      createMainActivePublicSmokes({
        plan: deploymentPlan,
        targetResults: {
          ...targetResults,
          reserve: { status: "passed", servedSha: SHA },
        },
      }),
    /reserve smoke result is inconsistent/,
  );
});

test("active controller commits exact ordered mutations and emits canonical redacted evidence", async () => {
  const harness = activeHarness();
  const result = await runMainActiveTransaction({
    plan: harness.plan,
    stageJobs: harness.stageJobs,
    appBuildProof: harness.appBuildProof,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: harness.adapters,
  });
  assert.equal(result.outcome, "active-committed");
  assert.equal(result.highestJournalStatus, "committed");
  assert.equal(result.publicServingMutationCommands, 6);
  assert.deepEqual(
    result.journal.operations
      .filter((operation) => operation.state === "verified")
      .map((operation) => [operation.type, operation.target, operation.alias]),
    [
      ["promote", "governance", null],
      ["promote", "reserve", null],
      ["promote", "ui", null],
      ["app_v3_deploy", "app", null],
      ["app_alias_set", "app", "app.mento.org"],
      ["app_alias_set", "app", "appmentoorg-env-v3-mentolabs.vercel.app"],
    ],
  );

  const evidence = createMainActiveDeploymentEvidence({
    plan: harness.plan,
    journalHistory: result.journalHistory,
    freshness: result.freshness,
    finalMappings: activeFinalMappings(harness),
    publicSmokes: activePublicSmokes(result),
    stateProof: activeStateProof({
      deploymentPlan: harness.plan,
      journal: result.journal,
      journalHistory: result.journalHistory,
      jobs: harness.stageJobs,
      runId: "800",
      runAttempt: "3",
    }),
    rollbackStateTargets: [],
    publicServingMutationCommands: result.publicServingMutationCommands,
    recoveryOutcome: "not-required",
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
  });
  assert.equal(evidence.schema, MAIN_ACTIVE_EVIDENCE_SCHEMA);
  assert.equal(evidence.journal.highestStatus, "committed");
  assert.equal(evidence.orderedVerifiedOperations.length, 6);
  assert.equal(evidence.finalMappings.length, 6);
  assert.equal(
    evidence.stateProofSummary.proofSchema,
    "vercel-active-deployment-state-proof:v2",
  );
  assert.deepEqual(evidence.recovery.rollbackStateTargets, []);
  assert.match(
    renderMainActiveDeploymentEvidence(evidence),
    /Public-serving mutation commands: `6`/,
  );
  assert.doesNotMatch(JSON.stringify(evidence), /token|cookie|environment/i);
  assert.throws(
    () =>
      createMainActiveDeploymentEvidence({
        plan: harness.plan,
        journalHistory: result.journalHistory,
        freshness: result.freshness,
        finalMappings: activeFinalMappings(harness),
        publicSmokes: {
          ...activePublicSmokes(result),
          app: {
            ...activePublicSmokes(result).app,
            token: "must-not-survive",
          },
        },
        stateProof: activeStateProof({
          deploymentPlan: harness.plan,
          journal: result.journal,
          journalHistory: result.journalHistory,
          jobs: harness.stageJobs,
          runId: "800",
          runAttempt: "3",
        }),
        rollbackStateTargets: [],
        publicServingMutationCommands: 6,
        recoveryOutcome: "not-required",
        runId: "800",
        runAttempt: "3",
        workflowRunUrl: WORKFLOW_RUN_URL,
      }),
    /forbidden or missing fields/,
  );
});

test("active App deployment safely skips zero, one, or two aliases it already moved", async () => {
  const appAliases = [
    "app.mento.org",
    "appmentoorg-env-v3-mentolabs.vercel.app",
  ];
  for (const [movedAliases, expectedCommands] of [
    [[], 6],
    [[appAliases[0]], 5],
    [appAliases, 4],
  ]) {
    const harness = activeHarness({ appAliasesMovedByDeploy: movedAliases });
    const result = await runMainActiveTransaction({
      plan: harness.plan,
      stageJobs: harness.stageJobs,
      appBuildProof: harness.appBuildProof,
      runId: "800",
      runAttempt: "3",
      journalHistory: [],
      adapters: harness.adapters,
    });
    assert.equal(result.outcome, "active-committed");
    assert.equal(result.publicServingMutationCommands, expectedCommands);
    assert.equal(
      result.journal.operations.filter(
        (operation) =>
          operation.type === "app_alias_set" && operation.state === "verified",
      ).length,
      appAliases.length - movedAliases.length,
      `moved aliases: ${movedAliases.length}`,
    );
  }
});

test("active controller keeps mixed shadow targets out of public mutation and evidence", async () => {
  const harness = activeHarness({
    ownershipMap: ownership({
      governance: MAIN_OWNERSHIP_MODES.SHADOW,
    }),
  });
  const result = await runMainActiveTransaction({
    plan: harness.plan,
    stageJobs: harness.stageJobs,
    appBuildProof: harness.appBuildProof,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: harness.adapters,
  });
  assert.deepEqual(result.shadowTargets, ["governance"]);
  assert.equal(result.publicServingMutationCommands, 5);
  assert.equal(
    result.journal.operations.some(
      (operation) =>
        operation.type === "promote" && operation.target === "governance",
    ),
    false,
  );
  assert.deepEqual(
    harness.mappings.get("governance.mento.org"),
    mapping("governance.mento.org", harness.inputs.prior.governance),
  );
  assert.deepEqual(activePublicSmokes(result).governance, {
    publicUrl: "https://governance.mento.org/",
    servedSha: null,
    status: "not-required",
  });
});

test("active journal identity rejects missing and ambiguous artifact histories", () => {
  const identity = createMainActiveJournalHistoryIdentity({
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(identity.mode, "active");
  assert.match(
    identity.artifactPrefix,
    new RegExp(`^vercel-main-journal-${identity.transactionId}-$`),
  );
  assert.throws(
    () =>
      assertMainActiveJournalHistory({
        journals: [],
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
      }),
    /non-empty array/,
  );
  const prepared = createPreparedMainActiveJournal({
    plan: activePlan(),
    stageJobs: stageJobs(activePlan()),
    appBuildProof: appProof(),
    runId: "800",
    runAttempt: "3",
  });
  assert.throws(
    () =>
      assertMainActiveJournalHistory({
        journals: [prepared, prepared],
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
      }),
    /missing or duplicated/,
  );
  assert.throws(
    () =>
      assertMainActiveJournalHistory({
        journals: [{ ...prepared, mode: "shadow" }],
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
      }),
    /mode/,
  );
});

test("active recovery planning and execution hand off exact reverse mutations and stay release-failing", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  let mappingState = "candidate";
  const currentMappings = Object.values(started.prior).flatMap((record) =>
    record.aliases.map((alias) =>
      mapping(
        alias,
        alias === "governance.mento.org"
          ? started.candidates.governance
          : record,
      ),
    ),
  );
  const recoveryPlan = planMainActiveRecovery({
    journalHistory: [prepared, started],
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
    currentMappings,
    appCandidateMatches: [],
  });
  assert.equal(recoveryPlan.decision, "recover");
  assert.deepEqual(recoveryPlan.rollbackStateTargets, ["governance"]);
  assert.equal(recoveryPlan.forceFailure, true);

  const result = await runMainActiveRecovery({
    recoveryPlan,
    adapters: {
      uploadJournal: async ({ artifactName, journal }) => ({
        acknowledged: true,
        artifactName,
        artifactId: String(7000 + journal.sequence),
      }),
      inspectMapping: async () => ({ mappingState }),
      ordinaryRollback: async () => {
        mappingState = "prior";
        return { outcome: "success" };
      },
      verifyMapping: async () => ({ mappingState }),
    },
  });
  assert.equal(result.outcome, "recovered");
  assert.equal(result.publicServingMutationCommands, 1);
  assert.equal(result.forceReleaseFailure, true);
  assert.equal(result.journal.status, "recovered");

  const verdict = evaluateMainActiveFinalResults({
    plan: deploymentPlan,
    jobs: activeJobs(deploymentPlan, { coordinator: "failure" }),
    coordinatorOutcome: "active-failed",
    recoveryOutcome: "recovered",
  });
  assert.deepEqual(verdict, {
    releaseOutcome: "failure",
    evidenceKind: "failure",
    failAfterEvidence: true,
    reason: "activation-recovered",
  });
});

test("active final-result matrix preserves safe noops and fails every recovery outcome after evidence", () => {
  const deploymentPlan = activePlan();
  const cases = [
    ["active-committed", "not-required", {}, "success"],
    ["no-target", "not-required", {}, "success"],
    ["superseded-before-journal", "not-required", {}, "success"],
    [
      "active-failed",
      "verified-no-mutation",
      { coordinator: "failure" },
      "failure",
    ],
    ["active-failed", "recovered", { coordinator: "failure" }, "failure"],
    [
      "active-failed",
      "manual-intervention",
      { coordinator: "failure" },
      "failure",
    ],
    [
      "active-failed",
      "recovery-failed",
      { coordinator: "failure", recovery: "failure" },
      "failure",
    ],
    [
      "active-failed",
      "not-found-after-runner-failure",
      { coordinator: "failure" },
      "failure",
    ],
  ];
  for (const [
    coordinatorOutcome,
    recoveryOutcome,
    jobOverrides,
    expected,
  ] of cases) {
    const verdict = evaluateMainActiveFinalResults({
      plan: deploymentPlan,
      jobs: activeJobs(deploymentPlan, jobOverrides),
      coordinatorOutcome,
      recoveryOutcome,
    });
    assert.equal(
      verdict.releaseOutcome,
      expected,
      `${coordinatorOutcome}/${recoveryOutcome}`,
    );
    assert.equal(verdict.failAfterEvidence, expected === "failure");
  }
  assert.equal(
    evaluateMainActiveFinalResults({
      plan: deploymentPlan,
      jobs: activeJobs(deploymentPlan, { stageUi: "failure" }),
      coordinatorOutcome: "active-committed",
      recoveryOutcome: "not-required",
    }).releaseOutcome,
    "failure",
  );
});

test("active failure evidence never claims zero after a mutation may have started and redacts raw plan output", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appBuildProof: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const base = {
    eventHeadSha: SHA,
    verifiedDeploySha: SHA,
    planOutput: "VERCEL_TOKEN=must-not-survive",
    jobs: activeJobs(deploymentPlan, { coordinator: "failure" }),
    workflowDefinitionSha: SHA,
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
    mainOwnershipMode: ownership(),
    journalHistory: [prepared, started],
    freshness: [
      { phase: "transaction-start", status: "fresh" },
      { phase: "pre-command", status: "superseded" },
    ],
    rollbackStateTargets: [],
    coordinatorOutcome: "active-failed",
    recoveryOutcome: "verified-no-mutation",
    errorCode: "SUPERSEDED_DURING_MUTATION",
  };
  assert.throws(
    () =>
      createMainActiveDeploymentFailureEvidence({
        ...base,
        publicServingMutationCommands: 0,
      }),
    /understates possible public mutations/,
  );
  const evidence = createMainActiveDeploymentFailureEvidence({
    ...base,
    publicServingMutationCommands: 1,
  });
  assert.equal(evidence.schema, MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA);
  assert.equal(evidence.journal.historyStatus, "valid");
  assert.equal(evidence.journal.highestSequence, 1);
  assert.equal(evidence.publicServingMutationCommands, 1);
  assert.doesNotMatch(
    JSON.stringify(evidence),
    /must-not-survive|VERCEL_TOKEN/,
  );
  assert.match(
    renderMainActiveDeploymentFailureEvidence(evidence),
    /Public-serving mutation commands: `1`/,
  );

  const ambiguous = createMainActiveDeploymentFailureEvidence({
    ...base,
    journalHistory: [prepared, prepared],
    publicServingMutationCommands: 0,
    errorCode: "JOURNAL_HISTORY_AMBIGUOUS",
  });
  assert.equal(ambiguous.journal.historyStatus, "ambiguous");
  const missing = createMainActiveDeploymentFailureEvidence({
    ...base,
    journalHistory: [],
    publicServingMutationCommands: 0,
    errorCode: "JOURNAL_HISTORY_MISSING",
  });
  assert.equal(missing.journal.historyStatus, "missing");

  const unavailableAfterRecovery = createMainActiveDeploymentFailureEvidence({
    ...base,
    journalHistory: [],
    publicServingMutationCommands: 12,
    recoveryOutcome: "recovered",
    errorCode: "JOURNAL_HISTORY_UNAVAILABLE_AFTER_RECOVERY",
  });
  assert.equal(unavailableAfterRecovery.journal.historyStatus, "missing");
  assert.equal(unavailableAfterRecovery.recoveryOutcome, "recovered");
  assert.equal(unavailableAfterRecovery.publicServingMutationCommands, 12);
});

test("final-active CLI exposes fail-after-evidence without ending evidence production", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-active-final-"));
  try {
    const output = join(directory, "github-output");
    writeFileSync(output, "");
    const deploymentPlan = activePlan();
    const result = await runMainDeploymentCli({
      argv: ["final-active"],
      values: {
        PLAN_JSON: JSON.stringify(deploymentPlan),
        WAIT_FOR_CI_RESULT: "success",
        PLAN_RESULT: "success",
        STAGE_GOVERNANCE_RESULT: "success",
        STAGE_RESERVE_RESULT: "success",
        STAGE_UI_RESULT: "success",
        COORDINATOR_RESULT: "failure",
        COORDINATOR_OUTCOME: "active-failed",
        RECOVERY_RESULT: "success",
        RECOVERY_OUTCOME: "manual-intervention",
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(result.releaseOutcome, "failure");
    assert.equal(result.failAfterEvidence, true);
    assert.match(readFileSync(output, "utf8"), /fail_after_evidence=true/);
    assert.match(readFileSync(output, "utf8"), /evidence_kind=failure/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
