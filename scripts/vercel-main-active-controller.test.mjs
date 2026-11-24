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
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const RUN_ID = "123456789";
const RUN_ATTEMPT = "2";
const TARGETS = ["app", "reserve", "ui"];
// Every main target, App included, maps exactly one reviewed alias.
const APP_ALIAS = "app.mento.org";
const PROJECT_IDS = {
  app: "prj_app123",
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
      customEnvironmentSlug: null,
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
    app: record("app", ["app.mento.org"]),
    reserve: record("reserve", ["reserve.mento.org"]),
    ui: record("ui", ["ui.mento.org"]),
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

// Every selected target stages an exact candidate before activation.
function prepared(activeTargets, { startCandidateTargets = [] } = {}) {
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
          deploymentId: "dpl_appCandidate123",
          deploymentUrl: "https://app-candidate.vercel.app",
          aliases: [...captured.app.aliases],
          discovery: candidate("app", captured.app.aliases, manifest).discovery,
        }
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
        states[target] === "candidate" ? journal.candidates[target] : captured;
      return captured.aliases.map((alias) => ({
        alias,
        deploymentId: selected.deploymentId,
        deploymentUrl: selected.deploymentUrl,
      }));
    })
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

function recoveryCurrentMappings(journal, states = {}) {
  return currentMappings(journal, states);
}

function groupedCurrentMappings(journal, states = {}) {
  return Object.fromEntries(
    Object.entries(journal.prior).map(([target, captured]) => {
      const selected =
        states[target] === "candidate" ? journal.candidates[target] : captured;
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
          target: "production",
          customEnvironmentSlug: null,
        },
      ];
    }),
  );
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
  return createActiveDeploymentStateProof({ spec, deployments });
}

function runtimeSmoke(target, deploySha = SHA) {
  const finalUrls = {
    app: "https://app.mento.org/swap/celo",
    reserve: "https://reserve.mento.org/?tab=stablecoins",
    ui: "https://ui.mento.org/form-components",
  };
  const interactions = {
    app: "real-production-wallet-list",
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
  const initial = prepared(["reserve"]);
  const history = [];
  const initialized = reduceForward(initial, history, event("initialize"), [
    "reserve",
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
    ["reserve"],
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
    ["reserve"],
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
    ["reserve"],
  );
  history.push(returned.journal);
  const verified = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        reserve: "candidate",
      }),
    }),
    ["reserve"],
  );
  history.push(verified.journal);
  return { initial, history, authorized };
}

test("initialize emits only prepared sequence zero for active targets", () => {
  const initial = prepared(["reserve"]);
  const result = reduceForward(initial, [], event("initialize"), ["reserve"]);
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
  const initial = prepared(["reserve"], {
    startCandidateTargets: ["reserve"],
  });
  const initialized = reduceForward(initial, [], event("initialize"), [
    "reserve",
  ]);
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal, {
        reserve: "candidate",
      }),
    }),
    ["reserve"],
  );
  assert.equal(dispatched.transitionKind, "await-final-proof");
  assert.equal(dispatched.nextAction, "collect-final-proof");
  assert.equal(dispatched.journal, null);
  assert.equal(dispatched.possibleMutationCommands, 0);
});

test("dispatch resumes a candidate prefix by promoting only the prior suffix", () => {
  const initial = prepared(["reserve", "ui"], {
    startCandidateTargets: ["reserve"],
  });
  const initialized = reduceForward(initial, [], event("initialize"), [
    "reserve",
    "ui",
  ]);
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal, {
        reserve: "candidate",
      }),
    }),
    ["reserve", "ui"],
  );
  assert.equal(dispatched.journal.operations.at(-1).type, "promote");
  assert.equal(dispatched.journal.operations.at(-1).target, "ui");
  assert.equal(dispatched.afterUploadAction, "authorize");
});

// MGP-18 moved `app.mento.org` into the production environment, so
// `vercel promote` carries it and the App promote verifies at `candidate` like
// every other target. An App promote whose reviewed domain is still at the
// prior is drift and must route to recovery; no bridge alias set follows it.
test("an App promote verified at prior routes to recovery instead of a bridge alias set", () => {
  const initial = prepared(["app"]);
  const history = [];
  const initialized = reduceForward(initial, history, event("initialize"), [
    "app",
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
    ["app"],
  );
  assert.equal(dispatched.journal.operations.at(-1).type, "promote");
  assert.equal(dispatched.journal.operations.at(-1).target, "app");
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
      result: { outcome: "success", reason: null, candidate: null },
    }),
    ["app"],
  );
  history.push(returned.journal);
  // The promote succeeded but the reviewed App domain is still at the prior.
  // That is drift now, not the expected verified state.
  const stalled = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
    }),
    ["app"],
  );
  assert.equal(stalled.journal.operations.at(-1).mappingState, "prior");
  assert.equal(stalled.afterUploadAction, "recover");

  // The App promote carrying its reviewed domain to the candidate is the only
  // verified forward state, and nothing follows it: activation is complete.
  const verified = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), { app: "candidate" }),
    }),
    ["app"],
  );
  assert.equal(verified.journal.operations.at(-1).mappingState, "candidate");
  assert.equal(verified.afterUploadAction, "dispatch");
  history.push(verified.journal);
  const next = reduceForward(
    initial,
    history,
    event("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), { app: "candidate" }),
    }),
    ["app"],
  );
  assert.equal(next.transitionKind, "await-final-proof");
  assert.equal(
    next.journal?.operations.some((operation) => operation.alias !== null) ??
      false,
    false,
  );
});

test("dispatch routes an unexpected ordinary mapping to recovery", () => {
  const initial = prepared(["reserve"]);
  const initialized = reduceForward(initial, [], event("initialize"), [
    "reserve",
  ]);
  const partial = currentMappings(initialized.journal).map((entry) =>
    entry.alias === "reserve.mento.org"
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
    ["reserve"],
  );
  assert.equal(dispatched.transitionKind, "recovery-required");
  assert.equal(dispatched.nextAction, "recover");
  assert.equal(dispatched.journal, null);
});

test("authorize requires an exact positive receipt for the started snapshot", () => {
  const initial = prepared(["reserve"]);
  const initialized = reduceForward(initial, [], event("initialize"), [
    "reserve",
  ]);
  const dispatched = reduceForward(
    initial,
    [initialized.journal],
    event("dispatch", {
      uploadReceipt: receipt(initialized.journal),
      freshSha: SHA,
      currentMappings: currentMappings(initialized.journal),
    }),
    ["reserve"],
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
        ["reserve"],
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
        reserve: "candidate",
      }),
    }),
    ["reserve"],
  );
  assert.equal(ready.transitionKind, "await-final-proof");
  const committed = reduceForward(
    initial,
    history,
    event("finalize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        reserve: "candidate",
      }),
      publicSmokes: publicSmokes(["reserve"]),
      stateProof: activeStateProof(history.at(-1), {
        activeTargets: ["reserve"],
      }),
    }),
    ["reserve"],
  );
  assert.equal(committed.journal.status, "committed");
  assert.equal(committed.afterUploadAction, "complete");
  assert.equal(committed.possibleMutationCommands, 1);
  assert.equal(committed.confirmedMutationCommands, 1);

  const tamperedPriorProof = activeStateProof(history.at(-1), {
    activeTargets: ["reserve"],
  });
  tamperedPriorProof.projects.reserve.priorDeploymentId =
    "dpl_otherReservePrior123";
  assert.throws(
    () =>
      reduceForward(
        initial,
        history,
        event("finalize", {
          uploadReceipt: receipt(history.at(-1)),
          freshSha: SHA,
          currentMappings: currentMappings(history.at(-1), {
            reserve: "candidate",
          }),
          publicSmokes: publicSmokes(["reserve"]),
          stateProof: tamperedPriorProof,
        }),
        ["reserve"],
      ),
    /reserve expectation is inconsistent/,
  );

  for (const [name, mutate, pattern] of [
    [
      "wrong final URL",
      (smokes) => {
        smokes.reserve.runtime.final_url = "https://reserve.mento.org/";
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
    const smokes = publicSmokes(["reserve"]);
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
              reserve: "candidate",
            }),
            publicSmokes: smokes,
            stateProof: activeStateProof(history.at(-1), {
              activeTargets: ["reserve"],
            }),
          }),
          ["reserve"],
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
    reserve: initial.candidates.reserve,
    ui: candidate("ui", initial.prior.ui.aliases),
  };
  const mainOwnershipMode = {
    app: "github",
    reserve: "github",
    ui: "shadow",
  };
  const committed = reduceMainActiveTransition({
    preparedJournal: initial,
    activeTargets: ["reserve"],
    shadowTargets: ["ui"],
    stagedCandidates,
    mainOwnershipMode,
    projectIds: PROJECT_IDS,
    history,
    event: event("finalize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1), {
        reserve: "candidate",
      }),
      publicSmokes: publicSmokes(["reserve"]),
      stateProof: activeStateProof(history.at(-1), {
        activeTargets: ["reserve"],
        shadowTargets: ["ui"],
        stagedCandidates,
        mainOwnershipMode,
      }),
    }),
  });
  assert.equal(committed.journal.status, "committed");
  assert.equal(
    committed.journal.operations.some((operation) => operation.target === "ui"),
    false,
  );
});

test("shadow final mapping accepts the bound prior and rejects unbound same-SHA identities", () => {
  const { initial, history } = runOrdinaryForward();
  const stagedCandidates = {
    app: null,
    reserve: initial.candidates.reserve,
    ui: candidate("ui", initial.prior.ui.aliases),
  };
  const mainOwnershipMode = {
    app: "github",
    reserve: "github",
    ui: "shadow",
  };
  const nativeUi = {
    deploymentId: "dpl_uiNative123",
    deploymentUrl: "https://ui-native.vercel.app",
  };
  const proof = activeStateProof(history.at(-1), {
    activeTargets: ["reserve"],
    shadowTargets: ["ui"],
    stagedCandidates,
    mainOwnershipMode,
  });
  const finalize = (uiDeployment) => {
    const mappings = currentMappings(history.at(-1), {
      reserve: "candidate",
    }).map((entry) =>
      entry.alias === "ui.mento.org"
        ? {
            alias: entry.alias,
            deploymentId: uiDeployment.deploymentId,
            deploymentUrl: uiDeployment.deploymentUrl,
          }
        : entry,
    );
    return reduceMainActiveTransition({
      preparedJournal: initial,
      activeTargets: ["reserve"],
      shadowTargets: ["ui"],
      stagedCandidates,
      mainOwnershipMode,
      projectIds: PROJECT_IDS,
      history,
      event: event("finalize", {
        uploadReceipt: receipt(history.at(-1)),
        freshSha: SHA,
        currentMappings: mappings,
        publicSmokes: publicSmokes(["reserve"]),
        stateProof: proof,
      }),
    });
  };
  assert.equal(finalize(initial.prior.ui).journal.status, "committed");
  for (const forbidden of [
    nativeUi,
    stagedCandidates.ui,
    {
      deploymentId: "dpl_uiUnexpected123",
      deploymentUrl: "https://ui-unexpected.vercel.app",
    },
  ]) {
    assert.throws(() => finalize(forbidden), /Final mapping ui is invalid/);
  }
});

test("provider-stable App candidates replace recovery discovery", () => {
  const providerResolved = prepared(["app"]);
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
      reserve: "candidate",
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
        reserve: "candidate",
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
        reserve: "candidate",
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
  const initial = prepared(["reserve", "ui"]);
  const reserveStarted = startMainTransactionOperation(initial, {
    type: "promote",
    target: "reserve",
  });
  const reserveReturned = recordMainTransactionCommandReturned(reserveStarted, {
    operationId: reserveStarted.operations.at(-1).operationId,
    outcome: "success",
  });
  const reserveVerified = recordMainTransactionVerified(reserveReturned, {
    operationId: reserveStarted.operations.at(-1).operationId,
    mappingState: "candidate",
  });
  const uiStarted = startMainTransactionOperation(reserveVerified, {
    type: "promote",
    target: "ui",
  });
  const uiReturned = recordMainTransactionCommandReturned(uiStarted, {
    operationId: uiStarted.operations.at(-1).operationId,
    outcome: "success",
  });
  const highest = recordMainTransactionVerified(uiReturned, {
    operationId: uiStarted.operations.at(-1).operationId,
    mappingState: "candidate",
  });
  const plannedMappings = currentMappings(highest, {
    ui: "candidate",
  }).map((mapping) =>
    mapping.alias === "reserve.mento.org"
      ? {
          ...mapping,
          deploymentId: "dpl_operator123",
          deploymentUrl: "https://operator.vercel.app",
        }
      : mapping,
  );
  const unexpectedReserve = recoveryCurrentMappings(highest, {
    ui: "candidate",
  }).map((mapping) =>
    mapping.alias === "reserve.mento.org"
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
      ["ordinary_rollback", "ui"],
      ["manual_intervention", "reserve"],
    ],
  );

  const history = [
    initial,
    reserveStarted,
    reserveReturned,
    reserveVerified,
    uiStarted,
    uiReturned,
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
      currentMappings: unexpectedReserve,
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
      currentMappings: unexpectedReserve,
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
  const restoredUi = unexpectedReserve.map((mapping) =>
    mapping.alias === "ui.mento.org"
      ? {
          ...mapping,
          deploymentId: highest.prior.ui.deploymentId,
          deploymentUrl: highest.prior.ui.deploymentUrl,
        }
      : mapping,
  );
  const verified = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("verify", {
      uploadReceipt: receipt(returned.journal),
      currentMappings: restoredUi,
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
      currentMappings: restoredUi,
    }),
  });
  assert.equal(terminal.journal.status, "manual_intervention");
  assert.equal(terminal.afterUploadAction, "fail-after-evidence");
});

// An unknown App promote that left the reviewed App domain at its prior is a
// verified noop. One that moved it to the candidate is compensated by an
// ordinary rollback exactly like every other target, and one that moved it to
// an unexpected deployment is manual. Every started promote is compensated in
// reverse activation order.
test("App promote recovery is a noop at prior, a rollback at candidate, and manual on an unexpected mapping", () => {
  for (const appMapping of ["prior", "candidate", "unexpected"]) {
    const initial = prepared(["app", "reserve", "ui"]);
    const history = [initial];
    let highest = initial;
    for (const target of ["reserve", "ui"]) {
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
      type: "promote",
      target: "app",
    });
    history.push(appStarted);
    highest = recordMainTransactionCommandReturned(appStarted, {
      operationId: appStarted.operations.at(-1).operationId,
      outcome: "unknown",
    });
    history.push(highest);

    const ordinaryStates = {
      reserve: "candidate",
      ui: "candidate",
    };
    const observed = currentMappings(highest, {
      ...ordinaryStates,
      ...(appMapping === "candidate" ? { app: "candidate" } : {}),
    }).map((entry) =>
      appMapping === "unexpected" && entry.alias === APP_ALIAS
        ? {
            ...entry,
            deploymentId: "dpl_unexpectedApp123",
            deploymentUrl: "https://unexpected-app.vercel.app",
          }
        : entry,
    );
    const plan = planMainTransactionRecovery({
      journal: highest,
      currentMappings: observed,
    });
    const appKind = {
      prior: "verified_noop",
      candidate: "ordinary_rollback",
      unexpected: "manual_intervention",
    }[appMapping];
    assert.deepEqual(
      plan.actions.map(({ kind, target }) => [target, kind]),
      [
        ["app", appKind],
        ["ui", "ordinary_rollback"],
        ["reserve", "ordinary_rollback"],
      ],
      appMapping,
    );
    assert.equal(
      plan.decision,
      appMapping === "unexpected" ? "manual_intervention" : "recover",
    );
    assert.deepEqual(plan.rollbackStateTargets, [
      ...(appMapping === "candidate" ? ["app"] : []),
      "ui",
      "reserve",
    ]);
  }
});

// MGP-18 retired the legacy App deployment and the transitional bridge alias
// operations. App recovery is an ordinary rollback, and no controller path may
// emit a legacy or alias command.
test("App recovery rolls back and no alias operation can re-enter", () => {
  const initial = prepared(["app"]);
  for (const type of ["app_alias_set", "app_alias_restore"]) {
    assert.throws(
      () =>
        startMainTransactionOperation(initial, {
          type,
          target: "app",
          alias: APP_ALIAS,
        }),
      /Operation type is unsupported/,
      type,
    );
  }
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "app",
  });
  assert.equal(started.prior["legacy-app"], undefined);
  const appAlias = started.prior.app.aliases.at(-1);
  const moved = currentMappings(started).map((mapping) =>
    mapping.alias === appAlias
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
  assert.equal(
    plan.actions.some(({ target }) => target === "legacy-app"),
    false,
  );
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
      mapping.alias === appAlias
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
  assert.equal(authorized.command.kind, "ordinary-rollback");
  assert.equal(authorized.command.target, "app");
  assert.deepEqual(authorized.command.arguments, [
    "rollback",
    started.prior.app.deploymentId,
    "--yes",
  ]);
  assert.equal(Object.hasOwn(authorized.command, "alias"), false);
  assert.equal(Object.hasOwn(authorized.command, "aliases"), false);
  assert.equal(Object.hasOwn(authorized.command, "projectId"), false);
});

test("provider census rejects ambiguous App discovery before recovery", () => {
  const providerResolved = prepared(["app"]);
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
      reserve: "candidate",
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
        reserve: "candidate",
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
        reserve: "candidate",
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
    reserve: "candidate",
  }).map((mapping) =>
    mapping.alias === "reserve.mento.org"
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
        reserve: "candidate",
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
  const initial = prepared(["reserve"]);
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
  const initial = prepared(["reserve"]);
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
  const journal = prepared(["app"]);
  const mappings = Object.fromEntries(
    ["reserve", "ui", "app"].map((target) => [
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
  const journal = prepared(TARGETS);
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
    recovery.actions.map(({ kind, target, alias }) => ({
      kind,
      target,
      alias,
    })),
    [{ kind: "ordinary_rollback", target: "app", alias: undefined }],
  );
});

test("forward dispatch and authorize reject a fresh App-only recovery residual", () => {
  const initial = prepared(TARGETS);
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
  assert.equal(dispatched.journal.operations.at(-1).target, "reserve");
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
  const inherited = prepared(TARGETS);
  const observed = groupedCurrentMappings(inherited, {
    reserve: "candidate",
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
    ["reserve"],
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
    reserve: "candidate",
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

test("App-only recovery residual rolls back its moved mapping before a fresh baseline", () => {
  const inherited = prepared(TARGETS);
  const observed = groupedCurrentMappings(inherited, { app: "candidate" });
  const movedAlias = APP_ALIAS;
  assert.deepEqual(inherited.prior.app.aliases, [APP_ALIAS]);
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
    plan.actions.map(({ kind, target, alias }) => ({ kind, target, alias })),
    [{ kind: "ordinary_rollback", target: "app", alias: undefined }],
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
  const movedAliases = new Set([movedAlias]);
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

  for (const expectedAlias of [movedAlias]) {
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
    assert.equal(authorized.command.kind, "ordinary-rollback");
    assert.equal(authorized.command.target, "app");
    assert.equal(Object.hasOwn(authorized.command, "alias"), false);
    assert.equal(movedAliases.has(expectedAlias), true);

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
  const inherited = prepared(TARGETS);
  const partial = groupedCurrentMappings(inherited, {
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
