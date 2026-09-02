import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
  ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA,
  ACTIVE_STATE_CLASSIFICATIONS,
  createActiveDeploymentStateProof,
} from "./vercel-deployment-state.mjs";
import {
  MAIN_ACTIVE_EVENT_SCHEMA,
  reduceMainActiveTransition,
} from "./vercel-main-active-controller.mjs";
import {
  MAIN_ACTIVE_DEPLOYMENT_MODE,
  MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA,
  MAIN_ACTIVE_EVIDENCE_SCHEMA,
  MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
  MAIN_ACTIVE_CENSUS_FAILURE_SCHEMA,
  MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES,
  MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA,
  MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
  MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA,
  MAIN_DEPLOYMENT_MODE,
  MAIN_DEPLOYMENT_SCHEMA,
  MAIN_FAILURE_EVIDENCE_SCHEMA,
  MAIN_OWNERSHIP_MODES,
  MAIN_PROMOTABLE_TARGETS,
  MAIN_STAGE_SCHEMA,
  assertMainActiveJournalHistory,
  assertMainStageBarrier,
  assertMainActiveTerminalEvidenceArtifact,
  assertMainActiveTerminalProofs,
  MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
  assertMainDeploymentHandoff,
  assertMainFinalResults,
  assertMainStageResult,
  assertProtectedSnapshotMatchesPlan,
  assertUploadedPreparedJournal,
  classifyRemoteMainFreshness,
  createMainActiveDeploymentEvidence,
  createMainActiveFreshness,
  createMainActiveCanonicalMappings,
  createMainActiveAliasMappingSpec,
  createMainActiveRecoveryCanonicalMappings,
  createMainActiveRecoveryMappingSpec,
  createMainActiveRecoveryDeploymentStateSpec,
  createMainActiveRecoveryPublicSmokes,
  createMainActiveDeploymentStateSpec,
  createMainActiveDeploymentFailureEvidence,
  createMainActiveSafeNoopEvidence,
  createMainActiveTerminalArtifacts,
  createMainActiveTerminalStateProof,
  createMainActiveTerminalHandoff,
  createMainTerminalAffectedOperations,
  createMainActiveJournalHistoryIdentity,
  createMainActivePlanning,
  createMainActivePublicSmokes,
  createMainActiveTransactionInputs,
  createMainCurrentCandidateIntent,
  createMainCurrentActiveAliasMappingSpec,
  createMainCurrentActiveDeploymentStateSpec,
  createMainCurrentReleaseVerifiedAliasMappingSpec,
  createMainCurrentReleaseVerifiedDeploymentStateSpec,
  createMainCurrentActivePublicSmokes,
  createMainCurrentActiveInputs,
  createMainDeploymentPlan,
  createMainDeploymentEvidence,
  createMainDeploymentFailureEvidence,
  createMainJournalArtifactIdentity,
  createMainWorkflowRunUrl,
  createMainProtectedAliasSpec,
  createMainStageResult,
  createMainTransactionInputs,
  createMainStageBarrier,
  createPreparedMainActiveJournal,
  createPreparedMainJournal,
  evaluateMainActiveFinalResults,
  parseMainDeploymentArguments,
  planMainActiveRecovery,
  readRemoteMainSha,
  recoverMainShadowTransaction,
  renderMainActiveDeploymentEvidence,
  MAIN_RIDER_ALIAS_BYTE_BUDGET,
  MAIN_RIDER_ALIAS_TARGET_LIMIT,
  renderMainActiveDeploymentFailureEvidence,
  renderMainActiveSafeNoopEvidence,
  renderMainDeploymentEvidence,
  renderMainDeploymentFailureEvidence,
  restoreMainActiveTerminalEvidence,
  runMainActiveRecovery,
  runMainActiveTransaction,
  runMainDeploymentCli,
  runMainShadowTransaction,
  validateMainDeploymentRecoverySource,
  validateMainDeploymentSource,
  validateMainStageJobs,
  validateMainWorkflowContext,
} from "./vercel-main-deployment.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import {
  createMainReleaseExecution,
  createMainReleaseSelection,
  digestMainReleaseExecution,
} from "./vercel-main-release-execution.mjs";
import * as mainDeploymentModule from "./vercel-main-deployment.mjs";
import {
  classifyMainTransactionMapping,
  expectedVerifiedMappingStateFor,
  finishMainTransactionRecovery,
  markMainTransactionCommitted,
  mainTransactionJournalArtifactName,
  recordMainTransactionCommandReturned,
  recordMainTransactionVerified,
  startMainTransactionRecovery,
  startMainTransactionOperation,
  createMainTransactionId,
} from "./vercel-main-transaction.mjs";
import {
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
  canonicalizeMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import {
  generateVercelDeploymentId,
  generateVercelMainCandidateDeploymentId,
} from "./vercel-prebuilt.mjs";
import * as mainPlanModule from "./vercel-main-plan.mjs";
import {
  acceptsPriorEnvironment,
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
} from "./vercel-main-plan.mjs";

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

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// MGP-18 retired the App custom `v3` environment, so the shared plan fixture
// carries the one steady-state App prior every run observes: `production`
// target, no custom environment, and exactly the reviewed production aliases.
// There is no second accepted prior shape and therefore no conversion helper —
// the App prior is read straight from the fixture like every other target's.
function allProtectedStates() {
  const source = structuredClone(fixture);
  const states = Object.values(source.priorStates).flatMap(
    (group) => group.states,
  );
  return states.sort((left, right) => left.alias.localeCompare(right.alias));
}

function planningSnapshot() {
  return {
    schema: "vercel-main-planning-snapshot:v1",
    states: allProtectedStates(),
  };
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
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456/attempts/2",
    buildAndTestJobUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456/job/654321",
  };
}

function plan({
  deployments = ["app", "governance", "reserve", "ui"],
  mode = MAIN_DEPLOYMENT_MODE,
  snapshot = planningSnapshot(),
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
    planningSnapshot: snapshot,
    rollbackOnlyTargets: [],
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

function releaseManifestForPlan(deploymentPlan) {
  const originalPriors = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => {
      const planned = deploymentPlan.planning.priors.find(
        (entry) => entry.target === target,
      );
      const leaves = deploymentPlan.protectedSnapshot.states.filter((state) =>
        planned.aliases.includes(state.alias),
      );
      const first = leaves[0];
      return [
        target,
        {
          deploymentId: planned.deploymentId,
          deploymentUrl: planned.deploymentUrl,
          aliases: [...planned.aliases],
          projectId: first.projectId,
          projectName: first.projectName,
          readyState: first.readyState,
          target: first.target,
          customEnvironmentSlug: first.customEnvironmentSlug,
          planningLeaves: planned.aliases.map((alias) => ({
            alias,
            deploymentId: planned.deploymentId,
            deploymentUrl: planned.deploymentUrl,
            aliases: [...planned.aliases],
            projectId: first.projectId,
            projectName: first.projectName,
            readyState: first.readyState,
            target: first.target,
            customEnvironmentSlug: first.customEnvironmentSlug,
            git: {
              status: "complete",
              org: first.git.org,
              repo: first.git.repo,
              ref: first.git.ref,
              sha: first.git.sha,
            },
          })),
          servedSha: planned.servedSha,
        },
      ];
    }),
  );
  return createMainReleaseManifest({
    upstreamRunId: deploymentPlan.upstream.runId,
    plan: deploymentPlan.planning,
    originalPriors,
  });
}

function releaseExecutionForPlan(deploymentPlan) {
  const manifest = releaseManifestForPlan(deploymentPlan);
  const selection = createMainReleaseSelection({
    providerDiscoveryDigest: "f".repeat(64),
    planningSnapshotDigest: "e".repeat(64),
    rollbackOnlyTargets: manifest.rollbackOnlyTargets,
    projectIds: Object.fromEntries(
      ["governance", "reserve", "ui", "app"].map((target) => [
        target,
        manifest.originalPriors[target].projectId,
      ]),
    ),
    mode: manifest.mode,
    mainOwnershipMode: manifest.mainOwnershipMode,
    selectedManifest: manifest,
  });
  return createMainReleaseExecution({
    decision:
      manifest.stagedTargets.length === 0
        ? "capture-new-baseline"
        : "resume-existing-release",
    reason:
      manifest.stagedTargets.length === 0
        ? "no-mapped-release-metadata"
        : "current-main-release-is-an-interrupted-prefix",
    manifest,
    upstream: deploymentPlan.upstream,
    selection,
  });
}

function currentCandidateReceipt(execution, target) {
  const identity = {
    repository: "mento-protocol/frontend-monorepo",
    deploySha: execution.manifest.deploySha,
    runId: "800",
    runAttempt: "3",
  };
  const prior = execution.manifest.originalPriors[target];
  const intent = createMainCandidateIntent({
    target,
    deploySha: identity.deploySha,
    upstreamRunId: execution.manifest.upstreamRunId,
    originRunId: identity.runId,
    originAttempt: identity.runAttempt,
    originTransactionId: createMainTransactionId(identity),
    projectId: prior.projectId,
    projectName: prior.projectName,
    releaseManifest: execution.manifest,
  });
  const deploymentUrl = `https://${target}-current-candidate.vercel.app`;
  return createMainCandidateReceipt({
    intent,
    candidate: {
      deploymentId: `dpl_${target}Current123`,
      deploymentUrl,
      projectId: prior.projectId,
      projectName: prior.projectName,
      readyState: "READY",
      target: "production",
      customEnvironmentSlug: null,
      source: "cli",
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: identity.deploySha,
      },
      metadata: canonicalizeMainCandidateVercelMetadata(
        createMainCandidateVercelMetadata({ intent }),
        {
          target,
          deploySha: identity.deploySha,
          projectId: prior.projectId,
          projectName: prior.projectName,
        },
      ),
    },
    immutableSmoke: {
      immutableUrl: deploymentUrl,
      servedSha: identity.deploySha,
      status: "passed",
    },
  });
}

function currentCanonicalMappings(deploymentPlan) {
  const byAlias = new Map();
  for (const state of deploymentPlan.protectedSnapshot.states) {
    for (const alias of state.aliases) byAlias.set(alias, state);
  }
  const targets = ["governance", "reserve", "ui", "app"];
  return {
    schema: "vercel-main-canonical-mappings:v1",
    mappings: Object.fromEntries(
      targets.map((target) => {
        const aliases = deploymentPlan.planning.priors.find(
          (entry) => entry.target === target,
        ).aliases;
        return [
          target,
          aliases.map((alias) => {
            const state = byAlias.get(alias);
            return {
              alias,
              deploymentId: state.deploymentId,
              deploymentUrl: state.deploymentUrl,
            };
          }),
        ];
      }),
    ),
  };
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

// The App is an ordinary main target: it hands over the same provider candidate
// receipt every other target does. The retired `createMainAppBuildProof` shape
// has no replacement because there is no separate App build verb any more.
function appReceipt(deploymentPlan = plan()) {
  return currentCandidateReceipt(
    releaseExecutionForPlan(deploymentPlan),
    "app",
  );
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
} = {}) {
  const reviewedPlan =
    deploymentPlan ?? activePlan({ mainOwnershipMode: ownershipMap });
  const inputs = createMainActiveTransactionInputs({
    plan: reviewedPlan,
    stageJobs: stageJobs(reviewedPlan),
    appCandidateReceipt: reviewedPlan.planning.stagedTargets.includes("app")
      ? appReceipt(reviewedPlan)
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
  // The App candidate is staged before activation like every other target, so
  // it carries its provider deployment identity from the very first journal.
  const candidateFor = (target) => inputs.candidates[target];
  const mappingState = (context) => {
    const operation = context.operation ?? context.intent;
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
    // `app.mento.org` now lives in the ordinary production environment, so an
    // App promote moves the reviewed App domain exactly like every other
    // target's promote moves its own. There is no bridge alias adapter.
    promote: async ({ operation }) => {
      for (const alias of inputs.prior[operation.target].aliases) {
        mappings.set(
          alias,
          mapping(alias, inputs.candidates[operation.target]),
        );
      }
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
    appCandidateReceipt: reviewedPlan.planning.stagedTargets.includes("app")
      ? appReceipt(reviewedPlan)
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

function runtimeSmoke(target, deploySha = SHA) {
  const finalPaths = {
    app: "https://app.mento.org/swap/celo",
    governance: "https://governance.mento.org/voting-power",
    reserve: "https://reserve.mento.org/?tab=stablecoins",
    ui: "https://ui.mento.org/form-components",
  };
  const interactions = {
    app: "real-production-wallet-list",
    governance: "governance-voting-power-navigation",
    reserve: "reserve-overview-data-and-supply-tab",
    ui: "ui-search-navigation-and-checkbox",
  };
  return {
    deploy_sha: deploySha,
    final_url: finalPaths[target],
    interaction: interactions[target],
    logical_target: target,
    public_url: `https://${target}.mento.org/`,
    successful_documents: 1,
    successful_fonts: 1,
    successful_scripts: 1,
    successful_stylesheets: 1,
  };
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
        ? {
            publicUrl: urls[target],
            runtime: runtimeSmoke(target),
            servedSha: SHA,
            status: "passed",
          }
        : {
            publicUrl: urls[target],
            runtime: null,
            servedSha: null,
            status: "not-required",
          },
    ]),
  );
}

// The App has no stage-job handoff — it stages a provider candidate receipt —
// so every active-state spec is derived through the stage barrier, which is
// also the only producer the `active-state-spec` CLI verb calls.
function barrierFor(execution, runId = "800", runAttempt = "3") {
  return createMainStageBarrier({
    execution,
    candidateReceipts: Object.fromEntries(
      ["app", "governance", "reserve", "ui"].map((target) => [
        target,
        execution.projection.stagedTargets.includes(target)
          ? currentCandidateReceipt(execution, target)
          : null,
      ]),
    ),
    runId,
    runAttempt,
  });
}

function activeStateProof({
  spec: suppliedSpec = null,
  deploymentPlan,
  journalHistory,
  runId,
  runAttempt,
  additionalDeployments = {},
}) {
  const execution =
    suppliedSpec === null ? releaseExecutionForPlan(deploymentPlan) : null;
  const spec =
    suppliedSpec ??
    createMainCurrentActiveDeploymentStateSpec({
      execution,
      barrier: barrierFor(execution, runId, runAttempt),
      journalHistory,
      runId,
      runAttempt,
    });
  const deployments = Object.fromEntries(
    Object.entries(spec.projects).map(([target, project]) => {
      const additional = additionalDeployments[target] ?? [];
      if (project.deploymentId === null) return [target, [...additional]];
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
                ...createMainCandidateVercelMetadata({
                  intent: createMainCandidateIntent({
                    target,
                    deploySha: spec.deploySha,
                    upstreamRunId: spec.releaseManifest.upstreamRunId,
                    originRunId: spec.runId,
                    originAttempt: spec.runAttempt,
                    originTransactionId: spec.transactionId,
                    projectId: project.projectId,
                    projectName: project.projectName,
                    releaseManifest: spec.releaseManifest,
                  }),
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
          ...additional,
        ],
      ];
    }),
  );
  return createActiveDeploymentStateProof({ spec, deployments });
}

function terminalStateProof({ execution, stateProof }) {
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: Object.fromEntries(
      ["app", "governance", "reserve", "ui"].map((target) => [
        target,
        execution.projection.activeTargets.includes(target) ||
        execution.projection.shadowTargets.includes(target)
          ? currentCandidateReceipt(execution, target)
          : null,
      ]),
    ),
    runId: "800",
    runAttempt: "3",
  });
  return createMainActiveTerminalStateProof({
    execution,
    barrier,
    stateProof,
    runId: "800",
    runAttempt: "3",
  });
}

function committedTerminalProofs({
  evidence,
  journalHistory,
  stateProof,
  execution,
}) {
  const terminalState = terminalStateProof({ execution, stateProof });
  return {
    schema: MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA,
    releaseId: execution.manifest.releaseId,
    releaseManifestDigest: digestJson(execution.manifest),
    releaseExecutionDigest: digestMainReleaseExecution(execution),
    producerJob: "activate-and-verify",
    outcome: "active-committed",
    finalMapping: { status: "passed", artifact: evidence.finalMappings },
    finalCensus: { status: "passed", artifact: terminalState },
    stateProof: { status: "passed", artifact: terminalState },
    publicSmoke: { status: "passed", artifact: evidence.publicSmokes },
    mutationCount: evidence.publicServingMutationCommands,
    rollbackTargets: [],
    affectedOperations: [],
    journal: { status: "committed", artifact: journalHistory },
  };
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

function finalActiveJobs(deploymentPlan, overrides = {}) {
  return {
    ...activeJobs(deploymentPlan),
    recovery: "skipped",
    ...overrides,
  };
}

function activeHistoryDocument(journals) {
  const highest = journals.at(-1);
  return {
    schema: "vercel-main-active-journal-history:v1",
    transactionId: highest.transactionId,
    highestSequence: highest.sequence,
    highestStatus: highest.status,
    highestArtifactName: mainTransactionJournalArtifactName(highest),
    journals,
  };
}

function providerMappings(execution, mappings) {
  const byAlias = new Map(mappings.map((entry) => [entry.alias, entry]));
  const grouped = {};
  for (const target of ["governance", "reserve", "ui", "app"]) {
    grouped[target] = execution.manifest.originalPriors[target].aliases
      .map((alias) => byAlias.get(alias))
      .toSorted((left, right) => left.alias.localeCompare(right.alias));
  }
  return {
    schema: "vercel-main-canonical-mappings:v1",
    mappings: grouped,
  };
}

function priorPublicSmokes(execution) {
  return Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      {
        publicUrl: `https://${target}.mento.org/`,
        runtime: runtimeSmoke(
          target,
          execution.manifest.originalPriors[target].servedSha,
        ),
        servedSha: execution.manifest.originalPriors[target].servedSha,
        status: "passed",
      },
    ]),
  );
}

// MGP-18 retired the legacy App deployment and the v3 custom environment now
// retires with it. The protected spec is exactly the four reviewed main
// aliases; nothing may re-admit the legacy or the custom-environment topology.
test("protected spec binds exactly the four reviewed main aliases", () => {
  const spec = createMainProtectedAliasSpec({ projectIds });
  assert.equal(spec.length, 4);
  assert.deepEqual(
    spec.map((entry) => entry.alias),
    [
      "app.mento.org",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
    ],
  );
  assert.equal(
    spec.filter((entry) => entry.projectName === "app.mento.org").length,
    1,
  );
  for (const entry of spec) {
    assert.equal(entry.git.ref, "main");
    assert.equal(entry.target, "production");
    assert.equal(entry.customEnvironmentSlug, null);
  }
  for (const retired of [
    "v2-app.mento.org",
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
    // The retiring v3 custom environment's generated alias is not managed.
    "appmentoorg-env-v3-mentolabs.vercel.app",
  ]) {
    assert.equal(
      spec.some((entry) => entry.alias === retired),
      false,
    );
  }
  assert.equal(MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS, 4);
  // Pin the derivation, not just the number: exactly one rollback slot per
  // promotable target. MGP-18 retired the extra bridge alias-restore slot, so
  // the reviewed App alias count no longer contributes a compensation slot.
  assert.deepEqual(
    [...MAIN_PROMOTABLE_TARGETS],
    ["governance", "reserve", "ui", "app"],
  );
  assert.deepEqual([...MAIN_TARGET_CONTRACTS.app.aliases], ["app.mento.org"]);
  assert.equal(
    MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
    MAIN_PROMOTABLE_TARGETS.length,
  );
});

// Replaces the retired "planning accepts the v3-shaped App prior the first
// post-cutover run sees" tolerance. MGP-18 deleted `acceptsPriorEnvironment`'s
// App-only alternative shape, so every prior — App included — is held to the
// same production contract a candidate is, and the retiring custom
// environment's shape and generated alias fail closed on the way in.
test("planning holds the App prior to the same production contract as every other target", () => {
  // The shared fixture is the production-shaped steady state, not the retired
  // first-run shape.
  const appState = planningSnapshot().states.find(
    ({ alias }) => alias === "app.mento.org",
  );
  assert.equal(appState.target, "production");
  assert.equal(appState.customEnvironmentSlug, null);
  assert.deepEqual(appState.aliases, [
    "app.mento.org",
    "appmentoorg-git-main-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
  ]);
  assert.deepEqual(
    assertMainDeploymentHandoff(activePlan()),
    activePlan(),
    "the handoff round-trips the production-shaped snapshot",
  );

  // The retired tolerance and its call-site helpers are gone from the planner.
  for (const retired of [
    "TRANSITIONAL_APP_PRIOR_ENVIRONMENT",
    "TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS",
    "isTransitionalAppPriorEnvironment",
  ]) {
    assert.equal(mainPlanModule[retired], undefined, retired);
  }
  // `acceptsPriorEnvironment` is strict for every target: production target,
  // null custom environment, no App exception.
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    assert.equal(
      acceptsPriorEnvironment(target, {
        target: "production",
        customEnvironmentSlug: null,
      }),
      true,
      target,
    );
    for (const rejected of [
      { target: null, customEnvironmentSlug: "v3" },
      { target: "preview", customEnvironmentSlug: null },
      { target: "production", customEnvironmentSlug: "v3" },
    ]) {
      assert.equal(
        acceptsPriorEnvironment(target, rejected),
        false,
        `${target} ${JSON.stringify(rejected)}`,
      );
    }
  }

  // Every retired prior shape now fails closed in planning, for App exactly as
  // for the ordinary targets.
  for (const [name, mutate, pattern] of [
    [
      "v3-shaped App prior",
      (states) => {
        const app = states.find(({ alias }) => alias === "app.mento.org");
        app.target = null;
        app.customEnvironmentSlug = "v3";
      },
      /Canonical deployment environment is malformed/,
    ],
    [
      "preview-shaped App prior",
      (states) => {
        states.find(({ alias }) => alias === "app.mento.org").target =
          "preview";
      },
      /Canonical deployment environment is malformed/,
    ],
    [
      "v3-shaped governance prior",
      (states) => {
        const governance = states.find(
          ({ alias }) => alias === "governance.mento.org",
        );
        governance.target = null;
        governance.customEnvironmentSlug = "v3";
      },
      /Canonical deployment environment is malformed/,
    ],
    [
      // A served prior may carry the project's other production domains, but
      // never another main target's reviewed protected domain.
      "another target's reviewed domain on the App prior",
      (states) => {
        const app = states.find(({ alias }) => alias === "app.mento.org");
        app.aliases = [...app.aliases, "governance.mento.org"].toSorted();
      },
      /app/,
    ],
    [
      "wrong App project",
      (states) => {
        states.find(({ alias }) => alias === "app.mento.org").projectId =
          "prj_other123";
      },
      /Protected snapshot state is ambiguous for app\.mento\.org/,
    ],
  ]) {
    const invalid = planningSnapshot();
    mutate(invalid.states);
    assert.throws(() => activePlan({ snapshot: invalid }), pattern, name);
  }
});

// Replaces the retired "App is deployed by its own v3 verb" model: the App is
// an ordinary main target, so nothing in the module may re-admit the custom
// environment as a managed alias, a candidate shape, or a state-spec shape.
test("the retired App v3 custom environment cannot re-enter any managed surface", () => {
  const retiredAlias = "appmentoorg-env-v3-mentolabs.vercel.app";
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const contract = MAIN_TARGET_CONTRACTS[target];
    assert.equal(contract.aliases.includes(retiredAlias), false, target);
    assert.equal(contract.customEnvironmentSlug, null, target);
    assert.equal(contract.target, "production", target);
  }
  const deploymentPlan = activePlan();
  assert.equal(
    JSON.stringify(deploymentPlan).includes(retiredAlias),
    false,
    "plan handoff",
  );
  assert.deepEqual(
    deploymentPlan.planning.priors.find((entry) => entry.target === "app")
      .aliases,
    ["app.mento.org"],
  );
  const spec = createMainProtectedAliasSpec({ projectIds });
  assert.equal(JSON.stringify(spec).includes(retiredAlias), false, "spec");

  // A candidate-facing App state spec is production-only.
  const execution = releaseExecutionForPlan(deploymentPlan);
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: Object.fromEntries(
      MAIN_DEPLOYMENT_TARGETS.map((target) => [
        target,
        currentCandidateReceipt(execution, target),
      ]),
    ),
    runId: "800",
    runAttempt: "3",
  });
  const prepared = createMainCurrentActiveInputs({
    execution,
    barrier,
    currentMappings: currentCanonicalMappings(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  }).journal;
  const stateSpec = createMainCurrentActiveDeploymentStateSpec({
    execution,
    barrier,
    journalHistory: [prepared],
    runId: "800",
    runAttempt: "3",
  });
  const appProject = stateSpec.projects.app;
  assert.equal(appProject.target, "production");
  assert.equal(appProject.customEnvironmentSlug, null);
  assert.equal(
    JSON.stringify(stateSpec).includes(retiredAlias),
    false,
    "state spec",
  );
  assert.throws(
    () =>
      createMainStageBarrier({
        execution,
        candidateReceipts: Object.fromEntries(
          MAIN_DEPLOYMENT_TARGETS.map((target) => {
            const receipt = structuredClone(
              currentCandidateReceipt(execution, target),
            );
            if (target === "app") {
              receipt.candidate.customEnvironmentSlug = "v3";
              receipt.candidate.target = null;
            }
            return [target, receipt];
          }),
        ),
        runId: "800",
        runAttempt: "3",
      }),
    /Main candidate environment conflicts with target/,
  );
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
      "--execution",
      "/tmp/execution.json",
      "--journal-history",
      "/tmp/history.json",
      "--output",
      "/tmp/state-spec.json",
      "--stage-barrier",
      "/tmp/stage-barrier.json",
    ],
    [
      "active-mapping-spec",
      "--execution",
      "/tmp/execution.json",
      "--journal-history",
      "/tmp/history.json",
      "--output",
      "/tmp/mapping-spec.json",
      "--stage-barrier",
      "/tmp/stage-barrier.json",
    ],
    [
      "active-canonical-mappings",
      "--mapping-spec",
      "/tmp/mapping-spec.json",
      "--mappings",
      "/tmp/mappings.json",
      "--output",
      "/tmp/canonical-mappings.json",
    ],
    [
      "active-public-smokes",
      "--app",
      "/tmp/app.json",
      "--execution",
      "/tmp/execution.json",
      "--governance",
      "/tmp/governance.json",
      "--output",
      "/tmp/smokes.json",
      "--reserve",
      "/tmp/reserve.json",
      "--stage-barrier",
      "/tmp/stage-barrier.json",
      "--ui",
      "/tmp/ui.json",
    ],
    [
      "run-active",
      "--execution",
      "/tmp/execution.json",
      "--event",
      "/tmp/event.json",
      "--journal-history",
      "/tmp/history.json",
      "--journal-output",
      "/tmp/journal.json",
      "--output",
      "/tmp/active.json",
      "--prepared-journal",
      "/tmp/prepared-journal.json",
      "--stage-barrier",
      "/tmp/stage-barrier.json",
    ],
    [
      "stage-barrier",
      "--candidate-receipts",
      "/tmp/candidate-receipts.json",
      "--execution",
      "/tmp/execution.json",
      "--output",
      "/tmp/stage-barrier.json",
    ],
    [
      "plan-active-recovery",
      "--journal-history",
      "/tmp/history.json",
      "--current-mappings",
      "/tmp/mappings.json",
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
    ["final-active", "--execution", "/tmp/execution.json"],
    [
      "active-recovery-state-spec",
      "--execution",
      "/tmp/execution.json",
      "--journal-history",
      "/tmp/history.json",
      "--output",
      "/tmp/state-spec.json",
    ],
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
    ["active-safe-noop-evidence", "--output", "/tmp/safe-noop-evidence.json"],
    [
      "terminal-evidence-create",
      "--active-evidence",
      "/tmp/active-evidence.json",
      "--evidence-output",
      "/tmp/terminal-evidence.json",
      "--execution",
      "/tmp/release-execution.json",
      "--manifest",
      "/tmp/release-manifest.json",
      "--proofs",
      "/tmp/terminal-proofs.json",
      "--receipt-output",
      "/tmp/terminal-receipt.json",
    ],
    [
      "terminal-evidence-restore",
      "--evidence",
      "ZXZpZGVuY2U",
      "--execution",
      "/tmp/release-execution.json",
      "--manifest",
      "/tmp/release-manifest.json",
      "--output",
      "/tmp/active-evidence.json",
      "--receipt",
      "cmVjZWlwdA",
    ],
    ["validate-context"],
    ["validate-recovery-source"],
    ["validate-source"],
    ["create-spec", "--scope", "main", "--output", "/tmp/spec.json"],
    ["evidence", "--output", "/tmp/evidence.json"],
    ["failure-evidence", "--output", "/tmp/failure-evidence.json"],
    [
      "plan",
      "--planning-snapshot",
      "/tmp/main.json",
      "--output",
      "/tmp/plan.json",
    ],
    ["freshness"],
    ["journal-name"],
    ["revalidate-prior", "--planning-snapshot", "/tmp/main.json"],
    [
      "candidate-intent",
      "--execution",
      "/tmp/execution.json",
      "--output",
      "/tmp/intent.json",
      "--target",
      "app",
    ],
    [
      "candidate-metadata",
      "--intent",
      "/tmp/intent.json",
      "--output",
      "/tmp/metadata.json",
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
      "candidate-intent",
      "--manifest",
      "/tmp/manifest.json",
      "--output",
      "/tmp/intent.json",
      "--target",
      "app",
    ],
    // The App has no separate build or discovery verb any more. Each retired
    // verb is rejected as an unsupported command, not merely mis-optioned.
    ["app-build-proof", "--intent", "/tmp/intent.json", "--output", "/tmp/a"],
    ["app-build-proof", "--output", "/tmp/app.json"],
    ["app-candidate-expectation", "--journal", "/tmp/j", "--output", "/tmp/e"],
    [
      "active-event-verify-app",
      "--app-candidate-receipt",
      "/tmp/receipt.json",
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
    // `stage-barrier` no longer carries a separate App preparation proof.
    [
      "stage-barrier",
      "--app-preparation",
      "/tmp/app-preparation.json",
      "--candidate-receipts",
      "/tmp/candidate-receipts.json",
      "--execution",
      "/tmp/execution.json",
      "--output",
      "/tmp/stage-barrier.json",
    ],
    // `active-event-verify` never carries App-only options.
    [
      "active-event-verify",
      "--app-candidate-receipt",
      "/tmp/receipt.json",
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
      "create-spec",
      "--scope",
      "main",
      "--scope",
      "main",
      "--output",
      "/tmp/spec.json",
    ],
    ["stage-result", "--state", "--output", "/tmp/result.json"],
    [
      "terminal-evidence-restore",
      "--evidence",
      "ZXZpZGVuY2U",
      "--manifest",
      "/tmp/manifest.json",
      "--output",
      "/tmp/evidence.json",
      "--plan",
      "/tmp/plan.json",
      "--receipt",
      "cmVjZWlwdA",
    ],
    ["freshness", "extra"],
  ]) {
    assert.throws(() => parseMainDeploymentArguments(argv));
  }
});

test("run-active CLI dispatches one reducer event and writes one optional journal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-active-cli-"));
  try {
    const reviewedPlan = activePlan({ deployments: ["governance"] });
    const execution = releaseExecutionForPlan(reviewedPlan);
    const receipts = {
      app: null,
      governance: currentCandidateReceipt(execution, "governance"),
      reserve: null,
      ui: null,
    };
    const barrier = createMainStageBarrier({
      execution,
      candidateReceipts: receipts,
      runId: "800",
      runAttempt: "3",
    });
    const prepared = createMainCurrentActiveInputs({
      execution,
      barrier,
      currentMappings: currentCanonicalMappings(reviewedPlan),
      runId: "800",
      runAttempt: "3",
    }).journal;
    const eventPath = join(directory, "event.json");
    const historyPath = join(directory, "history.json");
    const outputPath = join(directory, "transition.json");
    const journalPath = join(directory, "journal.json");
    const executionPath = join(directory, "execution.json");
    const barrierPath = join(directory, "barrier.json");
    const preparedPath = join(directory, "prepared.json");
    const githubOutput = join(directory, "github-output.txt");
    await runMainDeploymentCli({
      argv: ["active-event-initialize", "--output", eventPath],
      values: {},
    });
    writeFileSync(executionPath, `${JSON.stringify(execution)}\n`);
    writeFileSync(barrierPath, `${JSON.stringify(barrier)}\n`);
    writeFileSync(preparedPath, `${JSON.stringify(prepared)}\n`);
    writeFileSync(historyPath, "[]\n");
    const result = await runMainDeploymentCli({
      argv: [
        "run-active",
        "--execution",
        executionPath,
        "--event",
        eventPath,
        "--journal-history",
        historyPath,
        "--journal-output",
        journalPath,
        "--output",
        outputPath,
        "--prepared-journal",
        preparedPath,
        "--stage-barrier",
        barrierPath,
      ],
      values: {
        GITHUB_OUTPUT: githubOutput,
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
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
        "--execution",
        executionPath,
        "--event",
        dispatchEventPath,
        "--journal-history",
        historyPath,
        "--journal-output",
        dispatchJournalPath,
        "--output",
        join(directory, "dispatch-transition.json"),
        "--prepared-journal",
        preparedPath,
        "--stage-barrier",
        barrierPath,
      ],
      values: {
        GITHUB_OUTPUT: githubOutput,
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
      },
    });
    assert.equal(dispatch.journal.status, "started");
    assert.equal(dispatch.afterUploadAction, "authorize");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Replaces the retired "App builds its own v3 proof during activation" model:
// the App stages a provider candidate receipt exactly like every other target,
// and that receipt is the only source of the activation command's identity.
test("current execution drives one stable candidate identity through the App stage receipt and controller authorization", () => {
  const deploymentPlan = activePlan({ deployments: ["app"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const intent = createMainCurrentCandidateIntent({
    execution,
    target: "app",
    runId: "800",
    runAttempt: "3",
  });
  assert.match(intent.candidateId, /^mr-app-[a-f0-9]{18}$/);
  assert.equal(
    intent.projectId,
    execution.manifest.originalPriors.app.projectId,
  );
  const receipt = currentCandidateReceipt(execution, "app");
  assert.deepEqual(receipt.intent, intent);
  assert.equal(receipt.candidate.metadata.candidateId, intent.candidateId);
  // A selected App without its exact provider candidate receipt is rejected.
  assert.throws(
    () =>
      createMainStageBarrier({
        execution,
        candidateReceipts: {
          app: null,
          governance: null,
          reserve: null,
          ui: null,
        },
        runId: "800",
        runAttempt: "3",
      }),
    /Selected app requires an exact candidate receipt/,
  );

  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: {
      app: receipt,
      governance: null,
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(Object.keys(barrier.stages.app).toSorted(), [
    "kind",
    "receipt",
  ]);
  assert.equal(barrier.stages.app.kind, "receipt");
  const current = createMainCurrentActiveInputs({
    execution,
    barrier,
    currentMappings: currentCanonicalMappings(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    current.journal.candidates.app.discovery.candidateId,
    intent.candidateId,
  );
  const reducerInputs = {
    preparedJournal: current.journal,
    activeTargets: execution.projection.activeTargets,
    shadowTargets: execution.projection.shadowTargets,
    stagedCandidates: current.planning.stagedCandidates,
    mainOwnershipMode: execution.manifest.mainOwnershipMode,
    projectIds: execution.projection.projectIds,
  };
  const initialized = reduceMainActiveTransition({
    ...reducerInputs,
    history: [],
    event: {
      schema: MAIN_ACTIVE_EVENT_SCHEMA,
      kind: "initialize",
    },
  });
  const journalReceipt = (journal, artifactId) => ({
    acknowledged: true,
    artifactName: mainTransactionJournalArtifactName(journal),
    artifactId,
    transactionId: journal.transactionId,
    sequence: journal.sequence,
  });
  const currentMappings = Object.values(current.journal.startMappings)
    .flat()
    .sort((left, right) => left.alias.localeCompare(right.alias));
  const dispatched = reduceMainActiveTransition({
    ...reducerInputs,
    history: [initialized.journal],
    event: {
      schema: MAIN_ACTIVE_EVENT_SCHEMA,
      kind: "dispatch",
      uploadReceipt: journalReceipt(initialized.journal, "9101"),
      freshSha: SHA,
      currentMappings,
    },
  });
  const authorized = reduceMainActiveTransition({
    ...reducerInputs,
    history: [initialized.journal, dispatched.journal],
    event: {
      schema: MAIN_ACTIVE_EVENT_SCHEMA,
      kind: "authorize",
      uploadReceipt: journalReceipt(dispatched.journal, "9102"),
      freshSha: SHA,
      currentMappings,
    },
  });
  // The App is promoted like every other target, so the authorized command is
  // an ordinary promotion bound to the staged receipt's provider deployment.
  assert.equal(authorized.command.kind, "ordinary-promote");
  assert.equal(authorized.command.target, "app");
  assert.equal(authorized.command.deploymentId, receipt.candidate.deploymentId);
  assert.equal(
    Object.hasOwn(authorized.command, "nextDeploymentId"),
    false,
    "no App build identity survives on the activation command",
  );
  assert.equal(Object.hasOwn(authorized.command, "candidateMetadata"), false);
});

test("candidate CLI derives identity only from canonical execution and has no App-only verb", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-candidate-cli-"));
  try {
    const execution = releaseExecutionForPlan(
      activePlan({ deployments: ["app"] }),
    );
    const executionPath = join(directory, "execution.json");
    const intentPath = join(directory, "intent.json");
    const metadataPath = join(directory, "metadata.json");
    const githubOutput = join(directory, "github-output");
    writeFileSync(executionPath, `${JSON.stringify(execution)}\n`);
    writeFileSync(githubOutput, "");
    const values = {
      GITHUB_OUTPUT: githubOutput,
      GITHUB_RUN_ID: "800",
      GITHUB_RUN_ATTEMPT: "3",
      DEPLOY_SHA: OTHER_SHA,
      UPSTREAM_RUN_ID: "999999",
      VERCEL_PROJECT_ID_APP: "prj_untrusted_environment",
      MENTO_NEXT_DEPLOYMENT_ID: "m-app-untrusted",
    };
    const intent = await runMainDeploymentCli({
      argv: [
        "candidate-intent",
        "--execution",
        executionPath,
        "--output",
        intentPath,
        "--target",
        "app",
      ],
      values,
    });
    assert.equal(intent.deploySha, execution.manifest.deploySha);
    assert.equal(intent.upstreamRunId, execution.manifest.upstreamRunId);
    assert.equal(
      intent.projectId,
      execution.manifest.originalPriors.app.projectId,
    );
    assert.equal(
      intent.candidateId,
      generateVercelMainCandidateDeploymentId({
        repository: "mento-protocol/frontend-monorepo",
        target: "app",
        commitSha: execution.manifest.deploySha,
        upstreamRunId: execution.manifest.upstreamRunId,
      }),
    );
    // `candidate-metadata` is the only remaining per-target derivation; the
    // App-only `app-build-proof` and `app-candidate-expectation` verbs are gone.
    const metadata = await runMainDeploymentCli({
      argv: [
        "candidate-metadata",
        "--intent",
        intentPath,
        "--output",
        metadataPath,
      ],
      values,
    });
    assert.equal(metadata.mentoCandidateId, intent.candidateId);
    assert.deepEqual(JSON.parse(readFileSync(metadataPath, "utf8")), metadata);
    assert.match(
      readFileSync(githubOutput, "utf8"),
      new RegExp(`candidate_id=${intent.candidateId}`),
    );
    for (const retired of [
      "app-build-proof",
      "app-candidate-expectation",
      "active-event-verify-app",
    ]) {
      assert.equal(mainDeploymentModule[retired], undefined, retired);
      await assert.rejects(
        () =>
          runMainDeploymentCli({
            argv: [retired, "--output", join(directory, "retired.json")],
            values,
          }),
        /Main deployment command is missing or unsupported/,
        retired,
      );
    }
    for (const retired of [
      "createMainAppBuildProof",
      "createMainAppCandidateExpectation",
      "createMainAppTransactionMetadata",
    ]) {
      assert.equal(mainDeploymentModule[retired], undefined, retired);
    }
    assert.throws(
      () =>
        createMainCurrentCandidateIntent({
          execution: {
            ...execution,
            projection: {
              ...execution.projection,
              projectIds: {
                ...execution.projection.projectIds,
                app: "prj_divergent",
              },
            },
          },
          target: "app",
          runId: "800",
          runAttempt: "3",
        }),
      /projection differs/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Replaces the retired "pending-app barrier stage carries a build proof"
// model. A barrier stage is exactly `{kind, receipt}`, its kind is exactly
// `not-selected` or `receipt`, and a selected App must hand over a receipt.
test("current stage barrier partitions receipts and admits no App preparation slot", () => {
  const appPlan = activePlan({ deployments: ["app"] });
  const execution = releaseExecutionForPlan(appPlan);
  const emptyReceipts = {
    app: null,
    governance: null,
    reserve: null,
    ui: null,
  };
  assert.throws(
    () =>
      createMainStageBarrier({
        execution,
        candidateReceipts: emptyReceipts,
        runId: "800",
        runAttempt: "3",
      }),
    /Selected app requires an exact candidate receipt/,
  );
  const receipt = currentCandidateReceipt(execution, "app");
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: { ...emptyReceipts, app: receipt },
    runId: "800",
    runAttempt: "3",
  });
  for (const target of ["app", "governance", "reserve", "ui"]) {
    assert.deepEqual(
      Object.keys(barrier.stages[target]).toSorted(),
      ["kind", "receipt"],
      target,
    );
  }
  assert.equal(barrier.stages.app.kind, "receipt");
  assert.deepEqual(barrier.stages.governance, {
    kind: "not-selected",
    receipt: null,
  });
  // A resurrected `preparation` key or `pending-app` kind is rejected.
  assert.throws(
    () =>
      assertMainStageBarrier(
        {
          ...barrier,
          stages: {
            ...barrier.stages,
            app: { ...barrier.stages.app, preparation: null },
          },
        },
        { execution, runId: "800", runAttempt: "3" },
      ),
    /Current main barrier app contains forbidden or missing fields/,
  );
  assert.throws(
    () =>
      assertMainStageBarrier(
        {
          ...barrier,
          stages: {
            ...barrier.stages,
            app: { kind: "pending-app", receipt: null },
          },
        },
        { execution, runId: "800", runAttempt: "3" },
      ),
    /Current main barrier app kind is invalid/,
  );
  // A tampered receipt never becomes a barrier stage.
  assert.throws(
    () =>
      createMainStageBarrier({
        execution,
        candidateReceipts: {
          ...emptyReceipts,
          app: {
            ...receipt,
            intent: { ...receipt.intent, deploySha: OTHER_SHA },
          },
        },
        runId: "800",
        runAttempt: "3",
      }),
    /candidate|intent|inconsistent/i,
  );
  const noAppPlan = activePlan({ deployments: ["governance"] });
  const noAppExecution = releaseExecutionForPlan(noAppPlan);
  assert.throws(
    () =>
      createMainStageBarrier({
        execution: noAppExecution,
        candidateReceipts: {
          app: receipt,
          governance: currentCandidateReceipt(noAppExecution, "governance"),
          reserve: null,
          ui: null,
        },
        runId: "800",
        runAttempt: "3",
      }),
    /Unselected app has a candidate receipt/,
  );
});

// Replaces the retired "App shadow stage is a build proof": a shadow App is a
// staged target like any other, so it hands over a receipt whose candidate
// never becomes an active-transaction candidate.
test("current stage barrier admits a shadow App receipt without candidate authority", () => {
  const deploymentPlan = activePlan({
    deployments: ["app", "governance"],
    mainOwnershipMode: ownership({ app: MAIN_OWNERSHIP_MODES.SHADOW }),
  });
  const execution = releaseExecutionForPlan(deploymentPlan);
  assert.deepEqual(execution.projection.activeTargets, ["governance"]);
  assert.deepEqual(execution.projection.shadowTargets, ["app"]);
  const receipt = currentCandidateReceipt(execution, "app");
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: {
      app: receipt,
      governance: currentCandidateReceipt(execution, "governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(Object.keys(barrier.stages.app).toSorted(), [
    "kind",
    "receipt",
  ]);
  assert.equal(barrier.stages.app.kind, "receipt");
  assert.equal(
    barrier.stages.app.receipt.intent.candidateId,
    receipt.intent.candidateId,
  );
  const current = createMainCurrentActiveInputs({
    execution,
    barrier,
    currentMappings: currentCanonicalMappings(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  // Shadow ownership keeps the staged App candidate out of the journal.
  assert.equal(current.journal.candidates.app, null);
  assert.deepEqual(current.planning.stagedCandidates.app, {
    deploymentId: receipt.candidate.deploymentId,
    deploymentUrl: receipt.candidate.deploymentUrl,
  });
});

test("journal artifact identity is recoverable without coordinator outputs", () => {
  const journal = createPreparedMainJournal({
    plan: plan(),
    stageJobs: stageJobs(),
    appCandidateReceipt: appReceipt(),
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
      nextDeploymentId: appReceipt().intent.candidateId,
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
  assert.equal(evidence.schema, "vercel-main-evidence:v2");
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
  assert.equal(Object.hasOwn(evidence, "legacy"), false);
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
  // Shadow mode promotes nothing, so the rider column is the served-prior
  // census for all four targets and the caption says exactly that.
  assert.deepEqual(Object.keys(evidence.riderAliases), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(evidence.riderAliases.app, {
    aliases: [
      "appmentoorg-git-main-mentolabs.vercel.app",
      "appmentoorg-mentolabs.vercel.app",
      "appmentoorg.vercel.app",
    ],
    omitted: 0,
  });
  const summary = renderMainDeploymentEvidence(evidence);
  assert.match(
    summary,
    /\| Target \| Deployment \| Served SHA \| Reviewed aliases \| Rider domains \(served prior\) \|/,
  );
  assert.match(
    summary,
    /\| app \|.*\| `app\.mento\.org` \| appmentoorg-git-main-mentolabs\.vercel\.app, appmentoorg-mentolabs\.vercel\.app, appmentoorg\.vercel\.app \|/,
  );
  assert.match(summary, /this shadow run promotes nothing/);
  const noRiders = structuredClone(evidence);
  noRiders.riderAliases.ui = { aliases: [], omitted: 0 };
  assert.match(
    renderMainDeploymentEvidence(noRiders),
    /\| ui \|.*\| `ui\.mento\.org` \| none \|/,
  );
  assert.match(summary, /Served deployment priors/);
  assert.match(summary, /Served-SHA ranges and selection reasons/);
  assert.match(summary, /Candidate evidence/);
  assert.match(
    summary,
    /Public-serving activation, alias, promotion, rollback, and recovery commands: `0`/,
  );
  assert.match(summary, /Unaliased ordinary staging uploads/);
  assert.doesNotMatch(summary, /legacy-app|v2-app\.mento\.org/);
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
          nextDeploymentId: appReceipt().intent.candidateId,
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
      EVIDENCE_APP_NEXT_DEPLOYMENT_ID: appReceipt().intent.candidateId,
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

test("plan handoff binds upstream receipt, protected state, and served-SHA plan", () => {
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
  // One reviewed alias per target: the retiring v3 generated alias is gone.
  assert.equal(result.protectedSnapshot.states.length, 4);
  assert.deepEqual(
    result.protectedSnapshot.states.map((state) => state.alias),
    [
      "app.mento.org",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
    ],
  );
  assert.deepEqual(
    result.planning.priors.find((entry) => entry.target === "app").aliases,
    ["app.mento.org"],
  );
  assert.deepEqual(Object.keys(result), [
    "schema",
    "mode",
    "deploySha",
    "upstream",
    "projectIds",
    "protectedSnapshot",
    "planning",
  ]);
  assert.deepEqual(assertMainDeploymentHandoff(result), result);
  assert.throws(
    () =>
      assertMainDeploymentHandoff({
        ...result,
        token: "forbidden",
      }),
    /forbidden or missing fields/,
  );
  // MGP-18 retired the legacy App deployment; the handoff may not carry it.
  for (const retired of ["legacySnapshot", "legacyPrior"]) {
    assert.throws(
      () => assertMainDeploymentHandoff({ ...result, [retired]: [] }),
      /forbidden or missing fields/,
    );
  }
});

test("plan CLI conservatively selects every rollback-only main target", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-plan-"));
  try {
    const sourcePath = fileURLToPath(new URL("..", import.meta.url));
    const head = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: sourcePath,
      encoding: "utf8",
    });
    assert.equal(head.status, 0, head.stderr);

    const planPath = join(directory, "plan.json");
    const planningSnapshotPath = join(directory, "planning-snapshot.json");
    const githubOutput = join(directory, "github-output");
    writeFileSync(planningSnapshotPath, JSON.stringify(planningSnapshot()));
    writeFileSync(githubOutput, "");

    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./vercel-main-deployment.mjs", import.meta.url)),
        "plan",
        "--planning-snapshot",
        planningSnapshotPath,
        "--output",
        planPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          VERCEL_MAIN_MODE: MAIN_ACTIVE_DEPLOYMENT_MODE,
          MAIN_OWNERSHIP_MODE_JSON: JSON.stringify(
            Object.fromEntries(
              MAIN_DEPLOYMENT_TARGETS.map((target) => [
                target,
                MAIN_OWNERSHIP_MODES.GITHUB,
              ]),
            ),
          ),
          DEPLOY_SHA: head.stdout.trim(),
          VERCEL_PROJECT_ID_APP: projectIds.app,
          VERCEL_PROJECT_ID_GOVERNANCE: projectIds.governance,
          VERCEL_PROJECT_ID_RESERVE: projectIds.reserve,
          VERCEL_PROJECT_ID_UI: projectIds.ui,
          UPSTREAM_RUN_ID: "123456",
          UPSTREAM_RUN_ATTEMPT: "2",
          UPSTREAM_RUN_URL:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456/attempts/2",
          BUILD_AND_TEST_JOB_URL:
            "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456/job/654321",
          SOURCE_PATH: sourcePath,
          GITHUB_OUTPUT: githubOutput,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);

    const handoff = JSON.parse(readFileSync(planPath, "utf8"));
    assert.deepEqual(handoff.planning.plan, [...MAIN_DEPLOYMENT_TARGETS]);
    assert.deepEqual(handoff.planning.stagedTargets, [
      ...MAIN_DEPLOYMENT_TARGETS,
    ]);
    assert.deepEqual(handoff.planning.activeTargets, [
      ...MAIN_DEPLOYMENT_TARGETS,
    ]);
    assert.deepEqual(handoff.planning.shadowTargets, []);
    assert.deepEqual(
      handoff.planning.reasons,
      MAIN_DEPLOYMENT_TARGETS.map((target) => ({
        target,
        reason: "served-mapping-rollback-only",
        base: handoff.planning.priors.find((prior) => prior.target === target)
          .servedSha,
      })),
    );
    assert.deepEqual(handoff.planning.ranges, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
      rollbackOnlyTargets: [],
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

// Replaces the retired "cross-alias conflict" case: the App target no longer
// spans two reviewed aliases, so a split served-SHA between App aliases is
// structurally impossible. Guard that the split topology cannot come back.
test("every main target maps exactly one reviewed alias in the protected snapshot", () => {
  const snapshot = planningSnapshot();
  assert.equal(snapshot.states.length, MAIN_DEPLOYMENT_TARGETS.length);
  for (const target of MAIN_DEPLOYMENT_TARGETS) {
    const contract = MAIN_TARGET_CONTRACTS[target];
    assert.equal(contract.aliases.length, 1, target);
    assert.equal(
      snapshot.states.filter((state) => contract.aliases.includes(state.alias))
        .length,
      1,
      target,
    );
  }
  const extra = planningSnapshot();
  extra.states.push({
    ...extra.states.find((state) => state.alias === "app.mento.org"),
    alias: "appmentoorg-env-v3-mentolabs.vercel.app",
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "main",
      sha: "9".repeat(40),
    },
  });
  extra.states.sort((left, right) => left.alias.localeCompare(right.alias));
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
        planningSnapshot: extra,
        rollbackOnlyTargets: [],
        upstream: upstream(),
        gitAdapter: gitAdapter(),
        runPlanner: ({ base, head }) => ({
          base,
          head,
          deployments: [],
          reason: "non-runtime-only",
        }),
      }),
    /Protected snapshot does not contain every reviewed alias/,
  );
});

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

test("recovery source CLI dispatches the ancestor-permitting validator", async () => {
  await assert.rejects(
    () =>
      runMainDeploymentCli({
        argv: ["validate-recovery-source"],
        values: {},
      }),
    /DEPLOY_SHA/,
  );
});

test("recovery source proof permits only a newer main descendant of the admitted SHA", () => {
  const descendantCalls = [];
  const descendantMain = (_command, args) => {
    descendantCalls.push(args);
    const gitArgs = args.slice(2);
    if (
      gitArgs[0] === "rev-parse" &&
      gitArgs[1] === "refs/remotes/origin/main"
    ) {
      return `${OTHER_SHA}\n`;
    }
    if (gitArgs[0] === "rev-parse" && gitArgs[1] === "HEAD") {
      return `${SHA}\n`;
    }
    return "";
  };

  assert.equal(
    validateMainDeploymentRecoverySource({
      repoRoot: "/trusted/source",
      deploySha: SHA,
      workflowSha: SHA,
      execute: descendantMain,
    }),
    SHA,
  );
  assert.deepEqual(descendantCalls, [
    ["-C", "/trusted/source", "cat-file", "-e", `${SHA}^{commit}`],
    [
      "-C",
      "/trusted/source",
      "merge-base",
      "--is-ancestor",
      SHA,
      "refs/remotes/origin/main",
    ],
    ["-C", "/trusted/source", "rev-parse", "refs/remotes/origin/main"],
    ["-C", "/trusted/source", "rev-parse", "HEAD"],
  ]);
  assert.throws(
    () =>
      validateMainDeploymentSource({
        repoRoot: "/trusted/source",
        deploySha: SHA,
        workflowSha: SHA,
        execute: descendantMain,
      }),
    /does not match fetched origin\/main/,
  );
  assert.throws(
    () =>
      validateMainDeploymentRecoverySource({
        repoRoot: "/trusted/source",
        deploySha: SHA,
        workflowSha: OTHER_SHA,
        execute: () => assert.fail("git must stay inert"),
      }),
    /GITHUB_WORKFLOW_SHA/,
  );
  assert.throws(
    () =>
      validateMainDeploymentRecoverySource({
        repoRoot: "/trusted/source",
        deploySha: SHA,
        workflowSha: SHA,
        execute(_command, args) {
          if (args[2] === "merge-base") {
            throw new Error("admitted SHA is unrelated to origin/main");
          }
          return "";
        },
      }),
    /unrelated to origin\/main/,
  );
  assert.throws(
    () =>
      validateMainDeploymentRecoverySource({
        repoRoot: "/trusted/source",
        deploySha: SHA,
        workflowSha: SHA,
        execute(_command, args) {
          const gitArgs = args.slice(2);
          if (gitArgs[0] === "rev-parse") return `${OTHER_SHA}\n`;
          return "";
        },
      }),
    /Checked-out HEAD does not match DEPLOY_SHA/,
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
  const selectedValidation = validateMainStageJobs({
    plan: selected,
    jobs: stageJobs(selected),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(selectedValidation.outcome, "eligible");
  assert.equal(selectedValidation.activeTargetCount, 0);
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
  const noTargetValidation = validateMainStageJobs({
    plan: noTargets,
    jobs: stageJobs(noTargets),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(noTargetValidation.outcome, "no-target");
  assert.equal(noTargetValidation.activeTargetCount, 0);
});

test("protected rollback identity remains stable while ordinary generated aliases move", () => {
  const deploymentPlan = plan();
  assert.deepEqual(
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: planningSnapshot(),
    }),
    {
      protectedSnapshot: deploymentPlan.protectedSnapshot,
    },
  );
  const drifted = structuredClone(planningSnapshot());
  drifted.states[0].deploymentId = "dpl_operatorMove123";
  assert.throws(
    () =>
      assertProtectedSnapshotMatchesPlan({
        plan: deploymentPlan,
        planningSnapshot: drifted,
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
      }),
    );
  }
  const refreshedGitEvidence = structuredClone(planningSnapshot());
  refreshedGitEvidence.states[0].git = null;
  assert.doesNotThrow(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: refreshedGitEvidence,
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
    }),
  );
  // MGP-18 retired the legacy App deployment. Its aliases can no longer enter
  // the protected snapshot, so injecting one must fail closed.
  const retiredLegacyAlias = structuredClone(planningSnapshot());
  retiredLegacyAlias.states.push({
    ...retiredLegacyAlias.states[0],
    alias: "v2-app.mento.org",
    aliases: ["v2-app.mento.org"],
  });
  assert.throws(() =>
    assertProtectedSnapshotMatchesPlan({
      plan: deploymentPlan,
      planningSnapshot: retiredLegacyAlias,
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
      rollbackOnlyTargets: [],
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

test("transaction inputs bind ordered priors, release identity, and fresh start mappings", () => {
  const deploymentPlan = plan();
  const inputs = createMainTransactionInputs({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: appReceipt(),
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(Object.keys(inputs.prior), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(Object.keys(inputs.candidates), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(inputs.release.deploySha, SHA);
  assert.deepEqual(Object.keys(inputs.startMappings), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(
    inputs.startMappings.app[0].deploymentId,
    inputs.prior.app.deploymentId,
  );
  // Replaces the retired "build proof asserts deploy-unreachability" guard: the
  // App candidate is a real provider deployment, so its receipt must bind the
  // selected deployment exactly and a selected App may not omit one.
  assert.equal(
    inputs.appReceipt.candidate.deploymentId,
    appReceipt().candidate.deploymentId,
  );
  assert.throws(
    () =>
      createMainTransactionInputs({
        plan: deploymentPlan,
        stageJobs: stageJobs(deploymentPlan),
        appCandidateReceipt: null,
        runId: "800",
        runAttempt: "3",
      }),
    /Selected app requires its exact provider candidate receipt/,
  );
  assert.throws(
    () =>
      createMainTransactionInputs({
        plan: deploymentPlan,
        stageJobs: stageJobs(deploymentPlan),
        appCandidateReceipt: appReceipt(
          activePlan({ deployments: ["app", "governance", "reserve", "ui"] }),
        ),
        runId: "800",
        runAttempt: "3",
      }),
    /App provider candidate receipt differs from the selected deployment/,
  );
  const unselectedPlan = plan({ deployments: ["governance"] });
  assert.throws(
    () =>
      createMainTransactionInputs({
        plan: unselectedPlan,
        stageJobs: stageJobs(unselectedPlan),
        appCandidateReceipt: appReceipt(),
        runId: "800",
        runAttempt: "3",
      }),
    /Unselected app returned a provider candidate receipt/,
  );
  for (const transactionKey of ["999-3-governance", "800-4-governance"]) {
    const staleJobs = structuredClone(stageJobs(deploymentPlan));
    staleJobs.governance.handoff.transactionKey = transactionKey;
    assert.throws(
      () =>
        createMainTransactionInputs({
          plan: deploymentPlan,
          stageJobs: staleJobs,
          appCandidateReceipt: appReceipt(),
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
    appCandidateReceipt: appReceipt(),
    runId: "800",
    runAttempt: "3",
  });
  const bytes = `${JSON.stringify(journal)}\n`;
  const artifactName = mainTransactionJournalArtifactName(journal);
  // Replaces the retired App candidate-expectation derivation: the App
  // candidate is already in the prepared journal, so nothing recomputes it.
  assert.equal(mainDeploymentModule.createMainAppCandidateExpectation, void 0);
  const activeDeploymentPlan = activePlan();
  const activeJournal = createPreparedMainActiveJournal({
    plan: activeDeploymentPlan,
    stageJobs: stageJobs(activeDeploymentPlan),
    appCandidateReceipt: appReceipt(activeDeploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    activeJournal.candidates.app.discovery.candidateId,
    appReceipt(activeDeploymentPlan).intent.candidateId,
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
  // The App is an ordinary target that requires an exact staged provider
  // receipt, and the legacy shadow runner carries no receipt channel, so a
  // shadow run may only cover the ordinary targets.
  const deploymentPlan = plan({
    deployments: ["governance", "reserve", "ui"],
  });
  const journal = createPreparedMainJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const result = await runMainShadowTransaction({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
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
  // An App-staged shadow run carries the App provider receipt like every other
  // staged target, and is rejected without it.
  const appStagedPlan = plan();
  const appStagedJournal = createPreparedMainJournal({
    plan: appStagedPlan,
    stageJobs: stageJobs(appStagedPlan),
    appCandidateReceipt: appReceipt(appStagedPlan),
    runId: "800",
    runAttempt: "3",
  });
  // Shadow mode journals no candidate for any target, but it still validates
  // the App receipt against the selected release.
  assert.deepEqual(appStagedJournal.candidates, {
    app: null,
    governance: null,
    reserve: null,
    ui: null,
  });
  const appStagedResult = await runMainShadowTransaction({
    plan: appStagedPlan,
    stageJobs: stageJobs(appStagedPlan),
    appCandidateReceipt: appReceipt(appStagedPlan),
    runId: "800",
    runAttempt: "3",
    journalBytes: `${JSON.stringify(appStagedJournal)}\n`,
    artifactName: mainTransactionJournalArtifactName(appStagedJournal),
    artifactId: "91919",
    readRemoteMain: () => SHA,
  });
  assert.equal(appStagedResult.outcome, "shadow-prepared");
  assert.equal(appStagedResult.mutationCallbacksCalled, 0);
  await assert.rejects(
    () =>
      runMainShadowTransaction({
        plan: appStagedPlan,
        stageJobs: stageJobs(appStagedPlan),
        runId: "800",
        runAttempt: "3",
        journalBytes: `${JSON.stringify(appStagedJournal)}\n`,
        artifactName: mainTransactionJournalArtifactName(appStagedJournal),
        artifactId: "91919",
        readRemoteMain: () => SHA,
      }),
    /Selected app requires its exact provider candidate receipt/,
  );

  const stale = await runMainShadowTransaction({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
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
    appCandidateReceipt: appReceipt(),
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
    appCandidateReceipt: appReceipt(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(inputs.candidates.governance, null);
  assert.notEqual(inputs.candidates.reserve, null);
  assert.deepEqual(
    createPreparedMainActiveJournal({
      plan: deploymentPlan,
      stageJobs: stageJobs(deploymentPlan),
      appCandidateReceipt: appReceipt(deploymentPlan),
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
      appCandidateReceipt: appReceipt(deploymentPlan),
      runId: "800",
      runAttempt: "3",
    });
    // The App candidate is complete in the prepared journal: nothing attaches
    // it later, so the state spec is derivable from the preparation alone.
    assert.equal(
      mainDeploymentModule.attachDiscoveredAppCandidate,
      undefined,
      "activation never discovers an App candidate",
    );
    const execution = releaseExecutionForPlan(deploymentPlan);
    const barrier = barrierFor(execution);
    const expected = createMainCurrentActiveDeploymentStateSpec({
      execution,
      barrier,
      journalHistory: [prepared],
      runId: "800",
      runAttempt: "3",
    });
    assert.equal(expected.schema, "vercel-active-deployment-state-spec:v3");
    assert.deepEqual(expected.activeTargets, ["app", "governance", "ui"]);
    assert.deepEqual(expected.shadowTargets, ["reserve"]);
    assert.equal(
      expected.projects.app.deploymentId,
      appReceipt(deploymentPlan).candidate.deploymentId,
    );
    assert.equal(expected.projects.app.expectedDisposition, "githubPrebuilt");
    assert.equal(expected.projects.app.target, "production");
    assert.equal(expected.projects.app.customEnvironmentSlug, null);
    assert.equal(
      expected.projects.reserve.deploymentId,
      barrier.stages.reserve.receipt.candidate.deploymentId,
    );
    assert.equal(
      expected.projects.reserve.expectedDisposition,
      "githubShadowStage",
    );
    assert.equal(Object.hasOwn(expected, "legacyAppV2"), false);
    assert.deepEqual(
      createMainCurrentActiveAliasMappingSpec({
        execution,
        barrier,
        journalHistory: [prepared],
        runId: "800",
        runAttempt: "3",
      }).bindings.map(({ alias }) => alias),
      [
        "app.mento.org",
        "governance.mento.org",
        "reserve.mento.org",
        "ui.mento.org",
      ],
    );
    // Replaces the retired "pending App candidate" case: an active App whose
    // candidate lost its provider deployment is still rejected.
    const pendingApp = structuredClone(prepared);
    pendingApp.candidates.app.deploymentId = null;
    pendingApp.candidates.app.deploymentUrl = null;
    assert.throws(
      () =>
        createMainCurrentActiveDeploymentStateSpec({
          execution,
          barrier,
          journalHistory: [pendingApp],
          runId: "800",
          runAttempt: "3",
        }),
      /candidate|malformed|deployment/i,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The plan+stage-job state and mapping specs cover the ordinary targets only:
// the App hands over a candidate receipt, not a stage-job handoff, so its
// active-state artifacts come from the barrier-based producers above.
test("plan-derived state and mapping specs bind the ordinary stage handoffs", () => {
  const deploymentPlan = activePlan({
    deployments: ["governance", "reserve", "ui"],
  });
  const jobs = stageJobs(deploymentPlan);
  assert.deepEqual(Object.keys(jobs).toSorted(), [
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(deploymentPlan.planning.stagedTargets.includes("app"), false);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: jobs,
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const spec = createMainActiveDeploymentStateSpec({
    plan: deploymentPlan,
    journalHistory: [prepared],
    stageJobs: jobs,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(spec.activeTargets, ["governance", "reserve", "ui"]);
  for (const target of ["governance", "reserve", "ui"]) {
    assert.equal(
      spec.projects[target].deploymentId,
      jobs[target].handoff.candidate.deploymentId,
      target,
    );
    assert.equal(spec.projects[target].target, "production");
    assert.equal(spec.projects[target].customEnvironmentSlug, null);
  }
  assert.equal(spec.projects.app.expectedDisposition, null);
  assert.equal(spec.projects.app.deploymentId, null);
  assert.equal(spec.projects.app.target, "production");
  assert.equal(spec.projects.app.customEnvironmentSlug, null);

  // An active App binds the journal candidate its provider receipt created;
  // only the ordinary targets cross-check against a stage-result handoff.
  const appPlan = activePlan();
  const appJobs = stageJobs(appPlan);
  const appPrepared = createPreparedMainActiveJournal({
    plan: appPlan,
    stageJobs: appJobs,
    appCandidateReceipt: appReceipt(appPlan),
    runId: "800",
    runAttempt: "3",
  });
  const appSpec = createMainActiveDeploymentStateSpec({
    plan: appPlan,
    journalHistory: [appPrepared],
    stageJobs: appJobs,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(appSpec.activeTargets, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(appSpec.projects.app.expectedDisposition, "githubPrebuilt");
  assert.equal(
    appSpec.projects.app.deploymentId,
    appPrepared.candidates.app.deploymentId,
  );
  assert.equal(appSpec.projects.app.target, "production");
  assert.equal(appSpec.projects.app.customEnvironmentSlug, null);
  assert.deepEqual(
    createMainActiveAliasMappingSpec({
      plan: deploymentPlan,
      journalHistory: [prepared],
      runId: "800",
      runAttempt: "3",
    }).bindings.map(({ alias }) => alias),
    [
      "app.mento.org",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
    ],
  );
});

test("active public smoke materializer derives exact target records from the plan", () => {
  const deploymentPlan = activePlan({
    mainOwnershipMode: ownership({ reserve: MAIN_OWNERSHIP_MODES.SHADOW }),
  });
  const targetResults = Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      deploymentPlan.planning.activeTargets.includes(target)
        ? { runtime: runtimeSmoke(target), status: "passed", servedSha: SHA }
        : { runtime: null, status: "not-required", servedSha: null },
    ]),
  );
  const smokes = createMainActivePublicSmokes({
    plan: deploymentPlan,
    targetResults,
  });
  assert.deepEqual(smokes.reserve, {
    publicUrl: "https://reserve.mento.org/",
    runtime: null,
    servedSha: null,
    status: "not-required",
  });
  assert.throws(
    () =>
      createMainActivePublicSmokes({
        plan: deploymentPlan,
        targetResults: {
          ...targetResults,
          reserve: {
            runtime: runtimeSmoke("reserve"),
            status: "passed",
            servedSha: SHA,
          },
        },
      }),
    /reserve smoke result is inconsistent/,
  );
});

test("governance-only smoke materialization pipes through finalization and evidence unchanged", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const harness = activeHarness({ deploymentPlan });
  assert.equal(harness.appCandidateReceipt, null);
  assert.equal(harness.inputs.candidates.app, null);

  const transaction = await runMainActiveTransaction({
    plan: deploymentPlan,
    stageJobs: harness.stageJobs,
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: harness.adapters,
  });
  const history = transaction.journalHistory.slice(0, -1);
  const highest = history.at(-1);
  assert.equal(highest.status, "verified");

  const publicSmokes = createMainActivePublicSmokes({
    plan: deploymentPlan,
    targetResults: Object.fromEntries(
      ["app", "governance", "reserve", "ui"].map((target) => [
        target,
        target === "governance"
          ? {
              runtime: runtimeSmoke(target),
              status: "passed",
              servedSha: SHA,
            }
          : { runtime: null, status: "not-required", servedSha: null },
      ]),
    ),
  });
  assert.deepEqual(publicSmokes.app, {
    publicUrl: "https://app.mento.org/",
    runtime: null,
    servedSha: null,
    status: "not-required",
  });

  const stateProof = activeStateProof({
    deploymentPlan,
    journalHistory: history,
    jobs: harness.stageJobs,
    runId: "800",
    runAttempt: "3",
    additionalDeployments: {
      ui: [
        {
          deploymentId: "dpl_uicanceled123",
          response: {
            id: "dpl_uicanceled123",
            url: "https://ui-canceled.vercel.app",
            projectId: projectIds.ui,
            name: "ui.mento.org",
            readyState: "CANCELED",
            target: "production",
            customEnvironment: null,
            source: "git",
            meta: {
              githubCommitOrg: "mento-protocol",
              githubCommitRepo: "frontend-monorepo",
              githubCommitRef: "main",
              githubCommitSha: SHA,
            },
          },
        },
      ],
    },
  });
  assert.equal(stateProof.outcome, "proven");
  assert.deepEqual(stateProof.projects.ui.ids.inertCanceled, [
    "dpl_uicanceled123",
  ]);
  const boundFinalMappings = activeFinalMappings(harness);
  const finalized = reduceMainActiveTransition({
    preparedJournal: history[0],
    activeTargets: ["governance"],
    shadowTargets: [],
    stagedCandidates: harness.inputs.stagedCandidates,
    mainOwnershipMode: harness.ownershipMap,
    projectIds,
    history,
    event: {
      schema: MAIN_ACTIVE_EVENT_SCHEMA,
      kind: "finalize",
      uploadReceipt: {
        acknowledged: true,
        artifactName: mainTransactionJournalArtifactName(highest),
        artifactId: "91919",
        transactionId: highest.transactionId,
        sequence: highest.sequence,
      },
      freshSha: SHA,
      currentMappings: boundFinalMappings,
      publicSmokes,
      stateProof,
    },
  });
  assert.equal(finalized.journal.status, "committed");

  const evidence = createMainActiveDeploymentEvidence({
    plan: deploymentPlan,
    journalHistory: [...history, finalized.journal],
    freshness: transaction.freshness,
    finalMappings: activeFinalMappings(harness),
    publicSmokes,
    stateProof,
    rollbackStateTargets: [],
    publicServingMutationCommands: finalized.confirmedMutationCommands,
    recoveryOutcome: "not-required",
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
  });
  assert.deepEqual(evidence.publicSmokes, publicSmokes);
  assert.equal(evidence.stateProofSummary.targets.ui.counts.inertCanceled, 1);
  assert.deepEqual(Object.keys(evidence.stateProofSummary.targets.ui.counts), [
    "scanned",
    ...ACTIVE_STATE_CLASSIFICATIONS,
  ]);
  // MGP-18 retired the legacy App classification and its summary field.
  assert.equal(ACTIVE_STATE_CLASSIFICATIONS.includes("legacyV2"), false);
  assert.equal(ACTIVE_STATE_CLASSIFICATIONS.length, 7);
  assert.equal(Object.hasOwn(evidence.stateProofSummary, "legacyAppV2"), false);
});

test("active controller commits exact ordered mutations and emits canonical redacted evidence", async () => {
  const harness = activeHarness();
  const result = await runMainActiveTransaction({
    plan: harness.plan,
    stageJobs: harness.stageJobs,
    appCandidateReceipt: harness.appCandidateReceipt,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: harness.adapters,
  });
  assert.equal(result.outcome, "active-committed");
  assert.equal(result.highestJournalStatus, "committed");
  assert.equal(result.publicServingMutationCommands, 4);
  assert.deepEqual(
    result.journal.operations
      .filter((operation) => operation.state === "verified")
      .map((operation) => [operation.type, operation.target, operation.alias]),
    [
      ["promote", "governance", null],
      ["promote", "reserve", null],
      ["promote", "ui", null],
      // The App promote carries `app.mento.org` itself, so no bridge alias
      // operation follows it.
      ["promote", "app", null],
    ],
  );
  // Neither the retired legacy verb nor either retired bridge operation may
  // appear in a committed journal again.
  for (const retired of [
    "app_v3_deploy",
    "app_alias_set",
    "app_alias_restore",
  ]) {
    assert.equal(
      result.journal.operations.some((operation) => operation.type === retired),
      false,
      retired,
    );
  }
  // Every verified forward operation, App included, is verified at
  // `candidate`; `prior` is no longer an admissible verified App state.
  for (const operation of result.journal.operations.filter(
    (entry) => entry.state === "verified",
  )) {
    assert.equal(operation.mappingState, "candidate", operation.target);
    assert.equal(
      expectedVerifiedMappingStateFor(operation),
      "candidate",
      operation.target,
    );
  }

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
  assert.equal(evidence.orderedVerifiedOperations.length, 4);
  assert.equal(evidence.finalMappings.length, 4);
  assert.equal(
    evidence.stateProofSummary.proofSchema,
    ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA,
  );
  assert.deepEqual(evidence.recovery.rollbackStateTargets, []);
  // The committed active evidence pins its exact key order, including the
  // rider map. Riders are same-run observation, never release identity.
  assert.deepEqual(Object.keys(evidence), [
    "schema",
    "mode",
    "repository",
    "deploySha",
    "workflowDefinitionSha",
    "runId",
    "runAttempt",
    "workflowRunUrl",
    "planning",
    "riderAliases",
    "journal",
    "orderedVerifiedOperations",
    "freshness",
    "finalMappings",
    "publicSmokes",
    "stateProofSummary",
    "recovery",
    "publicServingMutationCommands",
    "outcome",
  ]);
  // Only promoted targets appear, and each entry is the bounded census shape.
  assert.deepEqual(
    Object.keys(evidence.riderAliases),
    evidence.planning.activeTargets,
  );
  assert.deepEqual(evidence.riderAliases.governance, {
    aliases: [
      "governancementoorg-git-main-mentolabs.vercel.app",
      "governancementoorg-mentolabs.vercel.app",
      "governancementoorg.vercel.app",
    ],
    omitted: 0,
  });
  const activeSummary = renderMainActiveDeploymentEvidence(evidence);
  assert.match(activeSummary, /Public-serving mutation commands: `4`/);
  assert.match(
    activeSummary,
    /- Rider domains moved with `app`: appmentoorg-git-main-mentolabs\.vercel\.app, appmentoorg-mentolabs\.vercel\.app, appmentoorg\.vercel\.app/,
  );
  // "none", truncation, and "unknown" are three distinct statements.
  const emptyRiders = structuredClone(evidence);
  emptyRiders.riderAliases.ui = { aliases: [], omitted: 0 };
  assert.match(
    renderMainActiveDeploymentEvidence(emptyRiders),
    /- Rider domains moved with `ui`: none/,
  );
  const truncatedRiders = structuredClone(evidence);
  truncatedRiders.riderAliases.ui = {
    aliases: ["uimentoorg.vercel.app"],
    omitted: 2,
  };
  assert.match(
    renderMainActiveDeploymentEvidence(truncatedRiders),
    /- Rider domains moved with `ui`: uimentoorg\.vercel\.app \(\+2 more, truncated\)/,
  );
  const unknownRiders = structuredClone(evidence);
  unknownRiders.riderAliases = null;
  assert.match(
    renderMainActiveDeploymentEvidence(unknownRiders),
    /- Rider domains moved: unknown \(no census in this job\)/,
  );
  const execution = releaseExecutionForPlan(harness.plan);
  assert.deepEqual(
    assertMainActiveTerminalEvidenceArtifact(evidence, {
      execution,
      runId: "800",
      runAttempt: "3",
      outcome: "active-committed",
    }),
    evidence,
  );
  // The terminal reader carries riders rather than re-deriving them, but still
  // holds them to the canonical shape and to the promoted-target scope.
  const unscopedRiders = structuredClone(evidence);
  unscopedRiders.riderAliases = {
    ...evidence.riderAliases,
    app: { aliases: ["governance.mento.org"], omitted: 0 },
  };
  assert.throws(
    () =>
      assertMainActiveTerminalEvidenceArtifact(unscopedRiders, {
        execution,
        runId: "800",
        runAttempt: "3",
        outcome: "active-committed",
      }),
    /Nested active rider domains app is not canonical/,
  );
  const unsortedRiders = structuredClone(evidence);
  unsortedRiders.riderAliases.ui = {
    aliases: ["uimentoorg.vercel.app", "uimentoorg-mentolabs.vercel.app"],
    omitted: 0,
  };
  assert.throws(
    () =>
      assertMainActiveTerminalEvidenceArtifact(unsortedRiders, {
        execution,
        runId: "800",
        runAttempt: "3",
        outcome: "active-committed",
      }),
    /Nested active rider domains ui is not canonical/,
  );
  const droppedRiders = structuredClone(evidence);
  delete droppedRiders.riderAliases;
  assert.throws(
    () =>
      assertMainActiveTerminalEvidenceArtifact(droppedRiders, {
        execution,
        runId: "800",
        runAttempt: "3",
        outcome: "active-committed",
      }),
    /Nested active deployment evidence contains forbidden or missing fields/,
  );
  const staleProofSchema = structuredClone(evidence);
  staleProofSchema.stateProofSummary.proofSchema = `${ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA}:stale`;
  assert.throws(
    () =>
      assertMainActiveTerminalEvidenceArtifact(staleProofSchema, {
        execution,
        runId: "800",
        runAttempt: "3",
        outcome: "active-committed",
      }),
    /state proof summary identity is invalid/,
  );
  const incompleteClassificationSummary = structuredClone(evidence);
  const requiredClassification = ACTIVE_STATE_CLASSIFICATIONS[0];
  delete incompleteClassificationSummary.stateProofSummary.targets.ui.counts[
    requiredClassification
  ];
  assert.throws(
    () =>
      assertMainActiveTerminalEvidenceArtifact(
        incompleteClassificationSummary,
        {
          execution,
          runId: "800",
          runAttempt: "3",
          outcome: "active-committed",
        },
      ),
    /forbidden or missing fields/,
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
        publicServingMutationCommands: 4,
        recoveryOutcome: "not-required",
        runId: "800",
        runAttempt: "3",
        workflowRunUrl: WORKFLOW_RUN_URL,
      }),
    /forbidden or missing fields/,
  );
});

test("production-shaped all-target terminal artifacts cover the four-operation committed journal", async () => {
  const harness = activeHarness();
  const transaction = await runMainActiveTransaction({
    plan: harness.plan,
    stageJobs: harness.stageJobs,
    appCandidateReceipt: harness.appCandidateReceipt,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: harness.adapters,
  });
  const execution = releaseExecutionForPlan(harness.plan);
  // Replaces the retired "the App candidate is discovered mid-activation"
  // reconstruction: every App journal already carries its staged candidate, so
  // the transaction's own history is the production-shaped history.
  const productionJournalHistory = transaction.journalHistory;
  for (const journal of productionJournalHistory) {
    assert.notEqual(journal.candidates.app, null);
    assert.match(journal.candidates.app.deploymentId, /^dpl_/);
  }
  for (let index = 1; index <= productionJournalHistory.length; index += 1) {
    try {
      assertMainActiveJournalHistory({
        journals: productionJournalHistory.slice(0, index),
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
      });
    } catch (error) {
      throw new Error(
        `production-shaped journal is invalid at snapshot ${index - 1}: ${error.message}`,
      );
    }
  }
  const stateProof = activeStateProof({
    deploymentPlan: harness.plan,
    journalHistory: productionJournalHistory,
    jobs: harness.stageJobs,
    runId: "800",
    runAttempt: "3",
  });
  const completeStateProof = terminalStateProof({ execution, stateProof });
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "active-committed",
    journalHistory: activeHistoryDocument(productionJournalHistory),
    finalMappings: providerMappings(execution, activeFinalMappings(harness)),
    publicSmokes: activePublicSmokes(transaction),
    stateProof: completeStateProof,
    finalCensus: completeStateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });

  assert.equal(transaction.publicServingMutationCommands, 4);
  assert.equal(
    productionJournalHistory.at(-1).sequence,
    productionJournalHistory.length - 1,
  );
  assert.deepEqual(
    transaction.journal.operations
      .filter((operation) => operation.state === "verified")
      .map((operation) => [operation.type, operation.target, operation.alias]),
    [
      ["promote", "governance", null],
      ["promote", "reserve", null],
      ["promote", "ui", null],
      // The App promote carries the reviewed App domain itself; the retired
      // bridge alias set has no slot left in a committed journal.
      ["promote", "app", null],
    ],
  );
  assert.deepEqual(artifacts.evidence.planning.activeTargets, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(Object.keys(artifacts.evidence.publicSmokes).sort(), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(artifacts.evidence.orderedVerifiedOperations.length, 4);
  assert.equal(artifacts.proofs.mutationCount, 4);
  // One prepared snapshot, three journals per promote, and the committed
  // snapshot: 1 + 4 * 3 + 1.
  assert.equal(artifacts.proofs.journal.artifact.length, 14);

  const evidenceBytes = Buffer.byteLength(
    `${JSON.stringify(artifacts.evidence)}\n`,
    "utf8",
  );
  const proofBytes = Buffer.byteLength(
    `${JSON.stringify(artifacts.proofs)}\n`,
    "utf8",
  );
  assert.ok(
    evidenceBytes <= 256 * 1024,
    `production-shaped terminal evidence uses ${evidenceBytes} bytes`,
  );
  assert.ok(
    proofBytes <= MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
    `production-shaped terminal proofs use ${proofBytes} bytes`,
  );

  const recoveryFailedArtifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "recovery-failed",
    journalHistory: activeHistoryDocument(productionJournalHistory),
    finalMappings: null,
    publicSmokes: null,
    stateProof: null,
    finalCensus: null,
    freshness: null,
    stageResults: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    recoveryFailedArtifacts.evidence.recoveryOutcome,
    "recovery-failed",
  );
  assert.deepEqual(recoveryFailedArtifacts.evidence.jobs, {
    waitForCi: "success",
    plan: "success",
    stageGovernance: "success",
    stageReserve: "success",
    stageUi: "success",
    coordinator: "failure",
    recovery: "failure",
  });
  assert.equal(recoveryFailedArtifacts.proofs.mutationCount, 4);
  assert.equal(recoveryFailedArtifacts.proofs.journal.artifact.length, 14);

  const recoveryFailedTerminal = createMainActiveTerminalHandoff({
    activeEvidence: recoveryFailedArtifacts.evidence,
    releaseManifest: execution.manifest,
    execution,
    proofs: recoveryFailedArtifacts.proofs,
    deploySha: SHA,
    upstreamRunId: "123456",
    upstreamRunAttempt: "2",
    workflowRunId: "800",
    producerRunAttempt: "3",
    repository: "mento-protocol/frontend-monorepo",
  });
  assert.equal(recoveryFailedTerminal.receipt.outcome, "recovery-failed");
  assert.deepEqual(
    restoreMainActiveTerminalEvidence({
      encodedReceipt: recoveryFailedTerminal.encodedReceipt,
      encodedEvidence: recoveryFailedTerminal.encodedEvidence,
      releaseManifest: execution.manifest,
      execution,
      deploySha: SHA,
      upstreamRunId: "123456",
      upstreamRunAttempt: "2",
      workflowRunId: "800",
      finalRunAttempt: "4",
      repository: "mento-protocol/frontend-monorepo",
    }).artifact,
    recoveryFailedArtifacts.evidence,
  );
  assert.ok(
    Buffer.byteLength(recoveryFailedTerminal.encodedReceipt, "utf8") <
      32 * 1024,
    "production-shaped recovery-failed receipt exceeds the workflow output bound",
  );
  assert.ok(
    Buffer.byteLength(recoveryFailedTerminal.encodedEvidence, "utf8") <
      64 * 1024,
    "production-shaped recovery-failed evidence exceeds the workflow output bound",
  );
});

test("execution-bound terminal artifacts derive committed and verified-noop proof from provider evidence and the current journal", async () => {
  const committedHarness = activeHarness({
    deploymentPlan: activePlan({ deployments: ["governance"] }),
  });
  const committed = await runMainActiveTransaction({
    plan: committedHarness.plan,
    stageJobs: committedHarness.stageJobs,
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: committedHarness.adapters,
  });
  const committedExecution = releaseExecutionForPlan(committedHarness.plan);
  const committedStateProof = activeStateProof({
    deploymentPlan: committedHarness.plan,
    journalHistory: committed.journalHistory,
    jobs: committedHarness.stageJobs,
    runId: "800",
    runAttempt: "3",
  });
  const committedTerminalStateProof = terminalStateProof({
    execution: committedExecution,
    stateProof: committedStateProof,
  });
  const committedArtifacts = createMainActiveTerminalArtifacts({
    execution: committedExecution,
    outcome: "active-committed",
    journalHistory: activeHistoryDocument(committed.journalHistory),
    finalMappings: providerMappings(
      committedExecution,
      activeFinalMappings(committedHarness),
    ),
    publicSmokes: activePublicSmokes(committed),
    stateProof: committedTerminalStateProof,
    finalCensus: committedTerminalStateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(committedArtifacts.evidence.schema, MAIN_ACTIVE_EVIDENCE_SCHEMA);
  assert.equal(
    committedArtifacts.evidence.publicServingMutationCommands,
    committed.publicServingMutationCommands,
  );
  assert.equal(committedArtifacts.proofs.journal.status, "committed");
  assert.deepEqual(
    assertMainActiveTerminalProofs(committedArtifacts.proofs).journal.artifact,
    committed.journalHistory,
  );
  // Replaces the retired App shadow build-proof slot: the terminal state proof
  // carries exactly these three keys and no App preparation of any kind.
  assert.deepEqual(Object.keys(committedTerminalStateProof).toSorted(), [
    "currentReleaseCandidates",
    "deploymentStateProof",
    "schema",
  ]);
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution: committedExecution,
        outcome: "active-committed",
        journalHistory: activeHistoryDocument(committed.journalHistory),
        finalMappings: providerMappings(
          committedExecution,
          activeFinalMappings(committedHarness),
        ),
        publicSmokes: activePublicSmokes(committed),
        stateProof: {
          ...committedTerminalStateProof,
          appShadowPreparation: { digest: null, preparation: null },
        },
        finalCensus: committedTerminalStateProof,
        freshness: null,
        runId: "800",
        runAttempt: "3",
      }),
    /forbidden or missing fields|lacks complete provider proof/,
  );
  const tamperedPriorProof = structuredClone(committedTerminalStateProof);
  tamperedPriorProof.deploymentStateProof.projects.governance.priorDeploymentId =
    "dpl_otherGovernancePrior123";
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution: committedExecution,
        outcome: "active-committed",
        journalHistory: activeHistoryDocument(committed.journalHistory),
        finalMappings: providerMappings(
          committedExecution,
          activeFinalMappings(committedHarness),
        ),
        publicSmokes: activePublicSmokes(committed),
        stateProof: tamperedPriorProof,
        finalCensus: tamperedPriorProof,
        freshness: null,
        runId: "800",
        runAttempt: "3",
      }),
    /deployment state proof prior conflicts/,
  );

  const noopPlan = activePlan({ deployments: ["governance"] });
  const noopExecution = releaseExecutionForPlan(noopPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: noopPlan,
    stageJobs: stageJobs(noopPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const priorMappings = Object.values(prepared.prior).flatMap((prior) =>
    prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const noopStateProof = activeStateProof({
    deploymentPlan: noopPlan,
    journalHistory: [prepared],
    jobs: stageJobs(noopPlan),
    runId: "800",
    runAttempt: "3",
  });
  const noopArtifacts = createMainActiveTerminalArtifacts({
    execution: noopExecution,
    outcome: "verified-noop",
    journalHistory: activeHistoryDocument([prepared]),
    finalMappings: providerMappings(noopExecution, priorMappings),
    publicSmokes: priorPublicSmokes(noopExecution),
    stateProof: noopStateProof,
    finalCensus: noopStateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    noopArtifacts.evidence.schema,
    MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
  );
  assert.equal(noopArtifacts.evidence.publicServingMutationCommands, 0);
  assert.equal(noopArtifacts.evidence.journal.highestStatus, "prepared");
  assert.equal(noopArtifacts.proofs.mutationCount, 0);
  assert.equal(noopArtifacts.proofs.journal.status, "not-applicable");

  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution: noopExecution,
        outcome: "verified-noop",
        journalHistory: activeHistoryDocument([prepared, started]),
        finalMappings: providerMappings(noopExecution, priorMappings),
        publicSmokes: priorPublicSmokes(noopExecution),
        stateProof: noopStateProof,
        finalCensus: noopStateProof,
        freshness: null,
        runId: "800",
        runAttempt: "3",
      }),
    /journal head conflicts/,
  );
  // MGP-18 retired the legacy App proof; the artifacts no longer emit one and
  // a supplied legacy snapshot is ignored rather than bound.
  const retiredLegacyArtifacts = createMainActiveTerminalArtifacts({
    execution: noopExecution,
    outcome: "verified-noop",
    journalHistory: activeHistoryDocument([prepared]),
    finalMappings: providerMappings(noopExecution, priorMappings),
    publicSmokes: priorPublicSmokes(noopExecution),
    stateProof: noopStateProof,
    finalCensus: noopStateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
    freshLegacyV2: [{ alias: "v2-app.mento.org" }],
  });
  assert.equal(
    Object.hasOwn(retiredLegacyArtifacts.proofs, "freshLegacyV2"),
    false,
  );
  assert.doesNotMatch(
    JSON.stringify(retiredLegacyArtifacts),
    /v2-app\.mento\.org/,
  );

  const supersededFreshness = createMainActiveFreshness({
    deploySha: SHA,
    observedSha: OTHER_SHA,
  });
  const supersededArtifacts = createMainActiveTerminalArtifacts({
    execution: noopExecution,
    outcome: "superseded-before-journal",
    journalHistory: [],
    finalMappings: null,
    publicSmokes: null,
    stateProof: null,
    finalCensus: null,
    freshness: supersededFreshness,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(
    supersededArtifacts.proofs.finalMapping.artifact,
    supersededFreshness,
  );
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution: noopExecution,
        outcome: "superseded-before-journal",
        journalHistory: [],
        finalMappings: null,
        publicSmokes: null,
        stateProof: null,
        finalCensus: null,
        freshness: createMainActiveFreshness({
          deploySha: SHA,
          observedSha: SHA,
        }),
        runId: "800",
        runAttempt: "3",
      }),
    /lacks exact freshness proof/,
  );
});

test("execution-bound recovered terminal artifacts prove rollback to every original prior", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const currentMappings = Object.values(started.prior).flatMap((prior) =>
    prior.aliases.map((alias) =>
      mapping(
        alias,
        alias === "governance.mento.org"
          ? started.candidates.governance
          : prior,
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
  let mappingState = "candidate";
  const recoveredHistory = [prepared, started];
  const recovered = await runMainActiveRecovery({
    recoveryPlan,
    adapters: {
      uploadJournal: async ({ artifactName, journal }) => {
        recoveredHistory.push(structuredClone(journal));
        return {
          acknowledged: true,
          artifactName,
          artifactId: String(8000 + journal.sequence),
        };
      },
      inspectMapping: async () => ({ mappingState }),
      ordinaryRollback: async () => {
        mappingState = "prior";
        return { outcome: "success" };
      },
      verifyMapping: async () => ({ mappingState }),
    },
  });
  assert.equal(recovered.journal.status, "recovered");
  const priorMappings = Object.values(recovered.journal.prior).flatMap(
    (prior) => prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const stateProof = activeStateProof({
    deploymentPlan,
    journalHistory: recoveredHistory,
    jobs: stageJobs(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "recovered",
    journalHistory: activeHistoryDocument(recoveredHistory),
    finalMappings: providerMappings(execution, priorMappings),
    publicSmokes: priorPublicSmokes(execution),
    stateProof,
    finalCensus: stateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(artifacts.evidence.schema, MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA);
  assert.equal(artifacts.evidence.recoveryOutcome, "recovered");
  assert.deepEqual(artifacts.proofs.rollbackTargets, ["governance"]);
  assert.equal(artifacts.proofs.journal.status, "recovered");
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution,
        outcome: "recovered",
        journalHistory: activeHistoryDocument(recoveredHistory),
        finalMappings: providerMappings(execution, [
          ...priorMappings.filter(
            ({ alias }) => alias !== "governance.mento.org",
          ),
          mapping(
            "governance.mento.org",
            recovered.journal.candidates.governance,
          ),
        ]),
        publicSmokes: priorPublicSmokes(execution),
        stateProof,
        finalCensus: stateProof,
        freshness: null,
        runId: "800",
        runAttempt: "3",
      }),
    /does not restore its prior/,
  );
});

test("recovered terminal preserves verified rollback evidence when final provider census is unproven", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  let mappingState = "candidate";
  const recoveredHistory = [prepared, started];
  const recovery = await runMainActiveRecovery({
    recoveryPlan: planMainActiveRecovery({
      journalHistory: recoveredHistory,
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
      currentMappings: Object.values(started.prior).flatMap((prior) =>
        prior.aliases.map((alias) =>
          mapping(
            alias,
            alias === "governance.mento.org"
              ? started.candidates.governance
              : prior,
          ),
        ),
      ),
      appCandidateMatches: [],
    }),
    adapters: {
      uploadJournal: async ({ artifactName, journal }) => {
        recoveredHistory.push(structuredClone(journal));
        return {
          acknowledged: true,
          artifactName,
          artifactId: String(8000 + journal.sequence),
        };
      },
      inspectMapping: async () => ({ mappingState }),
      ordinaryRollback: async () => {
        mappingState = "prior";
        return { outcome: "success" };
      },
      verifyMapping: async () => ({ mappingState }),
    },
  });
  const priorMappings = Object.values(recovery.journal.prior).flatMap((prior) =>
    prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const censusFailure = {
    schema: MAIN_ACTIVE_CENSUS_FAILURE_SCHEMA,
    phase: "recovery-final-active-proof",
    category: "provider-read-transport",
  };
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "recovered-census-unproven",
    journalHistory: activeHistoryDocument(recoveredHistory),
    finalMappings: providerMappings(execution, priorMappings),
    publicSmokes: priorPublicSmokes(execution),
    stateProof: null,
    finalCensus: censusFailure,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(artifacts.proofs.outcome, "recovered-census-unproven");
  assert.equal(artifacts.proofs.finalMapping.status, "passed");
  assert.equal(artifacts.proofs.publicSmoke.status, "passed");
  assert.equal(artifacts.proofs.finalCensus.status, "unsafe");
  assert.deepEqual(artifacts.proofs.finalCensus.artifact, censusFailure);
  assert.equal(artifacts.proofs.journal.status, "recovered");
  assert.equal(artifacts.evidence.errorCode, "RECOVERED_CENSUS_UNPROVEN");
  assert.deepEqual(artifacts.evidence.censusFailure, censusFailure);
  assert.equal(
    evaluateMainActiveFinalResults({
      execution,
      jobs: finalActiveJobs(deploymentPlan, {
        coordinator: "failure",
        recovery: "failure",
      }),
      coordinatorOutcome: "",
      recoveryOutcome: "recovered-census-unproven",
    }).failAfterEvidence,
    true,
  );
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution,
        outcome: "recovered-census-unproven",
        journalHistory: activeHistoryDocument(recoveredHistory),
        finalMappings: providerMappings(execution, priorMappings),
        publicSmokes: priorPublicSmokes(execution),
        stateProof: null,
        finalCensus: { ...censusFailure, category: "unbounded-provider-error" },
        freshness: null,
        runId: "800",
        runAttempt: "3",
      }),
    /category is unsupported/,
  );
});

test("manual terminal affected operations preserve ordinary, App, mixed, rollback, and unknown truth", () => {
  const manualize = (journal) =>
    finishMainTransactionRecovery(startMainTransactionRecovery(journal), {
      manualIntervention: true,
    });
  const complete = (journal, { mappingState, candidate = null }) => {
    const operationId = journal.operations.at(-1).operationId;
    const returned = recordMainTransactionCommandReturned(journal, {
      operationId,
      outcome: "success",
      candidate,
    });
    return recordMainTransactionVerified(returned, {
      operationId,
      mappingState,
    });
  };

  const ordinaryPlan = activePlan({ deployments: ["governance"] });
  const ordinaryPrepared = createPreparedMainActiveJournal({
    plan: ordinaryPlan,
    stageJobs: stageJobs(ordinaryPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const ordinaryForward = complete(
    startMainTransactionOperation(ordinaryPrepared, {
      type: "promote",
      target: "governance",
    }),
    { mappingState: "candidate" },
  );
  const ordinaryRecovering = startMainTransactionRecovery(ordinaryForward);
  const ordinaryRollbackStarted = startMainTransactionOperation(
    ordinaryRecovering,
    { type: "ordinary_rollback", target: "governance" },
  );
  const ordinaryRollbackId =
    ordinaryRollbackStarted.operations.at(-1).operationId;
  const ordinaryRollbackReturned = recordMainTransactionCommandReturned(
    ordinaryRollbackStarted,
    { operationId: ordinaryRollbackId, outcome: "success" },
  );
  const ordinaryRollbackVerified = recordMainTransactionVerified(
    ordinaryRollbackReturned,
    {
      operationId: ordinaryRollbackId,
      mappingState: "prior",
      rollbackState: "entered",
    },
  );
  const ordinaryManual = finishMainTransactionRecovery(
    ordinaryRollbackVerified,
    { manualIntervention: true },
  );
  assert.deepEqual(
    createMainTerminalAffectedOperations(ordinaryManual).map(
      ({ operationId, type, target, state, rollbackState }) => ({
        operationId,
        type,
        target,
        state,
        rollbackState,
      }),
    ),
    [
      {
        operationId: "op-0001",
        type: "promote",
        target: "governance",
        state: "verified",
        rollbackState: null,
      },
      {
        operationId: "op-0002",
        type: "ordinary_rollback",
        target: "governance",
        state: "verified",
        rollbackState: "entered",
      },
    ],
  );

  const appPlan = activePlan({ deployments: ["app"] });
  const appPrepared = createPreparedMainActiveJournal({
    plan: appPlan,
    stageJobs: stageJobs(appPlan),
    appCandidateReceipt: appReceipt(appPlan),
    runId: "800",
    runAttempt: "3",
  });
  // `app_v3_deploy` is not an operation type any more; the App promotes.
  // MGP-18 retired both bridge operations with it, so neither `app_alias_set`
  // nor `app_alias_restore` can re-enter a journal either.
  for (const retired of [
    "app_v3_deploy",
    "app_alias_set",
    "app_alias_restore",
  ]) {
    assert.throws(
      () =>
        startMainTransactionOperation(appPrepared, {
          type: retired,
          target: "app",
          alias: "app.mento.org",
        }),
      /Operation type is unsupported/,
      retired,
    );
  }
  const appDeployStarted = startMainTransactionOperation(appPrepared, {
    type: "promote",
    target: "app",
  });
  // The App promote now carries `app.mento.org` itself, so it is verified at
  // `candidate` like every other target. `prior` is no longer the expected
  // verified state for an App promote.
  assert.equal(
    expectedVerifiedMappingStateFor({ type: "promote", target: "app" }),
    "candidate",
  );
  assert.notEqual(
    expectedVerifiedMappingStateFor({ type: "promote", target: "app" }),
    "prior",
  );
  const appDeployVerified = complete(appDeployStarted, {
    mappingState: "candidate",
  });
  assert.deepEqual(appDeployVerified.prior.app.aliases, ["app.mento.org"]);
  assert.deepEqual(
    createMainTerminalAffectedOperations(manualize(appDeployVerified)).map(
      ({ type, target, alias }) => ({ type, target, alias }),
    ),
    [{ type: "promote", target: "app", alias: null }],
  );
  const unknownAppResult = recordMainTransactionCommandReturned(
    appDeployStarted,
    {
      operationId: appDeployStarted.operations.at(-1).operationId,
      outcome: "unknown",
    },
  );
  assert.deepEqual(
    createMainTerminalAffectedOperations(manualize(unknownAppResult)),
    [
      {
        operationId: "op-0001",
        target: "app",
        type: "promote",
        alias: null,
        state: "command_returned",
        commandOutcome: "unknown",
        mappingState: null,
        rollbackState: null,
      },
    ],
  );

  const mixedPlan = activePlan({ deployments: ["app", "governance"] });
  const mixedPrepared = createPreparedMainActiveJournal({
    plan: mixedPlan,
    stageJobs: stageJobs(mixedPlan),
    appCandidateReceipt: appReceipt(mixedPlan),
    runId: "800",
    runAttempt: "3",
  });
  const mixedOrdinary = complete(
    startMainTransactionOperation(mixedPrepared, {
      type: "promote",
      target: "governance",
    }),
    { mappingState: "candidate" },
  );
  const mixedAppUnknown = startMainTransactionOperation(mixedOrdinary, {
    type: "promote",
    target: "app",
  });
  const mixed = createMainTerminalAffectedOperations(
    manualize(mixedAppUnknown),
  );
  assert.deepEqual(
    mixed.map(({ type, target }) => ({ type, target })),
    [
      { type: "promote", target: "governance" },
      { type: "promote", target: "app" },
    ],
  );
  assert.deepEqual(mixed[1], {
    operationId: "op-0002",
    target: "app",
    type: "promote",
    alias: null,
    state: "started",
    commandOutcome: null,
    mappingState: null,
    rollbackState: null,
  });
});

test("manual terminal handoff binds its affected-operation set to the exact current-attempt journal", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const recovering = startMainTransactionRecovery(started);
  const manual = finishMainTransactionRecovery(recovering, {
    manualIntervention: true,
  });
  const history = [prepared, started, recovering, manual];
  const priorMappings = Object.values(manual.prior).flatMap((prior) =>
    prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const stateProof = activeStateProof({
    deploymentPlan,
    journalHistory: history,
    jobs: stageJobs(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "manual-intervention",
    journalHistory: activeHistoryDocument(history),
    finalMappings: providerMappings(execution, priorMappings),
    publicSmokes: null,
    stateProof,
    finalCensus: stateProof,
    freshness: null,
    stageResults: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(artifacts.proofs.rollbackTargets, []);
  assert.deepEqual(artifacts.proofs.affectedOperations, [
    {
      operationId: "op-0001",
      target: "governance",
      type: "promote",
      alias: null,
      state: "started",
      commandOutcome: null,
      mappingState: null,
      rollbackState: null,
    },
  ]);
  const terminal = createMainActiveTerminalHandoff({
    activeEvidence: artifacts.evidence,
    releaseManifest: execution.manifest,
    execution,
    proofs: artifacts.proofs,
    deploySha: SHA,
    upstreamRunId: "123456",
    upstreamRunAttempt: "2",
    workflowRunId: "800",
    producerRunAttempt: "3",
    repository: "mento-protocol/frontend-monorepo",
  });
  assert.deepEqual(
    terminal.receipt.affectedOperations,
    artifacts.proofs.affectedOperations,
  );

  const tampered = structuredClone(artifacts.proofs);
  tampered.affectedOperations[0].target = "reserve";
  assert.throws(
    () =>
      createMainActiveTerminalHandoff({
        activeEvidence: artifacts.evidence,
        releaseManifest: execution.manifest,
        execution,
        proofs: tampered,
        deploySha: SHA,
        upstreamRunId: "123456",
        upstreamRunAttempt: "2",
        workflowRunId: "800",
        producerRunAttempt: "3",
        repository: "mento-protocol/frontend-monorepo",
      }),
    /affected operations conflict with the journal/,
  );
});

test("recovery-failed terminal artifacts preserve a durable journal without recovery claims", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const returned = recordMainTransactionCommandReturned(started, {
    operationId: started.operations.at(-1).operationId,
    outcome: "success",
  });
  const verified = recordMainTransactionVerified(returned, {
    operationId: returned.operations.at(-1).operationId,
    mappingState: "candidate",
  });
  const committed = markMainTransactionCommitted(verified);
  const recovering = startMainTransactionRecovery(started);
  const cases = [
    {
      name: "prepared journal before a public-serving mutation",
      history: [prepared],
      expectedStarted: 0,
      expectedStatus: "prepared",
    },
    {
      name: "committed journal",
      history: [prepared, started, returned, verified, committed],
      expectedStarted: 1,
      expectedStatus: "committed",
    },
    {
      name: "durable nonterminal journal",
      history: [prepared, started],
      expectedStarted: 1,
      expectedStatus: "started",
    },
    {
      name: "recovering journal after a durable mutation start",
      history: [prepared, started, recovering],
      expectedStarted: 1,
      expectedStatus: "recovering",
    },
  ];

  for (const scenario of cases) {
    const artifacts = createMainActiveTerminalArtifacts({
      execution,
      outcome: "recovery-failed",
      journalHistory: activeHistoryDocument(scenario.history),
      finalMappings: null,
      publicSmokes: null,
      stateProof: null,
      finalCensus: null,
      freshness: null,
      stageResults: null,
      runId: "800",
      runAttempt: "3",
    });
    assert.equal(
      artifacts.evidence.schema,
      MAIN_ACTIVE_FAILURE_EVIDENCE_SCHEMA,
    );
    assert.equal(artifacts.evidence.recoveryOutcome, "recovery-failed");
    assert.deepEqual(
      artifacts.evidence.jobs,
      {
        waitForCi: "success",
        plan: "success",
        stageGovernance: "success",
        stageReserve: "skipped",
        stageUi: "skipped",
        coordinator: "failure",
        recovery: "failure",
      },
      scenario.name,
    );
    assert.equal(
      artifacts.evidence.errorCode,
      "RECOVERY_FAILED_AFTER_DURABLE_JOURNAL",
    );
    assert.equal(
      artifacts.evidence.journal.highestStatus,
      scenario.expectedStatus,
      scenario.name,
    );
    assert.equal(
      artifacts.evidence.publicServingMutationCommands,
      scenario.expectedStarted,
      scenario.name,
    );
    assert.equal(artifacts.proofs.outcome, "recovery-failed", scenario.name);
    assert.equal(
      artifacts.proofs.journal.status,
      "recovery-failed",
      scenario.name,
    );
    assert.deepEqual(artifacts.proofs.journal.artifact, scenario.history);
    assert.equal(artifacts.proofs.mutationCount, scenario.expectedStarted);
    assert.deepEqual(artifacts.proofs.rollbackTargets, []);
    assert.deepEqual(artifacts.proofs.affectedOperations, []);
    for (const proof of [
      artifacts.proofs.finalMapping,
      artifacts.proofs.finalCensus,
      artifacts.proofs.stateProof,
    ]) {
      assert.equal(proof.status, "unsafe", scenario.name);
      assert.deepEqual(proof.artifact, artifacts.evidence, scenario.name);
    }

    const terminal = createMainActiveTerminalHandoff({
      activeEvidence: artifacts.evidence,
      releaseManifest: execution.manifest,
      execution,
      proofs: artifacts.proofs,
      deploySha: SHA,
      upstreamRunId: "123456",
      upstreamRunAttempt: "2",
      workflowRunId: "800",
      producerRunAttempt: "3",
      repository: "mento-protocol/frontend-monorepo",
    });
    assert.equal(terminal.receipt.outcome, "recovery-failed", scenario.name);
    assert.deepEqual(
      restoreMainActiveTerminalEvidence({
        encodedReceipt: terminal.encodedReceipt,
        encodedEvidence: terminal.encodedEvidence,
        releaseManifest: execution.manifest,
        execution,
        deploySha: SHA,
        upstreamRunId: "123456",
        upstreamRunAttempt: "2",
        workflowRunId: "800",
        finalRunAttempt: "4",
        repository: "mento-protocol/frontend-monorepo",
      }).artifact,
      artifacts.evidence,
      scenario.name,
    );
  }

  const inputs = {
    execution,
    outcome: "recovery-failed",
    journalHistory: activeHistoryDocument([prepared, started]),
    finalMappings: null,
    publicSmokes: null,
    stateProof: null,
    finalCensus: null,
    freshness: null,
    stageResults: null,
    runId: "800",
    runAttempt: "3",
  };
  assert.throws(
    () => createMainActiveTerminalArtifacts({ ...inputs, journalHistory: [] }),
    /requires a durable journal/,
  );
  for (const field of [
    "finalMappings",
    "publicSmokes",
    "stateProof",
    "finalCensus",
    "freshness",
    "stageResults",
  ]) {
    assert.throws(
      () =>
        createMainActiveTerminalArtifacts({
          ...inputs,
          [field]: { unexpected: true },
        }),
      /cannot contain provider or stage proof/,
      field,
    );
  }
});

test("preparation failure terminal artifacts bind exact target results without provider claims", () => {
  const deploymentPlan = activePlan({
    deployments: ["governance", "reserve"],
  });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const stageResults = {
    schema: "vercel-main-stage-results:v2",
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
    results: {
      app: "skipped",
      governance: "failure",
      reserve: "success",
      ui: "skipped",
    },
    coordinatorResult: "success",
  };
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "preparation-failed-before-journal",
    journalHistory: [],
    finalMappings: null,
    publicSmokes: null,
    stateProof: null,
    finalCensus: null,
    freshness: null,
    stageResults,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    artifacts.evidence.schema,
    "vercel-main-active-preparation-failure-evidence:v1",
  );
  assert.deepEqual(artifacts.evidence.stageResults, stageResults);
  assert.equal(artifacts.proofs.producerJob, "recover-main-deployment");
  assert.equal(artifacts.proofs.finalMapping.status, "unsafe");
  assert.equal(artifacts.proofs.publicSmoke.status, "not-required");
  assert.equal(artifacts.proofs.journal.status, "not-applicable");
  assert.equal(artifacts.proofs.mutationCount, 0);
  assert.deepEqual(artifacts.proofs.rollbackTargets, []);
  assert.deepEqual(artifacts.proofs.affectedOperations, []);
  const terminal = createMainActiveTerminalHandoff({
    activeEvidence: artifacts.evidence,
    releaseManifest: execution.manifest,
    execution,
    proofs: artifacts.proofs,
    deploySha: SHA,
    upstreamRunId: "123456",
    upstreamRunAttempt: "2",
    workflowRunId: "800",
    producerRunAttempt: "3",
    repository: "mento-protocol/frontend-monorepo",
  });
  assert.equal(terminal.receipt.outcome, "preparation-failed-before-journal");
  assert.deepEqual(terminal.receipt.affectedOperations, []);
  assert.equal(
    restoreMainActiveTerminalEvidence({
      encodedReceipt: terminal.encodedReceipt,
      encodedEvidence: terminal.encodedEvidence,
      releaseManifest: execution.manifest,
      execution,
      deploySha: SHA,
      upstreamRunId: "123456",
      upstreamRunAttempt: "2",
      workflowRunId: "800",
      finalRunAttempt: "4",
      repository: "mento-protocol/frontend-monorepo",
    }).artifact.reason,
    "preparation-failed-before-journal",
  );

  for (const scenario of [
    {
      name: "coordinator failure after an ordinary stage succeeds",
      deployments: ["governance"],
      results: {
        app: "skipped",
        governance: "success",
        reserve: "skipped",
        ui: "skipped",
      },
      coordinatorResult: "failure",
    },
    {
      name: "selected ordinary stage cancelled",
      deployments: ["governance"],
      results: {
        app: "skipped",
        governance: "cancelled",
        reserve: "skipped",
        ui: "skipped",
      },
      coordinatorResult: "skipped",
    },
    {
      name: "coordinator skipped after selected ordinary stage succeeds",
      deployments: ["governance"],
      results: {
        app: "skipped",
        governance: "success",
        reserve: "skipped",
        ui: "skipped",
      },
      coordinatorResult: "skipped",
    },
  ]) {
    const scenarioPlan = activePlan({ deployments: scenario.deployments });
    const scenarioExecution = releaseExecutionForPlan(scenarioPlan);
    const result = createMainActiveTerminalArtifacts({
      execution: scenarioExecution,
      outcome: "preparation-failed-before-journal",
      journalHistory: [],
      finalMappings: null,
      publicSmokes: null,
      stateProof: null,
      finalCensus: null,
      freshness: null,
      stageResults: {
        schema: "vercel-main-stage-results:v2",
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
        results: scenario.results,
        coordinatorResult: scenario.coordinatorResult,
      },
      runId: "800",
      runAttempt: "3",
    });
    assert.deepEqual(
      result.evidence.stageResults.results,
      scenario.results,
      scenario.name,
    );
    assert.equal(
      result.evidence.stageResults.coordinatorResult,
      scenario.coordinatorResult,
      scenario.name,
    );
  }

  for (const [name, mutate, pattern] of [
    [
      "selected skipped",
      (value) => {
        value.results.governance = "skipped";
      },
      /do not prove a pre-journal failure/,
    ],
    [
      "no selected failure",
      (value) => {
        value.results.governance = "success";
      },
      /do not prove a pre-journal failure/,
    ],
    [
      "unselected success",
      (value) => {
        value.results.ui = "success";
      },
      /Unselected terminal preparation must be skipped/,
    ],
    [
      "wrong attempt",
      (value) => {
        value.runAttempt = "2";
      },
      /identity conflicts/,
    ],
    [
      "missing App result",
      (value) => {
        delete value.results.app;
      },
      /forbidden or missing fields/,
    ],
  ]) {
    const invalid = structuredClone(stageResults);
    mutate(invalid);
    assert.throws(
      () =>
        createMainActiveTerminalArtifacts({
          execution,
          outcome: "preparation-failed-before-journal",
          journalHistory: [],
          finalMappings: null,
          publicSmokes: null,
          stateProof: null,
          finalCensus: null,
          freshness: null,
          stageResults: invalid,
          runId: "800",
          runAttempt: "3",
        }),
      pattern,
      name,
    );
  }
  const appSelectedPlan = activePlan({
    deployments: ["app", "governance"],
  });
  const appSelectedExecution = releaseExecutionForPlan(appSelectedPlan);
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution: appSelectedExecution,
        outcome: "preparation-failed-before-journal",
        journalHistory: [],
        finalMappings: null,
        publicSmokes: null,
        stateProof: null,
        finalCensus: null,
        freshness: null,
        stageResults: {
          schema: "vercel-main-stage-results:v2",
          deploySha: SHA,
          runId: "800",
          runAttempt: "3",
          results: {
            app: "skipped",
            governance: "success",
            reserve: "skipped",
            ui: "skipped",
          },
          coordinatorResult: "success",
        },
        runId: "800",
        runAttempt: "3",
      }),
    /do not prove a pre-journal failure/,
  );
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution,
        outcome: "preparation-failed-before-journal",
        journalHistory: [],
        finalMappings: providerMappings(execution, []),
        publicSmokes: null,
        stateProof: null,
        finalCensus: null,
        freshness: null,
        stageResults,
        runId: "800",
        runAttempt: "3",
      }),
    /cannot contain journal or provider proof/,
  );
});

test("terminal evidence restore renders preparation failure evidence", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "vercel-main-preparation-failure-restore-"),
  );
  try {
    const deploymentPlan = activePlan();
    const execution = releaseExecutionForPlan(deploymentPlan);
    const artifacts = createMainActiveTerminalArtifacts({
      execution,
      outcome: "preparation-failed-before-journal",
      journalHistory: [],
      finalMappings: null,
      publicSmokes: null,
      stateProof: null,
      finalCensus: null,
      freshness: null,
      stageResults: {
        schema: "vercel-main-stage-results:v2",
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
        results: {
          app: "skipped",
          governance: "failure",
          reserve: "failure",
          ui: "failure",
        },
        coordinatorResult: "failure",
      },
      runId: "800",
      runAttempt: "3",
    });
    const terminal = createMainActiveTerminalHandoff({
      activeEvidence: artifacts.evidence,
      releaseManifest: execution.manifest,
      execution,
      proofs: artifacts.proofs,
      deploySha: SHA,
      upstreamRunId: "123456",
      upstreamRunAttempt: "2",
      workflowRunId: "800",
      producerRunAttempt: "3",
      repository: "mento-protocol/frontend-monorepo",
    });
    const executionPath = join(directory, "execution.json");
    const manifestPath = join(directory, "manifest.json");
    const evidencePath = join(directory, "evidence.json");
    const summaryPath = join(directory, "summary.md");
    writeFileSync(executionPath, JSON.stringify(execution));
    writeFileSync(manifestPath, JSON.stringify(execution.manifest));
    writeFileSync(summaryPath, "");

    const restored = await runMainDeploymentCli({
      argv: [
        "terminal-evidence-restore",
        "--evidence",
        terminal.encodedEvidence,
        "--execution",
        executionPath,
        "--manifest",
        manifestPath,
        "--output",
        evidencePath,
        "--receipt",
        terminal.encodedReceipt,
      ],
      values: {
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "4",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    });

    assert.deepEqual(restored.artifact, artifacts.evidence);
    assert.deepEqual(
      JSON.parse(readFileSync(evidencePath, "utf8")),
      artifacts.evidence,
    );
    const summary = readFileSync(summaryPath, "utf8");
    assert.match(
      summary,
      /^### Vercel main active preparation failure evidence/m,
    );
    assert.match(summary, /`governance:failure`/);
    assert.match(summary, /Public-serving mutation commands: `0`/);
    assert.doesNotMatch(summary, /active deployment failure evidence/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminal evidence CLI creates a bounded receipt and restores committed evidence on a later attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-terminal-"));
  try {
    const harness = activeHarness();
    const transaction = await runMainActiveTransaction({
      plan: harness.plan,
      stageJobs: harness.stageJobs,
      appCandidateReceipt: harness.appCandidateReceipt,
      runId: "800",
      runAttempt: "3",
      journalHistory: [],
      adapters: harness.adapters,
    });
    const stateProof = activeStateProof({
      deploymentPlan: harness.plan,
      journalHistory: transaction.journalHistory,
      jobs: harness.stageJobs,
      runId: "800",
      runAttempt: "3",
    });
    const evidence = createMainActiveDeploymentEvidence({
      plan: harness.plan,
      journalHistory: transaction.journalHistory,
      freshness: transaction.freshness,
      finalMappings: activeFinalMappings(harness),
      publicSmokes: activePublicSmokes(transaction),
      stateProof,
      rollbackStateTargets: [],
      publicServingMutationCommands: transaction.publicServingMutationCommands,
      recoveryOutcome: "not-required",
      runId: "800",
      runAttempt: "3",
      workflowRunUrl: WORKFLOW_RUN_URL,
    });
    const execution = releaseExecutionForPlan(harness.plan);
    const manifest = execution.manifest;
    const proofs = committedTerminalProofs({
      evidence,
      journalHistory: transaction.journalHistory,
      stateProof,
      execution,
    });
    const canonicalProofJson = `${JSON.stringify(proofs)}\n`;
    const canonicalProofBytes = Buffer.byteLength(canonicalProofJson, "utf8");
    assert.ok(
      canonicalProofBytes <= MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
      `canonical terminal proofs use ${canonicalProofBytes} bytes`,
    );
    assert.equal(
      assertMainActiveTerminalProofs(proofs).outcome,
      "active-committed",
    );
    assert.throws(
      () =>
        assertMainActiveTerminalProofs({
          ...proofs,
          schema: "vercel-main-active-terminal-proofs:v1",
        }),
      /schema is unsupported/,
    );
    assert.deepEqual(
      assertMainActiveTerminalEvidenceArtifact(evidence, {
        execution,
        runId: "800",
        runAttempt: "3",
        outcome: "active-committed",
      }),
      evidence,
    );
    assert.throws(
      () =>
        createMainActiveTerminalHandoff({
          activeEvidence: evidence,
          releaseManifest: manifest,
          execution,
          proofs: {
            ...proofs,
            finalCensus: {
              status: "passed",
              artifact: { forged: "unbound-census" },
            },
          },
          deploySha: SHA,
          upstreamRunId: "123456",
          upstreamRunAttempt: "2",
          workflowRunId: "800",
          producerRunAttempt: "3",
          repository: "mento-protocol/frontend-monorepo",
        }),
      /final census proof conflicts with canonical evidence/,
    );

    let recoveryJournal = startMainTransactionRecovery(
      transaction.journalHistory.at(-2),
    );
    const maximalRecoveryHistory = [
      ...transaction.journalHistory.slice(0, -1),
      recoveryJournal,
    ];
    // The maximal compensation set is exactly one rollback per promotable
    // target. MGP-18 retired the extra bridge alias-restore slots, so no
    // alias-carrying recovery intent can enlarge this set again.
    const maximalRecoveryIntents = MAIN_PROMOTABLE_TARGETS.map((target) => ({
      type: "ordinary_rollback",
      target,
      alias: null,
    }));
    assert.equal(
      maximalRecoveryIntents.length,
      MAIN_ACTIVE_MAX_RECOVERY_TRANSITIONS,
    );
    assert.equal(
      maximalRecoveryIntents.every((intent) => intent.alias === null),
      true,
    );
    assert.throws(
      () =>
        startMainTransactionOperation(recoveryJournal, {
          type: "app_alias_restore",
          target: "app",
          alias: recoveryJournal.prior.app.aliases[0],
        }),
      /Operation type is unsupported/,
    );
    for (const intent of maximalRecoveryIntents) {
      recoveryJournal = startMainTransactionOperation(recoveryJournal, intent);
      maximalRecoveryHistory.push(recoveryJournal);
      const operationId = recoveryJournal.operations.at(-1).operationId;
      recoveryJournal = recordMainTransactionCommandReturned(recoveryJournal, {
        operationId,
        outcome: "success",
      });
      maximalRecoveryHistory.push(recoveryJournal);
      recoveryJournal = recordMainTransactionVerified(recoveryJournal, {
        operationId,
        mappingState: "prior",
        rollbackState: intent.type === "ordinary_rollback" ? "entered" : null,
      });
      maximalRecoveryHistory.push(recoveryJournal);
    }
    recoveryJournal = finishMainTransactionRecovery(recoveryJournal);
    maximalRecoveryHistory.push(recoveryJournal);
    assertMainActiveJournalHistory({
      journals: maximalRecoveryHistory,
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
    });
    const maximalHistoryDocument = activeHistoryDocument(
      maximalRecoveryHistory,
    );
    const maximalHistoryJson = `${JSON.stringify(maximalHistoryDocument)}\n`;
    const maximalHistoryBytes = Buffer.byteLength(maximalHistoryJson, "utf8");
    assert.ok(
      maximalHistoryBytes > 256 * 1024,
      `maximal journal history unexpectedly uses only ${maximalHistoryBytes} bytes`,
    );
    assert.ok(
      maximalHistoryBytes <= MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES,
      `maximal journal history uses ${maximalHistoryBytes} bytes`,
    );
    const maximalPriorMappings = Object.values(recoveryJournal.prior).flatMap(
      (prior) => prior.aliases.map((alias) => mapping(alias, prior)),
    );
    const maximalRecoveryStateProof = activeStateProof({
      deploymentPlan: harness.plan,
      journalHistory: maximalRecoveryHistory,
      jobs: harness.stageJobs,
      runId: "800",
      runAttempt: "3",
    });
    const maximalRecoveryArtifacts = createMainActiveTerminalArtifacts({
      execution,
      outcome: "recovered",
      journalHistory: maximalHistoryDocument,
      finalMappings: providerMappings(execution, maximalPriorMappings),
      publicSmokes: priorPublicSmokes(execution),
      stateProof: maximalRecoveryStateProof,
      finalCensus: maximalRecoveryStateProof,
      freshness: null,
      runId: "800",
      runAttempt: "3",
    });
    const maximalProofJson = `${JSON.stringify(maximalRecoveryArtifacts.proofs)}\n`;
    const maximalProofBytes = Buffer.byteLength(maximalProofJson, "utf8");
    // The load-bearing claim is unchanged: the maximal recovery case still
    // exceeds the 256 KiB default JSON cap, so the 1 MiB proofs budget is
    // required. Re-pinned for the four-slot topology — MGP-18 retired the
    // bridge alias-restore slot, which shrank the maximal journal.
    assert.ok(
      maximalProofBytes > 256 * 1024,
      `maximal recovery proofs unexpectedly use only ${maximalProofBytes} bytes`,
    );
    assert.ok(
      maximalProofBytes > 320 * 1024,
      `maximal recovery proofs unexpectedly use only ${maximalProofBytes} bytes`,
    );
    assert.ok(
      maximalProofBytes <= MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
      `maximal recovery proofs use ${maximalProofBytes} bytes`,
    );

    const executionPath = join(directory, "execution.json");
    const manifestPath = join(directory, "manifest.json");
    const proofPath = join(directory, "proofs.json");
    const activeEvidencePath = join(directory, "active-evidence.json");
    const receiptPath = join(directory, "receipt.json");
    const terminalEvidencePath = join(directory, "terminal-evidence.json");
    const restoredPath = join(directory, "restored.json");
    const githubOutput = join(directory, "github-output");
    const summary = join(directory, "summary.md");
    for (const [path, value] of [
      [executionPath, execution],
      [manifestPath, manifest],
      [proofPath, proofs],
      [activeEvidencePath, evidence],
    ]) {
      writeFileSync(path, `${JSON.stringify(value)}\n`);
    }
    writeFileSync(githubOutput, "");
    writeFileSync(summary, "");
    const createResult = await runMainDeploymentCli({
      argv: [
        "terminal-evidence-create",
        "--active-evidence",
        activeEvidencePath,
        "--evidence-output",
        terminalEvidencePath,
        "--execution",
        executionPath,
        "--manifest",
        manifestPath,
        "--proofs",
        proofPath,
        "--receipt-output",
        receiptPath,
      ],
      values: {
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_OUTPUT: githubOutput,
      },
    });
    assert.equal(createResult.receipt.outcome, "active-committed");
    assert.equal(
      createResult.receipt.releasePlanDigest,
      manifest.releasePlanDigest,
    );
    assert.equal(
      createResult.receipt.releaseExecutionDigest,
      digestMainReleaseExecution(execution),
    );
    assert.notEqual(
      createResult.receipt.releaseExecutionDigest,
      createResult.receipt.releasePlanDigest,
    );
    assert.ok(createResult.receipt.digest.match(/^[a-f0-9]{64}$/));
    assert.ok(Buffer.byteLength(createResult.encodedReceipt) < 32 * 1024);
    assert.ok(Buffer.byteLength(createResult.encodedEvidence) < 64 * 1024);
    assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
    assert.equal(statSync(terminalEvidencePath).mode & 0o777, 0o600);
    const maximalHistoryPath = join(directory, "maximal-journal-history.json");
    writeFileSync(maximalHistoryPath, maximalHistoryJson);
    await runMainDeploymentCli({
      argv: [
        "active-recovery-mapping-spec",
        "--journal-history",
        maximalHistoryPath,
        "--output",
        join(directory, "maximal-recovery-mapping-spec.json"),
      ],
      values: {
        DEPLOY_SHA: SHA,
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
      },
    });
    const oversizedHistoryPath = join(
      directory,
      "oversized-journal-history.json",
    );
    writeFileSync(
      oversizedHistoryPath,
      `${maximalHistoryJson}${" ".repeat(
        MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES - maximalHistoryBytes + 1,
      )}`,
    );
    await assert.rejects(
      runMainDeploymentCli({
        argv: [
          "active-recovery-mapping-spec",
          "--journal-history",
          oversizedHistoryPath,
          "--output",
          join(directory, "oversized-recovery-mapping-spec.json"),
        ],
        values: {
          DEPLOY_SHA: SHA,
          GITHUB_RUN_ID: "800",
          GITHUB_RUN_ATTEMPT: "3",
        },
      }),
      /Active recovery mapping-spec journal history exceeds its size limit/,
    );
    const maximalProofPath = join(directory, "maximal-recovery-proofs.json");
    const maximalEvidencePath = join(
      directory,
      "maximal-recovery-active-evidence.json",
    );
    writeFileSync(maximalProofPath, maximalProofJson);
    writeFileSync(
      maximalEvidencePath,
      `${JSON.stringify(maximalRecoveryArtifacts.evidence)}\n`,
    );
    const maximalGithubOutput = join(
      directory,
      "github-output-maximal-recovery",
    );
    writeFileSync(maximalGithubOutput, "");
    const maximalCreateResult = await runMainDeploymentCli({
      argv: [
        "terminal-evidence-create",
        "--active-evidence",
        maximalEvidencePath,
        "--evidence-output",
        join(directory, "maximal-recovery-terminal-evidence.json"),
        "--execution",
        executionPath,
        "--manifest",
        manifestPath,
        "--proofs",
        maximalProofPath,
        "--receipt-output",
        join(directory, "maximal-recovery-receipt.json"),
      ],
      values: {
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_OUTPUT: maximalGithubOutput,
      },
    });
    assert.equal(maximalCreateResult.receipt.outcome, "recovered");
    const boundaryProofPath = join(directory, "proofs-at-size-limit.json");
    const boundaryBytes =
      MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES - maximalProofBytes;
    writeFileSync(
      boundaryProofPath,
      `${maximalProofJson}${" ".repeat(boundaryBytes)}`,
    );
    const boundaryGithubOutput = join(directory, "github-output-at-size-limit");
    writeFileSync(boundaryGithubOutput, "");
    await runMainDeploymentCli({
      argv: [
        "terminal-evidence-create",
        "--active-evidence",
        maximalEvidencePath,
        "--evidence-output",
        join(directory, "terminal-evidence-at-size-limit.json"),
        "--execution",
        executionPath,
        "--manifest",
        manifestPath,
        "--proofs",
        boundaryProofPath,
        "--receipt-output",
        join(directory, "receipt-at-size-limit.json"),
      ],
      values: {
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_OUTPUT: boundaryGithubOutput,
      },
    });
    const oversizedProofPath = join(directory, "proofs-over-size-limit.json");
    writeFileSync(
      oversizedProofPath,
      `${maximalProofJson}${" ".repeat(boundaryBytes + 1)}`,
    );
    await assert.rejects(
      runMainDeploymentCli({
        argv: [
          "terminal-evidence-create",
          "--active-evidence",
          maximalEvidencePath,
          "--evidence-output",
          join(directory, "terminal-evidence-over-size-limit.json"),
          "--execution",
          executionPath,
          "--manifest",
          manifestPath,
          "--proofs",
          oversizedProofPath,
          "--receipt-output",
          join(directory, "receipt-over-size-limit.json"),
        ],
        values: {
          DEPLOY_SHA: SHA,
          UPSTREAM_RUN_ID: "123456",
          UPSTREAM_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "800",
          GITHUB_RUN_ATTEMPT: "3",
          GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
          GITHUB_OUTPUT: boundaryGithubOutput,
        },
      }),
      /Canonical active terminal proofs exceeds its size limit/,
    );
    const outputs = Object.fromEntries(
      readFileSync(githubOutput, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
    assert.deepEqual(Object.keys(outputs), ["receipt", "evidence"]);

    const restored = await runMainDeploymentCli({
      argv: [
        "terminal-evidence-restore",
        "--evidence",
        outputs.evidence,
        "--execution",
        executionPath,
        "--manifest",
        manifestPath,
        "--output",
        restoredPath,
        "--receipt",
        outputs.receipt,
      ],
      values: {
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "4",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    assert.deepEqual(restored.artifact, evidence);
    assert.deepEqual(JSON.parse(readFileSync(restoredPath, "utf8")), evidence);
    assert.match(readFileSync(summary, "utf8"), /active deployment evidence/);
    assert.throws(
      () =>
        restoreMainActiveTerminalEvidence({
          encodedReceipt: outputs.receipt,
          encodedEvidence: outputs.evidence,
          releaseManifest: manifest,
          execution,
          deploySha: SHA,
          upstreamRunId: "123456",
          upstreamRunAttempt: "3",
          workflowRunId: "800",
          finalRunAttempt: "4",
          repository: "mento-protocol/frontend-monorepo",
        }),
      /identity conflicts with the execution/,
    );
    assert.throws(
      () =>
        restoreMainActiveTerminalEvidence({
          encodedReceipt: outputs.receipt,
          encodedEvidence: outputs.evidence,
          releaseManifest: manifest,
          execution,
          deploySha: SHA,
          upstreamRunId: "123456",
          upstreamRunAttempt: "2",
          workflowRunId: "800",
          finalRunAttempt: "2",
          repository: "mento-protocol/frontend-monorepo",
        }),
      /producer attempt exceeds final attempt/,
    );
    const changedSelection = createMainReleaseSelection({
      providerDiscoveryDigest: "b".repeat(64),
      planningSnapshotDigest: execution.selection.planningSnapshotDigest,
      rollbackOnlyTargets: execution.selection.rollbackOnlyTargets,
      projectIds: execution.selection.projectIds,
      mode: execution.selection.mode,
      mainOwnershipMode: execution.selection.mainOwnershipMode,
      selectedManifest: manifest,
    });
    assert.throws(
      () =>
        restoreMainActiveTerminalEvidence({
          encodedReceipt: outputs.receipt,
          encodedEvidence: outputs.evidence,
          releaseManifest: manifest,
          execution: {
            ...execution,
            selection: {
              ...execution.selection,
              providerDiscoveryDigest: "d".repeat(64),
            },
          },
          deploySha: SHA,
          upstreamRunId: "123456",
          upstreamRunAttempt: "2",
          workflowRunId: "800",
          finalRunAttempt: "4",
          repository: "mento-protocol/frontend-monorepo",
        }),
      /releaseExecutionDigest conflicts/,
    );
    for (const [changedExecution, changedAttempt] of [
      [
        {
          ...execution,
          upstream: {
            ...execution.upstream,
            runAttempt: "3",
            runUrl:
              "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123456/attempts/3",
          },
        },
        "3",
      ],
      [{ ...execution, selection: changedSelection }, "2"],
    ]) {
      assert.throws(
        () =>
          restoreMainActiveTerminalEvidence({
            encodedReceipt: outputs.receipt,
            encodedEvidence: outputs.evidence,
            releaseManifest: manifest,
            execution: changedExecution,
            deploySha: SHA,
            upstreamRunId: "123456",
            upstreamRunAttempt: changedAttempt,
            workflowRunId: "800",
            finalRunAttempt: "4",
            repository: "mento-protocol/frontend-monorepo",
          }),
        /upstreamRunAttempt conflicts|releaseExecutionDigest conflicts/,
      );
    }
    assert.throws(
      () =>
        createMainActiveTerminalHandoff({
          activeEvidence: evidence,
          releaseManifest: manifest,
          execution,
          proofs: {
            ...proofs,
            releaseExecutionDigest: manifest.releasePlanDigest,
          },
          deploySha: SHA,
          upstreamRunId: "123456",
          upstreamRunAttempt: "2",
          workflowRunId: "800",
          producerRunAttempt: "3",
          repository: "mento-protocol/frontend-monorepo",
        }),
      /proofs conflict with release execution/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("terminal evidence preserves every safe-noop outcome", () => {
  const cases = [
    {
      reason: "no-target",
      deploymentPlan: activePlan({ deployments: [] }),
      coordinatorOutcome: "no-target",
      statuses: [
        "not-required",
        "not-required",
        "not-required",
        "not-required",
      ],
    },
    {
      reason: "superseded-before-journal",
      deploymentPlan: activePlan({ deployments: ["governance"] }),
      coordinatorOutcome: "superseded-before-journal",
      statuses: ["superseded", "superseded", "superseded", "not-required"],
    },
    {
      reason: "shadow-prepared",
      deploymentPlan: activePlan({
        deployments: ["governance"],
        mainOwnershipMode: ownership({
          governance: MAIN_OWNERSHIP_MODES.SHADOW,
        }),
      }),
      coordinatorOutcome: "shadow-prepared",
      statuses: ["passed", "passed", "prepared", "passed"],
    },
  ];
  for (const {
    reason,
    deploymentPlan,
    coordinatorOutcome,
    statuses,
  } of cases) {
    const execution = releaseExecutionForPlan(deploymentPlan);
    const manifest = execution.manifest;
    const evidence = createMainActiveSafeNoopEvidence({
      plan: deploymentPlan,
      jobs: activeJobs(deploymentPlan),
      coordinatorOutcome,
      recoveryOutcome: "not-required",
      verifiedDeploySha: SHA,
      workflowDefinitionSha: SHA,
      runId: "800",
      runAttempt: "3",
      workflowRunUrl: WORKFLOW_RUN_URL,
    });
    const unchangedMappings = Object.values(execution.manifest.originalPriors)
      .flatMap((state) =>
        state.aliases.map((alias) => ({
          alias,
          deploymentId: state.deploymentId,
          deploymentUrl: state.deploymentUrl,
        })),
      )
      .toSorted((left, right) => left.alias.localeCompare(right.alias));
    const unchangedPublicSmokes = createMainActivePublicSmokes({
      plan: deploymentPlan,
      targetResults: Object.fromEntries(
        ["app", "governance", "reserve", "ui"].map((target) => [
          target,
          deploymentPlan.planning.activeTargets.includes(target)
            ? {
                runtime: runtimeSmoke(target),
                status: "passed",
                servedSha: SHA,
              }
            : { runtime: null, status: "not-required", servedSha: null },
        ]),
      ),
    });
    const shadowTerminalState =
      reason === "shadow-prepared"
        ? terminalStateProof({ execution, stateProof: null })
        : null;
    const proof = (status, name) => ({
      status,
      artifact:
        status === "not-required"
          ? null
          : reason === "shadow-prepared" && name === "final-mapping"
            ? unchangedMappings
            : reason === "shadow-prepared" && name === "final-census"
              ? shadowTerminalState
              : reason === "shadow-prepared" && name === "state-proof"
                ? shadowTerminalState
                : reason === "shadow-prepared" && name === "public-smoke"
                  ? unchangedPublicSmokes
                  : { deploySha: SHA, name, outcome: reason },
    });
    const proofs = {
      schema: MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA,
      releaseId: manifest.releaseId,
      releaseManifestDigest: digestJson(manifest),
      releaseExecutionDigest: digestMainReleaseExecution(execution),
      producerJob: "activate-and-verify",
      outcome: reason,
      finalMapping: proof(statuses[0], "final-mapping"),
      finalCensus: proof(statuses[1], "final-census"),
      stateProof: proof(statuses[2], "state-proof"),
      publicSmoke: proof(statuses[3], "public-smoke"),
      mutationCount: 0,
      rollbackTargets: [],
      affectedOperations: [],
      journal: { status: "not-applicable", artifact: null },
    };
    const terminal = createMainActiveTerminalHandoff({
      activeEvidence: evidence,
      releaseManifest: manifest,
      execution,
      proofs,
      deploySha: SHA,
      upstreamRunId: "123456",
      upstreamRunAttempt: "2",
      workflowRunId: "800",
      producerRunAttempt: "3",
      repository: "mento-protocol/frontend-monorepo",
    });
    assert.equal(terminal.receipt.outcome, reason);
    assert.equal(Object.hasOwn(terminal.receipt, "freshLegacyV2"), false);
    assert.deepEqual(
      restoreMainActiveTerminalEvidence({
        encodedReceipt: terminal.encodedReceipt,
        encodedEvidence: terminal.encodedEvidence,
        releaseManifest: manifest,
        execution,
        deploySha: SHA,
        upstreamRunId: "123456",
        upstreamRunAttempt: "2",
        workflowRunId: "800",
        finalRunAttempt: "9",
        repository: "mento-protocol/frontend-monorepo",
      }).artifact,
      evidence,
    );
    // MGP-18 retired the legacy App proof; it may not re-enter the handoff.
    assert.throws(
      () =>
        createMainActiveTerminalHandoff({
          activeEvidence: evidence,
          releaseManifest: manifest,
          execution,
          proofs: {
            ...proofs,
            freshLegacyV2: {
              status: "passed",
              artifact: { alias: "v2-app.mento.org" },
            },
          },
          deploySha: SHA,
          upstreamRunId: "123456",
          upstreamRunAttempt: "2",
          workflowRunId: "800",
          producerRunAttempt: "3",
          repository: "mento-protocol/frontend-monorepo",
        }),
      /forbidden or missing fields/,
    );
  }
});

test("terminal failure validation preserves manual-intervention journal semantics", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const evidence = createMainActiveDeploymentFailureEvidence({
    eventHeadSha: SHA,
    verifiedDeploySha: SHA,
    planOutput: JSON.stringify(deploymentPlan),
    jobs: activeJobs(deploymentPlan, { coordinator: "failure" }),
    workflowDefinitionSha: SHA,
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
    mainOwnershipMode: deploymentPlan.planning.mainOwnershipMode,
    journalHistory: [prepared, started],
    freshness: [{ phase: "pre-command", status: "unproven" }],
    rollbackStateTargets: ["governance"],
    publicServingMutationCommands: 1,
    coordinatorOutcome: "active-failed",
    recoveryOutcome: "manual-intervention",
    errorCode: "RECOVERY_FAILED",
  });
  assert.throws(
    () =>
      assertMainActiveTerminalEvidenceArtifact(evidence, {
        execution,
        runId: "800",
        runAttempt: "3",
        outcome: "manual-intervention",
      }),
    /terminal unsafe journal/,
  );
});

test("terminal evidence wraps and restores verified-noop failure evidence", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const manifest = execution.manifest;
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const finalMappings = Object.values(prepared.prior).flatMap((prior) =>
    prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const stateProof = activeStateProof({
    deploymentPlan,
    journalHistory: [prepared],
    jobs: stageJobs(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const publicSmokes = Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      {
        publicUrl: `https://${target}.mento.org/`,
        runtime: target === "governance" ? runtimeSmoke(target, SHA) : null,
        servedSha: target === "governance" ? SHA : null,
        status: target === "governance" ? "passed" : "not-run",
      },
    ]),
  );
  const evidence = createMainActiveDeploymentFailureEvidence({
    eventHeadSha: SHA,
    verifiedDeploySha: SHA,
    planOutput: JSON.stringify(deploymentPlan),
    jobs: activeJobs(deploymentPlan, { coordinator: "failure" }),
    workflowDefinitionSha: SHA,
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
    mainOwnershipMode: deploymentPlan.planning.mainOwnershipMode,
    journalHistory: [prepared],
    freshness: [{ phase: "pre-command", status: "fresh" }],
    finalMappings,
    publicSmokes,
    stateProof,
    rollbackStateTargets: [],
    publicServingMutationCommands: 0,
    coordinatorOutcome: "active-failed",
    recoveryOutcome: "verified-no-mutation",
    errorCode: "VERIFIED_NO_MUTATION",
  });
  const proofs = {
    schema: MAIN_ACTIVE_TERMINAL_PROOFS_SCHEMA,
    releaseId: manifest.releaseId,
    releaseManifestDigest: digestJson(manifest),
    releaseExecutionDigest: digestMainReleaseExecution(execution),
    producerJob: "recover-main-deployment",
    outcome: "verified-noop",
    finalMapping: { status: "passed", artifact: evidence.finalMappings },
    finalCensus: { status: "passed", artifact: stateProof },
    stateProof: { status: "passed", artifact: stateProof },
    publicSmoke: { status: "passed", artifact: evidence.publicSmokes },
    mutationCount: 0,
    rollbackTargets: [],
    affectedOperations: [],
    journal: { status: "not-applicable", artifact: null },
  };
  const terminal = createMainActiveTerminalHandoff({
    activeEvidence: evidence,
    releaseManifest: manifest,
    execution,
    proofs,
    deploySha: SHA,
    upstreamRunId: "123456",
    upstreamRunAttempt: "2",
    workflowRunId: "800",
    producerRunAttempt: "3",
    repository: "mento-protocol/frontend-monorepo",
  });
  assert.equal(terminal.receipt.outcome, "verified-noop");
  assert.equal(terminal.receipt.producerJob, "recover-main-deployment");
  assert.deepEqual(
    restoreMainActiveTerminalEvidence({
      encodedReceipt: terminal.encodedReceipt,
      encodedEvidence: terminal.encodedEvidence,
      releaseManifest: manifest,
      execution,
      deploySha: SHA,
      upstreamRunId: "123456",
      upstreamRunAttempt: "2",
      workflowRunId: "800",
      finalRunAttempt: "4",
      repository: "mento-protocol/frontend-monorepo",
    }).artifact,
    evidence,
  );
});

// Replaces the retired "the App activation binds exactly one bridge alias"
// matrix. MGP-18 moved `app.mento.org` into the ordinary production
// environment, so the App promote carries the reviewed domain itself: the
// activation emits exactly one App mutation, never an alias operation, and a
// reviewed App alias pointing at an unrelated deployment is still a drift the
// activation must fail closed on rather than silently skip.
test("active App activation is a single ordinary promote and no bridge alias operation can re-enter", async () => {
  assert.deepEqual([...MAIN_TARGET_CONTRACTS.app.aliases], ["app.mento.org"]);
  const clean = activeHarness();
  const result = await runMainActiveTransaction({
    plan: clean.plan,
    stageJobs: clean.stageJobs,
    appCandidateReceipt: clean.appCandidateReceipt,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: clean.adapters,
  });
  assert.equal(result.outcome, "active-committed");
  assert.equal(result.publicServingMutationCommands, 4);
  // Exactly one verified App operation, and it is an ordinary promote.
  assert.deepEqual(
    result.journal.operations
      .filter(
        (operation) =>
          operation.target === "app" && operation.state === "verified",
      )
      .map((operation) => [operation.type, operation.alias]),
    [["promote", null]],
  );
  // No journal operation of any target carries an alias any more.
  for (const operation of result.journal.operations) {
    assert.equal(operation.alias, null, operation.type);
  }
  // The harness itself may not offer an alias-mutating adapter.
  for (const retired of ["assignAlias", "restoreAppAlias", "deployAppV3"]) {
    assert.equal(clean.adapters[retired], undefined, retired);
  }

  // A reviewed App alias serving an unrelated deployment is drift, not a
  // completed prefix, and must not be promoted over.
  const drifted = activeHarness();
  drifted.mappings.set("app.mento.org", {
    alias: "app.mento.org",
    deploymentId: "dpl_unrelateddrift",
    deploymentUrl: "https://app-unrelated-drift.vercel.app",
  });
  await assert.rejects(
    () =>
      runMainActiveTransaction({
        plan: drifted.plan,
        stageJobs: drifted.stageJobs,
        appCandidateReceipt: drifted.appCandidateReceipt,
        runId: "800",
        runAttempt: "3",
        journalHistory: [],
        adapters: drifted.adapters,
      }),
    /mapping|recovery|drift/i,
  );
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
    appCandidateReceipt: harness.appCandidateReceipt,
    runId: "800",
    runAttempt: "3",
    journalHistory: [],
    adapters: harness.adapters,
  });
  assert.deepEqual(result.shadowTargets, ["governance"]);
  // Reserve + UI + App promotes. The App contributes exactly one command like
  // every other target now that the bridge alias set is retired.
  assert.equal(result.publicServingMutationCommands, 3);
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
    runtime: null,
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
    appCandidateReceipt: appReceipt(activePlan()),
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

test("active journal CLI accepts an inherited release SHA only through its dedicated override", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "vercel-main-inherited-journal-"),
  );
  try {
    const artifactsDirectory = join(directory, "journals");
    const output = join(directory, "history.json");
    const githubOutput = join(directory, "github-output");
    const journal = createPreparedMainActiveJournal({
      plan: activePlan(),
      stageJobs: stageJobs(activePlan()),
      appCandidateReceipt: appReceipt(activePlan()),
      runId: "800",
      runAttempt: "3",
    });
    const artifactName = mainTransactionJournalArtifactName(journal);
    mkdirSync(join(artifactsDirectory, artifactName), { recursive: true });
    writeFileSync(
      join(artifactsDirectory, artifactName, "main-journal.json"),
      `${JSON.stringify(journal)}\n`,
    );
    writeFileSync(githubOutput, "");

    const currentAttemptValues = {
      DEPLOY_SHA: OTHER_SHA,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_RUN_ID: "800",
      GITHUB_RUN_ATTEMPT: "3",
    };
    const historyArguments = [
      "active-journal-history",
      "--artifacts",
      artifactsDirectory,
      "--output",
      output,
    ];

    await assert.rejects(
      runMainDeploymentCli({
        argv: historyArguments,
        values: currentAttemptValues,
      }),
      /No active journal artifacts match the transaction/,
    );

    const inheritedIdentity = await runMainDeploymentCli({
      argv: ["active-journal-identity"],
      values: {
        ...currentAttemptValues,
        MAIN_ACTIVE_JOURNAL_DEPLOY_SHA: SHA,
      },
    });
    assert.equal(inheritedIdentity.deploySha, SHA);
    assert.equal(inheritedIdentity.transactionId, journal.transactionId);

    const history = await runMainDeploymentCli({
      argv: historyArguments,
      values: {
        ...currentAttemptValues,
        MAIN_ACTIVE_JOURNAL_DEPLOY_SHA: SHA,
      },
    });
    assert.deepEqual(history.journals, [journal]);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), history);

    await assert.rejects(
      runMainDeploymentCli({
        argv: historyArguments,
        values: {
          ...currentAttemptValues,
          MAIN_ACTIVE_JOURNAL_DEPLOY_SHA: SHA,
          GITHUB_RUN_ATTEMPT: "4",
        },
      }),
      /No active journal artifacts match the transaction/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active canonical mappings bind canonical active and current captures", async () => {
  const activeSpec = {
    schema: ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
    bindings: [
      { alias: "app.mento.org", projectId: "prj_app123", target: "app" },
      {
        alias: "governance.mento.org",
        projectId: "prj_governance123",
        target: "governance",
      },
      {
        alias: "reserve.mento.org",
        projectId: "prj_reserve123",
        target: "reserve",
      },
      { alias: "ui.mento.org", projectId: "prj_ui123", target: "ui" },
    ],
  };
  const currentSpec = {
    schema: ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
    bindings: [
      {
        alias: "app.mento.org",
        projectId: "prj_app456",
        target: "app",
      },
      {
        alias: "governance.mento.org",
        projectId: "prj_governance456",
        target: "governance",
      },
      {
        alias: "reserve.mento.org",
        projectId: "prj_reserve456",
        target: "reserve",
      },
      { alias: "ui.mento.org", projectId: "prj_ui456", target: "ui" },
    ],
  };
  const mappingsFor = (spec, deploymentSuffix) =>
    spec.bindings.map((binding, index) => ({
      alias: binding.alias,
      deploymentId: `dpl_${deploymentSuffix}${index + 1}`,
      deploymentUrl: `https://deployment-${deploymentSuffix}-${index + 1}.vercel.app`,
    }));
  const activeMappings = mappingsFor(activeSpec, "active");
  const currentMappings = mappingsFor(currentSpec, "current");
  const expectedActive = {
    schema: "vercel-main-canonical-mappings:v1",
    mappings: {
      governance: [activeMappings[1]],
      reserve: [activeMappings[2]],
      ui: [activeMappings[3]],
      app: [activeMappings[0]],
    },
  };
  assert.deepEqual(
    createMainActiveCanonicalMappings({
      mappingSpec: activeSpec,
      mappings: activeMappings,
    }),
    expectedActive,
  );
  assert.deepEqual(
    createMainActiveCanonicalMappings({
      mappingSpec: currentSpec,
      mappings: currentMappings,
    }),
    {
      schema: "vercel-main-canonical-mappings:v1",
      mappings: {
        governance: [currentMappings[1]],
        reserve: [currentMappings[2]],
        ui: [currentMappings[3]],
        app: [currentMappings[0]],
      },
    },
  );

  for (const [name, mappingSpec, mappings, pattern] of [
    [
      "malformed specification",
      { schema: ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA, bindings: [] },
      activeMappings,
      /specification is malformed/,
    ],
    [
      "missing capture",
      activeSpec,
      activeMappings.slice(1),
      /bound mappings are incomplete/,
    ],
    [
      "missing target",
      {
        ...activeSpec,
        bindings: activeSpec.bindings.filter(({ target }) => target !== "ui"),
      },
      activeMappings.filter(({ alias }) => alias !== "ui.mento.org"),
      /target coverage is incomplete/,
    ],
    [
      "duplicate capture",
      activeSpec,
      [...activeMappings.slice(0, -1), structuredClone(activeMappings[0])],
      /conflicts with its spec/,
    ],
    [
      "noncanonical capture order",
      activeSpec,
      [activeMappings[1], activeMappings[0], ...activeMappings.slice(2)],
      /conflicts with its spec/,
    ],
    [
      "retired legacy target binding",
      {
        ...activeSpec,
        bindings: [
          ...activeSpec.bindings,
          {
            alias: "v2-app.mento.org",
            projectId: "prj_app123",
            target: "legacy-app",
          },
        ],
      },
      activeMappings,
      /bindings are ambiguous|bindings are not canonical|bound mappings are incomplete/,
    ],
    [
      "project field on any mapping",
      activeSpec,
      activeMappings.map((mapping) =>
        mapping.alias === "app.mento.org"
          ? { ...mapping, projectId: "prj_app123" }
          : mapping,
      ),
      /forbidden or missing fields/,
    ],
    [
      "duplicate specification binding",
      {
        ...activeSpec,
        bindings: [
          activeSpec.bindings[0],
          { ...activeSpec.bindings[0], target: "governance" },
          ...activeSpec.bindings.slice(2),
        ],
      },
      activeMappings,
      /bindings are ambiguous/,
    ],
  ]) {
    assert.throws(
      () => createMainActiveCanonicalMappings({ mappingSpec, mappings }),
      pattern,
      name,
    );
  }

  const directory = mkdtempSync(
    join(tmpdir(), "vercel-main-canonical-mappings-"),
  );
  try {
    const specPath = join(directory, "current-mapping-spec.json");
    const mappingsPath = join(directory, "current-mappings.json");
    const outputPath = join(directory, "canonical-mappings.json");
    writeFileSync(specPath, JSON.stringify(currentSpec));
    writeFileSync(mappingsPath, JSON.stringify(currentMappings));
    const materialized = await runMainDeploymentCli({
      argv: [
        "active-canonical-mappings",
        "--mapping-spec",
        specPath,
        "--mappings",
        mappingsPath,
        "--output",
        outputPath,
      ],
    });
    assert.deepEqual(
      JSON.parse(readFileSync(outputPath, "utf8")),
      materialized,
    );
    assert.equal(
      readFileSync(outputPath, "utf8"),
      `${JSON.stringify(materialized)}\n`,
    );
    assert.deepEqual(
      materialized,
      createMainActiveCanonicalMappings({
        mappingSpec: currentSpec,
        mappings: currentMappings,
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active and current-release mapping-spec producers bind terminal captures", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const activeExecution = releaseExecutionForPlan(deploymentPlan);
  const activeBarrier = createMainStageBarrier({
    execution: activeExecution,
    candidateReceipts: {
      app: null,
      governance: currentCandidateReceipt(activeExecution, "governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  const activeJournal = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
    runId: "800",
    runAttempt: "3",
  });
  const currentExecution = createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: activeExecution.manifest,
    upstream: activeExecution.upstream,
    selection: activeExecution.selection,
  });
  const currentBarrier = createMainStageBarrier({
    execution: currentExecution,
    candidateReceipts: {
      app: null,
      governance: currentCandidateReceipt(currentExecution, "governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  const producers = [
    [
      "active",
      createMainCurrentActiveAliasMappingSpec({
        execution: activeExecution,
        barrier: activeBarrier,
        journalHistory: [activeJournal],
        runId: "800",
        runAttempt: "3",
      }),
    ],
    [
      "current release",
      createMainCurrentReleaseVerifiedAliasMappingSpec({
        execution: currentExecution,
        barrier: currentBarrier,
        runId: "800",
        runAttempt: "3",
      }),
    ],
  ];
  for (const [name, spec] of producers) {
    assert.equal(spec.schema, ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA, name);
    assert.deepEqual(
      new Set(spec.bindings.map(({ target }) => target)),
      new Set(["governance", "reserve", "ui", "app"]),
      name,
    );
    const rawMappings = spec.bindings.map((binding, index) => ({
      alias: binding.alias,
      deploymentId: `dpl_mapping${index + 1}`,
      deploymentUrl: `https://${name.replaceAll(" ", "-")}-${index + 1}.vercel.app`,
    }));
    const canonical = createMainActiveCanonicalMappings({
      mappingSpec: spec,
      mappings: rawMappings,
    });
    assert.deepEqual(canonical, {
      schema: "vercel-main-canonical-mappings:v1",
      mappings: Object.fromEntries(
        ["governance", "reserve", "ui", "app"].map((target) => [
          target,
          spec.bindings
            .map((binding, index) => ({ binding, mapping: rawMappings[index] }))
            .filter(({ binding }) => binding.target === target)
            .map(({ mapping }) => ({
              alias: mapping.alias,
              deploymentId: mapping.deploymentId,
              deploymentUrl: mapping.deploymentUrl,
            })),
        ]),
      ),
    });
    const malformed = structuredClone(spec);
    malformed.bindings[0].alias = "0.invalid.example";
    assert.throws(
      () =>
        createMainActiveCanonicalMappings({
          mappingSpec: malformed,
          mappings: rawMappings,
        }),
      /conflicts with its spec/,
      `${name} rejects a capture that no longer matches its binding`,
    );
  }
});

test("active recovery planning and execution hand off exact reverse mutations and stay release-failing", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
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
  // MGP-18 retired the legacy App binding. No recovery mapping may carry a
  // project ID any more.
  const projectBoundMappings = currentMappings.map((entry) => ({
    ...entry,
    projectId: started.release.originalPriors.app.projectId,
  }));
  assert.throws(
    () =>
      planMainActiveRecovery({
        journalHistory: [prepared, started],
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
        currentMappings: projectBoundMappings,
      }),
    /forbidden or missing fields/,
  );
  assert.equal(recoveryPlan.decision, "recover");
  assert.deepEqual(recoveryPlan.rollbackStateTargets, ["governance"]);
  assert.equal(recoveryPlan.forceFailure, true);
  const mappingSpec = createMainActiveRecoveryMappingSpec({
    journalHistory: activeHistoryDocument([prepared, started]),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(mappingSpec.schema, "vercel-active-alias-mapping-spec:v2");
  assert.deepEqual(
    mappingSpec.bindings.map(({ alias }) => alias),
    Object.values(started.prior)
      .flatMap(({ aliases }) => aliases)
      .toSorted(),
  );
  // One reviewed alias per main target.
  assert.equal(mappingSpec.bindings.length, MAIN_DEPLOYMENT_TARGETS.length);
  assert.equal(
    mappingSpec.bindings.some(
      ({ alias }) => alias === "appmentoorg-env-v3-mentolabs.vercel.app",
    ),
    false,
  );
  for (const binding of mappingSpec.bindings) {
    assert.equal(
      binding.projectId,
      started.release.originalPriors[binding.target].projectId,
    );
  }
  const boundMappings = mappingSpec.bindings.map((binding) => {
    const prior = started.prior[binding.target];
    return {
      alias: binding.alias,
      deploymentId: prior.deploymentId,
      deploymentUrl: prior.deploymentUrl,
    };
  });
  const canonicalMappings = createMainActiveRecoveryCanonicalMappings({
    journalHistory: activeHistoryDocument([prepared, started]),
    mappings: boundMappings,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(Object.keys(canonicalMappings.mappings), [
    "governance",
    "reserve",
    "ui",
    "app",
  ]);
  assert.equal(
    Object.hasOwn(canonicalMappings.mappings.app[0], "projectId"),
    false,
  );
  for (const [name, mutate, pattern] of [
    [
      "missing binding",
      (value) => value.slice(1),
      /bound mappings are incomplete/,
    ],
    [
      "extra binding",
      (value) => [...value, structuredClone(value[0])],
      /bound mappings are incomplete/,
    ],
    [
      "retired legacy project binding",
      (value) => {
        value[0].projectId = "prj_wrong123";
        return value;
      },
      /forbidden or missing fields/,
    ],
    [
      "noncanonical alias order",
      (value) => [value[1], value[0], ...value.slice(2)],
      /conflicts with its spec/,
    ],
  ]) {
    assert.throws(
      () =>
        createMainActiveRecoveryCanonicalMappings({
          journalHistory: activeHistoryDocument([prepared, started]),
          mappings: mutate(structuredClone(boundMappings)),
          runId: "800",
          runAttempt: "3",
        }),
      pattern,
      name,
    );
  }
  assert.throws(
    () =>
      createMainActiveRecoveryCanonicalMappings({
        journalHistory: activeHistoryDocument([prepared, started]),
        mappings: boundMappings,
        runId: "801",
        runAttempt: "3",
      }),
    /identity/,
    "foreign journal history",
  );
  const mappingDirectory = mkdtempSync(
    join(tmpdir(), "vercel-main-recovery-mappings-"),
  );
  try {
    const historyPath = join(mappingDirectory, "history.json");
    const mappingsPath = join(mappingDirectory, "mappings.json");
    const outputPath = join(mappingDirectory, "output.json");
    writeFileSync(
      historyPath,
      JSON.stringify(activeHistoryDocument([prepared, started])),
    );
    writeFileSync(mappingsPath, JSON.stringify(boundMappings));
    const materialized = await runMainDeploymentCli({
      argv: [
        "active-recovery-canonical-mappings",
        "--journal-history",
        historyPath,
        "--mappings",
        mappingsPath,
        "--output",
        outputPath,
      ],
      values: { GITHUB_RUN_ID: "800", GITHUB_RUN_ATTEMPT: "3" },
    });
    assert.deepEqual(materialized, canonicalMappings);
    assert.deepEqual(
      JSON.parse(readFileSync(outputPath, "utf8")),
      materialized,
    );
  } finally {
    rmSync(mappingDirectory, { recursive: true, force: true });
  }
  assert.throws(
    () =>
      createMainActiveRecoveryMappingSpec({
        journalHistory: activeHistoryDocument([prepared, started]),
        runId: "801",
        runAttempt: "3",
      }),
    /identity/,
  );
  // MGP-18 retired the legacy App deployment. A journal that re-introduces its
  // prior no longer matches the reviewed four-target shape.
  const retiredLegacyPrior = structuredClone(prepared);
  retiredLegacyPrior.prior["legacy-app"] = {
    deploymentId: "dpl_legacyPrior123",
    deploymentUrl: "https://legacy-prior.vercel.app",
    aliases: ["v2-app.mento.org"],
  };
  assert.throws(
    () =>
      createMainActiveRecoveryMappingSpec({
        journalHistory: [retiredLegacyPrior],
        runId: "800",
        runAttempt: "3",
      }),
    /keys are missing, extra, or out of order/,
  );

  const execution = releaseExecutionForPlan(deploymentPlan);
  assert.throws(
    () =>
      createMainActiveRecoveryDeploymentStateSpec({
        execution,
        journalHistory: activeHistoryDocument([prepared, started]),
        runId: "800",
        runAttempt: "3",
      }),
    /requires a terminal recovery journal/,
  );

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

  const recoveryHistory = activeHistoryDocument([
    prepared,
    started,
    ...result.uploadedJournals,
  ]);
  const recoveryStateSpec = createMainActiveRecoveryDeploymentStateSpec({
    execution,
    journalHistory: recoveryHistory,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    recoveryStateSpec.schema,
    "vercel-active-deployment-state-spec:v3",
  );
  assert.equal(recoveryStateSpec.transactionId, started.transactionId);
  assert.deepEqual(recoveryStateSpec.activeTargets, ["governance"]);
  assert.deepEqual(recoveryStateSpec.shadowTargets, []);
  assert.equal(
    recoveryStateSpec.projects.governance.deploymentId,
    started.candidates.governance.deploymentId,
  );
  assert.equal(Object.hasOwn(recoveryStateSpec, "legacyAppV2"), false);
  const recoveryProof = activeStateProof({ spec: recoveryStateSpec });
  assert.equal(recoveryProof.outcome, "proven");
  assert.throws(
    () =>
      createMainActiveRecoveryDeploymentStateSpec({
        execution,
        journalHistory: recoveryHistory,
        runId: "801",
        runAttempt: "3",
      }),
    /identity/,
  );
  assert.throws(
    () =>
      createMainActiveRecoveryDeploymentStateSpec({
        execution: releaseExecutionForPlan(activePlan({ deployments: ["ui"] })),
        journalHistory: recoveryHistory,
        runId: "800",
        runAttempt: "3",
      }),
    /does not match journal release/,
  );

  const verdict = evaluateMainActiveFinalResults({
    execution,
    jobs: finalActiveJobs(deploymentPlan, {
      coordinator: "failure",
      recovery: "failure",
    }),
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

// A shadow target is staged by its own job and never mutated by the activation
// transaction, so the current-attempt journal holds no candidate for it. The
// terminal recovery specification must still be constructible for a mixed
// release, and must stay fail-closed about the staged shadow deployment it
// cannot name.
test("active recovery terminal evidence is constructible for a mixed shadow release", async () => {
  const deploymentPlan = activePlan({
    deployments: ["app", "governance"],
    mainOwnershipMode: ownership({ app: MAIN_OWNERSHIP_MODES.SHADOW }),
  });
  const execution = releaseExecutionForPlan(deploymentPlan);
  assert.deepEqual(execution.projection.activeTargets, ["governance"]);
  assert.deepEqual(execution.projection.shadowTargets, ["app"]);

  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: appReceipt(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(prepared.candidates.app, null);
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const currentMappings = Object.values(started.prior).flatMap((prior) =>
    prior.aliases.map((alias) =>
      mapping(
        alias,
        alias === "governance.mento.org"
          ? started.candidates.governance
          : prior,
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
  let mappingState = "candidate";
  const result = await runMainActiveRecovery({
    recoveryPlan,
    adapters: {
      uploadJournal: async ({ artifactName, journal }) => ({
        acknowledged: true,
        artifactName,
        artifactId: String(8500 + journal.sequence),
      }),
      inspectMapping: async () => ({ mappingState }),
      ordinaryRollback: async () => {
        mappingState = "prior";
        return { outcome: "success" };
      },
      verifyMapping: async () => ({ mappingState }),
    },
  });
  assert.equal(result.journal.status, "recovered");

  const spec = createMainActiveRecoveryDeploymentStateSpec({
    execution,
    journalHistory: activeHistoryDocument([
      prepared,
      started,
      ...result.uploadedJournals,
    ]),
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(spec.activeTargets, ["governance"]);
  assert.deepEqual(spec.shadowTargets, ["app"]);
  assert.equal(spec.projects.governance.expectedDisposition, "githubPrebuilt");
  assert.equal(
    spec.projects.governance.deploymentId,
    started.candidates.governance.deploymentId,
  );
  // Recovery cannot bind the shadow App stage, so it claims nothing about it.
  assert.equal(spec.projects.app.expectedDisposition, null);
  assert.equal(spec.projects.app.deploymentId, null);
  assert.equal(spec.projects.app.deploymentUrl, null);
  assert.equal(activeStateProof({ spec }).outcome, "proven");
  // Fail-closed, never proven by omission: an actual staged shadow deployment
  // that the evidence does not name leaves the census unproven.
  const withShadowStage = activeStateProof({
    spec,
    additionalDeployments: {
      app: [
        {
          deploymentId: "dpl_appShadowStage123",
          response: {
            id: "dpl_appShadowStage123",
            url: "https://app-shadow-stage.vercel.app",
            projectId: spec.projects.app.projectId,
            name: spec.projects.app.projectName,
            readyState: "READY",
            target: "production",
            customEnvironment: null,
            source: "cli",
            meta: {
              githubCommitOrg: "mento-protocol",
              githubCommitRepo: "frontend-monorepo",
              githubCommitRef: "main",
              githubCommitSha: spec.deploySha,
            },
          },
        },
      ],
    },
  });
  assert.equal(withShadowStage.outcome, "unproven");
});

test("active recovery terminal evidence handles unstarted and unresolved App candidates", async () => {
  const deploymentPlan = activePlan({ deployments: ["app", "governance"] });
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: appReceipt(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const started = startMainTransactionOperation(prepared, {
    type: "promote",
    target: "governance",
  });
  const currentMappings = Object.values(started.prior).flatMap((prior) =>
    prior.aliases.map((alias) =>
      mapping(
        alias,
        alias === "governance.mento.org"
          ? started.candidates.governance
          : prior,
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
  let mappingState = "candidate";
  const result = await runMainActiveRecovery({
    recoveryPlan,
    adapters: {
      uploadJournal: async ({ artifactName, journal }) => ({
        acknowledged: true,
        artifactName,
        artifactId: String(8000 + journal.sequence),
      }),
      inspectMapping: async () => ({ mappingState }),
      ordinaryRollback: async () => {
        mappingState = "prior";
        return { outcome: "success" };
      },
      verifyMapping: async () => ({ mappingState }),
    },
  });
  assert.equal(result.journal.status, "recovered");
  const execution = releaseExecutionForPlan(deploymentPlan);
  const history = activeHistoryDocument([
    prepared,
    started,
    ...result.uploadedJournals,
  ]);
  const spec = createMainActiveRecoveryDeploymentStateSpec({
    execution,
    journalHistory: history,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(ACTIVE_STATE_CLASSIFICATIONS.includes("recoveredPrior"), false);
  assert.equal(spec.projects.app.expectedDisposition, "githubPrebuilt");
  assert.equal(
    spec.projects.app.deploymentId,
    appReceipt(deploymentPlan).candidate.deploymentId,
  );
  const stateProof = activeStateProof({ spec });
  assert.equal(stateProof.outcome, "proven");

  const priorMappings = Object.values(result.journal.prior).flatMap((prior) =>
    prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "recovered",
    journalHistory: history,
    finalMappings: providerMappings(execution, priorMappings),
    publicSmokes: priorPublicSmokes(execution),
    stateProof,
    finalCensus: stateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(artifacts.evidence.recoveryOutcome, "recovered");
  assert.equal(artifacts.proofs.outcome, "recovered");
  assert.equal(
    artifacts.proofs.stateProof.artifact.projects.app.expectedDisposition,
    "githubPrebuilt",
  );
  assert.ok(
    priorMappings.every(({ alias, deploymentId, deploymentUrl }) => {
      const target = Object.values(result.journal.prior).find((prior) =>
        prior.aliases.includes(alias),
      );
      return (
        target?.deploymentId === deploymentId &&
        target.deploymentUrl === deploymentUrl
      );
    }),
  );

  const unexpectedAppCandidateProof = activeStateProof({
    spec,
    additionalDeployments: {
      app: [
        {
          deploymentId: "dpl_unexpectedapp123",
          response: {
            id: "dpl_unexpectedapp123",
            url: "https://unexpected-app.vercel.app",
            projectId: spec.projects.app.projectId,
            name: spec.projects.app.projectName,
            readyState: "READY",
            target: null,
            customEnvironment: { slug: "v3" },
            source: "cli",
            meta: {
              githubCommitOrg: "mento-protocol",
              githubCommitRepo: "frontend-monorepo",
              githubCommitRef: "main",
              githubCommitSha: spec.deploySha,
            },
          },
        },
      ],
    },
  });
  assert.equal(unexpectedAppCandidateProof.outcome, "unproven");
  // A stray deployment in the retired v3 custom environment is no longer a
  // benign manual duplicate: it is unclassifiable and leaves the proof unproven.
  assert.deepEqual(unexpectedAppCandidateProof.projects.app.counts, {
    scanned: 2,
    githubPrebuilt: 1,
    githubShadowStage: 0,
    nativeGitOwner: 0,
    nativeGitDuplicates: 0,
    manualDuplicates: 0,
    inertCanceled: 0,
    unknown: 1,
  });
  assert.throws(
    () =>
      createMainActiveTerminalArtifacts({
        execution,
        outcome: "recovered",
        journalHistory: history,
        finalMappings: providerMappings(execution, priorMappings),
        publicSmokes: priorPublicSmokes(execution),
        stateProof: unexpectedAppCandidateProof,
        finalCensus: unexpectedAppCandidateProof,
        freshness: null,
        runId: "800",
        runAttempt: "3",
      }),
    /not proven/,
  );

  const governanceReturned = recordMainTransactionCommandReturned(started, {
    operationId: started.operations.at(-1).operationId,
    outcome: "success",
  });
  const governanceVerified = recordMainTransactionVerified(governanceReturned, {
    operationId: started.operations.at(-1).operationId,
    mappingState: "candidate",
  });
  const appDeployStarted = startMainTransactionOperation(governanceVerified, {
    type: "promote",
    target: "app",
  });
  const manualRecovering = startMainTransactionRecovery(appDeployStarted);
  const manualTerminal = finishMainTransactionRecovery(manualRecovering, {
    manualIntervention: true,
  });
  const manualHistory = activeHistoryDocument([
    prepared,
    started,
    governanceReturned,
    governanceVerified,
    appDeployStarted,
    manualRecovering,
    manualTerminal,
  ]);
  const manualSpec = createMainActiveRecoveryDeploymentStateSpec({
    execution,
    journalHistory: manualHistory,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(manualSpec.projects.app.expectedDisposition, "githubPrebuilt");
  assert.equal(
    manualSpec.projects.app.deploymentId,
    appReceipt(deploymentPlan).candidate.deploymentId,
  );
  const manualStateProof = activeStateProof({ spec: manualSpec });
  assert.equal(manualStateProof.outcome, "proven");
  const manualArtifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "manual-intervention",
    journalHistory: manualHistory,
    finalMappings: providerMappings(execution, currentMappings),
    publicSmokes: null,
    stateProof: manualStateProof,
    finalCensus: manualStateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(manualArtifacts.evidence.recoveryOutcome, "manual-intervention");
  assert.equal(manualArtifacts.proofs.outcome, "manual-intervention");

  const manualUnknownCandidateProof = activeStateProof({
    spec: manualSpec,
    additionalDeployments: {
      app: [
        {
          deploymentId: "dpl_unresolvedapp123",
          response: {
            id: "dpl_unresolvedapp123",
            url: "https://unresolved-app.vercel.app",
            projectId: manualSpec.projects.app.projectId,
            name: manualSpec.projects.app.projectName,
            readyState: "READY",
            target: null,
            customEnvironment: { slug: "v3" },
            source: "cli",
            meta: {
              githubCommitOrg: "mento-protocol",
              githubCommitRepo: "frontend-monorepo",
              githubCommitRef: "main",
              githubCommitSha: manualSpec.deploySha,
            },
          },
        },
      ],
    },
  });
  assert.equal(manualUnknownCandidateProof.outcome, "unproven");
  assert.deepEqual(manualUnknownCandidateProof.projects.app.counts, {
    scanned: 2,
    githubPrebuilt: 1,
    githubShadowStage: 0,
    nativeGitOwner: 0,
    nativeGitDuplicates: 0,
    manualDuplicates: 0,
    inertCanceled: 0,
    unknown: 1,
  });

  // Replaces the retired "recovered without a resolved App candidate" case:
  // an App candidate is complete from preparation, so the incompleteness guard
  // now fires only when a journal loses the staged provider deployment.
  const unsafeRecovering = startMainTransactionRecovery(appDeployStarted);
  const unsafeRecovered = finishMainTransactionRecovery(unsafeRecovering);
  assert.doesNotThrow(() =>
    createMainActiveRecoveryDeploymentStateSpec({
      execution,
      journalHistory: activeHistoryDocument([
        prepared,
        started,
        governanceReturned,
        governanceVerified,
        appDeployStarted,
        unsafeRecovering,
        unsafeRecovered,
      ]),
      runId: "800",
      runAttempt: "3",
    }),
  );
  const strippedAppCandidate = structuredClone(unsafeRecovered);
  strippedAppCandidate.candidates.app.deploymentId = null;
  strippedAppCandidate.candidates.app.deploymentUrl = null;
  assert.throws(
    () =>
      createMainActiveRecoveryDeploymentStateSpec({
        execution,
        journalHistory: activeHistoryDocument([
          prepared,
          started,
          governanceReturned,
          governanceVerified,
          appDeployStarted,
          unsafeRecovering,
          strippedAppCandidate,
        ]),
        runId: "800",
        runAttempt: "3",
      }),
    /candidate|malformed|deployment/i,
  );
});

test("unknown App controller recovery produces fail-closed terminal evidence after safe ordinary rollbacks", async () => {
  const deploymentPlan = activePlan();
  const execution = releaseExecutionForPlan(deploymentPlan);
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: appReceipt(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const forwardHistory = [prepared];
  let highest = prepared;
  for (const target of ["governance", "reserve", "ui"]) {
    const started = startMainTransactionOperation(highest, {
      type: "promote",
      target,
    });
    forwardHistory.push(started);
    const returned = recordMainTransactionCommandReturned(started, {
      operationId: started.operations.at(-1).operationId,
      outcome: "success",
    });
    forwardHistory.push(returned);
    highest = recordMainTransactionVerified(returned, {
      operationId: started.operations.at(-1).operationId,
      mappingState: "candidate",
    });
    forwardHistory.push(highest);
  }
  // `app_v3_deploy` is retired; the unresolved forward operation is the App
  // promote itself.
  const appStarted = startMainTransactionOperation(highest, {
    type: "promote",
    target: "app",
  });
  forwardHistory.push(appStarted);
  highest = recordMainTransactionCommandReturned(appStarted, {
    operationId: appStarted.operations.at(-1).operationId,
    outcome: "unknown",
  });
  forwardHistory.push(highest);

  // Replaces the retired "the App candidate was never resolved" fail-closed
  // reason. The App candidate is always staged now, so the fail-closed case is
  // an unknown App command that left the reviewed App alias on neither the
  // prior nor the candidate.
  const foreignAppDeployment = {
    deploymentId: "dpl_foreignApp123",
    deploymentUrl: "https://foreign-app.vercel.app",
  };
  const mappingStates = {
    app: "unexpected",
    governance: "candidate",
    reserve: "candidate",
    ui: "candidate",
  };
  const currentMappings = Object.entries(highest.prior).flatMap(
    ([target, prior]) =>
      prior.aliases.map((alias) =>
        mapping(
          alias,
          target === "app"
            ? foreignAppDeployment
            : mappingStates[target] === "candidate"
              ? highest.candidates[target]
              : prior,
        ),
      ),
  );
  const recoveryPlan = planMainActiveRecovery({
    journalHistory: forwardHistory,
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
    currentMappings,
  });
  assert.equal(recoveryPlan.decision, "manual_intervention");
  assert.equal(recoveryPlan.reason, "unexpected-protected-mapping");

  const rollbackOrder = [];
  const result = await runMainActiveRecovery({
    recoveryPlan,
    adapters: {
      uploadJournal: async ({ artifactName, journal }) => ({
        acknowledged: true,
        artifactName,
        artifactId: String(9000 + journal.sequence),
      }),
      inspectMapping: async ({ target }) => ({
        mappingState: mappingStates[target],
      }),
      ordinaryRollback: async ({ target }) => {
        rollbackOrder.push(target);
        mappingStates[target] = "prior";
        return { outcome: "success" };
      },
      verifyMapping: async ({ target }) => ({
        mappingState: mappingStates[target],
      }),
    },
  });
  assert.equal(result.outcome, "manual-intervention");
  assert.equal(result.journal.status, "manual_intervention");
  assert.equal(result.publicServingMutationCommands, 3);
  assert.deepEqual(rollbackOrder, ["ui", "reserve", "governance"]);

  const history = activeHistoryDocument([
    ...forwardHistory,
    ...result.uploadedJournals,
  ]);
  const spec = createMainActiveRecoveryDeploymentStateSpec({
    execution,
    journalHistory: history,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(ACTIVE_STATE_CLASSIFICATIONS.includes("recoveredPrior"), false);
  assert.equal(spec.projects.app.expectedDisposition, "githubPrebuilt");
  assert.equal(
    spec.projects.app.deploymentId,
    appReceipt(deploymentPlan).candidate.deploymentId,
  );
  const stateProof = activeStateProof({ spec });
  assert.equal(stateProof.outcome, "proven");

  const priorMappings = Object.values(result.journal.prior).flatMap((prior) =>
    prior.aliases.map((alias) => mapping(alias, prior)),
  );
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "manual-intervention",
    journalHistory: history,
    finalMappings: providerMappings(execution, priorMappings),
    publicSmokes: null,
    stateProof,
    finalCensus: stateProof,
    freshness: null,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(artifacts.evidence.recoveryOutcome, "manual-intervention");
  assert.equal(artifacts.proofs.outcome, "manual-intervention");
  assert.deepEqual(artifacts.proofs.rollbackTargets, [
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(
    artifacts.proofs.stateProof.artifact.projects.app.expectedDisposition,
    "githubPrebuilt",
  );
});

test("active recovery public-smoke materializer accepts only exact runtime results", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const finalPaths = {
    app: "https://app.mento.org/swap/celo",
    governance: "https://governance.mento.org/voting-power",
    reserve: "https://reserve.mento.org/?tab=stablecoins",
    ui: "https://ui.mento.org/form-components",
  };
  const interactions = {
    app: "real-production-wallet-list",
    governance: "governance-voting-power-navigation",
    reserve: "reserve-overview-data-and-supply-tab",
    ui: "ui-search-navigation-and-checkbox",
  };
  const runtimeResults = Object.fromEntries(
    Object.keys(finalPaths).map((target) => [
      target,
      {
        deploy_sha: execution.manifest.originalPriors[target].servedSha,
        final_url: finalPaths[target],
        interaction: interactions[target],
        logical_target: target,
        public_url: `https://${target}.mento.org/`,
        successful_documents: 1,
        successful_fonts: 1,
        successful_scripts: 1,
        successful_stylesheets: 1,
      },
    ]),
  );
  const smokes = createMainActiveRecoveryPublicSmokes({
    execution,
    targetResults: runtimeResults,
  });
  assert.deepEqual(smokes.governance, {
    publicUrl: "https://governance.mento.org/",
    runtime: runtimeResults.governance,
    servedSha: execution.manifest.originalPriors.governance.servedSha,
    status: "passed",
  });
  for (const [name, mutate, pattern] of [
    [
      "tampered served SHA",
      (value) => {
        value.governance.deploy_sha = OTHER_SHA;
      },
      /governance active recovery runtime smoke conflicts/,
    ],
    [
      "cross-target runtime result",
      (value) => {
        value.governance.logical_target = "reserve";
      },
      /governance active recovery runtime smoke conflicts/,
    ],
    [
      "missing runtime field",
      (value) => {
        delete value.governance.final_url;
      },
      /forbidden or missing fields/,
    ],
  ]) {
    assert.throws(
      () => {
        const targetResults = structuredClone(runtimeResults);
        mutate(targetResults);
        return createMainActiveRecoveryPublicSmokes({
          execution,
          targetResults,
        });
      },
      pattern,
      name,
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "vercel-main-recovery-smokes-"));
  try {
    const output = join(directory, "smokes.json");
    for (const [target, runtime] of Object.entries(runtimeResults)) {
      writeFileSync(join(directory, `${target}.json`), JSON.stringify(runtime));
    }
    writeFileSync(join(directory, "execution.json"), JSON.stringify(execution));
    const materialized = await runMainDeploymentCli({
      argv: [
        "active-recovery-public-smokes",
        "--execution",
        join(directory, "execution.json"),
        "--app",
        join(directory, "app.json"),
        "--governance",
        join(directory, "governance.json"),
        "--reserve",
        join(directory, "reserve.json"),
        "--ui",
        join(directory, "ui.json"),
        "--output",
        output,
      ],
      values: {},
    });
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), materialized);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("current state specs normalize a full release into active-state target order", () => {
  const deploymentPlan = activePlan();
  const execution = releaseExecutionForPlan(deploymentPlan);
  assert.deepEqual(execution.projection.stagedTargets, [
    "governance",
    "reserve",
    "ui",
    "app",
  ]);
  const candidateReceipts = Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      currentCandidateReceipt(execution, target),
    ]),
  );
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts,
    runId: "800",
    runAttempt: "3",
  });
  const prepared = createMainCurrentActiveInputs({
    execution,
    barrier,
    currentMappings: currentCanonicalMappings(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  }).journal;
  const activeSpec = createMainCurrentActiveDeploymentStateSpec({
    execution,
    barrier,
    journalHistory: [prepared],
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(activeSpec.stagedTargets, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(activeSpec.activeTargets, activeSpec.stagedTargets);
  assert.deepEqual(activeSpec.shadowTargets, []);

  const verifiedExecution = createMainReleaseExecution({
    ...execution,
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
  });
  const verifiedBarrier = createMainStageBarrier({
    execution: verifiedExecution,
    candidateReceipts: Object.fromEntries(
      ["app", "governance", "reserve", "ui"].map((target) => [
        target,
        currentCandidateReceipt(verifiedExecution, target),
      ]),
    ),
    runId: "800",
    runAttempt: "3",
  });
  const verifiedSpec = createMainCurrentReleaseVerifiedDeploymentStateSpec({
    execution: verifiedExecution,
    barrier: verifiedBarrier,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(verifiedSpec.stagedTargets, activeSpec.stagedTargets);
  assert.deepEqual(verifiedSpec.activeTargets, activeSpec.activeTargets);
  assert.deepEqual(verifiedSpec.shadowTargets, activeSpec.shadowTargets);
});

test("current state specs normalize a mixed App and ordinary release", () => {
  const deploymentPlan = activePlan({ deployments: ["app", "governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  assert.deepEqual(execution.projection.stagedTargets, ["governance", "app"]);
  const candidateReceipts = {
    app: currentCandidateReceipt(execution, "app"),
    governance: currentCandidateReceipt(execution, "governance"),
    reserve: null,
    ui: null,
  };
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts,
    runId: "800",
    runAttempt: "3",
  });
  const activeSpec = createMainCurrentActiveDeploymentStateSpec({
    execution,
    barrier,
    journalHistory: [
      createMainCurrentActiveInputs({
        execution,
        barrier,
        currentMappings: currentCanonicalMappings(deploymentPlan),
        runId: "800",
        runAttempt: "3",
      }).journal,
    ],
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(activeSpec.stagedTargets, ["app", "governance"]);
  assert.deepEqual(activeSpec.activeTargets, ["app", "governance"]);
  assert.deepEqual(activeSpec.shadowTargets, []);

  const verifiedExecution = createMainReleaseExecution({
    ...execution,
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
  });
  const verifiedSpec = createMainCurrentReleaseVerifiedDeploymentStateSpec({
    execution: verifiedExecution,
    barrier: createMainStageBarrier({
      execution: verifiedExecution,
      candidateReceipts: {
        app: currentCandidateReceipt(verifiedExecution, "app"),
        governance: currentCandidateReceipt(verifiedExecution, "governance"),
        reserve: null,
        ui: null,
      },
      runId: "800",
      runAttempt: "3",
    }),
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(verifiedSpec.stagedTargets, activeSpec.stagedTargets);
  assert.deepEqual(verifiedSpec.activeTargets, activeSpec.activeTargets);
  assert.deepEqual(verifiedSpec.shadowTargets, activeSpec.shadowTargets);
});

test("current release verification is journal-free and binds its barrier candidates", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const base = releaseExecutionForPlan(deploymentPlan);
  const execution = createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: base.manifest,
    upstream: base.upstream,
    selection: base.selection,
  });
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: {
      app: null,
      governance: currentCandidateReceipt(execution, "governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  const spec = createMainCurrentReleaseVerifiedDeploymentStateSpec({
    execution,
    barrier,
    runId: "800",
    runAttempt: "3",
  });
  const rawStateProof = activeStateProof({
    spec,
    deploymentPlan,
    journalHistory: [],
    jobs: stageJobs(deploymentPlan),
    runId: "800",
    runAttempt: "3",
  });
  const terminalState = createMainActiveTerminalStateProof({
    execution,
    barrier,
    stateProof: rawStateProof,
    runId: "800",
    runAttempt: "3",
  });
  const aliases = createMainCurrentReleaseVerifiedAliasMappingSpec({
    execution,
    barrier,
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    aliases.bindings.some(({ alias }) => alias === "governance.mento.org"),
    true,
  );
  const mappings = Object.values(execution.manifest.originalPriors).flatMap(
    (prior) =>
      prior.aliases.map((alias) =>
        mapping(
          alias,
          prior === execution.manifest.originalPriors.governance
            ? {
                deploymentId:
                  rawStateProof.projects.governance.expectedDeploymentId,
                deploymentUrl:
                  rawStateProof.projects.governance.expectedDeploymentUrl,
              }
            : prior,
        ),
      ),
  );
  const smokes = createMainCurrentActivePublicSmokes({
    execution,
    barrier,
    targetResults: {
      app: null,
      governance: runtimeSmoke("governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  const artifacts = createMainActiveTerminalArtifacts({
    execution,
    outcome: "current-release-verified",
    journalHistory: [],
    finalMappings: providerMappings(execution, mappings),
    publicSmokes: smokes,
    stateProof: terminalState,
    finalCensus: terminalState,
    freshness: createMainActiveFreshness({ deploySha: SHA, observedSha: SHA }),
    runId: "800",
    runAttempt: "3",
  });
  assert.equal(
    artifacts.evidence.schema,
    MAIN_ACTIVE_CURRENT_RELEASE_EVIDENCE_SCHEMA,
  );
  assert.equal(artifacts.proofs.mutationCount, 0);
  assert.throws(
    () =>
      createMainActiveTerminalStateProof({
        execution,
        barrier,
        stateProof: {
          ...rawStateProof,
          projects: {
            ...rawStateProof.projects,
            governance: {
              ...rawStateProof.projects.governance,
              expectedDeploymentId: "dpl_forged123",
            },
          },
        },
        runId: "800",
        runAttempt: "3",
      }),
    /deployment classification is malformed|current release candidate conflicts/,
  );
});

test("current active public-smoke materializer binds each active runtime result", async () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const execution = releaseExecutionForPlan(deploymentPlan);
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: {
      app: null,
      governance: currentCandidateReceipt(execution, "governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  const runtimeResults = {
    app: null,
    governance: {
      deploy_sha: execution.manifest.deploySha,
      final_url: "https://governance.mento.org/voting-power",
      interaction: "governance-voting-power-navigation",
      logical_target: "governance",
      public_url: "https://governance.mento.org/",
      successful_documents: 1,
      successful_fonts: 1,
      successful_scripts: 1,
      successful_stylesheets: 1,
    },
    reserve: null,
    ui: null,
  };
  const smokes = createMainCurrentActivePublicSmokes({
    execution,
    barrier,
    targetResults: runtimeResults,
    runId: "800",
    runAttempt: "3",
  });
  assert.deepEqual(smokes, {
    app: {
      publicUrl: "https://app.mento.org/",
      runtime: null,
      servedSha: null,
      status: "not-required",
    },
    governance: {
      publicUrl: "https://governance.mento.org/",
      runtime: runtimeResults.governance,
      servedSha: execution.manifest.deploySha,
      status: "passed",
    },
    reserve: {
      publicUrl: "https://reserve.mento.org/",
      runtime: null,
      servedSha: null,
      status: "not-required",
    },
    ui: {
      publicUrl: "https://ui.mento.org/",
      runtime: null,
      servedSha: null,
      status: "not-required",
    },
  });

  for (const [name, mutate, pattern] of [
    [
      "stale deployment SHA",
      (value) => {
        value.governance.deploy_sha = OTHER_SHA;
      },
      /governance active runtime smoke conflicts/,
    ],
    [
      "cross-target runtime result",
      (value) => {
        value.governance.logical_target = "reserve";
      },
      /governance active runtime smoke conflicts/,
    ],
    [
      "wrong requested public URL",
      (value) => {
        value.governance.public_url = "https://reserve.mento.org/";
      },
      /governance active runtime smoke conflicts/,
    ],
    [
      "wrong final URL",
      (value) => {
        value.governance.final_url = "https://governance.mento.org/";
      },
      /governance active runtime smoke conflicts/,
    ],
    [
      "incomplete resource evidence",
      (value) => {
        value.governance.successful_scripts = 0;
      },
      /governance active runtime smoke is incomplete/,
    ],
    [
      "malformed runtime result",
      (value) => {
        delete value.governance.final_url;
      },
      /forbidden or missing fields/,
    ],
    [
      "inactive target runtime result",
      (value) => {
        value.app = { ...value.governance, logical_target: "app" };
      },
      /app inactive active runtime smoke is malformed/,
    ],
  ]) {
    assert.throws(
      () => {
        const targetResults = structuredClone(runtimeResults);
        mutate(targetResults);
        return createMainCurrentActivePublicSmokes({
          execution,
          barrier,
          targetResults,
          runId: "800",
          runAttempt: "3",
        });
      },
      pattern,
      name,
    );
  }

  const directory = mkdtempSync(join(tmpdir(), "vercel-main-current-smokes-"));
  try {
    const output = join(directory, "smokes.json");
    writeFileSync(join(directory, "execution.json"), JSON.stringify(execution));
    writeFileSync(join(directory, "barrier.json"), JSON.stringify(barrier));
    for (const [target, runtime] of Object.entries(runtimeResults)) {
      writeFileSync(join(directory, `${target}.json`), JSON.stringify(runtime));
    }
    const materialized = await runMainDeploymentCli({
      argv: [
        "active-public-smokes",
        "--execution",
        join(directory, "execution.json"),
        "--stage-barrier",
        join(directory, "barrier.json"),
        "--app",
        join(directory, "app.json"),
        "--governance",
        join(directory, "governance.json"),
        "--reserve",
        join(directory, "reserve.json"),
        "--ui",
        join(directory, "ui.json"),
        "--output",
        output,
      ],
      values: { GITHUB_RUN_ID: "800", GITHUB_RUN_ATTEMPT: "3" },
    });
    assert.deepEqual(materialized, smokes);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), smokes);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("active final-result matrix preserves safe noops and fails every recovery outcome after evidence", () => {
  const deploymentPlan = activePlan();
  const currentReleaseBase = releaseExecutionForPlan(deploymentPlan);
  const currentReleaseExecution = createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: currentReleaseBase.manifest,
    upstream: currentReleaseBase.upstream,
    selection: currentReleaseBase.selection,
  });
  const cases = [
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "active-committed",
      "not-required",
      {},
      "success",
    ],
    [
      currentReleaseExecution,
      deploymentPlan,
      "current-release-verified",
      "not-required",
      {},
      "success",
    ],
    [
      releaseExecutionForPlan(activePlan({ deployments: [] })),
      activePlan({ deployments: [] }),
      "no-target",
      "not-required",
      {},
      "success",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "superseded-before-journal",
      "not-required",
      {},
      "success",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "active-failed",
      "verified-no-mutation",
      { coordinator: "failure", recovery: "success" },
      "failure",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "active-failed",
      "recovered",
      { coordinator: "failure", recovery: "failure" },
      "failure",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "active-failed",
      "manual-intervention",
      { coordinator: "failure", recovery: "failure" },
      "failure",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "active-failed",
      "recovery-failed",
      { coordinator: "failure", recovery: "failure" },
      "failure",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "preparation-failed-before-journal",
      "not-required",
      { coordinator: "failure", recovery: "failure" },
      "failure",
    ],
    [
      releaseExecutionForPlan(deploymentPlan),
      deploymentPlan,
      "active-failed",
      "not-found-after-runner-failure",
      { coordinator: "failure", recovery: "success" },
      "failure",
    ],
  ];
  for (const [
    execution,
    jobPlan,
    coordinatorOutcome,
    recoveryOutcome,
    jobOverrides,
    expected,
  ] of cases) {
    const verdict = evaluateMainActiveFinalResults({
      execution,
      jobs: finalActiveJobs(jobPlan, jobOverrides),
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
      execution: releaseExecutionForPlan(deploymentPlan),
      jobs: finalActiveJobs(deploymentPlan, { stageUi: "failure" }),
      coordinatorOutcome: "active-committed",
      recoveryOutcome: "not-required",
    }).releaseOutcome,
    "failure",
  );
  assert.equal(
    evaluateMainActiveFinalResults({
      execution: releaseExecutionForPlan(deploymentPlan),
      jobs: finalActiveJobs(deploymentPlan, {
        coordinator: "failure",
        recovery: "success",
      }),
      coordinatorOutcome: "active-failed",
      recoveryOutcome: "recovered",
    }).reason,
    "unexpected-active-job-graph",
  );
});

test("active final result accepts a staged target-local main rollback with no active targets", () => {
  const deploymentPlan = activePlan({
    deployments: ["governance"],
    mainOwnershipMode: ownership({
      governance: MAIN_OWNERSHIP_MODES.SHADOW,
    }),
  });
  assert.deepEqual(deploymentPlan.planning.stagedTargets, ["governance"]);
  assert.deepEqual(deploymentPlan.planning.activeTargets, []);
  assert.deepEqual(deploymentPlan.planning.shadowTargets, ["governance"]);
  assert.deepEqual(
    evaluateMainActiveFinalResults({
      execution: releaseExecutionForPlan(deploymentPlan),
      jobs: finalActiveJobs(deploymentPlan),
      coordinatorOutcome: "shadow-prepared",
      recoveryOutcome: "not-required",
    }),
    {
      releaseOutcome: "success",
      evidenceKind: "success",
      failAfterEvidence: false,
      reason: "shadow-prepared",
    },
  );
  const contradictoryPlan = activePlan({ deployments: ["governance"] });
  assert.equal(
    evaluateMainActiveFinalResults({
      execution: releaseExecutionForPlan(contradictoryPlan),
      jobs: finalActiveJobs(contradictoryPlan),
      coordinatorOutcome: "shadow-prepared",
      recoveryOutcome: "not-required",
    }).reason,
    "unexpected-active-job-graph",
  );
});

test("active safe-noop evidence records target-local shadow success without failure semantics", () => {
  const deploymentPlan = activePlan({
    deployments: ["governance"],
    mainOwnershipMode: ownership({
      governance: MAIN_OWNERSHIP_MODES.SHADOW,
    }),
  });
  const evidence = createMainActiveSafeNoopEvidence({
    plan: deploymentPlan,
    jobs: activeJobs(deploymentPlan),
    coordinatorOutcome: "shadow-prepared",
    recoveryOutcome: "not-required",
    verifiedDeploySha: SHA,
    workflowDefinitionSha: SHA,
    runId: "800",
    runAttempt: "3",
    workflowRunUrl: WORKFLOW_RUN_URL,
  });
  assert.equal(evidence.schema, MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA);
  assert.equal(evidence.outcome, "success");
  assert.equal(evidence.reason, "shadow-prepared");
  assert.equal(evidence.publicServingMutationCommands, 0);
  assert.deepEqual(evidence.planning.stagedTargets, ["governance"]);
  assert.deepEqual(evidence.planning.activeTargets, []);
  assert.deepEqual(evidence.planning.shadowTargets, ["governance"]);
  assert.equal(Object.hasOwn(evidence, "journal"), false);
  const summary = renderMainActiveSafeNoopEvidence(evidence);
  assert.match(summary, /active safe-noop evidence/);
  assert.match(summary, /Outcome: `success` \(`shadow-prepared`\)/);
  assert.match(summary, /Active journal: `not-required`/);
  assert.doesNotMatch(summary, /failure/i);
  assert.throws(
    () =>
      createMainActiveSafeNoopEvidence({
        ...evidence,
        plan: activePlan({ deployments: ["governance"] }),
        jobs: activeJobs(activePlan({ deployments: ["governance"] })),
        coordinatorOutcome: "active-committed",
      }),
    /requires a safe no-op verdict/,
  );
});

test("active failure evidence never claims zero after a mutation may have started and redacts raw plan output", () => {
  const deploymentPlan = activePlan({ deployments: ["governance"] });
  const prepared = createPreparedMainActiveJournal({
    plan: deploymentPlan,
    stageJobs: stageJobs(deploymentPlan),
    appCandidateReceipt: null,
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
  // A recovered or manual outcome still moved domains before the compensating
  // rollback, so failure evidence names them too — and says "unknown" rather
  // than "none" when the producing job observed no census.
  assert.equal(evidence.riderAliases, null);
  assert.match(
    renderMainActiveDeploymentFailureEvidence(evidence),
    /- Rider domains moved: unknown \(no census in this job\)/,
  );
  // But an outcome whose journal proves zero mutation commands moved nothing,
  // and must not imply movement its own mutation count has ruled out.
  const provenNoMutation = createMainActiveDeploymentFailureEvidence({
    ...base,
    journalHistory: [prepared],
    publicServingMutationCommands: 0,
    recoveryOutcome: "verified-no-mutation",
    errorCode: "VERIFIED_NO_MUTATION",
  });
  assert.equal(provenNoMutation.riderAliases, null);
  assert.equal(provenNoMutation.publicServingMutationCommands, 0);
  const noMutationSummary =
    renderMainActiveDeploymentFailureEvidence(provenNoMutation);
  assert.match(
    noMutationSummary,
    /- Rider domains moved: none \(no mutation in this run\)/,
  );
  assert.doesNotMatch(noMutationSummary, /Rider domains moved: unknown/);
  const withRiders = createMainActiveDeploymentFailureEvidence({
    ...base,
    publicServingMutationCommands: 1,
    riderAliases: {
      governance: {
        aliases: ["governancementoorg-mentolabs.vercel.app"],
        omitted: 0,
      },
    },
    riderTargets: ["governance"],
  });
  assert.deepEqual(withRiders.riderAliases, {
    governance: {
      aliases: ["governancementoorg-mentolabs.vercel.app"],
      omitted: 0,
    },
  });
  assert.match(
    renderMainActiveDeploymentFailureEvidence(withRiders),
    /- Rider domains moved with `governance`: governancementoorg-mentolabs\.vercel\.app/,
  );
  // Riders never widen scope: a target this release did not promote cannot
  // appear, and a foreign reviewed domain is still cross-target contamination.
  assert.throws(
    () =>
      createMainActiveDeploymentFailureEvidence({
        ...base,
        publicServingMutationCommands: 1,
        riderAliases: {
          governance: { aliases: [], omitted: 0 },
          ui: { aliases: [], omitted: 0 },
        },
        riderTargets: ["governance"],
      }),
    /Active failure rider domains contains forbidden or missing fields/,
  );
  assert.throws(
    () =>
      createMainActiveDeploymentFailureEvidence({
        ...base,
        publicServingMutationCommands: 1,
        riderAliases: {
          governance: { aliases: ["app.mento.org"], omitted: 0 },
        },
        riderTargets: ["governance"],
      }),
    /Active failure rider domains governance is not canonical/,
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

test("final-active CLI and safe-noop renderer publish target-local shadow success", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-active-noop-"));
  try {
    const githubOutput = join(directory, "github-output");
    const evidenceOutput = join(directory, "evidence.json");
    const summary = join(directory, "summary.md");
    const executionPath = join(directory, "execution.json");
    writeFileSync(githubOutput, "");
    writeFileSync(summary, "");
    const deploymentPlan = activePlan({
      deployments: ["governance"],
      mainOwnershipMode: ownership({
        governance: MAIN_OWNERSHIP_MODES.SHADOW,
      }),
    });
    writeFileSync(
      executionPath,
      JSON.stringify(releaseExecutionForPlan(deploymentPlan)),
    );
    const values = {
      WAIT_FOR_CI_RESULT: "success",
      PLAN_RESULT: "success",
      STAGE_GOVERNANCE_RESULT: "success",
      STAGE_RESERVE_RESULT: "skipped",
      STAGE_UI_RESULT: "skipped",
      COORDINATOR_RESULT: "success",
      COORDINATOR_OUTCOME: "shadow-prepared",
      RECOVERY_RESULT: "skipped",
      RECOVERY_OUTCOME: "not-required",
      DEPLOY_SHA: SHA,
      UPSTREAM_RUN_ID: "123456",
      UPSTREAM_RUN_ATTEMPT: "2",
      GITHUB_WORKFLOW_SHA: SHA,
      GITHUB_RUN_ID: "800",
      GITHUB_RUN_ATTEMPT: "3",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
      GITHUB_OUTPUT: githubOutput,
      GITHUB_STEP_SUMMARY: summary,
    };
    const verdict = await runMainDeploymentCli({
      argv: ["final-active", "--execution", executionPath],
      values,
    });
    assert.deepEqual(verdict, {
      releaseOutcome: "success",
      evidenceKind: "success",
      failAfterEvidence: false,
      reason: "shadow-prepared",
    });
    assert.match(readFileSync(githubOutput, "utf8"), /release_outcome=success/);
    assert.match(readFileSync(githubOutput, "utf8"), /evidence_kind=success/);
    assert.match(
      readFileSync(githubOutput, "utf8"),
      /fail_after_evidence=false/,
    );

    const evidence = await runMainDeploymentCli({
      argv: ["active-safe-noop-evidence", "--output", evidenceOutput],
      values: {
        ...values,
        PLAN_JSON: JSON.stringify(deploymentPlan),
        RECOVERY_RESULT: "success",
      },
    });
    assert.equal(evidence.schema, MAIN_ACTIVE_SAFE_NOOP_EVIDENCE_SCHEMA);
    assert.equal(evidence.outcome, "success");
    assert.equal(evidence.reason, "shadow-prepared");
    assert.deepEqual(
      JSON.parse(readFileSync(evidenceOutput, "utf8")),
      evidence,
    );
    assert.match(readFileSync(summary, "utf8"), /active safe-noop evidence/);
    assert.doesNotMatch(readFileSync(summary, "utf8"), /failure/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("final-active CLI exposes fail-after-evidence without ending evidence production", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-active-final-"));
  try {
    const output = join(directory, "github-output");
    const executionPath = join(directory, "execution.json");
    writeFileSync(output, "");
    const deploymentPlan = activePlan();
    writeFileSync(
      executionPath,
      JSON.stringify(releaseExecutionForPlan(deploymentPlan)),
    );
    const result = await runMainDeploymentCli({
      argv: ["final-active", "--execution", executionPath],
      values: {
        WAIT_FOR_CI_RESULT: "success",
        PLAN_RESULT: "success",
        STAGE_GOVERNANCE_RESULT: "success",
        STAGE_RESERVE_RESULT: "success",
        STAGE_UI_RESULT: "success",
        COORDINATOR_RESULT: "failure",
        COORDINATOR_OUTCOME: "active-failed",
        RECOVERY_RESULT: "success",
        RECOVERY_OUTCOME: "manual-intervention",
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(result.releaseOutcome, "failure");
    assert.equal(result.failAfterEvidence, true);
    assert.match(readFileSync(output, "utf8"), /release_outcome=failure/);
    assert.match(readFileSync(output, "utf8"), /fail_after_evidence=true/);
    assert.match(readFileSync(output, "utf8"), /evidence_kind=failure/);

    writeFileSync(output, "");
    const preparationFailure = await runMainDeploymentCli({
      argv: ["final-active", "--execution", executionPath],
      values: {
        WAIT_FOR_CI_RESULT: "success",
        PLAN_RESULT: "success",
        STAGE_GOVERNANCE_RESULT: "failure",
        STAGE_RESERVE_RESULT: "failure",
        STAGE_UI_RESULT: "failure",
        COORDINATOR_RESULT: "failure",
        COORDINATOR_OUTCOME: "preparation-failed-before-journal",
        RECOVERY_RESULT: "failure",
        RECOVERY_OUTCOME: "preparation-failed-before-journal",
        DEPLOY_SHA: SHA,
        UPSTREAM_RUN_ID: "123456",
        UPSTREAM_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "800",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(preparationFailure.releaseOutcome, "failure");
    assert.equal(preparationFailure.failAfterEvidence, true);
    assert.equal(preparationFailure.reason, "stage-governance-invalid");
    assert.match(readFileSync(output, "utf8"), /release_outcome=failure/);
    assert.match(readFileSync(output, "utf8"), /fail_after_evidence=true/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("final-active CLI process fails closed when the evaluator throws", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-main-active-throw-"));
  try {
    const output = join(directory, "github-output");
    const executionPath = join(directory, "execution.json");
    writeFileSync(output, "");
    const tamperedExecution = releaseExecutionForPlan(activePlan());
    tamperedExecution.projection.activeTargets = [];
    writeFileSync(executionPath, JSON.stringify(tamperedExecution));
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./vercel-main-deployment.mjs", import.meta.url)),
        "final-active",
        "--execution",
        executionPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          WAIT_FOR_CI_RESULT: "success",
          PLAN_RESULT: "success",
          STAGE_GOVERNANCE_RESULT: "success",
          STAGE_RESERVE_RESULT: "success",
          STAGE_UI_RESULT: "success",
          COORDINATOR_RESULT: "success",
          COORDINATOR_OUTCOME: "active-committed",
          RECOVERY_RESULT: "skipped",
          RECOVERY_OUTCOME: "not-required",
          DEPLOY_SHA: SHA,
          UPSTREAM_RUN_ID: "123456",
          UPSTREAM_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "800",
          GITHUB_RUN_ATTEMPT: "3",
          GITHUB_REPOSITORY: "mento-protocol/frontend-monorepo",
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Main release execution projection differs from its stable manifest/,
    );
    assert.equal(readFileSync(output, "utf8"), "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Rider evidence is visibility, so a project with many or long domains must
// never be able to fail a release: the census truncates, deterministically,
// and says how much it dropped.
test("rider evidence truncates rather than letting visibility fail a release", () => {
  const crowded = planningSnapshot();
  const many = Array.from(
    { length: 40 },
    (_unused, index) =>
      `appmentoorg-${String(index).padStart(3, "0")}-mentolabs.vercel.app`,
  );
  for (const state of crowded.states) {
    if (state.alias === "app.mento.org") {
      state.aliases = [...state.aliases, ...many].toSorted();
    }
  }
  const build = () => {
    const deploymentPlan = plan({ snapshot: structuredClone(crowded) });
    const jobs = stageJobs(deploymentPlan);
    const identity = createMainJournalArtifactIdentity({
      deploySha: SHA,
      runId: "800",
      runAttempt: "3",
    });
    return createMainDeploymentEvidence({
      plan: deploymentPlan,
      stages: Object.fromEntries(
        ["governance", "reserve", "ui"].map((target) => [
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
              buildDurationMs: "10000",
              deployDurationMs: "2000",
              totalDurationMs: "20000",
              turboCacheHits: "3",
              turboCacheMisses: "1",
            },
          },
        ]),
      ),
      app: {
        nextDeploymentId: appReceipt().intent.candidateId,
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
  };
  const evidence = build();
  const app = evidence.riderAliases.app;
  assert.equal(app.aliases.length, MAIN_RIDER_ALIAS_TARGET_LIMIT);
  assert.equal(app.omitted, 43 - MAIN_RIDER_ALIAS_TARGET_LIMIT);
  assert.deepEqual(app.aliases, [...app.aliases].sort());
  const bytes = Object.values(evidence.riderAliases).reduce(
    (total, entry) =>
      total +
      entry.aliases.reduce(
        (inner, alias) => inner + Buffer.byteLength(alias, "utf8") + 3,
        0,
      ),
    0,
  );
  assert.ok(
    bytes <= MAIN_RIDER_ALIAS_BYTE_BUDGET,
    `rider bytes ${bytes} exceed the budget`,
  );
  assert.match(
    renderMainDeploymentEvidence(evidence),
    /\(\+27 more, truncated\)/,
  );
  // Deterministic: the same census renders identically on every attempt.
  assert.deepEqual(build().riderAliases, evidence.riderAliases);
});
