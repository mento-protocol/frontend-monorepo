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
  executeMainActiveCommand,
  loadMainActiveJournalHistory,
  reduceMainActiveRecoveryTransition,
  reduceMainActiveTransition,
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
  startMainTransactionOperation,
} from "./vercel-main-transaction.mjs";

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

function candidate(name, aliases) {
  return {
    deploymentId: `dpl_${name}Candidate123`,
    deploymentUrl: `https://${name}-candidate.vercel.app`,
    aliases: [...aliases].sort(),
    discovery: null,
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
    "legacy-app": record("legacy", ["v2-app.mento.org"]),
  };
}

function prepared(activeTargets, { appKnown = false } = {}) {
  const captured = prior();
  const transactionIdentity = {
    repository: MAIN_TRANSACTION_REPOSITORY,
    deploySha: SHA,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
  };
  return createPreparedMainTransactionJournal({
    ...transactionIdentity,
    mode: "active",
    prior: captured,
    candidates: {
      app: activeTargets.includes("app")
        ? {
            deploymentId: appKnown ? "dpl_appCandidate123" : null,
            deploymentUrl: appKnown ? "https://app-candidate.vercel.app" : null,
            aliases: [...captured.app.aliases],
            discovery: {
              projectId: "prj_app123",
              projectName: "app.mento.org",
              deploySha: SHA,
              runId: RUN_ID,
              runAttempt: RUN_ATTEMPT,
              transactionId: createPreparedMainTransactionJournal({
                ...transactionIdentity,
                mode: "active",
                prior: captured,
                candidates: {
                  app: null,
                  governance: null,
                  reserve: null,
                  ui: null,
                },
              }).transactionId,
              customEnvironmentSlug: "v3",
            },
          }
        : null,
      governance: activeTargets.includes("governance")
        ? candidate("governance", captured.governance.aliases)
        : null,
      reserve: activeTargets.includes("reserve")
        ? candidate("reserve", captured.reserve.aliases)
        : null,
      ui: activeTargets.includes("ui")
        ? candidate("ui", captured.ui.aliases)
        : null,
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
          ? target === "app"
            ? {
                mentoTransactionId: spec.transactionId,
                mentoRunId: spec.runId,
                mentoRunAttempt: spec.runAttempt,
                mentoNextDeploymentId: "nextBuild123",
              }
            : {
                mentoTransaction: `${spec.runId}-${spec.runAttempt}-${target}`,
              }
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
  const spec = {
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha: journal.deploySha,
    runId: journal.runId,
    runAttempt: journal.runAttempt,
    transactionId: journal.transactionId,
    mainOwnershipMode,
    stagedTargets,
    activeTargets,
    shadowTargets,
    projects,
    legacyAppV2: {
      alias: legacy.aliases[0],
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
      source: "git",
      state: {
        alias: legacy.aliases[0],
        deploymentId: legacy.deploymentId,
        deploymentUrl: legacy.deploymentUrl,
        creatorUsername: null,
        projectId: PROJECT_IDS.app,
        projectName: "app.mento.org",
        readyState: "READY",
        target: "production",
        customEnvironmentSlug: null,
        git: { ...spec.legacyAppV2.git },
        aliases: [legacy.aliases[0]],
      },
    },
  });
}

function publicSmokes(activeTargets) {
  return Object.fromEntries(
    TARGETS.map((target) => [
      target,
      activeTargets.includes(target)
        ? {
            status: "passed",
            publicUrl: `https://${target === "app" ? "app" : target}.mento.org/`,
            servedSha: SHA,
          }
        : {
            status: "not-required",
            publicUrl: `https://${target === "app" ? "app" : target}.mento.org/`,
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
      appCandidateMatches: [],
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

test("shadow final mapping accepts proven native or prior and rejects stage or third deployment", () => {
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
    nativeOwners: { reserve: nativeReserve },
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
  assert.equal(finalize(nativeReserve).journal.status, "committed");
  assert.equal(finalize(initial.prior.reserve).journal.status, "committed");
  for (const forbidden of [
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

test("lost App output attaches a discovered candidate in its own snapshot", () => {
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
  assert.match(authorized.command.nextDeploymentId, /^m-app-[a-f0-9]{19}$/);
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
  const match = {
    deploymentId: "dpl_appCandidate123",
    deploymentUrl: "https://app-candidate.vercel.app",
    ...initial.candidates.app.discovery,
  };
  const attached = reduceForward(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: SHA,
      currentMappings: currentMappings(history.at(-1)),
      appCandidateMatches: [match],
      appDeployment: {
        deploymentId: match.deploymentId,
        deploymentUrl: match.deploymentUrl,
        readyState: "READY",
      },
    }),
    ["app"],
  );
  assert.equal(attached.journal.sequence, returned.journal.sequence + 1);
  assert.equal(attached.journal.status, returned.journal.status);
  assert.equal(
    attached.journal.operations.length,
    returned.journal.operations.length,
  );
  assert.equal(
    attached.journal.candidates.app.deploymentId,
    "dpl_appCandidate123",
  );
  assert.equal(attached.afterUploadAction, "verify");
});

test("recovery checkpoints a discovered App candidate before its second initialize", () => {
  const initial = prepared(["app"]);
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const movedMappings = currentMappings(started).map((mapping) =>
    started.prior.app.aliases.includes(mapping.alias)
      ? {
          ...mapping,
          deploymentId: "dpl_appCandidate123",
          deploymentUrl: "https://app-candidate.vercel.app",
        }
      : mapping,
  );
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: movedMappings,
    appCandidateMatches: [
      {
        deploymentId: "dpl_appCandidate123",
        deploymentUrl: "https://app-candidate.vercel.app",
        ...initial.candidates.app.discovery,
      },
    ],
  });
  assert.equal(plan.decision, "recover");
  assert.notEqual(plan.discoveredAppCandidate, null);
  const discovered = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history: [initial, started],
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(started),
    }),
  });
  assert.equal(discovered.afterUploadAction, "initialize");
  assert.equal(
    discovered.journal.candidates.app.deploymentId,
    "dpl_appCandidate123",
  );
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history: [initial, started, discovered.journal],
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(discovered.journal),
    }),
  });
  assert.equal(recovering.journal.status, "recovering");
  assert.equal(recovering.afterUploadAction, "dispatch");
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
      currentMappings: currentMappings(history.at(-1), {
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
      currentMappings: currentMappings(history.at(-1), {
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
      currentMappings: currentMappings(history.at(-1)),
    }),
  });
  history.push(verified.journal);
  const terminal = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history,
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      currentMappings: currentMappings(history.at(-1)),
    }),
  });
  assert.equal(terminal.journal, null);
  assert.equal(terminal.transitionKind, "recovery-verification-incomplete");
  assert.equal(terminal.nextAction, "fail-after-evidence");
  assert.equal(terminal.possibleMutationCommands, 2);
  assert.equal(terminal.confirmedMutationCommands, 2);
});

test("ambiguous moved App recovery persists manual intervention", () => {
  const initial = prepared(["app"]);
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const movedMappings = currentMappings(started).map((mapping) =>
    started.prior.app.aliases.includes(mapping.alias)
      ? {
          ...mapping,
          deploymentId: "dpl_appCandidate123",
          deploymentUrl: "https://app-candidate.vercel.app",
        }
      : mapping,
  );
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: movedMappings,
    appCandidateMatches: [],
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.equal(plan.reason, "app-candidate-ambiguous-after-mapping-moved");
  const recovering = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history: [initial, started],
    event: recoveryEvent("initialize", {
      uploadReceipt: receipt(started),
    }),
  });
  const manual = reduceMainActiveRecoveryTransition({
    recoveryPlan: plan,
    history: [initial, started, recovering.journal],
    event: recoveryEvent("dispatch", {
      uploadReceipt: receipt(recovering.journal),
      currentMappings: movedMappings,
    }),
  });
  assert.equal(manual.journal.status, "manual_intervention");
  assert.equal(manual.afterUploadAction, "fail-after-evidence");
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
      currentMappings: currentMappings(history.at(-1), {
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
      currentMappings: currentMappings(history.at(-1), {
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
  const unexpectedMappings = currentMappings(history.at(-1), {
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
      currentMappings: currentMappings(history.at(-1), {
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
