import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  linkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  MAIN_ACTIVE_EVENT_SCHEMA,
  MAIN_ACTIVE_RECOVERY_EVENT_SCHEMA,
  censusFreshMainActiveRelease,
  createCurrentMainActiveRecoveryJournal,
  decideMainActiveAppRecoverySafety,
  planFreshInheritedMainActiveRecovery,
  executeMainActiveCommand,
  loadMainActiveJournalHistory,
  reduceMainActiveRecoveryTransition,
  reduceMainActiveTransition,
  reconcileFreshMainActiveRelease,
} from "./vercel-main-active-controller.mjs";
import {
  ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
  createActiveDeploymentStateProof,
} from "./vercel-deployment-state.mjs";
import {
  MAIN_TRANSACTION_REPOSITORY,
  createPreparedMainTransactionJournal,
  mainTransactionJournalArtifactName,
  planMainTransactionRecovery,
  recordMainTransactionCommandReturned,
  recordMainTransactionVerified,
  startMainTransactionOperation,
} from "./vercel-main-transaction.mjs";
import { MAIN_TARGET_CONTRACTS } from "./vercel-main-plan.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  createMainReleaseManifest,
  decideMainPreplanReconciliation,
} from "./vercel-main-release-reconciliation.mjs";
import {
  canonicalizeMainCandidateVercelMetadata,
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = "123456789";
const RUN_ATTEMPT = "2";
const TARGETS = ["app", "governance", "reserve", "ui"];
const PROJECT_IDS = {
  app: "prj_app123",
  governance: "prj_governance123",
  reserve: "prj_reserve123",
  ui: "prj_ui123",
};

function record(name, aliases) {
  return {
    deploymentId: `dpl_${name}Prior123`,
    deploymentUrl: `https://${name}-prior.vercel.app`,
    aliases: [...aliases].sort(),
  };
}

function candidate(name, aliases, release) {
  if (release === undefined) {
    return {
      deploymentId: `dpl_${name}Candidate123`,
      deploymentUrl: `https://${name}-candidate.vercel.app`,
      aliases: [...aliases].sort(),
      discovery: null,
    };
  }
  const prior = release.originalPriors[name];
  return {
    deploymentId: `dpl_${name}Candidate123`,
    deploymentUrl: `https://${name}-candidate.vercel.app`,
    aliases: [...aliases].sort(),
    discovery: {
      releaseId: release.releaseId,
      candidateId: `candidate-${name}-${release.upstreamRunId}`,
      projectId: prior.projectId,
      projectName: prior.projectName,
      deploySha: SHA,
      target: name,
      customEnvironmentSlug: name === "app" ? "v3" : null,
      immutableSmoke: {
        immutableUrl: `https://${name}-candidate.vercel.app`,
        servedSha: SHA,
        status: "passed",
      },
      metrics: {
        buildDurationMs: null,
        deploymentDurationMs: null,
        cacheHit: null,
      },
    },
  };
}

function prior() {
  return {
    app: record("app", [
      "app.mento.org",
      "appmentoorg-env-v3-mentolabs.vercel.app",
    ]),
    governance: record("governance", ["governance.mento.org"]),
    reserve: record("reserve", ["reserve.mento.org"]),
    ui: record("ui", ["ui.mento.org"]),
    "legacy-app": record("legacy", [
      "appmentoorg-git-v2-mentolabs.vercel.app",
      "appmentoorg-mentolabs.vercel.app",
      "appmentoorg.vercel.app",
      "v2-app.mento.org",
    ]),
  };
}

function release(
  activeTargets,
  {
    shadowTargets = [],
    mainOwnershipMode = Object.fromEntries(
      TARGETS.map((target) => [target, "github"]),
    ),
  } = {},
) {
  const captured = prior();
  const stagedTargets = TARGETS.filter(
    (target) =>
      activeTargets.includes(target) || shadowTargets.includes(target),
  );
  const releasePlan = {
    schema: "vercel-main-plan:v2",
    mode: "active",
    mainOwnershipMode,
    deploySha: SHA,
    stagedTargets,
    activeTargets: [...activeTargets],
    shadowTargets: [...shadowTargets],
    plan: stagedTargets,
    priors: TARGETS.map((target) => ({
      target,
      deploymentId: captured[target].deploymentId,
      deploymentUrl: captured[target].deploymentUrl,
      aliases: captured[target].aliases,
      servedSha: "1111111111111111111111111111111111111111",
    })),
    ranges: [
      {
        base: "1111111111111111111111111111111111111111",
        head: SHA,
        kind: "served",
        reason: "global-build-input",
        targets: [...TARGETS],
        deployments: stagedTargets,
      },
    ],
    reasons: stagedTargets.map((target) => ({
      target,
      base: "1111111111111111111111111111111111111111",
      reason: "global-build-input",
    })),
  };
  const originalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      const contract = MAIN_TARGET_CONTRACTS[target];
      const value = captured[target];
      const shared = {
        ...value,
        projectId: PROJECT_IDS[target],
        projectName: contract.projectName,
        readyState: "READY",
        target: contract.target,
        customEnvironmentSlug: contract.customEnvironmentSlug,
      };
      return [
        target,
        {
          ...shared,
          planningLeaves: shared.aliases.map((alias) => ({
            alias,
            ...shared,
            git: {
              status: "complete",
              org: "mento-protocol",
              repo: "frontend-monorepo",
              ref: "main",
              sha: "1111111111111111111111111111111111111111",
            },
          })),
          servedSha: "1111111111111111111111111111111111111111",
        },
      ];
    }),
  );
  return createMainReleaseManifest({
    upstreamRunId: "123456",
    plan: releasePlan,
    originalPriors,
  });
}

function prepared(
  activeTargets,
  { appKnown = false, startCandidateTargets = [] } = {},
) {
  const captured = prior();
  const manifest = release(activeTargets);
  const transactionIdentity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: SHA,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
  };
  const candidates = {
    app: activeTargets.includes("app")
      ? {
          deploymentId: appKnown ? "dpl_appCandidate123" : null,
          deploymentUrl: appKnown ? "https://app-candidate.vercel.app" : null,
          aliases: [...captured.app.aliases],
          discovery: candidate("app", captured.app.aliases, manifest).discovery,
        }
      : null,
    governance: activeTargets.includes("governance")
      ? candidate("governance", captured.governance.aliases, manifest)
      : null,
    reserve: activeTargets.includes("reserve")
      ? candidate("reserve", captured.reserve.aliases, manifest)
      : null,
    ui: activeTargets.includes("ui")
      ? candidate("ui", captured.ui.aliases, manifest)
      : null,
  };
  return createPreparedMainTransactionJournal({
    ...transactionIdentity,
    mode: "active",
    release: manifest,
    prior: captured,
    startMappings: Object.fromEntries(
      Object.entries(captured).map(([target, value]) => {
        const selected = startCandidateTargets.includes(target)
          ? candidates[target]
          : value;
        return [
          target,
          value.aliases.map((alias) => ({
            alias,
            deploymentId: selected.deploymentId,
            deploymentUrl: selected.deploymentUrl,
          })),
        ];
      }),
    ),
    candidates,
  });
}

function preparedPendingApp() {
  const initial = prepared(["app"]);
  const intent = createMainCandidateIntent({
    target: "app",
    deploySha: initial.deploySha,
    upstreamRunId: initial.release.upstreamRunId,
    originRunId: initial.runId,
    originAttempt: initial.runAttempt,
    originTransactionId: initial.transactionId,
    projectId: initial.release.originalPriors.app.projectId,
    projectName: initial.release.originalPriors.app.projectName,
    releaseManifest: initial.release,
  });
  return {
    ...initial,
    candidates: {
      ...initial.candidates,
      app: {
        ...initial.candidates.app,
        deploymentId: null,
        deploymentUrl: null,
        discovery: {
          ...initial.candidates.app.discovery,
          candidateId: intent.candidateId,
          immutableSmoke: null,
        },
      },
    },
  };
}

function appCandidateReceipt(journal) {
  const intent = createMainCandidateIntent({
    target: "app",
    deploySha: journal.deploySha,
    upstreamRunId: journal.release.upstreamRunId,
    originRunId: journal.runId,
    originAttempt: journal.runAttempt,
    originTransactionId: journal.transactionId,
    projectId: journal.release.originalPriors.app.projectId,
    projectName: journal.release.originalPriors.app.projectName,
    releaseManifest: journal.release,
  });
  const metadata = canonicalizeMainCandidateVercelMetadata(
    createMainCandidateVercelMetadata({ intent }),
    {
      target: "app",
      deploySha: intent.deploySha,
      projectId: intent.projectId,
      projectName: intent.projectName,
    },
  );
  return createMainCandidateReceipt({
    intent,
    candidate: {
      deploymentId: "dpl_appCandidate123",
      deploymentUrl: "https://app-candidate.vercel.app",
      projectId: intent.projectId,
      projectName: intent.projectName,
      readyState: "READY",
      target: null,
      customEnvironmentSlug: "v3",
      source: "cli",
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: intent.deploySha,
      },
      metadata,
    },
    immutableSmoke: {
      immutableUrl: "https://app-candidate.vercel.app",
      servedSha: intent.deploySha,
      status: "passed",
    },
  });
}

function receipt(journal, artifactId = "9001") {
  return {
    acknowledged: true,
    artifactName: mainTransactionJournalArtifactName(journal),
    artifactId,
    transactionId: journal.transactionId,
    sequence: journal.sequence,
  };
}

function currentMappings(journal, states = {}) {
  return Object.entries(journal.prior)
    .flatMap(([target, captured]) => {
      const selected =
        states[target] === "candidate"
          ? target === "legacy-app"
            ? journal.candidates.app
            : journal.candidates[target]
          : captured;
      return captured.aliases.map((alias) => ({
        alias,
        deploymentId: selected.deploymentId,
        deploymentUrl: selected.deploymentUrl,
      }));
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

function recoveryCurrentMappings(journal, states = {}) {
  const legacyAliases = new Set(journal.prior["legacy-app"].aliases);
  const legacyProjectId = journal.release.originalPriors.app.projectId;
  return currentMappings(journal, states).map((mapping) =>
    legacyAliases.has(mapping.alias)
      ? { ...mapping, projectId: legacyProjectId }
      : mapping,
  );
}

function groupedCurrentMappings(journal, states = {}) {
  return Object.fromEntries(
    Object.entries(journal.prior).map(([target, captured]) => {
      const selected =
        states[target] === "candidate"
          ? target === "legacy-app"
            ? journal.candidates.app
            : journal.candidates[target]
          : captured;
      return [
        target,
        captured.aliases.map((alias) => ({
          alias,
          deploymentId: selected.deploymentId,
          deploymentUrl: selected.deploymentUrl,
        })),
      ];
    }),
  );
}

function event(kind, additional = {}) {
  return { schema: MAIN_ACTIVE_EVENT_SCHEMA, kind, ...additional };
}

function recoveryEvent(kind, additional = {}) {
  return {
    schema: MAIN_ACTIVE_RECOVERY_EVENT_SCHEMA,
    kind,
    ...additional,
  };
}

function reduceForward(
  journal,
  history,
  input,
  activeTargets,
  {
    shadowTargets = [],
    stagedCandidates = Object.fromEntries(
      TARGETS.map((target) => [target, journal.candidates[target]]),
    ),
    mainOwnershipMode = Object.fromEntries(
      TARGETS.map((target) => [target, "github"]),
    ),
  } = {},
) {
  return reduceMainActiveTransition({
    preparedJournal: journal,
    activeTargets,
    shadowTargets,
    stagedCandidates,
    mainOwnershipMode,
    projectIds: PROJECT_IDS,
    history,
    event: input,
  });
}

function activeStateResponse(
  spec,
  target,
  { deploymentId, deploymentUrl, source = "cli" },
) {
  const project = spec.projects[target];
  return {
    deploymentId,
    response: {
      id: deploymentId,
      url: deploymentUrl,
      projectId: project.projectId,
      name: project.projectName,
      readyState: "READY",
      target: project.target,
      customEnvironment:
        project.customEnvironmentSlug === null
          ? null
          : { slug: project.customEnvironmentSlug },
      source,
      meta: {
        githubCommitOrg: "mento-protocol",
        githubCommitRepo: "frontend-monorepo",
        githubCommitRef: "main",
        githubCommitSha: spec.deploySha,
        ...(source === "cli"
          ? createMainCandidateVercelMetadata({
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
            })
          : {}),
      },
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: spec.deploySha,
      },
    },
  };
}

function activeStateProof(
  journal,
  {
    activeTargets,
    shadowTargets = [],
    stagedCandidates = Object.fromEntries(
      TARGETS.map((target) => [target, journal.candidates[target]]),
    ),
    mainOwnershipMode = Object.fromEntries(
      TARGETS.map((target) => [target, "github"]),
    ),
    nativeOwners = {},
  },
) {
  const stagedTargets = TARGETS.filter(
    (target) =>
      activeTargets.includes(target) || shadowTargets.includes(target),
  );
  const projects = Object.fromEntries(
    TARGETS.map((target) => {
      const active = activeTargets.includes(target);
      const shadowStage = target !== "app" && shadowTargets.includes(target);
      const expected = active
        ? journal.candidates[target]
        : shadowStage
          ? stagedCandidates[target]
          : null;
      return [
        target,
        {
          projectId: PROJECT_IDS[target],
          projectName: `${target}.mento.org`,
          expectedDisposition: active
            ? "githubPrebuilt"
            : shadowStage
              ? "githubShadowStage"
              : null,
          deploymentId: expected?.deploymentId ?? null,
          deploymentUrl: expected?.deploymentUrl ?? null,
          target: target === "app" ? null : "production",
          customEnvironmentSlug: target === "app" ? "v3" : null,
        },
      ];
    }),
  );
  const legacy = journal.prior["legacy-app"];
  const releaseManifest = release(activeTargets, {
    shadowTargets,
    mainOwnershipMode,
  });
  const spec = {
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha: journal.deploySha,
    runId: journal.runId,
    runAttempt: journal.runAttempt,
    transactionId: journal.transactionId,
    releaseManifest,
    mainOwnershipMode,
    stagedTargets,
    activeTargets,
    shadowTargets,
    projects,
    legacyAppV2: {
      alias: "v2-app.mento.org",
      deployment: legacy.deploymentId,
      deploymentUrl: legacy.deploymentUrl,
      projectId: PROJECT_IDS.app,
      projectName: "app.mento.org",
      readyState: "READY",
      target: "production",
      customEnvironmentSlug: null,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "v2",
        sha: "1111111111111111111111111111111111111111",
      },
    },
  };
  const deployments = Object.fromEntries(
    TARGETS.map((target) => {
      const entries = [];
      if (projects[target].deploymentId !== null) {
        entries.push(
          activeStateResponse(spec, target, {
            deploymentId: projects[target].deploymentId,
            deploymentUrl: projects[target].deploymentUrl,
          }),
        );
      }
      if (nativeOwners[target]) {
        entries.push(
          activeStateResponse(spec, target, {
            ...nativeOwners[target],
            source: "git",
          }),
        );
      }
      return [target, entries];
    }),
  );
  return createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: {
      ownership: "native-vercel-git",
      state: {
        alias: "v2-app.mento.org",
        deploymentId: legacy.deploymentId,
        deploymentUrl: legacy.deploymentUrl,
        creatorUsername: null,
        projectId: PROJECT_IDS.app,
        projectName: "app.mento.org",
        readyState: "READY",
        target: "production",
        customEnvironmentSlug: null,
        git: { ...spec.legacyAppV2.git },
        aliases: [...legacy.aliases],
      },
    },
  });
}

function runtimeSmoke(target, deploySha = SHA) {
  const finalUrls = {
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
    final_url: finalUrls[target],
    interaction: interactions[target],
    logical_target: target,
    public_url: `https://${target}.mento.org/`,
    successful_documents: 1,
    successful_fonts: 1,
    successful_scripts: 1,
    successful_stylesheets: 1,
  };
}

function publicSmokes(activeTargets) {
  return Object.fromEntries(
    TARGETS.map((target) => [
      target,
      activeTargets.includes(target)
        ? {
            runtime: runtimeSmoke(target),
            status: "passed",
            publicUrl: `https://${target}.mento.org/`,
            servedSha: SHA,
          }
        : {
            runtime: null,
            status: "not-required",
            publicUrl: `https://${target}.mento.org/`,
            servedSha: null,
          },
    ]),
  );
}

function runOrdinaryForward() {
  const initial = prepared(["governance"]);
  const history = [];
  const initialized = reduceForward(initial, history, event("initialize"), [
    "governance",
  ]);
  history.push(initialized.journal);
  const dispatched = reduceForward(
    initial,
    history,
    event("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["governance"],
  );
  history.push(dispatched.journal);
  const authorized = reduceForward(
    initial,
    history,
    event("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["governance"],
  );
  const returned = reduceForward(
    initial,
    history,
    event("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: { outcome: "success", reason: null, candidate: null },
    }),
    ["governance"],
  );
  history.push(returned.journal);
  const verified = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        governance: "candidate",
      }),
      appCandidateReceipt: null,
      appDeployment: null,
    }),
    ["governance"],
  );
  history.push(verified.journal);
  return { initial, history, authorized };
}

test("initialize emits only prepared sequence zero for active targets", () => {
  const initial = prepared(["governance"]);
  const result = reduceForward(initial, [], event("initialize"), [
    "governance",
  ]);
  assert.equal(result.transitionKind, "journal");
  assert.equal(result.nextAction, "upload-journal");
  assert.equal(result.afterUploadAction, "dispatch");
  assert.equal(result.journal.sequence, 0);
  assert.equal(result.possibleMutationCommands, 0);
  assert.equal(result.confirmedMutationCommands, 0);
});

test("initialize with no active targets performs no transaction mutation", () => {
  const initial = prepared([]);
  const result = reduceForward(initial, [], event("initialize"), []);
  assert.equal(result.transitionKind, "no-active-target");
  assert.equal(result.nextAction, "complete");
  assert.equal(result.journal, null);
});

test("dispatch skips an already-candidate ordinary release without a promote", () => {
  const initial = prepared(["governance"], {
    startCandidateTargets: ["governance"],
  });
  const initialized = reduceForward(initial, [], event("initialize"), [
    "governance",
  ]);
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal, {
        governance: "candidate",
      }),
    }),
    ["governance"],
  );
  assert.equal(dispatched.transitionKind, "await-final-proof");
  assert.equal(dispatched.nextAction, "collect-final-proof");
  assert.equal(dispatched.journal, null);
  assert.equal(dispatched.possibleMutationCommands, 0);
});

test("dispatch resumes a candidate prefix by promoting only the prior suffix", () => {
  const initial = prepared(["governance", "reserve"], {
    startCandidateTargets: ["governance"],
  });
  const initialized = reduceForward(initial, [], event("initialize"), [
    "governance",
    "reserve",
  ]);
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal, {
        governance: "candidate",
      }),
    }),
    ["governance", "reserve"],
  );
  assert.equal(dispatched.journal.operations.at(-1).type, "promote");
  assert.equal(dispatched.journal.operations.at(-1).target, "reserve");
  assert.equal(dispatched.afterUploadAction, "authorize");
});

test("dispatch routes an unexpected ordinary mapping to recovery", () => {
  const initial = prepared(["governance"]);
  const initialized = reduceForward(initial, [], event("initialize"), [
    "governance",
  ]);
  const partial = currentMappings(initialized.journal).map((entry) =>
    entry.alias === "governance.mento.org"
      ? {
          ...entry,
          deploymentId: "dpl_unexpected123",
          deploymentUrl: "https://unexpected.vercel.app",
        }
      : entry,
  );
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: partial,
    }),
    ["governance"],
  );
  assert.equal(dispatched.transitionKind, "recovery-required");
  assert.equal(dispatched.nextAction, "recover");
  assert.equal(dispatched.journal, null);
});

test("authorize requires an exact positive receipt for the started snapshot", () => {
  const initial = prepared(["governance"]);
  const initialized = reduceForward(initial, [], event("initialize"), [
    "governance",
  ]);
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal),
    }),
    ["governance"],
  );
  assert.throws(
    () =>
      reduceForward(
        initial,
        [initialized.journal, dispatched.journal],
        event("authorize", {
          uploadReceipt: {
            ...receipt(dispatched.journal),
            sequence: initialized.journal.sequence,
          },
          freshSha: SHA,
          currentMappings: currentMappings(dispatched.journal),
        }),
        ["governance"],
      ),
    /does not acknowledge/,
  );
});

test("one forward invocation emits at most one snapshot or one safe command", () => {
  const { history, authorized } = runOrdinaryForward();
  assert.equal(authorized.transitionKind, "command");
  assert.equal(authorized.journal, null);
  assert.deepEqual(Object.keys(authorized.command).sort(), [
    "arguments",
    "deploymentId",
    "deploymentUrl",
    "kind",
    "target",
  ]);
  assert.equal(history.at(-1).status, "verified");
  assert.equal(history.at(-1).sequence, 3);
  assert.equal(
    history.at(-1).operations.filter((entry) => entry.state === "started")
      .length,
    1,
  );
});

test("finalize commits only after exact mappings, smokes, census, and v2 proof", () => {
  const { initial, history } = runOrdinaryForward();
  const ready = reduceForward(
    initial,
    history,
    event("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        governance: "candidate",
      }),
    }),
    ["governance"],
  );
  assert.equal(ready.transitionKind, "await-final-proof");
  const committed = reduceForward(
    initial,
    history,
    event("finalize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        governance: "candidate",
      }),
      publicSmokes: publicSmokes(["governance"]),
      stateProof: activeStateProof(history.at(-1), {
        activeTargets: ["governance"],
      }),
    }),
    ["governance"],
  );
  assert.equal(committed.journal.status, "committed");
  assert.equal(committed.afterUploadAction, "complete");
  assert.equal(committed.possibleMutationCommands, 1);
  assert.equal(committed.confirmedMutationCommands, 1);

  const tamperedPriorProof = activeStateProof(history.at(-1), {
    activeTargets: ["governance"],
  });
  tamperedPriorProof.projects.governance.priorDeploymentId =
    "dpl_otherGovernancePrior123";
  assert.throws(
    () =>
      reduceForward(
        initial,
        history,
        event("finalize", {
          uploadReceipt: receipt(history.at(-1)),
          freshSha: SHA,
          currentMappings: currentMappings(history.at(-1), {
            governance: "candidate",
          }),
          publicSmokes: publicSmokes(["governance"]),
          stateProof: tamperedPriorProof,
        }),
        ["governance"],
      ),
    /governance expectation is inconsistent/,
  );

  for (const [name, mutate, pattern] of [
    [
      "wrong final URL",
      (smokes) => {
        smokes.governance.runtime.final_url = "https://governance.mento.org/";
      },
      /runtime is unproven/,
    ],
    [
      "missing inactive null runtime",
      (smokes) => {
        smokes.app.runtime = runtimeSmoke("app");
      },
      /Unselected public smoke app is malformed/,
    ],
  ]) {
    const smokes = publicSmokes(["governance"]);
    mutate(smokes);
    assert.throws(
      () =>
        reduceForward(
          initial,
          history,
          event("finalize", {
            uploadReceipt: receipt(history.at(-1)),
            freshSha: SHA,
            currentMappings: currentMappings(history.at(-1), {
              governance: "candidate",
            }),
            publicSmokes: smokes,
            stateProof: activeStateProof(history.at(-1), {
              activeTargets: ["governance"],
            }),
          }),
          ["governance"],
        ),
      pattern,
      name,
    );
  }
});

test("mixed active and shadow planning validates shadow stages without journaling them", () => {
  const { initial, history } = runOrdinaryForward();
  const stagedCandidates = {
    app: null,
    governance: initial.candidates.governance,
    reserve: candidate("reserve", initial.prior.reserve.aliases),
    ui: null,
  };
  const mainOwnershipMode = {
    app: "github",
    governance: "github",
    reserve: "shadow",
    ui: "github",
  };
  const committed = reduceMainActiveTransition({
    preparedJournal: initial,
    activeTargets: ["governance"],
    shadowTargets: ["reserve"],
    stagedCandidates,
    mainOwnershipMode,
    projectIds: PROJECT_IDS,
    history,
    event: event("finalize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        governance: "candidate",
      }),
      publicSmokes: publicSmokes(["governance"]),
      stateProof: activeStateProof(history.at(-1), {
        activeTargets: ["governance"],
        shadowTargets: ["reserve"],
        stagedCandidates,
        mainOwnershipMode,
      }),
    }),
  });
  assert.equal(committed.journal.status, "committed");
  assert.equal(
    committed.journal.operations.some(
      (operation) => operation.target === "reserve",
    ),
    false,
  );
});

test("shadow final mapping accepts the bound prior and rejects unbound same-SHA identities", () => {
  const { initial, history } = runOrdinaryForward();
  const stagedCandidates = {
    app: null,
    governance: initial.candidates.governance,
    reserve: candidate("reserve", initial.prior.reserve.aliases),
    ui: null,
  };
  const mainOwnershipMode = {
    app: "github",
    governance: "github",
    reserve: "shadow",
    ui: "github",
  };
  const nativeReserve = {
    deploymentId: "dpl_reserveNative123",
    deploymentUrl: "https://reserve-native.vercel.app",
  };
  const proof = activeStateProof(history.at(-1), {
    activeTargets: ["governance"],
    shadowTargets: ["reserve"],
    stagedCandidates,
    mainOwnershipMode,
  });
  const finalize = (reserveDeployment) => {
    const mappings = currentMappings(history.at(-1), {
      governance: "candidate",
    }).map((entry) =>
      entry.alias === "reserve.mento.org"
        ? {
            alias: entry.alias,
            deploymentId: reserveDeployment.deploymentId,
            deploymentUrl: reserveDeployment.deploymentUrl,
          }
        : entry,
    );
    return reduceMainActiveTransition({
      preparedJournal: initial,
      activeTargets: ["governance"],
      shadowTargets: ["reserve"],
      stagedCandidates,
      mainOwnershipMode,
      projectIds: PROJECT_IDS,
      history,
      event: event("finalize", {
        uploadReceipt: receipt(history.at(-1)),
        freshSha: SHA,
        currentMappings: mappings,
        publicSmokes: publicSmokes(["governance"]),
        stateProof: proof,
      }),
    });
  };
  assert.equal(finalize(initial.prior.reserve).journal.status, "committed");
  for (const forbidden of [
    nativeReserve,
    stagedCandidates.reserve,
    {
      deploymentId: "dpl_reserveUnexpected123",
      deploymentUrl: "https://reserve-unexpected.vercel.app",
    },
  ]) {
    assert.throws(
      () => finalize(forbidden),
      /Final mapping reserve is invalid/,
    );
  }
});

test("lost App output routes to recovery without provider match authority", () => {
  const initial = prepared(["app"]);
  const history = [
    reduceForward(initial, [], event("initialize"), ["app"]).journal,
  ];
  const dispatched = reduceForward(
    initial,
    history,
    event("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["app"],
  );
  history.push(dispatched.journal);
  const authorized = reduceForward(
    initial,
    history,
    event("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["app"],
  );
  assert.match(authorized.command.nextDeploymentId, /^mr-app-[a-f0-9]{18}$/);
  const returned = reduceForward(
    initial,
    history,
    event("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: { outcome: "unknown", reason: "lost-output", candidate: null },
    }),
    ["app"],
  );
  history.push(returned.journal);
  const verified = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
      appCandidateReceipt: null,
      appDeployment: null,
    }),
    ["app"],
  );
  assert.equal(verified.journal.sequence, returned.journal.sequence + 1);
  assert.equal(verified.journal.status, "verified");
  assert.equal(
    verified.journal.operations.length,
    returned.journal.operations.length + 1,
  );
  assert.equal(verified.journal.candidates.app.deploymentId, null);
  assert.equal(verified.journal.operations.at(-1).mappingState, "unknown");
  assert.equal(verified.afterUploadAction, "recover");
});

test("App command output remains pending until the finalized receipt attaches candidate authority", () => {
  const initial = preparedPendingApp();
  const history = [
    reduceForward(initial, [], event("initialize"), ["app"]).journal,
  ];
  const dispatched = reduceForward(
    initial,
    history,
    event("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["app"],
  );
  history.push(dispatched.journal);
  const authorized = reduceForward(
    initial,
    history,
    event("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["app"],
  );
  const returned = reduceForward(
    initial,
    history,
    event("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: {
        outcome: "success",
        reason: null,
        candidate: {
          deploymentId: "dpl_appCliOutput123",
          deploymentUrl: "https://app-cli-output.vercel.app",
        },
      },
    }),
    ["app"],
  );
  assert.equal(returned.journal.candidates.app.deploymentId, null);
  assert.equal(returned.journal.candidates.app.discovery.immutableSmoke, null);
  history.push(returned.journal);

  const finalizedReceipt = appCandidateReceipt(initial);
  const attached = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
      appCandidateReceipt: finalizedReceipt,
      appDeployment: null,
    }),
    ["app"],
  );
  assert.equal(
    attached.journal.candidates.app.deploymentId,
    finalizedReceipt.candidate.deploymentId,
  );
  assert.equal(
    attached.journal.candidates.app.deploymentUrl,
    finalizedReceipt.candidate.deploymentUrl,
  );
  assert.deepEqual(
    attached.journal.candidates.app.discovery.immutableSmoke,
    finalizedReceipt.immutableSmoke,
  );
});

test("provider-stable App candidates replace recovery discovery", () => {
  const providerResolved = prepared(["app"], { appKnown: true });
  assert.equal(
    providerResolved.candidates.app.discovery.metrics.cacheHit,
    null,
  );
});

test("recovery reducer persists recovering, started, returned, verified, and terminal snapshots", () => {
  const { history } = runOrdinaryForward();
  const plan = planMainTransactionRecovery({
    journal: history.at(-1),
    currentMappings: currentMappings(history.at(-1), {
      governance: "candidate",
    }),
  });
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(history.at(-1)),
    }),
  });
  history.push(recovering.journal);
  assert.equal(recovering.journal.status, "recovering");
  const started = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1), {
        governance: "candidate",
      }),
    }),
  });
  history.push(started.journal);
  const authorized = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1), {
        governance: "candidate",
      }),
    }),
  });
  assert.equal(authorized.command.kind, "ordinary-rollback");
  const returned = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: { outcome: "unknown", reason: "timeout", candidate: null },
    }),
  });
  history.push(returned.journal);
  const verified = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("verify", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1)),
    }),
  });
  history.push(verified.journal);
  const terminal = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1)),
    }),
  });
  assert.equal(terminal.journal, null);
  assert.equal(terminal.transitionKind, "recovery-verification-incomplete");
  assert.equal(terminal.nextAction, "fail-after-evidence");
  assert.equal(terminal.possibleMutationCommands, 2);
  assert.equal(terminal.confirmedMutationCommands, 2);
});

test("recovery reducer checkpoints safe reverse recovery before manual intervention", () => {
  const initial = prepared(["governance", "reserve"]);
  const governanceStarted = startMainTransactionOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const governanceReturned = recordMainTransactionCommandReturned(
    governanceStarted,
    {
      operationId: governanceStarted.operations.at(-1).operationId,
      outcome: "success",
    },
  );
  const governanceVerified = recordMainTransactionVerified(governanceReturned, {
    operationId: governanceStarted.operations.at(-1).operationId,
    mappingState: "candidate",
  });
  const reserveStarted = startMainTransactionOperation(governanceVerified, {
    type: "promote",
    target: "reserve",
  });
  const reserveReturned = recordMainTransactionCommandReturned(reserveStarted, {
    operationId: reserveStarted.operations.at(-1).operationId,
    outcome: "success",
  });
  const highest = recordMainTransactionVerified(reserveReturned, {
    operationId: reserveStarted.operations.at(-1).operationId,
    mappingState: "candidate",
  });
  const plannedMappings = currentMappings(highest, {
    reserve: "candidate",
  }).map((mapping) =>
    mapping.alias === "governance.mento.org"
      ? {
          ...mapping,
          deploymentId: "dpl_operator123",
          deploymentUrl: "https://operator.vercel.app",
        }
      : mapping,
  );
  const unexpectedGovernance = recoveryCurrentMappings(highest, {
    reserve: "candidate",
  }).map((mapping) =>
    mapping.alias === "governance.mento.org"
      ? {
          ...mapping,
          deploymentId: "dpl_operator123",
          deploymentUrl: "https://operator.vercel.app",
        }
      : mapping,
  );
  const plan = planMainTransactionRecovery({
    journal: highest,
    currentMappings: plannedMappings,
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.deepEqual(
    plan.actions.map((action) => [action.kind, action.target]),
    [
      ["ordinary_rollback", "reserve"],
      ["manual_intervention", "governance"],
    ],
  );

  const history = [
    initial,
    governanceStarted,
    governanceReturned,
    governanceVerified,
    reserveStarted,
    reserveReturned,
    highest,
  ];
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(highest),
    }),
  });
  history.push(recovering.journal);
  const started = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(recovering.journal),
      currentMappings: unexpectedGovernance,
    }),
  });
  assert.equal(started.journal.operations.at(-1).type, "ordinary_rollback");
  assert.equal(started.afterUploadAction, "authorize");
  history.push(started.journal);
  const authorized = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("authorize", {
      uploadReceipt: receipt(started.journal),
      currentMappings: unexpectedGovernance,
    }),
  });
  assert.equal(authorized.command.kind, "ordinary-rollback");
  const returned = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("command-returned", {
      uploadReceipt: receipt(started.journal),
      operationId: authorized.operationId,
      command: authorized.command,
      result: { outcome: "success", reason: null, candidate: null },
    }),
  });
  history.push(returned.journal);
  const restoredReserve = unexpectedGovernance.map((mapping) =>
    mapping.alias === "reserve.mento.org"
      ? {
          ...mapping,
          deploymentId: highest.prior.reserve.deploymentId,
          deploymentUrl: highest.prior.reserve.deploymentUrl,
        }
      : mapping,
  );
  const verified = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("verify", {
      uploadReceipt: receipt(returned.journal),
      currentMappings: restoredReserve,
    }),
  });
  assert.equal(verified.journal.operations.at(-1).mappingState, "prior");
  assert.equal(verified.afterUploadAction, "dispatch");
  history.push(verified.journal);
  const terminal = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(verified.journal),
      currentMappings: restoredReserve,
    }),
  });
  assert.equal(terminal.journal.status, "manual_intervention");
  assert.equal(terminal.afterUploadAction, "fail-after-evidence");
});

test("unknown App recovery compensates ordinary targets before manual intervention", () => {
  for (const appMovesAfterPlanning of [false, true]) {
    const initial = prepared(["app", "governance", "reserve", "ui"]);
    const history = [initial];
    let highest = initial;
    for (const target of ["governance", "reserve", "ui"]) {
      const started = startMainTransactionOperation(highest, {
        type: "promote",
        target,
      });
      history.push(started);
      const returned = recordMainTransactionCommandReturned(started, {
        operationId: started.operations.at(-1).operationId,
        outcome: "success",
      });
      history.push(returned);
      highest = recordMainTransactionVerified(returned, {
        operationId: started.operations.at(-1).operationId,
        mappingState: "candidate",
      });
      history.push(highest);
    }
    const appStarted = startMainTransactionOperation(highest, {
      type: "app_v3_deploy",
      target: "app",
    });
    history.push(appStarted);
    highest = recordMainTransactionCommandReturned(appStarted, {
      operationId: appStarted.operations.at(-1).operationId,
      outcome: "unknown",
    });
    history.push(highest);

    const ordinaryStates = {
      governance: "candidate",
      reserve: "candidate",
      ui: "candidate",
    };
    const plan = planMainTransactionRecovery({
      journal: highest,
      currentMappings: currentMappings(highest, ordinaryStates),
    });
    assert.equal(plan.decision, "manual_intervention");
    assert.equal(plan.reason, "app-candidate-unresolved-after-start");

    const recovering = reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("initialize", {
        uploadReceipt: receipt(highest),
      }),
    });
    history.push(recovering.journal);

    const movedAppAlias = highest.prior.app.aliases[1];
    const liveMappings = () =>
      recoveryCurrentMappings(history.at(-1), ordinaryStates).map((mapping) =>
        appMovesAfterPlanning && mapping.alias === movedAppAlias
          ? {
              ...mapping,
              deploymentId: "dpl_unresolvedApp123",
              deploymentUrl: "https://unresolved-app.vercel.app",
            }
          : mapping,
      );

    for (const target of ["ui", "reserve", "governance"]) {
      const started = reduceMainActiveRecoveryTransition({
        recoveryPlan: plan,
        history,
        event: recoveryEvent("dispatch", {
          uploadReceipt: receipt(history.at(-1)),
          currentMappings: liveMappings(),
        }),
      });
      assert.equal(started.journal.operations.at(-1).type, "ordinary_rollback");
      assert.equal(started.journal.operations.at(-1).target, target);
      history.push(started.journal);

      const authorized = reduceMainActiveRecoveryTransition({
        recoveryPlan: plan,
        history,
        event: recoveryEvent("authorize", {
          uploadReceipt: receipt(history.at(-1)),
          currentMappings: liveMappings(),
        }),
      });
      const returned = reduceMainActiveRecoveryTransition({
        recoveryPlan: plan,
        history,
        event: recoveryEvent("command-returned", {
          uploadReceipt: receipt(history.at(-1)),
          operationId: authorized.operationId,
          command: authorized.command,
          result: { outcome: "success", reason: null, candidate: null },
        }),
      });
      history.push(returned.journal);

      delete ordinaryStates[target];
      const verified = reduceMainActiveRecoveryTransition({
        recoveryPlan: plan,
        history,
        event: recoveryEvent("verify", {
          uploadReceipt: receipt(history.at(-1)),
          currentMappings: liveMappings(),
        }),
      });
      assert.equal(verified.journal.operations.at(-1).mappingState, "prior");
      history.push(verified.journal);
    }

    const terminal = reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("dispatch", {
        uploadReceipt: receipt(history.at(-1)),
        currentMappings: liveMappings(),
      }),
    });
    assert.equal(terminal.journal.status, "manual_intervention");
    assert.equal(terminal.afterUploadAction, "fail-after-evidence");
    assert.deepEqual(
      terminal.journal.operations
        .filter(
          (operation) =>
            operation.type === "ordinary_rollback" &&
            operation.state === "started",
        )
        .map((operation) => operation.target),
      ["ui", "reserve", "governance"],
    );
    assert.equal(
      terminal.journal.operations.some(
        (operation) =>
          operation.type === "app_alias_restore" ||
          operation.type === "legacy_emergency_restore",
      ),
      false,
    );
  }
});

test("legacy recovery command binds the full reviewed topology and App project", () => {
  const initial = prepared(["app"], { appKnown: true });
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const legacyAlias = "v2-app.mento.org";
  const moved = currentMappings(started).map((mapping) =>
    mapping.alias === legacyAlias
      ? {
          ...mapping,
          deploymentId: started.candidates.app.deploymentId,
          deploymentUrl: started.candidates.app.deploymentUrl,
        }
      : mapping,
  );
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: moved,
  });
  assert.equal(plan.decision, "recover");
  const history = [initial, started];
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(started),
    }),
  });
  history.push(recovering.journal);
  const boundMoved = recoveryCurrentMappings(recovering.journal).map(
    (mapping) =>
      mapping.alias === legacyAlias
        ? {
            ...mapping,
            deploymentId: started.candidates.app.deploymentId,
            deploymentUrl: started.candidates.app.deploymentUrl,
          }
        : mapping,
  );
  const dispatched = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(recovering.journal),
      currentMappings: boundMoved,
    }),
  });
  history.push(dispatched.journal);
  const authorized = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("authorize", {
      uploadReceipt: receipt(dispatched.journal),
      currentMappings: boundMoved,
    }),
  });
  assert.equal(authorized.command.kind, "legacy-alias-restore");
  assert.equal(authorized.command.alias, legacyAlias);
  assert.deepEqual(
    authorized.command.aliases,
    started.prior["legacy-app"].aliases,
  );
  assert.equal(
    authorized.command.projectId,
    started.release.originalPriors.app.projectId,
  );
});

test("provider census rejects ambiguous App discovery before recovery", () => {
  const providerResolved = prepared(["app"], { appKnown: true });
  assert.equal(
    providerResolved.candidates.app.discovery.releaseId.length > 0,
    true,
  );
});

test("unknown recovery that is not restored persists manual intervention", () => {
  const { history } = runOrdinaryForward();
  const plan = planMainTransactionRecovery({
    journal: history.at(-1),
    currentMappings: currentMappings(history.at(-1), {
      governance: "candidate",
    }),
  });
  for (const transition of [
    reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("initialize", {
        uploadReceipt: receipt(history.at(-1)),
      }),
    }),
  ]) {
    history.push(transition.journal);
  }
  const started = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1), {
        governance: "candidate",
      }),
    }),
  });
  history.push(started.journal);
  const authorized = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1), {
        governance: "candidate",
      }),
    }),
  });
  const returned = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: { outcome: "unknown", reason: "nonzero", candidate: null },
    }),
  });
  history.push(returned.journal);
  const unexpectedMappings = recoveryCurrentMappings(history.at(-1), {
    governance: "candidate",
  }).map((mapping) =>
    mapping.alias === "governance.mento.org"
      ? {
          ...mapping,
          deploymentId: "dpl_unexpected123",
          deploymentUrl: "https://unexpected.vercel.app",
        }
      : mapping,
  );
  const verified = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("verify", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: unexpectedMappings,
    }),
  });
  history.push(verified.journal);
  const terminal = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: unexpectedMappings,
    }),
  });
  assert.equal(terminal.journal, null);
  assert.equal(terminal.transitionKind, "manual-intervention-required");
  assert.equal(terminal.nextAction, "fail-after-evidence");
  assert.equal(terminal.possibleMutationCommands, 2);
  assert.equal(terminal.confirmedMutationCommands, 2);
});

test("recovery rechecks a planned noop and restores an exact late candidate", () => {
  const { history } = runOrdinaryForward();
  const plan = planMainTransactionRecovery({
    journal: history.at(-1),
    currentMappings: currentMappings(history.at(-1)),
  });
  assert.equal(plan.actions[0].kind, "verified_noop");
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(history.at(-1)),
    }),
  });
  history.push(recovering.journal);
  const dispatched = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: recoveryCurrentMappings(history.at(-1), {
        governance: "candidate",
      }),
    }),
  });
  assert.equal(dispatched.journal.status, "started");
  assert.equal(dispatched.journal.operations.at(-1).type, "ordinary_rollback");
});

test("separate command executor binds result to the safe descriptor", async () => {
  const { authorized } = runOrdinaryForward();
  let received;
  const result = await executeMainActiveCommand({
    command: authorized.command,
    adapter: async (command) => {
      received = command;
      return { outcome: "success", reason: null, candidate: null };
    },
  });
  assert.equal(result.outcome, "success");
  assert.deepEqual(received, authorized.command);
});

test("separate command executor treats malformed adapter results as unknown", async () => {
  const { authorized } = runOrdinaryForward();
  const result = await executeMainActiveCommand({
    command: authorized.command,
    adapter: async () => undefined,
  });
  assert.deepEqual(result, {
    outcome: "unknown",
    reason: "lost-result",
    candidate: null,
  });
});

test("history loader accepts only contiguous identity-bound artifact directories", () => {
  const initial = prepared(["governance"]);
  const root = mkdtempSync(join(tmpdir(), "main-active-history-"));
  try {
    const directory = join(root, mainTransactionJournalArtifactName(initial));
    mkdirSync(directory);
    writeFileSync(
      join(directory, "main-journal.json"),
      `${JSON.stringify(initial)}\n`,
    );
    const loaded = loadMainActiveJournalHistory({
      artifactsDirectory: root,
      expectedIdentity: {
        repository: initial.repository,
        deploySha: initial.deploySha,
        runId: initial.runId,
        runAttempt: initial.runAttempt,
        transactionId: initial.transactionId,
        mode: initial.mode,
      },
    });
    assert.equal(loaded.highestSequence, 0);
    assert.equal(
      loaded.highestArtifactName,
      mainTransactionJournalArtifactName(initial),
    );
    assert.throws(
      () =>
        loadMainActiveJournalHistory({
          artifactsDirectory: root,
          expectedIdentity: { transactionId: initial.transactionId },
        }),
      /forbidden or missing fields/,
    );

    const forged = { ...initial, sequence: 2 };
    const gapDirectory = join(root, mainTransactionJournalArtifactName(forged));
    mkdirSync(gapDirectory);
    writeFileSync(
      join(gapDirectory, "main-journal.json"),
      `${JSON.stringify(forged)}\n`,
    );
    assert.throws(
      () =>
        loadMainActiveJournalHistory({
          artifactsDirectory: root,
          expectedIdentity: {
            repository: initial.repository,
            deploySha: initial.deploySha,
            runId: initial.runId,
            runAttempt: initial.runAttempt,
            transactionId: initial.transactionId,
            mode: initial.mode,
          },
        }),
      /missing or duplicated/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("history loader rejects multi-link and oversized journal files", () => {
  const initial = prepared(["governance"]);
  const root = mkdtempSync(join(tmpdir(), "main-active-history-bounds-"));
  try {
    const directory = join(root, mainTransactionJournalArtifactName(initial));
    mkdirSync(directory);
    const file = join(directory, "main-journal.json");
    writeFileSync(file, `${JSON.stringify(initial)}\n`);
    linkSync(file, join(root, "journal-hardlink.json"));
    assert.throws(
      () =>
        loadMainActiveJournalHistory({
          artifactsDirectory: root,
          expectedIdentity: {
            repository: initial.repository,
            deploySha: initial.deploySha,
            runId: initial.runId,
            runAttempt: initial.runAttempt,
            transactionId: initial.transactionId,
            mode: initial.mode,
          },
        }),
      /regular file/,
    );
    rmSync(join(root, "journal-hardlink.json"));
    writeFileSync(file, "x".repeat(256 * 1024 + 1));
    assert.throws(
      () =>
        loadMainActiveJournalHistory({
          artifactsDirectory: root,
          expectedIdentity: {
            repository: initial.repository,
            deploySha: initial.deploySha,
            runId: initial.runId,
            runAttempt: initial.runAttempt,
            transactionId: initial.transactionId,
            mode: initial.mode,
          },
        }),
      /regular file/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fresh App provider census accepts one stable candidate and rejects a third deployment", async () => {
  const journal = prepared(["app"], { appKnown: true });
  const mappings = Object.fromEntries(
    ["governance", "reserve", "ui", "app", "legacy-app"].map((target) => [
      target,
      journal.prior[target].aliases.map((alias) => ({
        alias,
        deploymentId: journal.prior[target].deploymentId,
        deploymentUrl: journal.prior[target].deploymentUrl,
      })),
    ]),
  );
  const census = await censusFreshMainActiveRelease({
    journal,
    inspectCurrentMappings: async () => structuredClone(mappings),
  });
  assert.equal(census.reconciliation.allPrior, true);
  mappings.app[0] = {
    ...mappings.app[0],
    deploymentId: "dpl_appThird123",
    deploymentUrl: "https://app-third.vercel.app",
  };
  const plan = planFreshInheritedMainActiveRecovery({
    inheritedJournal: journal,
    reason: "forward-operation-failed",
    currentMappings: mappings,
  });
  assert.equal(plan.decision, "manual-intervention");
});

test("fresh forward reconciliation rejects an App-only recovery residual", () => {
  const journal = prepared(TARGETS, { appKnown: true });
  const mappings = groupedCurrentMappings(journal, { app: "candidate" });

  assert.throws(
    () =>
      reconcileFreshMainActiveRelease({
        journal,
        currentMappings: mappings,
      }),
    /activation prefix/,
  );

  const recovery = planFreshInheritedMainActiveRecovery({
    inheritedJournal: journal,
    reason: "forward-operation-failed",
    currentMappings: mappings,
  });
  assert.equal(recovery.decision, "restore-inherited");
  assert.deepEqual(
    recovery.actions.map(({ kind, alias }) => ({ kind, alias })),
    [...journal.prior.app.aliases]
      .reverse()
      .map((alias) => ({ kind: "app_alias_restore", alias })),
  );
});

test("forward dispatch and authorize reject a fresh App-only recovery residual", () => {
  const initial = prepared(TARGETS, { appKnown: true });
  const initialized = reduceForward(initial, [], event("initialize"), TARGETS);
  const residual = currentMappings(initialized.journal, {
    app: "candidate",
  });

  assert.throws(
    () =>
      reduceForward(
        initial,
        [initialized.journal],
        event("dispatch", {
          uploadReceipt: receipt(initialized.journal),
          freshSha: SHA,
          currentMappings: residual,
        }),
        TARGETS,
      ),
    /activation prefix/,
  );

  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal),
    }),
    TARGETS,
  );
  assert.equal(dispatched.journal.operations.at(-1).target, "governance");
  assert.throws(
    () =>
      reduceForward(
        initial,
        [initialized.journal, dispatched.journal],
        event("authorize", {
          uploadReceipt: receipt(dispatched.journal),
          freshSha: SHA,
          currentMappings: residual,
        }),
        TARGETS,
      ),
    /activation prefix/,
  );
});

test("current-attempt inherited recovery binds the inherited release SHA and completes", () => {
  const inherited = prepared(TARGETS, { appKnown: true });
  const observed = groupedCurrentMappings(inherited, {
    governance: "candidate",
  });
  const { journal: current } = createCurrentMainActiveRecoveryJournal({
    inheritedJournal: inherited,
    identity: {
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: "2222222222222222222222222222222222222222",
      runId: "987654321",
      runAttempt: "7",
    },
    currentMappings: observed,
  });
  assert.equal(current.deploySha, inherited.release.deploySha);
  assert.notEqual(current.runId, inherited.runId);
  assert.deepEqual(current.startMappings, observed);

  const plan = decideMainActiveAppRecoverySafety({
    inheritedJournal: inherited,
    currentJournal: current,
    reason: "suffix-preparation-failed-before-forward",
    currentMappings: observed,
  });
  assert.equal(plan.decision, "restore-inherited");
  assert.equal(plan.journal.transactionId, current.transactionId);
  assert.deepEqual(
    plan.actions.map(({ target }) => target),
    ["governance"],
  );

  const history = [current];
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(current),
    }),
  });
  history.push(recovering.journal);
  assert.equal(recovering.journal.status, "recovering");

  const moved = recoveryCurrentMappings(recovering.journal, {
    governance: "candidate",
  });
  const started = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: moved,
    }),
  });
  history.push(started.journal);
  const authorized = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: moved,
    }),
  });
  assert.equal(authorized.command.kind, "ordinary-rollback");

  const returned = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: { outcome: "success", reason: null, candidate: null },
    }),
  });
  history.push(returned.journal);
  const restored = recoveryCurrentMappings(returned.journal);
  const verified = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("verify", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: restored,
    }),
  });
  history.push(verified.journal);
  const terminal = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: restored,
    }),
  });
  assert.equal(terminal.journal.status, "recovered");
  assert.equal(terminal.afterUploadAction, "continue-after-recovery");
});

test("App-only recovery residual restores both aliases before a fresh baseline", () => {
  const inherited = prepared(TARGETS, { appKnown: true });
  const observed = groupedCurrentMappings(inherited, { app: "candidate" });
  const { journal: current } = createCurrentMainActiveRecoveryJournal({
    inheritedJournal: inherited,
    identity: {
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: "2222222222222222222222222222222222222222",
      runId: "987654321",
      runAttempt: "7",
    },
    currentMappings: observed,
  });
  const plan = decideMainActiveAppRecoverySafety({
    inheritedJournal: inherited,
    currentJournal: current,
    reason: "forward-operation-failed",
    currentMappings: observed,
  });
  assert.equal(plan.decision, "restore-inherited");
  assert.deepEqual(
    plan.actions.map(({ kind, alias }) => ({ kind, alias })),
    [...inherited.prior.app.aliases]
      .reverse()
      .map((alias) => ({ kind: "app_alias_restore", alias })),
  );

  const history = [current];
  const initialized = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(current),
    }),
  });
  history.push(initialized.journal);
  const movedAliases = new Set(inherited.prior.app.aliases);
  const liveMappings = () =>
    recoveryCurrentMappings(history.at(-1)).map((mapping) =>
      movedAliases.has(mapping.alias)
        ? {
            ...mapping,
            deploymentId: history.at(-1).candidates.app.deploymentId,
            deploymentUrl: history.at(-1).candidates.app.deploymentUrl,
          }
        : mapping,
    );

  for (const expectedAlias of [...inherited.prior.app.aliases].reverse()) {
    const started = reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("dispatch", {
        uploadReceipt: receipt(history.at(-1)),
        currentMappings: liveMappings(),
      }),
    });
    history.push(started.journal);
    const authorized = reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("authorize", {
        uploadReceipt: receipt(history.at(-1)),
        currentMappings: liveMappings(),
      }),
    });
    assert.equal(authorized.command.kind, "app-alias-restore");
    assert.equal(authorized.command.alias, expectedAlias);

    const returned = reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("command-returned", {
        uploadReceipt: receipt(history.at(-1)),
        operationId: authorized.operationId,
        command: authorized.command,
        result: { outcome: "success", reason: null, candidate: null },
      }),
    });
    history.push(returned.journal);
    movedAliases.delete(expectedAlias);
    const verified = reduceMainActiveRecoveryTransition({
      recoveryPlan: plan,
      history,
      event: recoveryEvent("verify", {
        uploadReceipt: receipt(history.at(-1)),
        currentMappings: liveMappings(),
      }),
    });
    history.push(verified.journal);
  }

  const terminal = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: liveMappings(),
    }),
  });
  assert.equal(terminal.journal.status, "recovered");
  assert.equal(terminal.afterUploadAction, "continue-after-recovery");

  const recoveredMappings = groupedCurrentMappings(terminal.journal);
  const next = decideMainPreplanReconciliation({
    nextDeploySha: "2222222222222222222222222222222222222222",
    nextUpstreamRunId: "987654321",
    candidateReleases: [],
    currentMappings: Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
        target,
        recoveredMappings[target],
      ]),
    ),
    rollbackOnlyTargets: [],
  });
  assert.equal(next.decision, "capture-new-baseline");
  assert.equal(next.reason, "no-mapped-release-metadata");
});

test("inherited recovery refuses missing, divergent, and all-candidate current journals", () => {
  const inherited = prepared(TARGETS, { appKnown: true });
  const partial = groupedCurrentMappings(inherited, {
    governance: "candidate",
    reserve: "candidate",
    ui: "candidate",
  });
  const missing = decideMainActiveAppRecoverySafety({
    inheritedJournal: inherited,
    reason: "forward-operation-failed",
    currentMappings: partial,
  });
  assert.equal(missing.decision, "manual-intervention");
  assert.equal(missing.reason, "current-attempt-recovery-journal-is-required");

  const { journal: current } = createCurrentMainActiveRecoveryJournal({
    inheritedJournal: inherited,
    identity: {
      repository: MAIN_TRANSACTION_REPOSITORY,
      deploySha: inherited.deploySha,
      runId: "987654321",
      runAttempt: "8",
    },
    currentMappings: partial,
  });
  const divergent = structuredClone(current);
  divergent.runAttempt = "9";
  assert.throws(
    () =>
      reduceMainActiveRecoveryTransition({
        recoveryPlan: planFreshInheritedMainActiveRecovery({
          inheritedJournal: current,
          reason: "forward-operation-failed",
          currentMappings: partial,
        }),
        history: [divergent],
        event: recoveryEvent("initialize", {
          uploadReceipt: receipt(divergent),
        }),
      }),
    /identity|transaction/,
  );

  const allCandidate = groupedCurrentMappings(inherited, {
    app: "candidate",
    governance: "candidate",
    reserve: "candidate",
    ui: "candidate",
  });
  const verifyOnly = planFreshInheritedMainActiveRecovery({
    inheritedJournal: inherited,
    reason: "main-stale-before-forward",
    currentMappings: allCandidate,
  });
  assert.equal(verifyOnly.decision, "verify-noop");
  assert.throws(
    () =>
      reduceMainActiveRecoveryTransition({
        recoveryPlan: verifyOnly,
        history: [inherited],
        event: recoveryEvent("initialize", {
          uploadReceipt: receipt(inherited),
        }),
      }),
    /not executable/,
  );
});
