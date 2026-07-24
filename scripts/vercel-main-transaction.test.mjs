import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MAIN_TRANSACTION_MODE,
  MAIN_TRANSACTION_REPOSITORY,
  MainTransactionError,
  assertMainTransactionJournal,
  assertMainTransactionJournalHistory,
  attachDiscoveredAppCandidate,
  classifyMainTransactionMapping,
  createMainTransactionId,
  createPreparedMainTransactionJournal,
  decideMainTransactionRecovery,
  executeJournaledMainMutation,
  executeMainTransactionRecovery,
  mainTransactionJournalArtifactName,
  markMainTransactionCommitted,
  persistMainTransactionJournal,
  planMainTransactionRecovery,
  recordMainTransactionCommandReturned,
  recordMainTransactionVerified,
  resolveUniqueAppTransactionCandidate,
  runMainTransaction,
  selectHighestMainTransactionJournal,
  startMainTransactionOperation,
} from "./vercel-main-transaction.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "abcdef0123456789abcdef0123456789abcdef01";
const identity = Object.freeze({
  repository: MAIN_TRANSACTION_REPOSITORY,
  deploySha: SHA,
  runId: "987654321",
  runAttempt: "2",
});

function deploymentRecord(name, aliases) {
  return {
    deploymentId: `dpl_${name}Prior123`,
    deploymentUrl: `https://${name}-prior.vercel.app`,
    aliases: [...aliases].sort(),
  };
}

function candidateRecord(name, aliases) {
  return {
    deploymentId: `dpl_${name}Candidate123`,
    deploymentUrl: `https://${name}-candidate.vercel.app`,
    aliases: [...aliases].sort(),
    discovery: null,
  };
}

function priorState() {
  return {
    app: deploymentRecord("app", [
      "app.mento.org",
      "appmentoorg-env-v3-mentolabs.vercel.app",
    ]),
    governance: deploymentRecord("governance", [
      "governance.mento.org",
      "governancementoorg-mentolabs.vercel.app",
    ]),
    reserve: deploymentRecord("reserve", [
      "reserve.mento.org",
      "reservementoorg-mentolabs.vercel.app",
    ]),
    ui: deploymentRecord("ui", [
      "ui.mento.org",
      "uimentoorg-mentolabs.vercel.app",
    ]),
    "legacy-app": deploymentRecord("legacy", ["v2-app.mento.org"]),
  };
}

function appDiscovery() {
  return {
    projectId: "prj_app123",
    projectName: "app.mento.org",
    deploySha: SHA,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    transactionId: createMainTransactionId(identity),
    customEnvironmentSlug: "v3",
  };
}

function candidateState({ app = "unknown" } = {}) {
  const prior = priorState();
  return {
    app:
      app === null
        ? null
        : {
            deploymentId: app === "known" ? "dpl_appCandidate123" : null,
            deploymentUrl:
              app === "known" ? "https://app-candidate.vercel.app" : null,
            aliases: [...prior.app.aliases],
            discovery: appDiscovery(),
          },
    governance: candidateRecord("governance", prior.governance.aliases),
    reserve: candidateRecord("reserve", prior.reserve.aliases),
    ui: candidateRecord("ui", prior.ui.aliases),
  };
}

function prepared(options = {}) {
  return createPreparedMainTransactionJournal({
    ...identity,
    mode: options.mode ?? "active",
    prior: priorState(),
    candidates: candidateState(options),
  });
}

function appCandidateMatch(overrides = {}) {
  return {
    deploymentId: "dpl_appCandidate123",
    deploymentUrl: "https://app-candidate.vercel.app",
    ...appDiscovery(),
    ...overrides,
  };
}

function mapping(alias, record) {
  return {
    alias,
    deploymentId: record.deploymentId,
    deploymentUrl: record.deploymentUrl,
  };
}

function currentMappings(journal, overrides = {}) {
  return Object.values(journal.prior).flatMap((record) =>
    record.aliases.map((alias) => {
      const selected = overrides[alias] ?? record;
      return mapping(alias, selected);
    }),
  );
}

function acknowledgedUploader(log = []) {
  return async ({ artifactName, journal, retentionDays }) => {
    log.push({
      kind: "upload",
      artifactName,
      sequence: journal.sequence,
      status: journal.status,
      retentionDays,
      journal,
    });
    return { acknowledged: true, artifactName };
  };
}

function transitionSuccessfulOperation(journal, intent) {
  const started = startMainTransactionOperation(journal, intent);
  const operationId = started.operations.at(-1).operationId;
  const returned = recordMainTransactionCommandReturned(started, {
    operationId,
    outcome: "success",
  });
  return {
    started,
    returned,
    verified: recordMainTransactionVerified(returned, {
      operationId,
      mappingState: "candidate",
    }),
  };
}

test("transaction ID is deterministic and binds only immutable run identity", () => {
  const transactionId = createMainTransactionId(identity);
  assert.match(transactionId, /^main-[a-f0-9]{32}$/);
  assert.equal(transactionId, createMainTransactionId({ ...identity }));
  assert.notEqual(
    transactionId,
    createMainTransactionId({ ...identity, runAttempt: "3" }),
  );
  assert.notEqual(
    transactionId,
    createMainTransactionId({ ...identity, deploySha: OTHER_SHA }),
  );
  assert.throws(
    () =>
      createMainTransactionId({
        ...identity,
        repository: "fork/frontend-monorepo",
      }),
    /repository is unexpected/,
  );
});

test("prepared journal is canonical, redacted, and names an immutable artifact", () => {
  const journal = prepared();
  assert.equal(journal.schema, 1);
  assert.equal(journal.sequence, 0);
  assert.equal(journal.status, "prepared");
  assert.equal(journal.runId, identity.runId);
  assert.equal(journal.runAttempt, identity.runAttempt);
  assert.equal(journal.candidates.app.deploymentId, null);
  assert.equal(
    mainTransactionJournalArtifactName(journal),
    `vercel-main-journal-${journal.transactionId}-000000`,
  );
  assert.doesNotMatch(
    JSON.stringify(journal),
    /token|secret|authorization|cookie|header|environmentValue/i,
  );

  assert.throws(
    () => assertMainTransactionJournal({ ...journal, token: "forbidden" }),
    /forbidden or missing fields/,
  );
  assert.throws(
    () =>
      assertMainTransactionJournal({
        ...journal,
        prior: {
          ...journal.prior,
          app: { ...journal.prior.app, rawResponse: {} },
        },
      }),
    /forbidden or missing fields/,
  );
  assert.throws(
    () =>
      createPreparedMainTransactionJournal({
        ...identity,
        mode: "active",
        prior: priorState(),
        candidates: {
          ...candidateState(),
          app: {
            ...candidateState().app,
            discovery: {
              ...appDiscovery(),
              transactionId: "main-00000000000000000000000000000000",
            },
          },
        },
      }),
    /does not match the journal identity/,
  );
});

test("static fixture remains compatible with the canonical journal schema", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/vercel-main-transaction/prepared-shadow.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const canonical = assertMainTransactionJournal(fixture);
  assert.equal(canonical.mode, "shadow");
  assert.equal(canonical.status, "prepared");
  assert.equal(canonical.transactionId, createMainTransactionId(canonical));
});

test("operation snapshots form an append-only monotonic history", () => {
  const initial = prepared({ app: "known" });
  const { started, returned, verified } = transitionSuccessfulOperation(
    initial,
    { type: "promote", target: "governance" },
  );
  const committed = markMainTransactionCommitted(verified);
  const history = [initial, started, returned, verified, committed];

  assert.equal(
    selectHighestMainTransactionJournal(history).status,
    "committed",
  );
  assert.deepEqual(decideMainTransactionRecovery(history), {
    decision: "bypass",
    reason: "committed",
    journal: committed,
  });
  assert.equal(started.operations[0].state, "started");
  assert.equal(returned.operations[1].state, "command_returned");
  assert.equal(verified.operations[2].state, "verified");
  assert.deepEqual(
    returned.operations.slice(0, started.operations.length),
    started.operations,
  );

  assert.throws(
    () => assertMainTransactionJournalHistory([initial, returned]),
    /sequence is missing or duplicated/,
  );
  assert.throws(
    () =>
      assertMainTransactionJournalHistory([
        initial,
        {
          ...started,
          operations: [
            { ...started.operations[0], priorDeploymentId: "dpl_rewritten" },
          ],
        },
      ]),
    /differs from the journal|rewritten/,
  );
  assert.throws(
    () =>
      selectHighestMainTransactionJournal(history, {
        runId: "123",
      }),
    /does not match the expected identity/,
  );
  assert.throws(
    () =>
      assertMainTransactionJournal({
        ...verified,
        operations: verified.operations.map((operation, index) =>
          index === verified.operations.length - 1
            ? { ...operation, commandOutcome: "unknown" }
            : operation,
        ),
      }),
    /command outcome changed/,
  );
});

test("known app candidate may only evolve once from exact discovery metadata", () => {
  const initial = prepared();
  const attached = attachDiscoveredAppCandidate(initial, appCandidateMatch());
  assert.equal(attached.sequence, 1);
  assert.equal(attached.candidates.app.deploymentId, "dpl_appCandidate123");
  assert.deepEqual(
    resolveUniqueAppTransactionCandidate(initial, [appCandidateMatch()]),
    attached.candidates.app,
  );
  assert.throws(
    () => resolveUniqueAppTransactionCandidate(initial, []),
    /exactly one match/,
  );
  assert.throws(
    () =>
      resolveUniqueAppTransactionCandidate(initial, [
        appCandidateMatch(),
        appCandidateMatch({
          deploymentId: "dpl_appCandidate456",
          deploymentUrl: "https://app-candidate-two.vercel.app",
        }),
      ]),
    /exactly one match/,
  );
  assert.throws(
    () =>
      attachDiscoveredAppCandidate(
        initial,
        appCandidateMatch({ deploySha: OTHER_SHA }),
      ),
    /does not match discovery metadata/,
  );
});

test("app candidate command return uses one monotonic journal sequence", () => {
  const initial = prepared();
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const returned = recordMainTransactionCommandReturned(started, {
    operationId: started.operations.at(-1).operationId,
    outcome: "success",
    candidate: appCandidateMatch(),
  });
  assert.equal(started.sequence, 1);
  assert.equal(returned.sequence, 2);
  assert.equal(returned.candidates.app.deploymentId, "dpl_appCandidate123");
  assert.doesNotThrow(() =>
    assertMainTransactionJournalHistory([initial, started, returned]),
  );
});

test("journal upload acknowledgement is exact and uses seven-day retention", async () => {
  const journal = prepared();
  const uploads = [];
  await persistMainTransactionJournal(journal, acknowledgedUploader(uploads));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].retentionDays, 7);
  assert.equal(
    uploads[0].artifactName,
    mainTransactionJournalArtifactName(journal),
  );
  await assert.rejects(
    persistMainTransactionJournal(journal, async ({ artifactName }) => ({
      acknowledged: true,
      artifactName: `${artifactName}-wrong`,
    })),
    (error) =>
      error instanceof MainTransactionError &&
      error.code === "JOURNAL_UPLOAD_NOT_ACKNOWLEDGED",
  );
});

test("started journal is durably acknowledged before mutation callback", async () => {
  const events = [];
  const journal = await executeJournaledMainMutation({
    journal: prepared({ app: "known" }),
    intent: { type: "promote", target: "governance" },
    uploadJournal: async (payload) => {
      events.push(`upload:${payload.journal.status}`);
      return { acknowledged: true, artifactName: payload.artifactName };
    },
    assertFreshness: async ({ phase }) => {
      events.push(`fresh:${phase}`);
      return { sha: SHA };
    },
    executeMutation: async () => {
      events.push("mutate");
      return { outcome: "success" };
    },
    inspectMutationState: async ({ phase }) => {
      events.push(`mapping:${phase}`);
      return { mappingState: "prior" };
    },
    verifyMapping: async () => {
      events.push("verify");
      return { mappingState: "candidate" };
    },
  });
  assert.equal(journal.status, "verified");
  assert.deepEqual(events, [
    "fresh:pre-operation",
    "mapping:pre-operation",
    "upload:started",
    "fresh:pre-command",
    "mapping:pre-command",
    "mutate",
    "upload:command_returned",
    "fresh:post-command",
    "verify",
    "upload:verified",
  ]);
});

test("upload failure prevents mutation and leaves only prior durable state", async () => {
  let mutations = 0;
  await assert.rejects(
    executeJournaledMainMutation({
      journal: prepared({ app: "known" }),
      intent: { type: "promote", target: "governance" },
      uploadJournal: async () => {
        throw new Error("artifact service unavailable");
      },
      assertFreshness: async () => ({ sha: SHA }),
      executeMutation: async () => {
        mutations += 1;
        return { outcome: "success" };
      },
      inspectMutationState: async () => ({ mappingState: "prior" }),
      verifyMapping: async () => ({ mappingState: "candidate" }),
    }),
    (error) =>
      error instanceof MainTransactionError &&
      error.code === "JOURNAL_UPLOAD_FAILED",
  );
  assert.equal(mutations, 0);
});

test("main advancing before an operation performs no mutation", async () => {
  let uploads = 0;
  let mutations = 0;
  await assert.rejects(
    executeJournaledMainMutation({
      journal: prepared({ app: "known" }),
      intent: { type: "promote", target: "governance" },
      uploadJournal: async () => {
        uploads += 1;
      },
      assertFreshness: async () => ({ sha: OTHER_SHA }),
      executeMutation: async () => {
        mutations += 1;
      },
      inspectMutationState: async () => ({ mappingState: "prior" }),
      verifyMapping: async () => ({ mappingState: "prior" }),
    }),
    (error) =>
      error instanceof MainTransactionError &&
      error.code === "SUPERSEDED_DURING_MUTATION",
  );
  assert.equal(uploads, 0);
  assert.equal(mutations, 0);
});

test("main advancing after started upload hands recovery a durable operation", async () => {
  let mutations = 0;
  const uploads = [];
  await assert.rejects(
    executeJournaledMainMutation({
      journal: prepared({ app: "known" }),
      intent: { type: "promote", target: "governance" },
      uploadJournal: acknowledgedUploader(uploads),
      assertFreshness: async ({ phase }) => ({
        sha: phase === "pre-command" ? OTHER_SHA : SHA,
      }),
      executeMutation: async () => {
        mutations += 1;
      },
      inspectMutationState: async () => ({ mappingState: "prior" }),
      verifyMapping: async () => ({ mappingState: "prior" }),
    }),
    (error) => {
      assert.equal(error.code, "SUPERSEDED_DURING_MUTATION");
      assert.equal(error.journal.status, "started");
      return true;
    },
  );
  assert.equal(mutations, 0);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].status, "started");
});

test("protected mapping drift before command prevents the mutation callback", async () => {
  let mutations = 0;
  let inspections = 0;
  const uploads = [];
  await assert.rejects(
    executeJournaledMainMutation({
      journal: prepared({ app: "known" }),
      intent: { type: "promote", target: "governance" },
      uploadJournal: acknowledgedUploader(uploads),
      assertFreshness: async () => ({ sha: SHA }),
      inspectMutationState: async () => {
        inspections += 1;
        return {
          mappingState: inspections === 1 ? "prior" : "unexpected",
        };
      },
      executeMutation: async () => {
        mutations += 1;
        return { outcome: "success" };
      },
      verifyMapping: async () => ({ mappingState: "prior" }),
    }),
    (error) => {
      assert.equal(error.code, "PROTECTED_MAPPING_DRIFT");
      assert.equal(error.journal.status, "started");
      return true;
    },
  );
  assert.equal(mutations, 0);
  assert.equal(uploads.length, 1);
});

test("main advancing during or after a command forces recovery", async () => {
  let currentSha = SHA;
  const uploads = [];
  await assert.rejects(
    executeJournaledMainMutation({
      journal: prepared({ app: "known" }),
      intent: { type: "promote", target: "governance" },
      uploadJournal: acknowledgedUploader(uploads),
      assertFreshness: async () => ({ sha: currentSha }),
      executeMutation: async () => {
        currentSha = OTHER_SHA;
        return { outcome: "success" };
      },
      inspectMutationState: async () => ({ mappingState: "prior" }),
      verifyMapping: async () => ({ mappingState: "candidate" }),
    }),
    (error) => {
      assert.equal(error.code, "SUPERSEDED_DURING_MUTATION");
      assert.equal(error.journal.status, "verified");
      return true;
    },
  );
  assert.deepEqual(
    uploads.map((entry) => entry.status),
    ["started", "command_returned", "verified"],
  );
});

test("a successful forward command that leaves the prior mapping cannot pass verification", async () => {
  await assert.rejects(
    executeJournaledMainMutation({
      journal: prepared({ app: "known" }),
      intent: { type: "promote", target: "ui" },
      uploadJournal: acknowledgedUploader(),
      assertFreshness: async () => ({ sha: SHA }),
      inspectMutationState: async () => ({ mappingState: "prior" }),
      executeMutation: async () => ({ outcome: "success" }),
      verifyMapping: async () => ({ mappingState: "prior" }),
    }),
    (error) => {
      assert.equal(error.code, "MUTATION_VERIFICATION_FAILED");
      assert.equal(error.journal.operations.at(-1).mappingState, "prior");
      return true;
    },
  );
});

for (const commandCase of [
  {
    name: "nonzero return",
    execute: async () => ({ outcome: "nonzero" }),
  },
  {
    name: "timeout return",
    execute: async () => ({ outcome: "timeout" }),
  },
  {
    name: "lost output",
    execute: async () => undefined,
  },
  {
    name: "runner callback error",
    execute: async () => {
      throw new Error("runner lost");
    },
  },
]) {
  test(`${commandCase.name} is an unknown outcome and remains failed`, async () => {
    await assert.rejects(
      executeJournaledMainMutation({
        journal: prepared({ app: "known" }),
        intent: { type: "promote", target: "reserve" },
        uploadJournal: acknowledgedUploader(),
        assertFreshness: async () => ({ sha: SHA }),
        executeMutation: commandCase.execute,
        inspectMutationState: async () => ({ mappingState: "prior" }),
        verifyMapping: async () => ({ mappingState: "prior" }),
      }),
      (error) => {
        assert.equal(error.code, "MUTATION_OUTCOME_UNKNOWN");
        assert.equal(error.journal.status, "verified");
        assert.equal(error.journal.operations.at(-1).commandOutcome, "unknown");
        assert.equal(error.journal.operations.at(-1).mappingState, "prior");
        return true;
      },
    );
  });
}

test("a cancellation after started persistence is recoverable by a separate job", async () => {
  const initial = prepared({ app: "known" });
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const uploads = [];
  await persistMainTransactionJournal(started, acknowledgedUploader(uploads));

  const decision = decideMainTransactionRecovery([initial, started]);
  assert.equal(decision.decision, "recover");
  assert.equal(decision.reason, "incomplete-mutation-journal");
  assert.equal(uploads[0].status, "started");
});

test("mapping classifier distinguishes prior, candidate, partial, and unexpected", () => {
  const journal = prepared({ app: "known" });
  const prior = journal.prior.governance;
  const candidate = journal.candidates.governance;
  const aliases = prior.aliases;
  const classify = (records) =>
    classifyMainTransactionMapping({
      aliases,
      currentMappings: records,
      prior,
      candidate,
    });
  assert.equal(
    classify(aliases.map((alias) => mapping(alias, prior))),
    "prior",
  );
  assert.equal(
    classify(aliases.map((alias) => mapping(alias, candidate))),
    "candidate",
  );
  assert.equal(
    classify([mapping(aliases[0], prior), mapping(aliases[1], candidate)]),
    "partial",
  );
  assert.equal(
    classify([
      mapping(aliases[0], prior),
      mapping(aliases[1], {
        deploymentId: "dpl_operator123",
        deploymentUrl: "https://operator.vercel.app",
      }),
    ]),
    "unexpected",
  );
});

test("ordinary recovery is planned and executed in reverse activation order", async () => {
  const snapshots = [prepared({ app: "known" })];
  let highest = snapshots[0];
  for (const target of ["governance", "reserve", "ui"]) {
    const transitions = transitionSuccessfulOperation(highest, {
      type: "promote",
      target,
    });
    snapshots.push(
      transitions.started,
      transitions.returned,
      transitions.verified,
    );
    highest = transitions.verified;
  }
  const overrides = Object.fromEntries(
    ["governance", "reserve", "ui"].flatMap((target) =>
      highest.prior[target].aliases.map((alias) => [
        alias,
        highest.candidates[target],
      ]),
    ),
  );
  const plan = planMainTransactionRecovery({
    journal: highest,
    currentMappings: currentMappings(highest, overrides),
  });
  assert.equal(plan.decision, "recover");
  assert.deepEqual(
    plan.actions.map((entry) => `${entry.kind}:${entry.target}`),
    [
      "ordinary_rollback:ui",
      "ordinary_rollback:reserve",
      "ordinary_rollback:governance",
    ],
  );
  assert.deepEqual(plan.rollbackStateTargets, ["ui", "reserve", "governance"]);
  assert.ok(plan.actions.every((entry) => entry.entersRollbackState));

  const calls = [];
  const recovered = await executeMainTransactionRecovery({
    plan,
    uploadJournal: acknowledgedUploader(),
    ordinaryRollback: async (entry) => {
      calls.push(`rollback:${entry.target}:${entry.priorDeploymentId}`);
      return { outcome: "success" };
    },
    restoreAppAlias: async () => {
      throw new Error("unreachable");
    },
    restoreLegacyAlias: async () => {
      throw new Error("unreachable");
    },
    inspectMapping: async () => ({ mappingState: "candidate" }),
    verifyMapping: async (entry) => {
      calls.push(`verify:${entry.target}`);
      return { mappingState: "prior" };
    },
  });
  assert.deepEqual(
    calls.map((entry) => entry.split(":").slice(0, 2).join(":")),
    [
      "rollback:ui",
      "verify:ui",
      "rollback:reserve",
      "verify:reserve",
      "rollback:governance",
      "verify:governance",
    ],
  );
  assert.equal(recovered.status, "recovered");
  const rollbackEvents = recovered.operations.filter(
    (operation) =>
      operation.type === "ordinary_rollback" && operation.state === "verified",
  );
  assert.equal(rollbackEvents.length, 3);
  assert.ok(
    rollbackEvents.every((operation) => operation.rollbackState === "entered"),
  );
});

test("partial ordinary movement preserves possible operator intervention", () => {
  const initial = prepared({ app: "known" });
  const { started } = transitionSuccessfulOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const aliases = started.prior.governance.aliases;
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [aliases[0]]: started.prior.governance,
      [aliases[1]]: started.candidates.governance,
    }),
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.equal(plan.actions[0].kind, "manual_intervention");
  assert.equal(plan.actions[0].mappingState, "partial");
});

test("manual intervention on one target does not skip safe reverse recovery elsewhere", async () => {
  let highest = prepared({ app: "known" });
  for (const target of ["governance", "reserve"]) {
    highest = transitionSuccessfulOperation(highest, {
      type: "promote",
      target,
    }).verified;
  }
  const governanceAlias = highest.prior.governance.aliases[0];
  const overrides = Object.fromEntries(
    highest.prior.reserve.aliases.map((alias) => [
      alias,
      highest.candidates.reserve,
    ]),
  );
  overrides[governanceAlias] = {
    deploymentId: "dpl_operator123",
    deploymentUrl: "https://operator.vercel.app",
  };
  const plan = planMainTransactionRecovery({
    journal: highest,
    currentMappings: currentMappings(highest, overrides),
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.equal(plan.actions[0].kind, "ordinary_rollback");
  assert.ok(plan.actions.some((entry) => entry.kind === "manual_intervention"));

  const calls = [];
  const result = await executeMainTransactionRecovery({
    plan,
    uploadJournal: acknowledgedUploader(),
    ordinaryRollback: async (entry) => {
      calls.push(entry.target);
      return { outcome: "success" };
    },
    inspectMapping: async () => ({ mappingState: "candidate" }),
    verifyMapping: async () => ({ mappingState: "prior" }),
  });
  assert.deepEqual(calls, ["reserve"]);
  assert.equal(result.status, "manual_intervention");
});

test("app recovery restores only exact transaction-candidate aliases", () => {
  const initial = prepared();
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const returned = recordMainTransactionCommandReturned(started, {
    operationId: started.operations.at(-1).operationId,
    outcome: "success",
    candidate: appCandidateMatch(),
  });
  const aliases = returned.prior.app.aliases;
  const plan = planMainTransactionRecovery({
    journal: returned,
    currentMappings: currentMappings(returned, {
      [aliases[0]]: returned.prior.app,
      [aliases[1]]: returned.candidates.app,
    }),
  });
  assert.equal(plan.decision, "recover");
  const appActions = plan.actions.filter((entry) => entry.target === "app");
  assert.deepEqual(
    appActions.map((entry) => [entry.kind, entry.alias]),
    [
      ["app_alias_restore", aliases[1]],
      ["verified_noop", aliases[0]],
    ],
  );
  assert.equal(
    appActions[0].priorDeploymentUrl,
    returned.prior.app.deploymentUrl,
  );
  assert.equal(
    appActions[0].candidateDeploymentId,
    returned.candidates.app.deploymentId,
  );
});

test("unknown app candidate is required only after an app mapping moved", () => {
  const initial = prepared();
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const priorPlan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started),
    appCandidateMatches: [],
  });
  assert.equal(priorPlan.decision, "recover");
  assert.ok(priorPlan.actions.every((entry) => entry.kind === "verified_noop"));

  const movedAlias = started.prior.app.aliases[0];
  const movedMappings = currentMappings(started, {
    [movedAlias]: {
      deploymentId: "dpl_appCandidate123",
      deploymentUrl: "https://app-candidate.vercel.app",
    },
  });
  for (const matches of [
    [],
    [
      appCandidateMatch(),
      appCandidateMatch({
        deploymentId: "dpl_appCandidate456",
        deploymentUrl: "https://app-candidate-two.vercel.app",
      }),
    ],
  ]) {
    const plan = planMainTransactionRecovery({
      journal: started,
      currentMappings: movedMappings,
      appCandidateMatches: matches,
    });
    assert.equal(plan.decision, "manual_intervention");
    assert.equal(plan.reason, "app-candidate-ambiguous-after-mapping-moved");
  }
  const unique = planMainTransactionRecovery({
    journal: started,
    currentMappings: movedMappings,
    appCandidateMatches: [appCandidateMatch()],
  });
  assert.equal(unique.decision, "recover");
  assert.equal(
    unique.actions.find((entry) => entry.alias === movedAlias).kind,
    "app_alias_restore",
  );
});

test("unexpected app mapping is never overwritten", () => {
  const initial = prepared({ app: "known" });
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const alias = started.prior.app.aliases[0];
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [alias]: {
        deploymentId: "dpl_operator123",
        deploymentUrl: "https://operator.vercel.app",
      },
    }),
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.equal(
    plan.actions.find((entry) => entry.alias === alias).kind,
    "manual_intervention",
  );
});

test("legacy v2 is untouched normally and restored only from the exact app candidate", () => {
  const initial = prepared({ app: "known" });
  const started = startMainTransactionOperation(initial, {
    type: "app_v3_deploy",
    target: "app",
  });
  const legacyAlias = started.prior["legacy-app"].aliases[0];
  const untouched = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started),
  });
  assert.equal(
    untouched.actions.find((entry) => entry.alias === legacyAlias).kind,
    "verified_noop",
  );

  const emergency = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [legacyAlias]: started.candidates.app,
    }),
  });
  const restore = emergency.actions.find(
    (entry) => entry.alias === legacyAlias,
  );
  assert.equal(restore.kind, "legacy_emergency_restore");
  assert.equal(
    restore.priorDeploymentUrl,
    started.prior["legacy-app"].deploymentUrl,
  );
  assert.equal(emergency.forceFailure, true);
  assert.equal(emergency.reason, "legacy-alias-moved-to-transaction-candidate");

  const operator = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [legacyAlias]: {
        deploymentId: "dpl_operator123",
        deploymentUrl: "https://operator.vercel.app",
      },
    }),
  });
  assert.equal(operator.decision, "manual_intervention");
});

test("recovered and committed histories bypass repeat recovery", () => {
  const initial = prepared({ app: "known" });
  const committed = markMainTransactionCommitted(initial);
  assert.equal(
    decideMainTransactionRecovery([initial, committed]).decision,
    "bypass",
  );
  const verificationOnly = decideMainTransactionRecovery([initial]);
  assert.equal(verificationOnly.decision, "verify-only");
});

test("shadow execution exercises preparation, freshness, persistence, and recovery decision only", async () => {
  const events = [];
  const forbidden = () => {
    events.push("MUTATION");
    throw new Error("unreachable");
  };
  const result = await runMainTransaction({
    mode: MAIN_TRANSACTION_MODE,
    identity,
    prior: priorState(),
    candidates: candidateState(),
    assertFreshness: async ({ phase }) => {
      events.push(`fresh:${phase}`);
      return { sha: SHA };
    },
    uploadJournal: async (payload) => {
      events.push(`upload:${payload.journal.status}`);
      return { acknowledged: true, artifactName: payload.artifactName };
    },
    inspectRecoveryState: async ({ decision }) => {
      events.push(`recovery:${decision}`);
    },
    mutationAdapters: {
      promote: forbidden,
      deployAppV3: forbidden,
      assignAlias: forbidden,
      ordinaryRollback: forbidden,
      restoreAppAlias: forbidden,
      restoreLegacyAlias: forbidden,
    },
  });
  assert.equal(result.outcome, "shadow-prepared");
  assert.equal(result.mutationCallbacksCalled, 0);
  assert.deepEqual(events, [
    "fresh:transaction-start",
    "upload:prepared",
    "recovery:verify-only",
  ]);
});

test("shadow transaction superseded at start persists nothing", async () => {
  let uploads = 0;
  await assert.rejects(
    runMainTransaction({
      mode: "shadow",
      identity,
      prior: priorState(),
      candidates: candidateState(),
      assertFreshness: async () => ({ sha: OTHER_SHA }),
      uploadJournal: async () => {
        uploads += 1;
      },
    }),
    (error) =>
      error instanceof MainTransactionError &&
      error.code === "SUPERSEDED_BEFORE_MUTATION",
  );
  assert.equal(uploads, 0);
});

test("active mode and every mutation callback remain unreachable in PR A", async () => {
  let callbacks = 0;
  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: priorState(),
      candidates: candidateState(),
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: acknowledgedUploader(),
      mutationAdapters: {
        promote: () => {
          callbacks += 1;
        },
      },
    }),
    /unreachable in PR A/,
  );
  assert.equal(callbacks, 0);
});
