import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";
import {
  assertMainCandidateReceipt,
  createMainCandidateIntent,
} from "./vercel-main-candidate.mjs";
import { assertMainReleaseExecution } from "./vercel-main-release-execution.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainPreplanReconciliation,
} from "./vercel-main-release-reconciliation.mjs";
import { MAIN_CANONICAL_MAPPINGS_SCHEMA } from "./vercel-main-provider-cli.mjs";
import {
  MAIN_TRANSACTION_REPOSITORY,
  createMainTransactionId,
  createPreparedMainTransactionJournal,
  planInheritedMainTransactionRecovery,
} from "./vercel-main-transaction.mjs";

const APP_FIRST_TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const MAPPING_TARGETS = Object.freeze([...MAIN_RELEASE_ACTIVATION_ORDER]);
const PROTECTED_TARGETS = Object.freeze([...APP_FIRST_TARGETS]);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, keys, label) {
  if (
    !isPlainObject(value) ||
    JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) {
    throw new Error(`${label} contains forbidden or missing fields`);
  }
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function canonicalIdentity({ deploySha, runId, runAttempt }) {
  return {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: requireString(
      deploySha,
      "Main journal bridge deploy SHA",
      SHA_PATTERN,
    ),
    runId: requireString(
      String(runId),
      "Main journal bridge run ID",
      POSITIVE_ID_PATTERN,
    ),
    runAttempt: requireString(
      String(runAttempt),
      "Main journal bridge run attempt",
      POSITIVE_ID_PATTERN,
    ),
  };
}

function canonicalMappings({ value, manifest }) {
  assertExactKeys(
    value,
    ["schema", "mappings"],
    "Main journal canonical mappings",
  );
  if (value.schema !== MAIN_CANONICAL_MAPPINGS_SCHEMA) {
    throw new Error("Main journal canonical mappings schema is unsupported");
  }
  assertExactKeys(
    value.mappings,
    MAPPING_TARGETS,
    "Main journal mapping targets",
  );
  const result = {};
  for (const target of MAPPING_TARGETS) {
    const aliases = manifest.originalPriors[target].aliases;
    const mappings = value.mappings[target];
    if (!Array.isArray(mappings) || mappings.length !== aliases.length) {
      throw new Error(`Main journal ${target} mappings are incomplete`);
    }
    result[target] = mappings.map((mapping, index) => {
      assertExactKeys(
        mapping,
        ["alias", "deploymentId", "deploymentUrl"],
        `Main journal ${target} mapping`,
      );
      const canonical = {
        alias: canonicalizeHostname(mapping.alias),
        deploymentId: requireString(
          mapping.deploymentId,
          `Main journal ${target} deployment ID`,
          DEPLOYMENT_ID_PATTERN,
        ),
        deploymentUrl: canonicalizeDeploymentUrl(mapping.deploymentUrl),
      };
      if (canonical.alias !== aliases[index]) {
        throw new Error(`Main journal ${target} aliases are not canonical`);
      }
      return canonical;
    });
  }
  return result;
}

function priorState(manifest) {
  return Object.fromEntries(
    PROTECTED_TARGETS.map((target) => {
      const value = manifest.originalPriors[target];
      return [
        target,
        {
          deploymentId: value.deploymentId,
          deploymentUrl: value.deploymentUrl,
          aliases: [...value.aliases],
        },
      ];
    }),
  );
}

function expectedIntent({ manifest, target, identity }) {
  return createMainCandidateIntent({
    target,
    deploySha: manifest.deploySha,
    upstreamRunId: manifest.upstreamRunId,
    originRunId: identity.runId,
    originAttempt: identity.runAttempt,
    originTransactionId: createMainTransactionId(identity),
    projectId: manifest.originalPriors[target].projectId,
    projectName: manifest.originalPriors[target].projectName,
    releaseManifest: manifest,
  });
}

function candidateRecordFromReceipt({
  rawReceipt,
  manifest,
  target,
  identity,
  aliases,
}) {
  const intent = expectedIntent({ manifest, target, identity });
  const receipt = assertMainCandidateReceipt(rawReceipt, intent);
  if (JSON.stringify(receipt.intent) !== JSON.stringify(intent)) {
    throw new Error(
      `Main journal ${target} receipt is not from the current attempt`,
    );
  }
  return {
    deploymentId: receipt.candidate.deploymentId,
    deploymentUrl: receipt.candidate.deploymentUrl,
    aliases: [...aliases],
    discovery: {
      releaseId: receipt.intent.releaseId,
      candidateId: receipt.intent.candidateId,
      projectId: receipt.candidate.projectId,
      projectName: receipt.candidate.projectName,
      deploySha: receipt.intent.deploySha,
      target,
      customEnvironmentSlug: receipt.intent.environment.customEnvironmentSlug,
      immutableSmoke: receipt.immutableSmoke,
      metrics: receipt.metrics,
    },
  };
}

function pendingAppRecord({ manifest, identity, aliases }) {
  const intent = expectedIntent({ manifest, target: "app", identity });
  return {
    deploymentId: null,
    deploymentUrl: null,
    aliases: [...aliases],
    discovery: {
      releaseId: intent.releaseId,
      candidateId: intent.candidateId,
      projectId: intent.projectId,
      projectName: intent.projectName,
      deploySha: intent.deploySha,
      target: "app",
      customEnvironmentSlug: intent.environment.customEnvironmentSlug,
      immutableSmoke: null,
      metrics: {
        buildDurationMs: null,
        deploymentDurationMs: null,
        cacheHit: null,
      },
    },
  };
}

function candidateState({ manifest, identity, candidateReceipts, pendingApp }) {
  assertExactKeys(
    candidateReceipts,
    APP_FIRST_TARGETS,
    "Main journal candidate receipts",
  );
  return Object.fromEntries(
    APP_FIRST_TARGETS.map((target) => {
      const selected = manifest.activeTargets.includes(target);
      const rawReceipt = candidateReceipts[target];
      if (!selected) {
        if (rawReceipt !== null) {
          throw new Error(
            `Main journal receipt exists for unselected ${target}`,
          );
        }
        return [target, null];
      }
      if (rawReceipt === null) {
        if (target === "app" && pendingApp) {
          return [
            target,
            pendingAppRecord({
              manifest,
              identity,
              aliases: manifest.originalPriors.app.aliases,
            }),
          ];
        }
        return [target, null];
      }
      return [
        target,
        candidateRecordFromReceipt({
          rawReceipt,
          manifest,
          target,
          identity,
          aliases: manifest.originalPriors[target].aliases,
        }),
      ];
    }),
  );
}

function createJournal({
  manifest,
  currentMappings,
  candidateReceipts,
  identity,
  pendingApp,
  allowTerminalAppRecoveryResidual = false,
}) {
  const mappings = canonicalMappings({ value: currentMappings, manifest });
  return createPreparedMainTransactionJournal({
    ...identity,
    mode: manifest.mode,
    release: manifest,
    prior: priorState(manifest),
    // The transaction schema has a distinct canonical order for its mutable
    // protected surfaces. Provider mappings are ordered for release evidence;
    // never let that evidence order leak into the current-attempt journal.
    startMappings: Object.fromEntries(
      PROTECTED_TARGETS.map((target) => [target, mappings[target]]),
    ),
    candidates: candidateState({
      manifest,
      identity,
      candidateReceipts,
      pendingApp,
    }),
    allowTerminalAppRecoveryResidual,
  });
}

export function createMainForwardTransactionJournal({
  releaseExecution,
  currentMappings,
  candidateReceipts,
  runId,
  runAttempt,
}) {
  const execution = assertMainReleaseExecution(releaseExecution);
  const identity = canonicalIdentity({
    deploySha: execution.manifest.deploySha,
    runId,
    runAttempt,
  });
  return createJournal({
    manifest: execution.manifest,
    currentMappings,
    candidateReceipts,
    identity,
    pendingApp: true,
  });
}

export function createMainInheritedRecoveryJournal({
  preplan,
  nextDeploySha,
  nextUpstreamRunId,
  currentMappings,
  candidateReceipts,
  runId,
  runAttempt,
}) {
  const decision = assertMainPreplanReconciliation(preplan, {
    nextDeploySha,
    nextUpstreamRunId,
  });
  if (decision.decision !== "restore-before-planning") {
    throw new Error(
      "Main inherited recovery journal requires restore decision",
    );
  }
  const manifest = decision.reconciliation.manifest;
  const identity = canonicalIdentity({
    deploySha: manifest.deploySha,
    runId,
    runAttempt,
  });
  const journal = createJournal({
    manifest,
    currentMappings,
    candidateReceipts,
    identity,
    pendingApp: false,
    allowTerminalAppRecoveryResidual: true,
  });
  const recoveryPlan = planInheritedMainTransactionRecovery({
    journal,
    reason: "main-stale-before-forward",
  });
  if (
    recoveryPlan.decision !== "restore-inherited" ||
    JSON.stringify(recoveryPlan.rollbackAuthority) !==
      JSON.stringify({
        targets: decision.rollbackAuthorization.targets,
        aliases: decision.rollbackAuthorization.aliases,
      })
  ) {
    throw new Error(
      "Fresh inherited recovery journal conflicts with rollback authority",
    );
  }
  return { journal, recoveryPlan };
}
