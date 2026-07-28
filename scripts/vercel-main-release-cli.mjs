#!/usr/bin/env node

import { createHash } from "node:crypto";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCanonicalOutput,
  assertMainPlanningSnapshot,
} from "./vercel-deployment-state.mjs";
import {
  appendGithubOutputs,
  assertMainProviderDiscovery,
  createMainCanonicalMappings,
  digestMainLegacyV2Snapshot,
  readPrivateJson,
  reviewedRunnerTemp,
  writePrivateJson,
} from "./vercel-main-provider-cli.mjs";
import {
  createMainCandidateIntent,
  decodeMainCandidateReceipt,
} from "./vercel-main-candidate.mjs";
import {
  assertMainPreplanReconciliation,
  decideMainPreplanReconciliation,
} from "./vercel-main-release-reconciliation.mjs";
import {
  assertMainReleaseExecution,
  createMainReleaseExecution,
  createMainReleaseSelection,
  decodeMainReleaseExecution,
  encodeMainReleaseExecution,
} from "./vercel-main-release-execution.mjs";
import { createMainReleaseBaseline } from "./vercel-main-release-planner.mjs";
import {
  createMainForwardTransactionJournal,
  createMainInheritedRecoveryJournal,
} from "./vercel-main-release-journal.mjs";
import {
  MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES,
  MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
  createMainActiveTerminalArtifacts,
  createMainTerminalStageResults,
} from "./vercel-main-deployment.mjs";
import {
  MAIN_TRANSACTION_REPOSITORY,
  createMainTransactionId,
  mainTransactionJournalArtifactName,
} from "./vercel-main-transaction.mjs";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const TARGETS = ["app", "governance", "reserve", "ui"];
const EXECUTION_DIAGNOSTIC_PHASES = Object.freeze({
  INPUT: "input",
  PREPLAN: "preplan",
  DISCOVERY: "discovery",
  PLANNING_SNAPSHOT: "planning-snapshot",
  PROJECT_CENSUS: "project-census",
  LEGACY: "legacy",
  CANONICAL_MAPPINGS: "canonical-mappings",
  PREPLAN_RECOMPUTE: "preplan-recompute",
  OWNERSHIP: "ownership",
  BASELINE_SOURCE_GIT: "baseline-source-git",
  BASELINE_PRIOR_APP: "baseline-prior-app",
  BASELINE_PRIOR_GOVERNANCE: "baseline-prior-governance",
  BASELINE_PRIOR_RESERVE: "baseline-prior-reserve",
  BASELINE_PRIOR_UI: "baseline-prior-ui",
  BASELINE_PLANNER_RANGE: "baseline-planner-range",
  BASELINE_MANIFEST: "baseline-manifest",
  BASELINE_UNKNOWN: "baseline-unknown",
  MANIFEST_ASSERTION: "manifest-assertion",
  SELECTION: "selection",
  EXECUTION_ASSEMBLY: "execution-assembly",
  PRIVATE_OUTPUT: "private-output",
  EXECUTION_ENCODE: "execution-encode",
  GITHUB_OUTPUT: "github-output",
});

export const MAIN_RELEASE_EXECUTION_DIAGNOSTIC_CODES = Object.freeze({
  [EXECUTION_DIAGNOSTIC_PHASES.INPUT]: "main-release-execution-input",
  [EXECUTION_DIAGNOSTIC_PHASES.PREPLAN]: "main-release-execution-preplan",
  [EXECUTION_DIAGNOSTIC_PHASES.DISCOVERY]: "main-release-execution-discovery",
  [EXECUTION_DIAGNOSTIC_PHASES.PLANNING_SNAPSHOT]:
    "main-release-execution-planning-snapshot",
  [EXECUTION_DIAGNOSTIC_PHASES.PROJECT_CENSUS]:
    "main-release-execution-project-census",
  [EXECUTION_DIAGNOSTIC_PHASES.LEGACY]: "main-release-execution-legacy",
  [EXECUTION_DIAGNOSTIC_PHASES.CANONICAL_MAPPINGS]:
    "main-release-execution-canonical-mappings",
  [EXECUTION_DIAGNOSTIC_PHASES.PREPLAN_RECOMPUTE]:
    "main-release-execution-preplan-recompute",
  [EXECUTION_DIAGNOSTIC_PHASES.OWNERSHIP]: "main-release-execution-ownership",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_SOURCE_GIT]:
    "main-release-execution-baseline-source-git",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_APP]:
    "main-release-execution-baseline-prior-app",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_GOVERNANCE]:
    "main-release-execution-baseline-prior-governance",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_RESERVE]:
    "main-release-execution-baseline-prior-reserve",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_UI]:
    "main-release-execution-baseline-prior-ui",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PLANNER_RANGE]:
    "main-release-execution-baseline-planner-range",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_MANIFEST]:
    "main-release-execution-baseline-manifest",
  [EXECUTION_DIAGNOSTIC_PHASES.BASELINE_UNKNOWN]:
    "main-release-execution-baseline-unknown",
  [EXECUTION_DIAGNOSTIC_PHASES.MANIFEST_ASSERTION]:
    "main-release-execution-manifest-assertion",
  [EXECUTION_DIAGNOSTIC_PHASES.SELECTION]: "main-release-execution-selection",
  [EXECUTION_DIAGNOSTIC_PHASES.EXECUTION_ASSEMBLY]:
    "main-release-execution-assembly",
  [EXECUTION_DIAGNOSTIC_PHASES.PRIVATE_OUTPUT]:
    "main-release-execution-private-output",
  [EXECUTION_DIAGNOSTIC_PHASES.EXECUTION_ENCODE]:
    "main-release-execution-encode",
  [EXECUTION_DIAGNOSTIC_PHASES.GITHUB_OUTPUT]:
    "main-release-execution-github-output",
});

const TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES = Object.freeze({
  READ_INPUTS: "read-inputs",
  CREATE_ARTIFACTS: "create-artifacts",
  EVIDENCE_WRITE: "evidence-write",
  PROOFS_WRITE: "proofs-write",
});

export const MAIN_RELEASE_TERMINAL_ARTIFACT_DIAGNOSTIC_CODES = Object.freeze({
  [TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.READ_INPUTS]:
    "main-release-terminal-artifacts-read-inputs",
  [TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.CREATE_ARTIFACTS]:
    "main-release-terminal-artifacts-create-artifacts",
  [TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.EVIDENCE_WRITE]:
    "main-release-terminal-artifacts-evidence-write",
  [TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.PROOFS_WRITE]:
    "main-release-terminal-artifacts-proofs-write",
});

const BASELINE_PRIOR_PHASE_BY_TARGET = Object.freeze({
  app: EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_APP,
  governance: EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_GOVERNANCE,
  reserve: EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_RESERVE,
  ui: EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PRIOR_UI,
});
const OPTIONS = Object.freeze({
  "candidate-receipts": Object.freeze([
    "app",
    "execution",
    "governance",
    "output",
    "reserve",
    "ui",
  ]),
  execution: Object.freeze([
    "preplan",
    "discovery",
    "planning-snapshot",
    "legacy-snapshot",
    "output",
  ]),
  "forward-journal": Object.freeze([
    "execution",
    "current-mappings",
    "candidate-receipts",
    "output",
  ]),
  "inherited-recovery-journal": Object.freeze([
    "preplan",
    "legacy-snapshot",
    "current-mappings",
    "candidate-receipts",
    "journal-output",
    "plan-output",
  ]),
  "inherited-candidate-intent": Object.freeze(["output", "preplan", "target"]),
  "inherited-candidate-receipts": Object.freeze([
    "app",
    "governance",
    "output",
    "preplan",
    "reserve",
    "ui",
  ]),
  materialize: Object.freeze(["output"]),
  selection: Object.freeze(["execution", "output"]),
  "terminal-stage-results": Object.freeze([
    "app-result",
    "coordinator-result",
    "execution",
    "governance-result",
    "output",
    "reserve-result",
    "ui-result",
  ]),
  "terminal-artifacts": Object.freeze([
    "active-evidence-output",
    "execution",
    "final-census",
    "final-mappings",
    "freshness",
    "journal-history",
    "legacy-v2",
    "outcome",
    "proofs-output",
    "public-smokes",
    "stage-results",
    "state-proof",
  ]),
});

function createExecutionDiagnostics() {
  let phase = EXECUTION_DIAGNOSTIC_PHASES.INPUT;
  return Object.freeze({
    mark(nextPhase) {
      if (!Object.hasOwn(MAIN_RELEASE_EXECUTION_DIAGNOSTIC_CODES, nextPhase)) {
        throw new Error(
          "Main release execution diagnostic phase is unsupported",
        );
      }
      phase = nextPhase;
    },
    current() {
      return phase;
    },
  });
}

function createTerminalArtifactDiagnostics() {
  let phase = TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.READ_INPUTS;
  return Object.freeze({
    mark(nextPhase) {
      if (
        !Object.hasOwn(
          MAIN_RELEASE_TERMINAL_ARTIFACT_DIAGNOSTIC_CODES,
          nextPhase,
        )
      ) {
        throw new Error(
          "Main release terminal artifact diagnostic phase is unsupported",
        );
      }
      phase = nextPhase;
    },
    current() {
      return phase;
    },
  });
}

function markExecutionPhase(diagnostics, phase) {
  diagnostics?.mark(phase);
}

function markTerminalArtifactPhase(diagnostics, phase) {
  diagnostics?.mark(phase);
}

function baselineFailurePhase(error) {
  const target =
    error !== null &&
    typeof error === "object" &&
    Object.hasOwn(error, "target") &&
    typeof error.target === "string"
      ? error.target
      : null;
  if (
    target !== null &&
    Object.hasOwn(BASELINE_PRIOR_PHASE_BY_TARGET, target)
  ) {
    return BASELINE_PRIOR_PHASE_BY_TARGET[target];
  }
  const message = error instanceof Error ? error.message : "";
  if (
    /DEPLOY_SHA cannot be resolved|DEPLOY_SHA did not resolve exactly|Git proof failed|Git ancestry proof failed|First-parent proof failed/.test(
      message,
    )
  ) {
    return EXECUTION_DIAGNOSTIC_PHASES.BASELINE_SOURCE_GIT;
  }
  const priorTarget = TARGETS.find((targetName) =>
    new RegExp(
      `Main release baseline ${targetName} (state is incomplete|prior is ambiguous)`,
    ).test(message),
  );
  if (priorTarget !== undefined) {
    return BASELINE_PRIOR_PHASE_BY_TARGET[priorTarget];
  }
  if (
    /planner|Main deployment plan|Main deployment range|Main deployment final plan/.test(
      message,
    )
  ) {
    return EXECUTION_DIAGNOSTIC_PHASES.BASELINE_PLANNER_RANGE;
  }
  if (/Main release manifest|original prior/.test(message)) {
    return EXECUTION_DIAGNOSTIC_PHASES.BASELINE_MANIFEST;
  }
  return EXECUTION_DIAGNOSTIC_PHASES.BASELINE_UNKNOWN;
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || !Object.hasOwn(OPTIONS, argv[0])) {
    throw new Error("Main release command is missing or unsupported");
  }
  const command = argv[0];
  const required = new Set(OPTIONS[command]);
  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      typeof flag !== "string" ||
      !/^--[a-z][a-z0-9-]*$/.test(flag) ||
      typeof value !== "string" ||
      value.length === 0
    ) {
      throw new Error("Main release arguments are malformed");
    }
    const name = flag.slice(2);
    if (!required.has(name) || Object.hasOwn(options, name)) {
      throw new Error("Main release option is unsupported or duplicated");
    }
    options[name] = value;
  }
  for (const name of required) {
    if (!Object.hasOwn(options, name)) {
      throw new Error(`Main release option --${name} is required`);
    }
  }
  return { command, options };
}

function requireEnvironment(env) {
  if (
    typeof env.DEPLOY_SHA !== "string" ||
    !SHA_PATTERN.test(env.DEPLOY_SHA) ||
    typeof env.UPSTREAM_RUN_ID !== "string" ||
    !POSITIVE_ID_PATTERN.test(env.UPSTREAM_RUN_ID)
  ) {
    throw new Error("Main release identity environment is malformed");
  }
  return {
    deploySha: env.DEPLOY_SHA,
    upstreamRunId: env.UPSTREAM_RUN_ID,
  };
}

function currentAttempt(env) {
  if (
    typeof env.GITHUB_RUN_ID !== "string" ||
    !POSITIVE_ID_PATTERN.test(env.GITHUB_RUN_ID) ||
    typeof env.GITHUB_RUN_ATTEMPT !== "string" ||
    !POSITIVE_ID_PATTERN.test(env.GITHUB_RUN_ATTEMPT)
  ) {
    throw new Error("Main release current attempt environment is malformed");
  }
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
}

function expectedManifestCandidateIntent({ manifest, target, attempt }) {
  const prior = manifest.originalPriors[target];
  return createMainCandidateIntent({
    target,
    deploySha: manifest.deploySha,
    upstreamRunId: manifest.upstreamRunId,
    originRunId: attempt.runId,
    originAttempt: attempt.runAttempt,
    originTransactionId: createMainTransactionId({
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: manifest.deploySha,
      runId: attempt.runId,
      runAttempt: attempt.runAttempt,
    }),
    projectId: prior.projectId,
    projectName: prior.projectName,
    releaseManifest: manifest,
  });
}

function expectedCandidateIntent({ execution, target, attempt }) {
  return expectedManifestCandidateIntent({
    manifest: execution.manifest,
    target,
    attempt,
  });
}

function materializeCandidateReceipts({ execution, encoded, attempt }) {
  const selected = new Set(execution.projection.stagedTargets);
  return Object.fromEntries(
    TARGETS.map((target) => {
      const value = encoded[target];
      if (!selected.has(target)) {
        if (value !== "none") {
          throw new Error(
            `Unselected main release target ${target} must have no receipt`,
          );
        }
        return [target, null];
      }
      if (value === "none") {
        if (target !== "app") {
          throw new Error(
            `Selected main release target ${target} requires a receipt`,
          );
        }
        return [target, null];
      }
      const expected = expectedCandidateIntent({
        execution,
        target,
        attempt,
      });
      const receipt = decodeMainCandidateReceipt(value, expected);
      if (JSON.stringify(receipt.intent) !== JSON.stringify(expected)) {
        throw new Error(
          `Main release ${target} receipt is not from the current attempt`,
        );
      }
      return [target, receipt];
    }),
  );
}

function inheritedRecoveryDecision({ value, identity }) {
  const decision = assertMainPreplanReconciliation(value, {
    nextDeploySha: identity.deploySha,
    nextUpstreamRunId: identity.upstreamRunId,
  });
  if (decision.decision !== "restore-before-planning") {
    throw new Error(
      "Inherited candidate command requires restore-before-planning",
    );
  }
  return decision;
}

function materializeInheritedCandidateReceipts({ decision, encoded, attempt }) {
  const manifest = decision.reconciliation.manifest;
  const movedCandidates = new Set(decision.rollbackAuthorization.targets);
  return Object.fromEntries(
    TARGETS.map((target) => {
      const value = encoded[target];
      if (!movedCandidates.has(target)) {
        if (value !== "none") {
          throw new Error(
            `Unmoved inherited main release target ${target} must have no receipt`,
          );
        }
        return [target, null];
      }
      if (value === "none") {
        throw new Error(
          `Moved inherited main release target ${target} requires a receipt`,
        );
      }
      const expected = expectedManifestCandidateIntent({
        manifest,
        target,
        attempt,
      });
      const receipt = decodeMainCandidateReceipt(value, expected);
      if (JSON.stringify(receipt.intent) !== JSON.stringify(expected)) {
        throw new Error(
          `Inherited main release ${target} receipt is not from the current attempt`,
        );
      }
      return [target, receipt];
    }),
  );
}

function writeJournalOutputs(env, journal) {
  appendGithubOutputs(env, {
    transaction_id: journal.transactionId,
    journal_artifact_name: mainTransactionJournalArtifactName(journal),
    journal_sequence: String(journal.sequence),
  });
}

function projectIdsFromEnvironment(env) {
  return Object.fromEntries(
    TARGETS.map((target) => {
      const name = `VERCEL_PROJECT_ID_${target.toUpperCase()}`;
      const value = env[name];
      if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error(`Main release ${target} project ID is malformed`);
      }
      return [target, value];
    }),
  );
}

function ownershipFromEnvironment(env) {
  let value;
  try {
    value = JSON.parse(env.MAIN_OWNERSHIP_MODE_JSON);
  } catch {
    throw new Error("Main release ownership environment is malformed");
  }
  return value;
}

function currentUpstream(env) {
  return {
    runId: env.UPSTREAM_RUN_ID,
    runAttempt: env.UPSTREAM_RUN_ATTEMPT,
    runUrl: env.UPSTREAM_RUN_URL,
    buildAndTestJobUrl: env.BUILD_AND_TEST_JOB_URL,
  };
}

function exactLegacyState(value) {
  const snapshot = assertCanonicalOutput(value);
  if (!Array.isArray(snapshot) || snapshot.length !== 1) {
    throw new Error("Main release legacy snapshot must contain one state");
  }
  return snapshot[0];
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameProjectIds(left, right) {
  return TARGETS.every((target) => left[target] === right[target]);
}

function assertManifestEnvironment({
  manifest,
  mode,
  mainOwnershipMode,
  projectIds,
}) {
  if (
    manifest.mode !== mode ||
    JSON.stringify(manifest.mainOwnershipMode) !==
      JSON.stringify(mainOwnershipMode) ||
    TARGETS.some(
      (target) =>
        manifest.originalPriors[target].projectId !== projectIds[target],
    )
  ) {
    throw new Error(
      "Main release manifest conflicts with current ownership or projects",
    );
  }
}

export async function runMainReleaseCli({
  argv = process.argv.slice(2),
  env = process.env,
  baselineFactory = createMainReleaseBaseline,
  executionDiagnostics = null,
  terminalArtifactDiagnostics = null,
} = {}) {
  markExecutionPhase(executionDiagnostics, EXECUTION_DIAGNOSTIC_PHASES.INPUT);
  markTerminalArtifactPhase(
    terminalArtifactDiagnostics,
    TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.READ_INPUTS,
  );
  const { command, options } = parseArguments(argv);
  const identity = requireEnvironment(env);
  const runnerTemp = reviewedRunnerTemp(env.RUNNER_TEMP);

  if (command === "materialize") {
    const execution = decodeMainReleaseExecution(
      env.MAIN_RELEASE_EXECUTION,
      identity,
    );
    writePrivateJson(options.output, execution, runnerTemp);
    return execution;
  }

  if (command === "selection") {
    const execution = assertMainReleaseExecution(
      readPrivateJson(options.execution, "Main release execution", runnerTemp),
      identity,
    );
    writePrivateJson(options.output, execution.selection, runnerTemp);
    return execution.selection;
  }

  if (command === "candidate-receipts") {
    const execution = assertMainReleaseExecution(
      readPrivateJson(options.execution, "Main release execution", runnerTemp),
      identity,
    );
    const receipts = materializeCandidateReceipts({
      execution,
      encoded: Object.fromEntries(
        TARGETS.map((target) => [target, options[target]]),
      ),
      attempt: currentAttempt(env),
    });
    writePrivateJson(options.output, receipts, runnerTemp);
    return receipts;
  }

  if (
    command === "inherited-candidate-intent" ||
    command === "inherited-candidate-receipts"
  ) {
    const decision = inheritedRecoveryDecision({
      value: readPrivateJson(
        options.preplan,
        "Main inherited recovery pre-plan",
        runnerTemp,
      ),
      identity,
    });
    const attempt = currentAttempt(env);
    if (command === "inherited-candidate-intent") {
      if (!TARGETS.includes(options.target)) {
        throw new Error("Inherited main release target is unsupported");
      }
      if (!decision.rollbackAuthorization.targets.includes(options.target)) {
        throw new Error(
          `Inherited main release target ${options.target} has no moved candidate`,
        );
      }
      const intent = expectedManifestCandidateIntent({
        manifest: decision.reconciliation.manifest,
        target: options.target,
        attempt,
      });
      writePrivateJson(options.output, intent, runnerTemp);
      return intent;
    }
    const receipts = materializeInheritedCandidateReceipts({
      decision,
      encoded: Object.fromEntries(
        TARGETS.map((target) => [target, options[target]]),
      ),
      attempt,
    });
    writePrivateJson(options.output, receipts, runnerTemp);
    return receipts;
  }

  if (command === "terminal-artifacts") {
    const execution = assertMainReleaseExecution(
      readPrivateJson(
        options.execution,
        "Main terminal release execution",
        runnerTemp,
      ),
      identity,
    );
    const inputs = {
      journalHistory: readPrivateJson(
        options["journal-history"],
        "Main terminal journal history",
        runnerTemp,
        MAIN_ACTIVE_JOURNAL_HISTORY_MAX_JSON_BYTES,
      ),
      finalMappings: readPrivateJson(
        options["final-mappings"],
        "Main terminal final mappings",
        runnerTemp,
      ),
      publicSmokes: readPrivateJson(
        options["public-smokes"],
        "Main terminal public smokes",
        runnerTemp,
      ),
      stateProof: readPrivateJson(
        options["state-proof"],
        "Main terminal state proof",
        runnerTemp,
      ),
      finalCensus: readPrivateJson(
        options["final-census"],
        "Main terminal final census",
        runnerTemp,
      ),
      freshLegacyV2: readPrivateJson(
        options["legacy-v2"],
        "Main terminal fresh legacy v2 snapshot",
        runnerTemp,
      ),
      freshness: readPrivateJson(
        options.freshness,
        "Main terminal freshness proof",
        runnerTemp,
      ),
      stageResults: readPrivateJson(
        options["stage-results"],
        "Main terminal stage results",
        runnerTemp,
      ),
    };
    markTerminalArtifactPhase(
      terminalArtifactDiagnostics,
      TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.CREATE_ARTIFACTS,
    );
    const artifacts = createMainActiveTerminalArtifacts({
      execution,
      outcome: options.outcome,
      ...inputs,
      ...currentAttempt(env),
    });
    markTerminalArtifactPhase(
      terminalArtifactDiagnostics,
      TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.EVIDENCE_WRITE,
    );
    writePrivateJson(
      options["active-evidence-output"],
      artifacts.evidence,
      runnerTemp,
    );
    markTerminalArtifactPhase(
      terminalArtifactDiagnostics,
      TERMINAL_ARTIFACT_DIAGNOSTIC_PHASES.PROOFS_WRITE,
    );
    writePrivateJson(
      options["proofs-output"],
      artifacts.proofs,
      runnerTemp,
      MAIN_ACTIVE_TERMINAL_PROOFS_MAX_JSON_BYTES,
    );
    return artifacts;
  }

  if (command === "terminal-stage-results") {
    const execution = assertMainReleaseExecution(
      readPrivateJson(
        options.execution,
        "Main terminal release execution",
        runnerTemp,
      ),
      identity,
    );
    const stageResults = createMainTerminalStageResults({
      execution,
      results: {
        app: options["app-result"],
        governance: options["governance-result"],
        reserve: options["reserve-result"],
        ui: options["ui-result"],
      },
      coordinatorResult: options["coordinator-result"],
      ...currentAttempt(env),
    });
    writePrivateJson(options.output, stageResults, runnerTemp);
    return stageResults;
  }

  if (command === "forward-journal") {
    const execution = assertMainReleaseExecution(
      readPrivateJson(options.execution, "Main release execution", runnerTemp),
      identity,
    );
    const journal = createMainForwardTransactionJournal({
      releaseExecution: execution,
      currentMappings: readPrivateJson(
        options["current-mappings"],
        "Main release current mappings",
        runnerTemp,
      ),
      candidateReceipts: readPrivateJson(
        options["candidate-receipts"],
        "Main release candidate receipts",
        runnerTemp,
      ),
      ...currentAttempt(env),
    });
    writePrivateJson(options.output, journal, runnerTemp);
    writeJournalOutputs(env, journal);
    return journal;
  }

  if (command === "inherited-recovery-journal") {
    const result = createMainInheritedRecoveryJournal({
      preplan: readPrivateJson(
        options.preplan,
        "Main inherited recovery pre-plan",
        runnerTemp,
      ),
      nextDeploySha: identity.deploySha,
      nextUpstreamRunId: identity.upstreamRunId,
      legacySnapshot: readPrivateJson(
        options["legacy-snapshot"],
        "Main inherited recovery legacy snapshot",
        runnerTemp,
      ),
      currentMappings: readPrivateJson(
        options["current-mappings"],
        "Main inherited recovery current mappings",
        runnerTemp,
      ),
      candidateReceipts: readPrivateJson(
        options["candidate-receipts"],
        "Main inherited recovery candidate receipts",
        runnerTemp,
      ),
      ...currentAttempt(env),
    });
    writePrivateJson(options["journal-output"], result.journal, runnerTemp);
    writePrivateJson(options["plan-output"], result.recoveryPlan, runnerTemp);
    writeJournalOutputs(env, result.journal);
    appendGithubOutputs(env, {
      recovery_decision: result.recoveryPlan.decision,
    });
    return result;
  }

  markExecutionPhase(executionDiagnostics, EXECUTION_DIAGNOSTIC_PHASES.PREPLAN);
  const preplan = assertMainPreplanReconciliation(
    readPrivateJson(
      options.preplan,
      "Main release pre-plan decision",
      runnerTemp,
    ),
    {
      nextDeploySha: identity.deploySha,
      nextUpstreamRunId: identity.upstreamRunId,
    },
  );
  if (preplan.decision === "restore-before-planning") {
    throw new Error(
      "Inherited release recovery must finish before execution creation",
    );
  }
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.DISCOVERY,
  );
  const discovery = assertMainProviderDiscovery(
    readPrivateJson(options.discovery, "Main provider discovery", runnerTemp),
  );
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.PLANNING_SNAPSHOT,
  );
  const planningSnapshot = assertMainPlanningSnapshot(
    readPrivateJson(
      options["planning-snapshot"],
      "Main release planning snapshot",
      runnerTemp,
    ),
  );
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.PROJECT_CENSUS,
  );
  const projectIds = projectIdsFromEnvironment(env);
  if (
    !sameProjectIds(projectIds, discovery.projectIds) ||
    digest(planningSnapshot) !== discovery.planningSnapshotDigest
  ) {
    throw new Error(
      "Main release provider discovery conflicts with the supplied census",
    );
  }
  markExecutionPhase(executionDiagnostics, EXECUTION_DIAGNOSTIC_PHASES.LEGACY);
  const legacyAppV2 = exactLegacyState(
    readPrivateJson(
      options["legacy-snapshot"],
      "Main legacy v2 snapshot",
      runnerTemp,
    ),
  );
  if (
    digestMainLegacyV2Snapshot([legacyAppV2]) !== discovery.legacyAppV2Digest
  ) {
    throw new Error(
      "Main release legacy v2 state changed after provider discovery",
    );
  }
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.CANONICAL_MAPPINGS,
  );
  const currentMappings = createMainCanonicalMappings({
    planningSnapshot,
    projectIds,
    legacySnapshot: [legacyAppV2],
  }).mappings;
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.PREPLAN_RECOMPUTE,
  );
  const recomputedPreplan = decideMainPreplanReconciliation({
    nextDeploySha: identity.deploySha,
    nextUpstreamRunId: identity.upstreamRunId,
    candidateReleases: discovery.discovery.candidateReleases,
    currentMappings: Object.fromEntries(
      ["governance", "reserve", "ui", "app"].map((target) => [
        target,
        currentMappings[target],
      ]),
    ),
    rollbackOnlyTargets: discovery.discovery.rollbackOnlyTargets,
  });
  if (JSON.stringify(recomputedPreplan) !== JSON.stringify(preplan)) {
    throw new Error(
      "Main release pre-plan decision conflicts with provider discovery",
    );
  }
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.OWNERSHIP,
  );
  const mode = env.VERCEL_MAIN_MODE;
  const mainOwnershipMode = ownershipFromEnvironment(env);
  let manifest;
  if (preplan.decision === "capture-new-baseline") {
    try {
      manifest = (
        await baselineFactory({
          mode,
          mainOwnershipMode,
          deploySha: identity.deploySha,
          upstreamRunId: identity.upstreamRunId,
          projectIds,
          planningSnapshot,
          rollbackOnlyTargets: discovery.discovery.rollbackOnlyTargets,
          repoRoot: env.SOURCE_PATH,
        })
      ).manifest;
    } catch (error) {
      markExecutionPhase(executionDiagnostics, baselineFailurePhase(error));
      throw error;
    }
  } else {
    manifest = preplan.reconciliation?.manifest;
  }
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.MANIFEST_ASSERTION,
  );
  assertManifestEnvironment({
    manifest,
    mode,
    mainOwnershipMode,
    projectIds,
  });
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.SELECTION,
  );
  const selection = createMainReleaseSelection({
    providerDiscoveryDigest: digest(discovery),
    planningSnapshotDigest: discovery.planningSnapshotDigest,
    rollbackOnlyTargets: discovery.discovery.rollbackOnlyTargets,
    legacyAppV2,
    projectIds: Object.fromEntries(
      ["governance", "reserve", "ui", "app"].map((target) => [
        target,
        projectIds[target],
      ]),
    ),
    mode,
    mainOwnershipMode,
    selectedManifest: manifest,
  });
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.EXECUTION_ASSEMBLY,
  );
  const execution = createMainReleaseExecution({
    decision: preplan.decision,
    reason: preplan.reason,
    manifest,
    upstream: currentUpstream(env),
    legacyAppV2,
    selection,
  });
  const canonical = assertMainReleaseExecution(execution, identity);
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.PRIVATE_OUTPUT,
  );
  writePrivateJson(options.output, canonical, runnerTemp);
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.EXECUTION_ENCODE,
  );
  const encodedExecution = encodeMainReleaseExecution(canonical, identity);
  markExecutionPhase(
    executionDiagnostics,
    EXECUTION_DIAGNOSTIC_PHASES.GITHUB_OUTPUT,
  );
  appendGithubOutputs(env, {
    execution: encodedExecution,
    decision: canonical.decision,
    release_id: canonical.manifest.releaseId,
    targets: JSON.stringify(canonical.projection.stagedTargets),
    active_targets: JSON.stringify(canonical.projection.activeTargets),
    shadow_targets: JSON.stringify(canonical.projection.shadowTargets),
    has_active_targets: String(canonical.projection.activeTargets.length > 0),
    no_target: String(canonical.projection.noTarget),
  });
  return canonical;
}

export function renderMainReleaseCliFailure() {
  return "Vercel main release command failed\n";
}

export function renderMainReleaseExecutionCliFailure(phase) {
  const code = MAIN_RELEASE_EXECUTION_DIAGNOSTIC_CODES[phase];
  if (code === undefined) {
    throw new Error("Main release execution diagnostic phase is unsupported");
  }
  return `Vercel main release execution failed phase=${phase} code=${code}\n`;
}

export function renderMainReleaseTerminalArtifactCliFailure(phase) {
  const code = MAIN_RELEASE_TERMINAL_ARTIFACT_DIAGNOSTIC_CODES[phase];
  if (code === undefined) {
    throw new Error(
      "Main release terminal artifact diagnostic phase is unsupported",
    );
  }
  return `Vercel main release terminal artifacts failed phase=${phase} code=${code}\n`;
}

export async function runMainReleaseCliEntrypoint({
  argv = process.argv.slice(2),
  env = process.env,
  writeStderr = (line) => process.stderr.write(line),
  run = runMainReleaseCli,
} = {}) {
  const diagnostics =
    argv[0] === "execution" ? createExecutionDiagnostics() : null;
  const terminalArtifactDiagnostics =
    argv[0] === "terminal-artifacts"
      ? createTerminalArtifactDiagnostics()
      : null;
  try {
    await run({
      argv,
      env,
      executionDiagnostics: diagnostics,
      terminalArtifactDiagnostics,
    });
    return 0;
  } catch {
    writeStderr(
      diagnostics === null
        ? terminalArtifactDiagnostics === null
          ? renderMainReleaseCliFailure()
          : renderMainReleaseTerminalArtifactCliFailure(
              terminalArtifactDiagnostics.current(),
            )
        : renderMainReleaseExecutionCliFailure(diagnostics.current()),
    );
    return 1;
  }
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  process.exitCode = await runMainReleaseCliEntrypoint();
}
