import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import * as mainTransactionModule from "./vercel-main-transaction.mjs";
import {
  MAIN_TRANSACTION_MODE,
  MAIN_TRANSACTION_REPOSITORY,
  MainTransactionError,
  assertMainInheritedTransactionRecoveryPlan,
  assertMainTransactionJournal,
  assertMainTransactionJournalHistory,
  assertMainTransactionRecoveryPlan,
  classifyMainTransactionMapping,
  createMainTransactionId,
  createPreparedMainTransactionJournal as createPreparedMainTransactionJournalImpl,
  decideMainTransactionRecovery,
  executeJournaledMainMutation,
  executeMainTransactionRecovery,
  finishMainTransactionRecovery,
  mainTransactionJournalArtifactName,
  markMainTransactionCommitted,
  persistMainTransactionJournal,
  planInheritedMainTransactionRecovery,
  expectedVerifiedMappingStateFor,
  isProductionShapedPrior,
  planMainTransactionRecovery,
  recordMainTransactionCommandReturned,
  recordMainTransactionVerified,
  runMainTransaction as runMainTransactionImpl,
  selectHighestMainTransactionJournal,
  startMainTransactionOperation,
  startInheritedMainTransactionRecovery,
  startMainTransactionRecovery,
} from "./vercel-main-transaction.mjs";
import {
  MAIN_TARGET_CONTRACTS,
  TRANSITIONAL_APP_PRIOR_ENVIRONMENT,
  TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS,
} from "./vercel-main-plan.mjs";
import {
  createMainReleaseManifest,
  MAIN_RELEASE_ACTIVATION_ORDER,
} from "./vercel-main-release-reconciliation.mjs";
import { createMainCandidateIntent } from "./vercel-main-candidate.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "abcdef0123456789abcdef0123456789abcdef01";
const identity = Object.freeze({
  repository: MAIN_TRANSACTION_REPOSITORY,
  deploySha: SHA,
  runId: "987654321",
  runAttempt: "2",
});
const TARGET_ORDER = Object.freeze(["app", "governance", "reserve", "ui"]);

function deploymentRecord(name, aliases) {
  return {
    deploymentId: `dpl_${name}Prior123`,
    deploymentUrl: `https://${name}-prior.vercel.app`,
    aliases: [...aliases].sort(),
  };
}

// `environment` overrides the shape of the deployment the reviewed aliases
// served before this release. Only the TRANSITION-V3-PRIOR App prior uses it.
function releasePrior(target, environment) {
  const contract = MAIN_TARGET_CONTRACTS[target];
  const aliases = [...contract.aliases].sort();
  const shared = {
    deploymentId: `dpl_${target}Prior123`,
    deploymentUrl: `https://${target}-prior.vercel.app`,
    aliases,
    projectId: `prj_${target}123`,
    projectName: contract.projectName,
    readyState: "READY",
    target: environment === undefined ? contract.target : environment.target,
    customEnvironmentSlug:
      environment === undefined
        ? contract.customEnvironmentSlug
        : environment.customEnvironmentSlug,
  };
  return {
    ...shared,
    planningLeaves: aliases.map((alias) => ({
      alias,
      ...shared,
      git: {
        status: "complete",
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: OTHER_SHA,
      },
    })),
    servedSha: OTHER_SHA,
  };
}

function releasePlan(activeTargets = TARGET_ORDER, mode = "active") {
  const active =
    mode === "shadow"
      ? []
      : TARGET_ORDER.filter((target) => activeTargets.includes(target));
  const shadow = TARGET_ORDER.filter((target) => !active.includes(target));
  return {
    schema: "vercel-main-plan:v2",
    mode,
    mainOwnershipMode: Object.fromEntries(
      TARGET_ORDER.map((target) => [
        target,
        active.includes(target) ? "github" : "shadow",
      ]),
    ),
    deploySha: SHA,
    stagedTargets: [...TARGET_ORDER],
    activeTargets: active,
    shadowTargets: shadow,
    plan: [...TARGET_ORDER],
    priors: TARGET_ORDER.map((target) => ({
      target,
      deploymentId: `dpl_${target}Prior123`,
      deploymentUrl: `https://${target}-prior.vercel.app`,
      aliases: [...MAIN_TARGET_CONTRACTS[target].aliases],
      servedSha: OTHER_SHA,
    })),
    ranges: [
      {
        base: OTHER_SHA,
        head: SHA,
        kind: "served",
        reason: "global-build-input",
        targets: [...TARGET_ORDER],
        deployments: [...TARGET_ORDER],
      },
    ],
    reasons: TARGET_ORDER.map((target) => ({
      target,
      base: OTHER_SHA,
      reason: "global-build-input",
    })),
  };
}

function releaseForTargets(
  activeTargets = TARGET_ORDER,
  mode = "active",
  priorEnvironments = {},
) {
  return createMainReleaseManifest({
    upstreamRunId: "700",
    plan: releasePlan(activeTargets, mode),
    originalPriors: Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
        target,
        releasePrior(target, priorEnvironments[target]),
      ]),
    ),
  });
}

// TRANSITION-V3-PRIOR
// The first activation after the cutover still finds `app.mento.org` assigned
// to the retiring `v3` custom environment, so the App prior is v3-shaped.
function releaseWithV3AppPrior(activeTargets = TARGET_ORDER) {
  return releaseForTargets(activeTargets, "active", {
    app: TRANSITIONAL_APP_PRIOR_ENVIRONMENT,
  });
}

function candidateDiscovery(target, releaseManifest) {
  const prior = releaseManifest.originalPriors[target];
  return {
    releaseId: releaseManifest.releaseId,
    candidateId: `candidate-${target}-700`,
    projectId: prior.projectId,
    projectName: prior.projectName,
    deploySha: SHA,
    target,
    customEnvironmentSlug: null,
    immutableSmoke: {
      immutableUrl: `https://${target}-candidate.vercel.app`,
      servedSha: SHA,
      status: "passed",
    },
    metrics: {
      buildDurationMs: null,
      deploymentDurationMs: null,
      cacheHit: null,
    },
  };
}

function candidateRecord(name, aliases, releaseManifest) {
  return {
    deploymentId: `dpl_${name}Candidate123`,
    deploymentUrl: `https://${name}-candidate.vercel.app`,
    aliases: [...aliases].sort(),
    discovery: candidateDiscovery(name, releaseManifest),
  };
}

function priorState() {
  return {
    app: deploymentRecord("app", ["app.mento.org"]),
    governance: deploymentRecord("governance", ["governance.mento.org"]),
    reserve: deploymentRecord("reserve", ["reserve.mento.org"]),
    ui: deploymentRecord("ui", ["ui.mento.org"]),
  };
}

function appDiscovery(releaseManifest = releaseForTargets()) {
  return candidateDiscovery("app", releaseManifest);
}

function candidateState(
  { app = true } = {},
  activeTargets = TARGET_ORDER,
  mode = "active",
) {
  const prior = priorState();
  const releaseManifest = releaseForTargets(activeTargets, mode);
  const selected = new Set(mode === "shadow" ? [] : activeTargets);
  return {
    app:
      app === null || app === false || !selected.has("app")
        ? null
        : {
            deploymentId: "dpl_appCandidate123",
            deploymentUrl: "https://app-candidate.vercel.app",
            aliases: [...prior.app.aliases],
            discovery: appDiscovery(releaseManifest),
          },
    governance: selected.has("governance")
      ? candidateRecord("governance", prior.governance.aliases, releaseManifest)
      : null,
    reserve: selected.has("reserve")
      ? candidateRecord("reserve", prior.reserve.aliases, releaseManifest)
      : null,
    ui: selected.has("ui")
      ? candidateRecord("ui", prior.ui.aliases, releaseManifest)
      : null,
  };
}

function startMappingsAtPrior(prior) {
  return Object.fromEntries(
    Object.entries(prior).map(([target, record]) => [
      target,
      record.aliases.map((alias) => mapping(alias, record)),
    ]),
  );
}

function selectedTargets(candidates, mode) {
  return mode === "shadow"
    ? []
    : TARGET_ORDER.filter((target) => candidates[target] !== null);
}

function createPreparedMainTransactionJournal(options) {
  const mode = options.mode ?? "active";
  const release =
    options.release ??
    releaseForTargets(selectedTargets(options.candidates, mode), mode);
  return createPreparedMainTransactionJournalImpl({
    ...options,
    mode,
    release,
    startMappings: options.startMappings ?? startMappingsAtPrior(options.prior),
  });
}

function runMainTransaction(options) {
  const mode = options.mode ?? MAIN_TRANSACTION_MODE;
  const candidates =
    mode === "shadow"
      ? { app: null, governance: null, reserve: null, ui: null }
      : options.candidates;
  const release =
    options.release ??
    releaseForTargets(selectedTargets(candidates, mode), mode);
  return runMainTransactionImpl({
    ...options,
    mode,
    release,
    candidates,
    startMappings: options.startMappings ?? startMappingsAtPrior(options.prior),
  });
}

function prepared(options = {}) {
  const mode = options.mode ?? "active";
  const activeTargets = mode === "shadow" ? [] : TARGET_ORDER;
  return createPreparedMainTransactionJournal({
    ...identity,
    mode,
    prior: priorState(),
    candidates: candidateState(options, activeTargets, mode),
  });
}

function preparedForTargets(targets, options = {}) {
  const mode = options.mode ?? "active";
  const candidates = candidateState(options, targets, mode);
  const prior = options.prior ?? priorState();
  const startMappings = options.startMappings ?? startMappingsAtPrior(prior);
  return createPreparedMainTransactionJournal({
    ...identity,
    mode,
    prior,
    startMappings,
    candidates,
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

// The retired pending-App shape: a candidate record that names no staged
// provider deployment yet. Every selected target now stages one before
// activation, so preparing this shape must fail.
function preparedPendingApp() {
  const release = releaseForTargets(["app"]);
  const prior = priorState();
  const intent = createMainCandidateIntent({
    target: "app",
    deploySha: release.deploySha,
    upstreamRunId: release.upstreamRunId,
    originRunId: identity.runId,
    originAttempt: identity.runAttempt,
    originTransactionId: createMainTransactionId(identity),
    projectId: release.originalPriors.app.projectId,
    projectName: release.originalPriors.app.projectName,
    releaseManifest: release,
  });
  const discovery = {
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
  };
  return createPreparedMainTransactionJournalImpl({
    ...identity,
    mode: "active",
    release,
    prior,
    startMappings: startMappingsAtPrior(prior),
    candidates: {
      app: {
        deploymentId: null,
        deploymentUrl: null,
        aliases: prior.app.aliases,
        discovery,
      },
      governance: null,
      reserve: null,
      ui: null,
    },
  });
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
    return {
      acknowledged: true,
      artifactName,
      artifactId: String(1000 + journal.sequence),
    };
  };
}

function activeMutationHarness({
  appAliasMovedByPromote = false,
  unexpectedAppAliasAfterPromote = null,
  onProtectedInspection,
} = {}) {
  const prior = priorState();
  const candidates = candidateState();
  const knownAppCandidate = candidates.app;
  const events = [];
  const mappings = new Map(
    Object.values(prior).flatMap((record) =>
      record.aliases.map((alias) => [alias, mapping(alias, record)]),
    ),
  );

  const operationMappingState = (context) => {
    const operation = context.operation ?? context.intent;
    const target = operation.target;
    const aliases =
      operation.alias === null || operation.alias === undefined
        ? prior[target].aliases
        : [operation.alias];
    return classifyMainTransactionMapping({
      aliases,
      currentMappings: aliases.map((alias) => mappings.get(alias)),
      prior: prior[target],
      candidate: candidates[target],
    });
  };

  return {
    prior,
    candidates,
    events,
    mappings,
    mutationAdapters: {
      promote: async ({ operation }) => {
        events.push(`mutate:${operation.type}:${operation.target}`);
        // TRANSITION-V3-PRIOR: an App promote leaves the reviewed App
        // domain at its prior because that domain is still assigned to the
        // retiring custom environment; the bridge alias set moves it.
        if (operation.target === "app") {
          if (appAliasMovedByPromote) {
            for (const alias of prior.app.aliases) {
              mappings.set(alias, mapping(alias, knownAppCandidate));
            }
          }
          if (unexpectedAppAliasAfterPromote !== null) {
            mappings.set(
              unexpectedAppAliasAfterPromote,
              mapping(unexpectedAppAliasAfterPromote, {
                deploymentId: "dpl_operator123",
                deploymentUrl: "https://operator.vercel.app",
              }),
            );
          }
          return { outcome: "success" };
        }
        for (const alias of prior[operation.target].aliases) {
          mappings.set(alias, mapping(alias, candidates[operation.target]));
        }
        return { outcome: "success" };
      },
      assignAlias: async ({ operation }) => {
        events.push(
          `mutate:${operation.type}:${operation.target}:${operation.alias}`,
        );
        mappings.set(
          operation.alias,
          mapping(operation.alias, knownAppCandidate),
        );
        return { outcome: "success" };
      },
      inspectMapping: async (context) => ({
        mappingState: operationMappingState(context),
      }),
      verifyMapping: async (context) => ({
        mappingState: operationMappingState(context),
      }),
      inspectProtectedMappings: async (context) => {
        await onProtectedInspection?.({
          ...context,
          mappings,
          prior,
          candidates,
          knownAppCandidate,
        });
        return {
          currentMappings: [...mappings.values()],
        };
      },
    },
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
    // TRANSITION-V3-PRIOR: an App promote is verified at `prior`, every other
    // forward operation at `candidate`.
    verified: recordMainTransactionVerified(returned, {
      operationId,
      mappingState: expectedVerifiedMappingStateFor(intent),
    }),
  };
}

function plannedOrdinaryRecovery(targets = ["governance"]) {
  let highest = prepared({ app: "known" });
  for (const target of targets) {
    highest = transitionSuccessfulOperation(highest, {
      type: "promote",
      target,
    }).verified;
  }
  const overrides = Object.fromEntries(
    targets.flatMap((target) =>
      highest.prior[target].aliases.map((alias) => [
        alias,
        highest.candidates[target],
      ]),
    ),
  );
  return planMainTransactionRecovery({
    journal: highest,
    currentMappings: currentMappings(highest, overrides),
  });
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
  assert.equal(journal.schema, 3);
  assert.equal(journal.sequence, 0);
  assert.equal(journal.status, "prepared");
  assert.equal(journal.runId, identity.runId);
  assert.equal(journal.runAttempt, identity.runAttempt);
  assert.equal(journal.candidates.app.deploymentId, "dpl_appCandidate123");
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
              releaseId: "mr-wrong-release",
            },
          },
        },
      }),
    /does not match stable provider identity/,
  );
  // Every selected target, App included, stages its provider deployment
  // before activation, so a candidate without one is rejected outright.
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
            deploymentId: null,
            deploymentUrl: null,
          },
        },
      }),
    /Candidate app must identify the staged deployment/,
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
  assert.equal(canonical.mode, "active");
  assert.equal(canonical.status, "prepared");
  assert.equal(canonical.transactionId, createMainTransactionId(canonical));
});

test("operation snapshots form an append-only monotonic history", () => {
  const initial = preparedForTargets(["governance"], { app: "known" });
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

test("operation event fields must match the constructor state", () => {
  const initial = preparedForTargets(["governance"], { app: "known" });
  const { started, returned, verified } = transitionSuccessfulOperation(
    initial,
    { type: "promote", target: "governance" },
  );
  const cases = [
    {
      journal: {
        ...started,
        operations: [
          {
            ...started.operations[0],
            commandOutcome: "success",
          },
        ],
      },
      pattern: /fields are inconsistent/,
    },
    {
      journal: {
        ...returned,
        operations: returned.operations.map((operation, index) =>
          index === returned.operations.length - 1
            ? { ...operation, mappingState: "candidate" }
            : operation,
        ),
      },
      pattern: /fields are inconsistent/,
    },
    {
      journal: {
        ...verified,
        operations: verified.operations.map((operation, index) =>
          index === verified.operations.length - 1
            ? { ...operation, mappingState: null }
            : operation,
        ),
      },
      pattern: /fields are inconsistent/,
    },
    {
      journal: {
        ...verified,
        operations: verified.operations.map((operation, index) =>
          index === verified.operations.length - 1
            ? { ...operation, rollbackState: "entered" }
            : operation,
        ),
      },
      pattern: /Rollback marker requires/,
    },
    {
      journal: {
        ...started,
        status: "recovering",
        operations: [
          {
            ...started.operations[0],
            state: "recovering",
          },
        ],
      },
      pattern: /state is unsupported/,
    },
  ];
  for (const { journal, pattern } of cases) {
    assert.throws(() => assertMainTransactionJournal(journal), pattern);
  }
});

test("adjacent journal snapshots append exactly one helper-legal event", () => {
  const initial = preparedForTargets(["governance"], { app: "known" });
  const { started, returned, verified } = transitionSuccessfulOperation(
    initial,
    {
      type: "promote",
      target: "governance",
    },
  );
  assert.throws(
    () =>
      assertMainTransactionJournalHistory([
        initial,
        { ...returned, sequence: 1 },
      ]),
    /batched operation events/,
  );
  assert.throws(
    () =>
      assertMainTransactionJournalHistory([
        initial,
        { ...started, status: "command_returned" },
      ]),
    /differs from its legal helper append/,
  );

  // Candidates are staged before activation, so no snapshot may attach or
  // evolve one, and a snapshot that appends no event must be a legal status
  // transition.
  const appInitial = preparedForTargets(["app"]);
  assert.throws(
    () =>
      assertMainTransactionJournalHistory([
        appInitial,
        {
          ...appInitial,
          sequence: appInitial.sequence + 1,
          candidates: {
            ...appInitial.candidates,
            app: {
              ...appInitial.candidates.app,
              deploymentId: "dpl_appCandidate456",
              deploymentUrl: "https://app-candidate-two.vercel.app",
            },
          },
        },
      ]),
    /Journal candidates changed after preparation/,
  );
  assert.throws(
    () =>
      assertMainTransactionJournalHistory([
        appInitial,
        {
          ...appInitial,
          sequence: appInitial.sequence + 1,
          status: "verified",
        },
      ]),
    /did not append one legal event/,
  );

  const duplicate = {
    ...verified,
    sequence: verified.sequence + 1,
    status: "started",
    operations: [
      ...verified.operations,
      {
        ...started.operations[0],
        operationId: "op-0002",
      },
    ],
  };
  assert.throws(
    () =>
      assertMainTransactionJournalHistory([
        initial,
        started,
        returned,
        verified,
        duplicate,
      ]),
    /already recorded/,
  );
});

test("forged terminal artifacts cannot bypass transaction recovery", () => {
  const selected = preparedForTargets(["governance"], { app: "known" });
  assert.throws(
    () =>
      decideMainTransactionRecovery([
        selected,
        { ...selected, sequence: 1, status: "committed" },
      ]),
    /incomplete operations/,
  );

  const { started, returned, verified } = transitionSuccessfulOperation(
    selected,
    { type: "promote", target: "governance" },
  );
  for (const status of ["recovered", "manual_intervention"]) {
    assert.throws(
      () =>
        decideMainTransactionRecovery([
          selected,
          started,
          returned,
          verified,
          {
            ...verified,
            sequence: verified.sequence + 1,
            status,
          },
        ]),
      /requires a recovering snapshot/,
    );
  }
});

test("recovery status helpers expose one legal durable transition at a time", () => {
  const selected = preparedForTargets(["governance"], { app: "known" });
  const forwardTransition = transitionSuccessfulOperation(selected, {
    type: "promote",
    target: "governance",
  });
  const forward = forwardTransition.verified;
  const recovering = startMainTransactionRecovery(forward);
  assert.equal(recovering.status, "recovering");
  assert.equal(recovering.sequence, forward.sequence + 1);

  const rollbackStarted = startMainTransactionOperation(recovering, {
    type: "ordinary_rollback",
    target: "governance",
  });
  assert.throws(
    () => finishMainTransactionRecovery(rollbackStarted),
    /cannot finish/,
  );
  const rollbackReturned = recordMainTransactionCommandReturned(
    rollbackStarted,
    {
      operationId: rollbackStarted.operations.at(-1).operationId,
      outcome: "success",
    },
  );
  const rollbackVerified = recordMainTransactionVerified(rollbackReturned, {
    operationId: rollbackReturned.operations.at(-1).operationId,
    mappingState: "prior",
    rollbackState: "entered",
  });
  const recovered = finishMainTransactionRecovery(rollbackVerified);
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.sequence, rollbackVerified.sequence + 1);
  assert.deepEqual(
    assertMainTransactionJournalHistory([
      selected,
      forwardTransition.started,
      forwardTransition.returned,
      forwardTransition.verified,
      recovering,
      rollbackStarted,
      rollbackReturned,
      rollbackVerified,
      recovered,
    ]).at(-1),
    recovered,
  );
});

test("recovery status helpers reject recovery-free and repeated terminals", () => {
  const selected = preparedForTargets(["governance"], { app: "known" });
  assert.throws(
    () => startMainTransactionRecovery(selected),
    /does not require/,
  );
  const forward = transitionSuccessfulOperation(selected, {
    type: "promote",
    target: "governance",
  }).verified;
  assert.throws(
    () => finishMainTransactionRecovery(forward),
    /was not started/,
  );
  const terminal = finishMainTransactionRecovery(
    startMainTransactionRecovery(forward),
    { manualIntervention: true },
  );
  assert.equal(terminal.status, "manual_intervention");
  assert.throws(() => finishMainTransactionRecovery(terminal), /cannot finish/);
});

test("operation starts are phase-gated before any mutation descriptor exists", () => {
  const selected = preparedForTargets(["governance", "reserve"], {
    app: "known",
  });
  assert.throws(
    () =>
      startMainTransactionOperation(selected, {
        type: "ordinary_rollback",
        target: "governance",
      }),
    /not allowed in this transaction phase/,
  );

  const governanceForward = transitionSuccessfulOperation(selected, {
    type: "promote",
    target: "governance",
  }).verified;
  const forward = transitionSuccessfulOperation(governanceForward, {
    type: "promote",
    target: "reserve",
  }).verified;
  const recovering = startMainTransactionRecovery(forward);
  assert.throws(
    () =>
      startMainTransactionOperation(recovering, {
        type: "promote",
        target: "governance",
      }),
    /not allowed in this transaction phase/,
  );

  const rollbackStarted = startMainTransactionOperation(recovering, {
    type: "ordinary_rollback",
    target: "governance",
  });
  const rollbackReturned = recordMainTransactionCommandReturned(
    rollbackStarted,
    {
      operationId: rollbackStarted.operations.at(-1).operationId,
      outcome: "success",
    },
  );
  const rollbackVerified = recordMainTransactionVerified(rollbackReturned, {
    operationId: rollbackReturned.operations.at(-1).operationId,
    mappingState: "prior",
    rollbackState: "entered",
  });
  assert.doesNotThrow(() =>
    startMainTransactionOperation(rollbackVerified, {
      type: "ordinary_rollback",
      target: "reserve",
    }),
  );
});

test("commit requires one verified forward operation for every selected candidate", () => {
  const selected = preparedForTargets(["governance", "reserve"], {
    app: "known",
  });
  assert.throws(
    () => markMainTransactionCommitted(selected),
    /incomplete operations/,
  );

  const governanceVerified = transitionSuccessfulOperation(selected, {
    type: "promote",
    target: "governance",
  }).verified;
  assert.throws(
    () => markMainTransactionCommitted(governanceVerified),
    /incomplete operations/,
  );

  let fullyVerified = preparedForTargets(
    ["app", "governance", "reserve", "ui"],
    { app: "known" },
  );
  for (const intent of [
    { type: "promote", target: "governance" },
    { type: "promote", target: "reserve" },
    { type: "promote", target: "ui" },
    { type: "promote", target: "app" },
  ]) {
    fullyVerified = transitionSuccessfulOperation(
      fullyVerified,
      intent,
    ).verified;
  }
  assert.equal(markMainTransactionCommitted(fullyVerified).status, "committed");
});

test("commit requires mutations only for ordinary targets that started at prior", () => {
  const prior = priorState();
  const candidates = candidateState({ app: "known" }, [
    "governance",
    "reserve",
  ]);
  const startMappings = startMappingsAtPrior(prior);
  startMappings.governance = prior.governance.aliases.map((alias) =>
    mapping(alias, candidates.governance),
  );
  const selected = preparedForTargets(["governance", "reserve"], {
    app: "known",
    prior,
    startMappings,
  });
  const reserveVerified = transitionSuccessfulOperation(selected, {
    type: "promote",
    target: "reserve",
  }).verified;
  assert.equal(
    reserveVerified.operations.some(
      (operation) => operation.target === "governance",
    ),
    false,
  );
  assert.equal(
    markMainTransactionCommitted(reserveVerified).status,
    "committed",
  );
});

// Replaces the retired "pending App candidate cannot commit" guard: an App
// candidate that names no staged deployment can no longer be prepared at all.
test("selected app commit requires its exact staged candidate", () => {
  const selected = preparedForTargets(["app"]);
  assert.equal(selected.candidates.app.deploymentId, "dpl_appCandidate123");
  assert.deepEqual(
    selected.candidates.app.discovery,
    appDiscovery(selected.release),
  );
  assert.throws(
    () => preparedPendingApp(),
    /Candidate app must identify the staged deployment/,
  );
  assert.throws(
    () =>
      startMainTransactionOperation(preparedForTargets([]), {
        type: "promote",
        target: "app",
      }),
    /Every operation binds its exact staged candidate/,
  );
});

test("app alias completeness is a final mapping-verification boundary", () => {
  const selected = preparedForTargets(["app"], { app: "known" });
  const appVerified = transitionSuccessfulOperation(selected, {
    type: "promote",
    target: "app",
  }).verified;
  assert.equal(
    appVerified.operations.some(
      (operation) => operation.type === "app_alias_set",
    ),
    false,
  );
  assert.equal(markMainTransactionCommitted(appVerified).status, "committed");
});

// TRANSITION-V3-PRIOR
test("App promote verifies at prior and its bridge alias set verifies at candidate", () => {
  assert.equal(
    expectedVerifiedMappingStateFor({ type: "promote", target: "app" }),
    "prior",
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.equal(
      expectedVerifiedMappingStateFor({ type: "promote", target }),
      "candidate",
    );
  }
  for (const operation of [
    { type: "app_alias_set", target: "app" },
    { type: "app_alias_restore", target: "app" },
    { type: "ordinary_rollback", target: "app" },
  ]) {
    assert.equal(expectedVerifiedMappingStateFor(operation), "candidate");
  }

  const initial = preparedForTargets(["app"]);
  const alias = initial.prior.app.aliases[0];
  const promoted = transitionSuccessfulOperation(initial, {
    type: "promote",
    target: "app",
  }).verified;
  assert.deepEqual(
    [
      promoted.operations.at(-1).type,
      promoted.operations.at(-1).commandOutcome,
      promoted.operations.at(-1).mappingState,
    ],
    ["promote", "success", "prior"],
  );
  const bridged = transitionSuccessfulOperation(promoted, {
    type: "app_alias_set",
    target: "app",
    alias,
  }).verified;
  assert.deepEqual(
    [
      bridged.operations.at(-1).type,
      bridged.operations.at(-1).alias,
      bridged.operations.at(-1).mappingState,
    ],
    ["app_alias_set", alias, "candidate"],
  );
  assert.equal(markMainTransactionCommitted(bridged).status, "committed");

  // An App promote that reached the candidate is not a verified App promote.
  const movedPromote = transitionSuccessfulOperation(initial, {
    type: "promote",
    target: "app",
  }).returned;
  assert.throws(
    () =>
      markMainTransactionCommitted(
        recordMainTransactionVerified(movedPromote, {
          operationId: movedPromote.operations.at(-1).operationId,
          mappingState: "candidate",
        }),
      ),
    /incomplete operations/,
  );
});

test("duplicate forward mutations are rejected after a verified attempt", () => {
  const ordinary = transitionSuccessfulOperation(
    preparedForTargets(["governance"], { app: "known" }),
    { type: "promote", target: "governance" },
  ).verified;
  assert.throws(
    () =>
      startMainTransactionOperation(ordinary, {
        type: "promote",
        target: "governance",
      }),
    /already recorded/,
  );
  assert.throws(
    () =>
      startMainTransactionOperation(preparedForTargets([], { app: "known" }), {
        type: "promote",
        target: "app",
      }),
    /Every operation binds its exact staged candidate/,
  );

  const appDeploy = transitionSuccessfulOperation(
    preparedForTargets(["app"], { app: "known" }),
    { type: "promote", target: "app" },
  ).verified;
  assert.throws(
    () =>
      startMainTransactionOperation(appDeploy, {
        type: "promote",
        target: "app",
      }),
    /already recorded/,
  );

  const alias = appDeploy.prior.app.aliases[0];
  const aliasVerified = transitionSuccessfulOperation(appDeploy, {
    type: "app_alias_set",
    target: "app",
    alias,
  }).verified;
  assert.throws(
    () =>
      startMainTransactionOperation(aliasVerified, {
        type: "app_alias_set",
        target: "app",
        alias,
      }),
    /already recorded/,
  );
});

// Replaces the retired "candidate discovered during activation" model: the
// staging apparatus is gone and no activation command may introduce one.
test("app candidate is staged at preparation and never discovered later", () => {
  for (const name of [
    "attachDiscoveredAppCandidate",
    "attachMainTransactionAppCandidateReceipt",
    "resolveUniqueAppTransactionCandidate",
  ]) {
    assert.equal(mainTransactionModule[name], undefined, name);
  }
  const initial = prepared();
  assert.equal(initial.candidates.app.deploymentId, "dpl_appCandidate123");
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "app",
  });
  assert.throws(
    () =>
      recordMainTransactionCommandReturned(started, {
        operationId: started.operations.at(-1).operationId,
        outcome: "success",
        candidate: appCandidateMatch(),
      }),
    /Activation commands never discover a candidate/,
  );
});

test("app activation events use one monotonic journal sequence", () => {
  const initial = prepared();
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "app",
  });
  const returned = recordMainTransactionCommandReturned(started, {
    operationId: started.operations.at(-1).operationId,
    outcome: "success",
  });
  assert.equal(started.sequence, 1);
  assert.equal(returned.sequence, 2);
  assert.deepEqual(returned.candidates, initial.candidates);
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
      artifactId: "1000",
    })),
    (error) =>
      error instanceof MainTransactionError &&
      error.code === "JOURNAL_UPLOAD_NOT_ACKNOWLEDGED",
  );
});

for (const [name, artifactId] of [
  ["missing", undefined],
  ["zero", "0"],
  ["negative", "-1"],
  ["non-numeric", "artifact-123"],
]) {
  test(`journal upload rejects a ${name} immutable artifact ID`, async () => {
    const journal = prepared();
    await assert.rejects(
      persistMainTransactionJournal(journal, async ({ artifactName }) => ({
        acknowledged: true,
        artifactName,
        ...(artifactId === undefined ? {} : { artifactId }),
      })),
      (error) =>
        error instanceof MainTransactionError &&
        error.code === "JOURNAL_UPLOAD_NOT_ACKNOWLEDGED",
    );
  });
}

test("started journal is durably acknowledged before mutation callback", async () => {
  const events = [];
  const journal = await executeJournaledMainMutation({
    journal: prepared({ app: "known" }),
    intent: { type: "promote", target: "governance" },
    uploadJournal: async (payload) => {
      events.push(`upload:${payload.journal.status}`);
      return {
        acknowledged: true,
        artifactName: payload.artifactName,
        artifactId: String(1000 + payload.journal.sequence),
      };
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

test("every forward upload failure exposes only the last durable journal", async () => {
  const expectedDurable = [
    { sequence: 0, status: "prepared", mutations: 0 },
    { sequence: 1, status: "started", mutations: 1 },
    { sequence: 2, status: "command_returned", mutations: 1 },
  ];
  for (const [index, expected] of expectedDurable.entries()) {
    let attempts = 0;
    let mutations = 0;
    await assert.rejects(
      executeJournaledMainMutation({
        journal: prepared({ app: "known" }),
        intent: { type: "promote", target: "governance" },
        uploadJournal: async ({ artifactName, journal }) => {
          attempts += 1;
          if (attempts === index + 1) {
            throw new Error("artifact upload interrupted");
          }
          return {
            acknowledged: true,
            artifactName,
            artifactId: String(1000 + journal.sequence),
          };
        },
        assertFreshness: async () => ({ sha: SHA }),
        executeMutation: async () => {
          mutations += 1;
          return { outcome: "success" };
        },
        inspectMutationState: async () => ({ mappingState: "prior" }),
        verifyMapping: async () => ({ mappingState: "candidate" }),
      }),
      (error) => {
        assert.equal(error.code, "JOURNAL_UPLOAD_FAILED");
        assert.equal(error.journal.sequence, expected.sequence);
        assert.equal(error.journal.status, expected.status);
        return true;
      },
    );
    assert.equal(mutations, expected.mutations);
  }
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
  const prior = journal.prior.app;
  const candidate = journal.candidates.app;
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
    classify([
      mapping(aliases[0], {
        deploymentId: "dpl_operator123",
        deploymentUrl: "https://operator.vercel.app",
      }),
    ]),
    "unexpected",
  );

  // Every reviewed target now maps exactly one alias, so `partial` and a
  // mixed `unexpected` are only reachable through the classifier's own
  // multi-alias contract.
  const multiPrior = deploymentRecord("multi", [
    "multi-one.mento.org",
    "multi-two.mento.org",
  ]);
  const multiCandidate = {
    deploymentId: "dpl_multiCandidate123",
    deploymentUrl: "https://multi-candidate.vercel.app",
    aliases: [...multiPrior.aliases],
  };
  const classifyMulti = (records) =>
    classifyMainTransactionMapping({
      aliases: multiPrior.aliases,
      currentMappings: records,
      prior: multiPrior,
      candidate: multiCandidate,
    });
  assert.equal(
    classifyMulti([
      mapping(multiPrior.aliases[0], multiPrior),
      mapping(multiPrior.aliases[1], multiCandidate),
    ]),
    "partial",
  );
  assert.equal(
    classifyMulti([
      mapping(multiPrior.aliases[0], multiPrior),
      mapping(multiPrior.aliases[1], {
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
    inspectMapping: async (_entry, context) => ({
      mappingState: context.phase === "recovery-final" ? "prior" : "candidate",
    }),
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

test("forged recovery action fields never reach inspection or mutation adapters", async () => {
  const basePlan = plannedOrdinaryRecovery(["governance", "reserve"]);
  const mutations = [
    ["target", (plan) => (plan.actions[0].target = "governance")],
    ["operation ID", (plan) => (plan.actions[0].operationId = "op-0001")],
    [
      "prior deployment ID",
      (plan) => (plan.actions[0].priorDeploymentId = "dpl_attackerPrior123"),
    ],
    [
      "prior deployment URL",
      (plan) =>
        (plan.actions[0].priorDeploymentUrl =
          "https://attacker-prior.vercel.app"),
    ],
    [
      "candidate deployment ID",
      (plan) =>
        (plan.actions[0].candidateDeploymentId = "dpl_attackerCandidate123"),
    ],
    [
      "candidate deployment URL",
      (plan) =>
        (plan.actions[0].candidateDeploymentUrl =
          "https://attacker-candidate.vercel.app"),
    ],
    ["action order", (plan) => plan.actions.reverse()],
    ["action kind", (plan) => (plan.actions[0].kind = "verified_noop")],
    ["extra field", (plan) => (plan.actions[0].operator = "attacker")],
    ["missing field", (plan) => delete plan.actions[0].candidateDeploymentUrl],
    [
      "rollback aliases",
      (plan) => (plan.actions[0].aliases = ["attacker.mento.org"]),
    ],
    [
      "rollback marker",
      (plan) => (plan.actions[0].entersRollbackState = false),
    ],
  ];
  for (const [name, tamper] of mutations) {
    const plan = structuredClone(basePlan);
    tamper(plan);
    let inspections = 0;
    let adapterCalls = 0;
    let uploads = 0;
    await assert.rejects(
      executeMainTransactionRecovery({
        plan,
        uploadJournal: async () => {
          uploads += 1;
        },
        ordinaryRollback: async () => {
          adapterCalls += 1;
        },
        restoreAppAlias: async () => {
          adapterCalls += 1;
        },
        inspectMapping: async () => {
          inspections += 1;
          return { mappingState: "candidate" };
        },
        verifyMapping: async () => ({ mappingState: "prior" }),
      }),
      undefined,
      name,
    );
    assert.equal(inspections, 0, name);
    assert.equal(adapterCalls, 0, name);
    assert.equal(uploads, 0, name);
  }

  const appStarted = startMainTransactionOperation(
    preparedForTargets(["app"], { app: "known" }),
    {
      type: "app_alias_set",
      target: "app",
      alias: priorState().app.aliases[0],
    },
  );
  const movedAlias = appStarted.prior.app.aliases[0];
  const appPlan = planMainTransactionRecovery({
    journal: appStarted,
    currentMappings: currentMappings(appStarted, {
      [movedAlias]: appStarted.candidates.app,
    }),
  });
  const restore = appPlan.actions.find(
    (entry) => entry.kind === "app_alias_restore",
  );
  restore.alias = "app-forged.mento.org";
  let appInspections = 0;
  await assert.rejects(
    executeMainTransactionRecovery({
      plan: appPlan,
      uploadJournal: acknowledgedUploader(),
      restoreAppAlias: async () => ({ outcome: "success" }),
      inspectMapping: async () => {
        appInspections += 1;
        return { mappingState: "candidate" };
      },
      verifyMapping: async () => ({ mappingState: "prior" }),
    }),
  );
  assert.equal(appInspections, 0);
});

test("every recovery upload failure exposes only the last durable journal", async () => {
  const plan = plannedOrdinaryRecovery();
  const expectedDurable = [
    { offset: 0, status: "verified", mutations: 0, finalInspections: 0 },
    { offset: 1, status: "recovering", mutations: 0, finalInspections: 0 },
    { offset: 2, status: "started", mutations: 1, finalInspections: 0 },
    {
      offset: 3,
      status: "command_returned",
      mutations: 1,
      finalInspections: 0,
    },
    { offset: 4, status: "verified", mutations: 1, finalInspections: 1 },
  ];
  for (const [index, expected] of expectedDurable.entries()) {
    let attempts = 0;
    let mutations = 0;
    let finalInspections = 0;
    await assert.rejects(
      executeMainTransactionRecovery({
        plan,
        uploadJournal: async ({ artifactName, journal }) => {
          attempts += 1;
          if (attempts === index + 1) {
            throw new Error("artifact upload interrupted");
          }
          return {
            acknowledged: true,
            artifactName,
            artifactId: String(2000 + journal.sequence),
          };
        },
        ordinaryRollback: async () => {
          mutations += 1;
          return { outcome: "success" };
        },
        inspectMapping: async (_entry, context) => ({
          mappingState: (() => {
            if (context.phase !== "recovery-final") return "candidate";
            finalInspections += 1;
            return "prior";
          })(),
        }),
        verifyMapping: async () => ({ mappingState: "prior" }),
      }),
      (error) => {
        assert.equal(error.code, "JOURNAL_UPLOAD_FAILED");
        assert.equal(
          error.journal.sequence,
          plan.journal.sequence + expected.offset,
        );
        assert.equal(error.journal.status, expected.status);
        return true;
      },
    );
    assert.equal(mutations, expected.mutations);
    assert.equal(finalInspections, expected.finalInspections);
  }
});

test("a noop that moves after planning cannot be recorded as recovered", async () => {
  const initial = preparedForTargets(["governance"], { app: "known" });
  const transitions = transitionSuccessfulOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const plan = planMainTransactionRecovery({
    journal: transitions.verified,
    currentMappings: currentMappings(transitions.verified),
  });
  assert.equal(plan.actions[0].kind, "verified_noop");
  const uploads = [];
  await assert.rejects(
    executeMainTransactionRecovery({
      plan,
      uploadJournal: acknowledgedUploader(uploads),
      inspectMapping: async (_entry, context) => ({
        mappingState:
          context.phase === "recovery-final" ? "candidate" : "prior",
      }),
    }),
    (error) => {
      assert.equal(error.code, "RECOVERY_VERIFICATION_FAILED");
      assert.equal(error.journal.status, "recovering");
      return true;
    },
  );
  assert.deepEqual(
    uploads.map((entry) => entry.status),
    ["recovering"],
  );
});

test("app recovery-start uploads retain the prior durable snapshot", async () => {
  const initial = preparedForTargets(["app"]);
  const started = startMainTransactionOperation(initial, {
    type: "app_alias_set",
    target: "app",
    alias: initial.prior.app.aliases[0],
  });
  const movedAlias = started.prior.app.aliases[0];
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [movedAlias]: {
        deploymentId: "dpl_appCandidate123",
        deploymentUrl: "https://app-candidate.vercel.app",
      },
    }),
  });
  assert.deepEqual(
    plan.actions.map(({ kind, alias }) => ({ kind, alias })),
    [{ kind: "app_alias_restore", alias: movedAlias }],
  );
  for (const [failAt, expected] of [
    [1, { sequence: started.sequence, status: "started" }],
    [2, { sequence: started.sequence + 1, status: "recovering" }],
  ]) {
    let attempts = 0;
    await assert.rejects(
      executeMainTransactionRecovery({
        plan,
        uploadJournal: async ({ artifactName, journal }) => {
          attempts += 1;
          if (attempts === failAt) throw new Error("upload interrupted");
          return {
            acknowledged: true,
            artifactName,
            artifactId: String(3000 + journal.sequence),
          };
        },
        restoreAppAlias: async () => ({ outcome: "success" }),
        inspectMapping: async (entry) => ({
          mappingState: entry.kind === "verified_noop" ? "prior" : "candidate",
        }),
        verifyMapping: async () => ({ mappingState: "prior" }),
      }),
      (error) => {
        assert.equal(error.code, "JOURNAL_UPLOAD_FAILED");
        assert.equal(error.journal.sequence, expected.sequence);
        assert.equal(error.journal.status, expected.status);
        return true;
      },
    );
  }
});

test("unexpected ordinary movement preserves possible operator intervention", () => {
  const initial = prepared({ app: "known" });
  const { started } = transitionSuccessfulOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const aliases = started.prior.governance.aliases;
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [aliases[0]]: {
        deploymentId: "dpl_operator123",
        deploymentUrl: "https://operator.vercel.app",
      },
    }),
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.equal(plan.actions[0].kind, "manual_intervention");
  assert.equal(plan.actions[0].mappingState, "unexpected");
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
    inspectMapping: async (entry) => ({
      mappingState:
        entry.kind === "manual_intervention" ? "unexpected" : "candidate",
    }),
    verifyMapping: async () => ({ mappingState: "prior" }),
  });
  assert.deepEqual(calls, ["reserve"]);
  assert.equal(result.status, "manual_intervention");
});

test("app recovery restores only the exact transaction-candidate mapping", () => {
  const initial = prepared();
  const alias = initial.prior.app.aliases[0];
  const started = startMainTransactionOperation(initial, {
    type: "app_alias_set",
    target: "app",
    alias,
  });
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [alias]: started.candidates.app,
    }),
  });
  assert.equal(plan.decision, "recover");
  const appActions = plan.actions.filter((entry) => entry.target === "app");
  assert.deepEqual(
    appActions.map((entry) => [entry.kind, entry.alias]),
    [["app_alias_restore", alias]],
  );
  assert.equal(
    appActions[0].priorDeploymentUrl,
    started.prior.app.deploymentUrl,
  );
  assert.equal(
    appActions[0].candidateDeploymentId,
    started.candidates.app.deploymentId,
  );

  const foreign = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [alias]: {
        deploymentId: "dpl_operator123",
        deploymentUrl: "https://operator.vercel.app",
      },
    }),
  });
  assert.equal(foreign.decision, "manual_intervention");
  assert.deepEqual(
    foreign.actions.map(({ kind, alias: actionAlias }) => [kind, actionAlias]),
    [["manual_intervention", alias]],
  );
});

// Replaces the retired "unknown App candidate" recovery model: the App
// candidate is always staged, so recovery never resolves one and its
// unresolved/ambiguous reasons no longer exist.
test("staged App candidate removes the unresolved-candidate recovery model", () => {
  assert.throws(
    () => preparedPendingApp(),
    /Candidate app must identify the staged deployment/,
  );
  const initial = prepared();
  const movedAlias = initial.prior.app.aliases[0];
  const started = startMainTransactionOperation(initial, {
    type: "app_alias_set",
    target: "app",
    alias: movedAlias,
  });
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [movedAlias]: started.candidates.app,
    }),
    // Recovery no longer consults provider candidate matches.
    appCandidateMatches: [],
  });
  assert.equal(plan.decision, "recover");
  assert.equal(
    plan.reason,
    "started-operations-require-verification-or-recovery",
  );
  assert.equal(
    plan.actions.find((entry) => entry.alias === movedAlias).kind,
    "app_alias_restore",
  );
});

test("manual App recovery retains safe ordinary rollback actions", () => {
  let highest = prepared();
  for (const target of ["governance", "reserve", "ui"]) {
    highest = transitionSuccessfulOperation(highest, {
      type: "promote",
      target,
    }).verified;
  }
  highest = startMainTransactionOperation(highest, {
    type: "promote",
    target: "app",
  });
  highest = recordMainTransactionCommandReturned(highest, {
    operationId: highest.operations.at(-1).operationId,
    outcome: "unknown",
  });

  const overrides = Object.fromEntries(
    ["governance", "reserve", "ui"].flatMap((target) =>
      highest.prior[target].aliases.map((alias) => [
        alias,
        highest.candidates[target],
      ]),
    ),
  );
  const movedAppAlias = highest.prior.app.aliases[0];
  overrides[movedAppAlias] = {
    deploymentId: "dpl_unresolvedApp123",
    deploymentUrl: "https://unresolved-app.vercel.app",
  };
  const plan = planMainTransactionRecovery({
    journal: highest,
    currentMappings: currentMappings(highest, overrides),
  });

  assert.equal(plan.decision, "manual_intervention");
  assert.equal(plan.reason, "unexpected-protected-mapping");
  assert.ok(
    plan.actions.some(
      (entry) =>
        entry.kind === "manual_intervention" &&
        entry.target === "app" &&
        entry.mappingState === "unexpected",
    ),
  );
  assert.deepEqual(
    plan.actions
      .filter((entry) => entry.kind === "ordinary_rollback")
      .map((entry) => entry.target),
    ["ui", "reserve", "governance"],
  );
  assert.deepEqual(plan.rollbackStateTargets, ["ui", "reserve", "governance"]);
});

test("unexpected app mapping is never overwritten", () => {
  const initial = prepared({ app: "known" });
  const alias = initial.prior.app.aliases[0];
  const started = startMainTransactionOperation(initial, {
    type: "app_alias_set",
    target: "app",
    alias,
  });
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

// MGP-18 retired the legacy App deployment. Recovery no longer models a
// legacy prior, slot, action kind, operation type, or decision reason.
test("retired legacy App v2 cannot re-enter the transaction recovery model", () => {
  const initial = prepared({ app: "known" });
  const started = startMainTransactionOperation(initial, {
    type: "app_alias_set",
    target: "app",
    alias: initial.prior.app.aliases[0],
  });
  assert.equal(started.prior["legacy-app"], undefined);
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started),
  });
  assert.deepEqual(
    plan.actions.map(({ target, alias }) => ({ target, alias })),
    [...started.prior.app.aliases]
      .reverse()
      .map((alias) => ({ target: "app", alias })),
  );
  assert.equal(
    plan.actions.some(({ kind }) => kind === "legacy_emergency_restore"),
    false,
  );
  assert.notEqual(plan.reason, "legacy-alias-moved-to-transaction-candidate");

  assert.throws(
    () =>
      startMainTransactionOperation(initial, {
        type: "legacy_emergency_restore",
        target: "legacy-app",
        alias: "v2-app.mento.org",
      }),
    /type is unsupported|target is unsupported/,
  );
  assert.throws(
    () =>
      createPreparedMainTransactionJournalImpl({
        ...identity,
        mode: "active",
        release: releaseForTargets(),
        prior: {
          ...priorState(),
          "legacy-app": deploymentRecord("legacy", ["v2-app.mento.org"]),
        },
        startMappings: startMappingsAtPrior(priorState()),
        candidates: candidateState(),
      }),
    /prior/,
  );
});

// TRANSITION-V3-PRIOR
// The first activation after the cutover still finds a v3-shaped App prior.
// `vercel rollback` restores a production deployment, which that prior is not,
// so a moved App promote is manual and the bridge restore is the only
// compensation for the reviewed domain.
test("first-run App recovery cannot roll back a v3-shaped App prior", () => {
  const prior = priorState();
  const journal = createPreparedMainTransactionJournalImpl({
    ...identity,
    mode: "active",
    release: releaseWithV3AppPrior(),
    prior,
    startMappings: startMappingsAtPrior(prior),
    candidates: candidateState(),
  });
  assert.equal(isProductionShapedPrior(journal.release, "app"), false);
  for (const target of ["governance", "reserve", "ui"]) {
    assert.equal(isProductionShapedPrior(journal.release, target), true);
  }

  const alias = journal.prior.app.aliases[0];
  const started = startMainTransactionOperation(journal, {
    type: "promote",
    target: "app",
  });
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [alias]: started.candidates.app,
    }),
  });
  assert.equal(plan.decision, "manual_intervention");
  assert.deepEqual(
    plan.actions.map(({ kind, target, mappingState }) => ({
      kind,
      target,
      mappingState,
    })),
    [{ kind: "manual_intervention", target: "app", mappingState: "candidate" }],
  );
  assert.deepEqual(plan.rollbackStateTargets, []);
  // The manual plan must survive its own strict validator: a promote slot that
  // cannot roll back is a legal manual action.
  assert.deepEqual(assertMainTransactionRecoveryPlan(plan), plan);

  assert.throws(
    () =>
      startMainTransactionOperation(startMainTransactionRecovery(started), {
        type: "ordinary_rollback",
        target: "app",
      }),
    /ordinary_rollback cannot restore a non-production app prior/,
  );
  assert.doesNotThrow(() =>
    startMainTransactionOperation(startMainTransactionRecovery(started), {
      type: "app_alias_restore",
      target: "app",
      alias,
    }),
  );
});

// TRANSITION-V3-PRIOR
// The whole forward path ran and the run failed after the bridge alias set.
// The bridge restore returns the only reviewed App alias to the captured v3
// prior, which is the entire compensation available for a v3-shaped App prior,
// so the App promote slot is a compensated noop and recovery must not escalate
// the interruption to a human.
test("first-run App recovery compensates a bridged promote with its alias restore", () => {
  const prior = priorState();
  let journal = createPreparedMainTransactionJournalImpl({
    ...identity,
    mode: "active",
    release: releaseWithV3AppPrior(),
    prior,
    startMappings: startMappingsAtPrior(prior),
    candidates: candidateState(),
  });
  const alias = journal.prior.app.aliases[0];
  for (const target of ["governance", "reserve", "ui"]) {
    const started = startMainTransactionOperation(journal, {
      type: "promote",
      target,
    });
    const operationId = started.operations.at(-1).operationId;
    journal = recordMainTransactionVerified(
      recordMainTransactionCommandReturned(started, {
        operationId,
        outcome: "success",
      }),
      { operationId, mappingState: "candidate" },
    );
  }
  const appPromoted = startMainTransactionOperation(journal, {
    type: "promote",
    target: "app",
  });
  const appPromoteId = appPromoted.operations.at(-1).operationId;
  journal = recordMainTransactionVerified(
    recordMainTransactionCommandReturned(appPromoted, {
      operationId: appPromoteId,
      outcome: "success",
    }),
    { operationId: appPromoteId, mappingState: "prior" },
  );
  const bridged = startMainTransactionOperation(journal, {
    type: "app_alias_set",
    target: "app",
    alias,
  });

  const plan = planMainTransactionRecovery({
    journal: bridged,
    currentMappings: currentMappings(bridged, {
      [alias]: bridged.candidates.app,
      "governance.mento.org": bridged.candidates.governance,
      "reserve.mento.org": bridged.candidates.reserve,
      "ui.mento.org": bridged.candidates.ui,
    }),
  });
  assert.equal(plan.decision, "recover");
  assert.equal(
    plan.reason,
    "started-operations-require-verification-or-recovery",
  );
  assert.deepEqual(
    plan.actions.map((entry) => ({
      kind: entry.kind,
      target: entry.target,
      alias: entry.alias ?? null,
      mappingState: entry.mappingState ?? null,
    })),
    [
      {
        kind: "app_alias_restore",
        target: "app",
        alias,
        mappingState: null,
      },
      {
        kind: "verified_noop",
        target: "app",
        alias: null,
        mappingState: "candidate",
      },
      {
        kind: "ordinary_rollback",
        target: "ui",
        alias: null,
        mappingState: null,
      },
      {
        kind: "ordinary_rollback",
        target: "reserve",
        alias: null,
        mappingState: null,
      },
      {
        kind: "ordinary_rollback",
        target: "governance",
        alias: null,
        mappingState: null,
      },
    ],
  );
  assert.deepEqual(plan.rollbackStateTargets, ["ui", "reserve", "governance"]);
  assert.deepEqual(assertMainTransactionRecoveryPlan(plan), plan);

  // Without the bridge restore covering the reviewed alias the same promote
  // stays manual: a v3-shaped prior has nothing to roll back to.
  const unbridged = planMainTransactionRecovery({
    journal: appPromoted,
    currentMappings: currentMappings(appPromoted, {
      [alias]: appPromoted.candidates.app,
      "governance.mento.org": appPromoted.candidates.governance,
      "reserve.mento.org": appPromoted.candidates.reserve,
      "ui.mento.org": appPromoted.candidates.ui,
    }),
  });
  assert.equal(unbridged.decision, "manual_intervention");
  assert.equal(
    unbridged.actions.find((entry) => entry.target === "app").kind,
    "manual_intervention",
  );
});

// TRANSITION-V3-PRIOR
// Once `app.mento.org` is a production App deployment, App recovers like every
// other main target.
test("steady-state App recovery rolls back a production-shaped App prior", () => {
  const initial = prepared();
  assert.equal(isProductionShapedPrior(initial.release, "app"), true);
  const alias = initial.prior.app.aliases[0];
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "app",
  });
  const plan = planMainTransactionRecovery({
    journal: started,
    currentMappings: currentMappings(started, {
      [alias]: started.candidates.app,
    }),
  });
  assert.equal(plan.decision, "recover");
  assert.deepEqual(
    plan.actions.map(({ kind, target, aliases, entersRollbackState }) => ({
      kind,
      target,
      aliases,
      entersRollbackState,
    })),
    [
      {
        kind: "ordinary_rollback",
        target: "app",
        aliases: [alias],
        entersRollbackState: true,
      },
    ],
  );
  assert.deepEqual(plan.rollbackStateTargets, ["app"]);
  assert.deepEqual(assertMainTransactionRecoveryPlan(plan), plan);

  const rollbackStarted = startMainTransactionOperation(
    startMainTransactionRecovery(started),
    { type: "ordinary_rollback", target: "app" },
  );
  assert.deepEqual(
    [
      rollbackStarted.operations.at(-1).type,
      rollbackStarted.operations.at(-1).target,
      rollbackStarted.operations.at(-1).alias,
    ],
    ["ordinary_rollback", "app", null],
  );
});

test("retired app_v3_deploy operation type cannot re-enter the transaction model", () => {
  const journal = prepared();
  assert.throws(
    () =>
      startMainTransactionOperation(journal, {
        type: "app_v3_deploy",
        target: "app",
      }),
    /Operation type is unsupported/,
  );
  const started = startMainTransactionOperation(journal, {
    type: "promote",
    target: "app",
  });
  const forged = {
    ...started,
    operations: started.operations.map((operation) => ({
      ...operation,
      type: "app_v3_deploy",
    })),
  };
  assert.throws(
    () => assertMainTransactionJournal(forged),
    /Operation type is unsupported/,
  );
  assert.throws(
    () => assertMainTransactionJournalHistory([journal, forged]),
    /Operation type is unsupported/,
  );
});

test("recovered and committed histories bypass repeat recovery", () => {
  const initial = preparedForTargets([], { app: "known" });
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
      return {
        acknowledged: true,
        artifactName: payload.artifactName,
        artifactId: String(1000 + payload.journal.sequence),
      };
    },
    inspectRecoveryState: async ({ decision }) => {
      events.push(`recovery:${decision}`);
    },
    mutationAdapters: {
      promote: forbidden,
      assignAlias: forbidden,
      ordinaryRollback: forbidden,
      restoreAppAlias: forbidden,
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

test("active mode promotes ordinary targets sequentially and activates App last", async () => {
  const harness = activeMutationHarness();
  const events = harness.events;
  const freshness = [];
  const result = await runMainTransaction({
    mode: "active",
    identity,
    prior: harness.prior,
    candidates: harness.candidates,
    assertFreshness: async ({ phase }) => {
      freshness.push(phase);
      return { sha: SHA };
    },
    uploadJournal: async ({ artifactName, journal }) => {
      events.push(
        `upload:${journal.status}:${journal.operations.at(-1)?.operationId ?? "none"}`,
      );
      return {
        acknowledged: true,
        artifactName,
        artifactId: String(4000 + journal.sequence),
      };
    },
    mutationAdapters: harness.mutationAdapters,
  });

  assert.equal(result.outcome, "active-committed");
  assert.equal(result.journal.status, "committed");
  assert.equal(result.mutationCallbacksCalled, 5);
  // TRANSITION-V3-PRIOR: App promotes last, then the bridge alias set carries
  // the reviewed domain from the prior to the promoted candidate.
  assert.deepEqual(
    result.journal.operations
      .filter((operation) => operation.state === "started")
      .map((operation) => [operation.type, operation.target, operation.alias]),
    [
      ["promote", "governance", null],
      ["promote", "reserve", null],
      ["promote", "ui", null],
      ["promote", "app", null],
      ["app_alias_set", "app", "app.mento.org"],
    ],
  );
  assert.deepEqual(
    result.journal.operations
      .filter((operation) => operation.state === "verified")
      .map((operation) => [
        operation.type,
        operation.target,
        operation.mappingState,
      ]),
    [
      ["promote", "governance", "candidate"],
      ["promote", "reserve", "candidate"],
      ["promote", "ui", "candidate"],
      ["promote", "app", "prior"],
      ["app_alias_set", "app", "candidate"],
    ],
  );
  assert.deepEqual(
    events.filter((event) => event.startsWith("mutate:")),
    [
      "mutate:promote:governance",
      "mutate:promote:reserve",
      "mutate:promote:ui",
      "mutate:promote:app",
      "mutate:app_alias_set:app:app.mento.org",
    ],
  );
  for (const [index, event] of events.entries()) {
    if (!event.startsWith("mutate:")) continue;
    assert.match(events[index - 1], /^upload:started:op-[0-9]{4}$/);
  }
  assert.equal(events[0], "upload:prepared:none");
  assert.match(events.at(-1), /^upload:committed:op-[0-9]{4}$/);
  assert.equal(freshness.filter((phase) => phase === "pre-command").length, 5);
  assert.equal(freshness.at(-1), "transaction-commit");
  assert.equal(
    result.journal.candidates.app.deploymentId,
    "dpl_appCandidate123",
  );
  assert.deepEqual(result.recoveryDecision, {
    decision: "bypass",
    reason: "committed",
  });
});

// TRANSITION-V3-PRIOR
test("active mode treats a reviewed App alias already at the candidate as a verified noop", async () => {
  const harness = activeMutationHarness();
  const baseInspectMapping = harness.mutationAdapters.inspectMapping;
  const result = await runMainTransaction({
    mode: "active",
    identity,
    prior: harness.prior,
    candidates: harness.candidates,
    assertFreshness: async () => ({ sha: SHA }),
    uploadJournal: acknowledgedUploader(),
    mutationAdapters: {
      ...harness.mutationAdapters,
      inspectMapping: async (context) => {
        if (context.phase === "alias-selection") {
          // The reviewed domain reached the promoted candidate on its own
          // between the App promote and the bridge alias set.
          for (const alias of harness.prior.app.aliases) {
            harness.mappings.set(alias, mapping(alias, harness.candidates.app));
          }
        }
        return baseInspectMapping(context);
      },
    },
  });

  assert.equal(result.journal.status, "committed");
  assert.equal(result.mutationCallbacksCalled, 4);
  assert.equal(
    result.journal.operations.some(
      (operation) => operation.type === "app_alias_set",
    ),
    false,
  );
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith("mutate:")),
    [
      "mutate:promote:governance",
      "mutate:promote:reserve",
      "mutate:promote:ui",
      "mutate:promote:app",
    ],
  );
});

// TRANSITION-V3-PRIOR
test("active mode binds the staged App candidate and assigns only aliases still at prior", async () => {
  const harness = activeMutationHarness();
  const baseVerifyMapping = harness.mutationAdapters.verifyMapping;
  let verifiedAppPromote = null;
  const result = await runMainTransaction({
    mode: "active",
    identity,
    prior: harness.prior,
    candidates: harness.candidates,
    assertFreshness: async () => ({ sha: SHA }),
    uploadJournal: acknowledgedUploader(),
    mutationAdapters: {
      ...harness.mutationAdapters,
      verifyMapping: async (context) => {
        if (
          context.operation.type === "promote" &&
          context.operation.target === "app"
        ) {
          verifiedAppPromote = {
            deploymentId: context.operation.candidateDeploymentId,
            deploymentUrl: context.operation.candidateDeploymentUrl,
            readyState: "READY",
          };
          // The promote moves the App production environment, never the
          // reviewed domain that still belongs to the `v3` environment.
          assert.deepEqual(
            harness.mappings.get("app.mento.org"),
            mapping("app.mento.org", harness.prior.app),
          );
        }
        return baseVerifyMapping(context);
      },
    },
  });

  assert.equal(result.journal.status, "committed");
  assert.equal(result.mutationCallbacksCalled, 5);
  assert.deepEqual(verifiedAppPromote, {
    deploymentId: "dpl_appCandidate123",
    deploymentUrl: "https://app-candidate.vercel.app",
    readyState: "READY",
  });
  assert.deepEqual(
    result.journal.operations
      .filter(
        (operation) =>
          operation.type === "app_alias_set" && operation.state === "started",
      )
      .map((operation) => operation.alias),
    ["app.mento.org"],
  );
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith("mutate:app_alias_set")),
    ["mutate:app_alias_set:app:app.mento.org"],
  );
  assert.deepEqual(
    harness.mappings.get("app.mento.org"),
    mapping("app.mento.org", harness.candidates.app),
  );
});

// TRANSITION-V3-PRIOR
test("active mode rejects an App promote that moved the reviewed domain", async () => {
  const harness = activeMutationHarness({ appAliasMovedByPromote: true });
  const uploads = [];

  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: harness.prior,
      candidates: harness.candidates,
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: acknowledgedUploader(uploads),
      mutationAdapters: harness.mutationAdapters,
    }),
    (error) => {
      assert.ok(error instanceof MainTransactionError);
      assert.equal(error.code, "MUTATION_VERIFICATION_FAILED");
      assert.equal(error.journal.status, "verified");
      assert.deepEqual(
        [
          error.journal.operations.at(-1).type,
          error.journal.operations.at(-1).target,
          error.journal.operations.at(-1).mappingState,
        ],
        ["promote", "app", "candidate"],
      );
      return true;
    },
  );
  assert.equal(
    harness.events.some((event) => event.startsWith("mutate:app_alias_set")),
    false,
  );
});

test("active mode rejects an unexpected reviewed App alias before journaling or command", async () => {
  const harness = activeMutationHarness({
    unexpectedAppAliasAfterPromote: "app.mento.org",
  });
  const uploads = [];

  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: harness.prior,
      candidates: harness.candidates,
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: acknowledgedUploader(uploads),
      mutationAdapters: harness.mutationAdapters,
    }),
    (error) => {
      assert.ok(error instanceof MainTransactionError);
      assert.equal(error.code, "MUTATION_VERIFICATION_FAILED");
      assert.equal(error.journal.status, "verified");
      assert.deepEqual(
        [
          error.journal.operations.at(-1).type,
          error.journal.operations.at(-1).target,
          error.journal.operations.at(-1).mappingState,
        ],
        ["promote", "app", "unexpected"],
      );
      return true;
    },
  );
  assert.equal(
    harness.events.some((event) => event.startsWith("mutate:app_alias_set")),
    false,
  );
  assert.equal(
    uploads.some(({ journal }) =>
      journal.operations.some(
        (operation) => operation.type === "app_alias_set",
      ),
    ),
    false,
  );
});

test("active mode rejects a drifted reviewed App alias before journaling the bridge", async () => {
  const harness = activeMutationHarness();
  const baseInspectMapping = harness.mutationAdapters.inspectMapping;
  const uploads = [];

  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: harness.prior,
      candidates: harness.candidates,
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: acknowledgedUploader(uploads),
      mutationAdapters: {
        ...harness.mutationAdapters,
        inspectMapping: async (context) => {
          if (context.phase === "alias-selection") {
            return { mappingState: "unexpected" };
          }
          return baseInspectMapping(context);
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof MainTransactionError);
      assert.equal(error.code, "PROTECTED_MAPPING_DRIFT");
      assert.equal(error.journal.status, "verified");
      assert.deepEqual(
        [
          error.journal.operations.at(-1).type,
          error.journal.operations.at(-1).target,
        ],
        ["promote", "app"],
      );
      return true;
    },
  );
  assert.equal(
    harness.events.some((event) => event.startsWith("mutate:app_alias_set")),
    false,
  );
  assert.equal(
    uploads.some(({ journal }) =>
      journal.operations.some(
        (operation) => operation.type === "app_alias_set",
      ),
    ),
    false,
  );
});

test("active mode hands an incomplete durable history to recovery without replay", async () => {
  const initial = preparedForTargets(["governance"], { app: "known" });
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const harness = activeMutationHarness();
  let uploads = 0;
  const recoveryDecisions = [];

  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: initial.prior,
      candidates: initial.candidates,
      existingJournals: [initial, started],
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: async () => {
        uploads += 1;
      },
      inspectRecoveryState: async (decision) => {
        recoveryDecisions.push(decision);
      },
      mutationAdapters: harness.mutationAdapters,
    }),
    (error) => {
      assert.ok(error instanceof MainTransactionError);
      assert.equal(error.code, "RECOVERY_REQUIRED");
      assert.equal(error.journal.status, "started");
      return true;
    },
  );
  assert.equal(uploads, 0);
  assert.deepEqual(
    recoveryDecisions.map(({ decision, reason }) => [decision, reason]),
    [["recover", "incomplete-mutation-journal"]],
  );
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith("mutate:")),
    [],
  );
});

test("active mode stops at the next freshness barrier and preserves the last durable operation", async () => {
  const harness = activeMutationHarness();
  const uploads = [];
  let preOperations = 0;

  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: harness.prior,
      candidates: harness.candidates,
      assertFreshness: async ({ phase }) => {
        if (phase === "pre-operation") {
          preOperations += 1;
          if (preOperations === 2) return { sha: OTHER_SHA };
        }
        return { sha: SHA };
      },
      uploadJournal: acknowledgedUploader(uploads),
      mutationAdapters: harness.mutationAdapters,
    }),
    (error) => {
      assert.ok(error instanceof MainTransactionError);
      assert.equal(error.code, "SUPERSEDED_DURING_MUTATION");
      assert.equal(error.journal.status, "verified");
      assert.equal(error.journal.operations.at(-1).target, "governance");
      return true;
    },
  );
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith("mutate:")),
    ["mutate:promote:governance"],
  );
  assert.equal(uploads.at(-1).status, "verified");
});

test("active mode never commits when a final protected mapping changed", async () => {
  const harness = activeMutationHarness({
    onProtectedInspection: ({ phase, mappings, prior }) => {
      if (phase !== "transaction-commit") return;
      const alias = prior.ui.aliases[0];
      mappings.set(
        alias,
        mapping(alias, {
          deploymentId: "dpl_operator123",
          deploymentUrl: "https://operator.vercel.app",
        }),
      );
    },
  });
  const uploads = [];

  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: harness.prior,
      candidates: harness.candidates,
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: acknowledgedUploader(uploads),
      mutationAdapters: harness.mutationAdapters,
    }),
    (error) => {
      assert.ok(error instanceof MainTransactionError);
      assert.equal(error.code, "FINAL_MAPPING_VERIFICATION_FAILED");
      assert.equal(error.journal.status, "verified");
      return true;
    },
  );
  assert.equal(
    uploads.some((entry) => entry.status === "committed"),
    false,
  );
});

test("active mode requires every selected forward and verification adapter before persistence", async () => {
  let uploads = 0;
  await assert.rejects(
    runMainTransaction({
      mode: "active",
      identity,
      prior: priorState(),
      candidates: candidateState(),
      assertFreshness: async () => ({ sha: SHA }),
      uploadJournal: async () => {
        uploads += 1;
      },
      mutationAdapters: {},
    }),
    /Mutation adapter promote is required/,
  );
  assert.equal(uploads, 0);
});

function preparedWithCandidatePrefix(prefix) {
  const prior = priorState();
  const candidates = candidateState({ app: "known" });
  const activationOrder = ["governance", "reserve", "ui", "app"];
  const inherited = new Set(activationOrder.slice(0, prefix));
  const startMappings = Object.fromEntries(
    Object.entries(prior).map(([target, record]) => [
      target,
      record.aliases.map((alias) =>
        mapping(alias, inherited.has(target) ? candidates[target] : record),
      ),
    ]),
  );
  return createPreparedMainTransactionJournalImpl({
    ...identity,
    mode: "active",
    release: releaseForTargets(),
    prior,
    startMappings,
    candidates,
  });
}

test("v3 journal binds durable release, all four priors, and exact start mappings", () => {
  const journal = prepared();
  assert.equal(journal.schema, 3);
  assert.equal(journal.release.deploySha, journal.deploySha);
  assert.deepEqual(Object.keys(journal.prior), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(
    Object.keys(journal.startMappings),
    Object.keys(journal.prior),
  );
  assert.equal(journal.candidates.app.deploymentId, "dpl_appCandidate123");
  assert.deepEqual(journal.prior.app.aliases, ["app.mento.org"]);
});

test("v3 history freezes release and start mappings", () => {
  const initial = preparedForTargets(["governance"], { app: "known" });
  const started = startMainTransactionOperation(initial, {
    type: "promote",
    target: "governance",
  });
  const changedRelease = structuredClone(started);
  changedRelease.release.releasePlanDigest = "0".repeat(64);
  assert.throws(
    () => assertMainTransactionJournalHistory([initial, changedRelease]),
    /release|manifest|identity/,
  );
  const changedStart = structuredClone(started);
  changedStart.startMappings.governance[0].deploymentId = "dpl_operator123";
  assert.throws(
    () => assertMainTransactionJournalHistory([initial, changedStart]),
    /mapping|start/,
  );
});

// Replaces the retired "placeholder until discovery" guard: the staged App
// candidate must name its deployment and prove its immutable smoke at
// preparation time.
test("staged App candidate must identify its deployment and prove its smoke", () => {
  const initial = preparedForTargets(["app"]);
  assert.equal(initial.candidates.app.deploymentId, "dpl_appCandidate123");
  assert.throws(
    () => preparedPendingApp(),
    /Candidate app must identify the staged deployment/,
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
              immutableSmoke: {
                ...appDiscovery().immutableSmoke,
                servedSha: OTHER_SHA,
              },
            },
          },
        },
      }),
    /does not prove the candidate SHA/,
  );
});

test("selected App target promotes its staged candidate and reconciles its alias", async () => {
  const harness = activeMutationHarness();
  const candidates = candidateState({ app: "known" }, ["app"]);
  const result = await runMainTransaction({
    mode: "active",
    identity,
    prior: harness.prior,
    candidates,
    assertFreshness: async () => ({ sha: SHA }),
    uploadJournal: acknowledgedUploader(),
    mutationAdapters: harness.mutationAdapters,
  });
  assert.equal(result.outcome, "active-committed");
  assert.equal(
    harness.events.some((entry) => entry.startsWith("mutate:app_v3_deploy")),
    false,
  );
  assert.deepEqual(
    harness.events.filter((entry) => entry.startsWith("mutate:")),
    ["mutate:promote:app", "mutate:app_alias_set:app:app.mento.org"],
  );
});

test("v3 release reconciliation rejects non-prefix inherited mappings", () => {
  const journal = preparedWithCandidatePrefix(1);
  const invalid = structuredClone(journal);
  invalid.startMappings.ui = invalid.startMappings.ui.map((entry) =>
    mapping(entry.alias, invalid.candidates.ui),
  );
  assert.throws(
    () => assertMainTransactionJournal(invalid),
    /activation prefix/,
  );
});

test("one, two, and three inherited targets receive reverse recovery authority", () => {
  for (const prefix of [1, 2, 3]) {
    const journal = preparedWithCandidatePrefix(prefix);
    const plan = planInheritedMainTransactionRecovery({
      journal,
      reason: "suffix-preparation-failed-before-forward",
    });
    assert.equal(plan.decision, "restore-inherited");
    assert.deepEqual(
      plan.rollbackAuthority.targets,
      ["governance", "reserve", "ui"].slice(0, prefix),
    );
    assert.deepEqual(
      plan.actions.map(({ target }) => target),
      ["governance", "reserve", "ui"].slice(0, prefix).reverse(),
    );
    assert.deepEqual(assertMainInheritedTransactionRecoveryPlan(plan), plan);
    const recovering = startInheritedMainTransactionRecovery({
      journal,
      recoveryPlan: plan,
    });
    assert.equal(recovering.status, "recovering");
    assert.deepEqual(
      assertMainTransactionJournalHistory([journal, recovering]).at(-1),
      recovering,
    );
  }
});

test("inherited recovery binds the fresh journal and untampered restore plan", () => {
  const journal = preparedWithCandidatePrefix(2);
  const plan = planInheritedMainTransactionRecovery({
    journal,
    reason: "forward-operation-failed",
  });
  const tampered = structuredClone(plan);
  tampered.actions.reverse();
  assert.throws(
    () => assertMainInheritedTransactionRecoveryPlan(tampered),
    /canonical plan/,
  );
  assert.throws(
    () =>
      startInheritedMainTransactionRecovery({
        journal: preparedWithCandidatePrefix(1),
        recoveryPlan: plan,
      }),
    /differs/,
  );
  const alreadyStarted = startInheritedMainTransactionRecovery({
    journal,
    recoveryPlan: plan,
  });
  assert.throws(
    () =>
      startInheritedMainTransactionRecovery({
        journal: alreadyStarted,
        recoveryPlan: plan,
      }),
    /differs|fresh prepared/,
  );
});

// Replaces the retired "mixed App inheritance" case: every reviewed target now
// maps exactly one alias, so a per-target mixed state is unreachable and the
// retired v3 generated alias cannot re-enter the journal.
test("single-alias targets make a mixed inherited App state unreachable", () => {
  const journal = preparedWithCandidatePrefix(3);
  for (const target of MAIN_RELEASE_ACTIVATION_ORDER) {
    assert.deepEqual(journal.prior[target].aliases, [
      ...MAIN_TARGET_CONTRACTS[target].aliases,
    ]);
  }

  const forgedMapping = structuredClone(journal);
  forgedMapping.startMappings.app = [
    ...forgedMapping.startMappings.app,
    mapping(
      TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS,
      forgedMapping.candidates.app,
    ),
  ];
  assert.throws(
    () => assertMainTransactionJournal(forgedMapping),
    /do not exactly cover protected aliases/,
  );

  const forgedPrior = structuredClone(journal);
  const forgedAliases = [
    ...forgedPrior.prior.app.aliases,
    TRANSITIONAL_APP_PRIOR_GENERATED_ALIAS,
  ].sort();
  forgedPrior.prior.app.aliases = forgedAliases;
  forgedPrior.candidates.app.aliases = [...forgedAliases];
  forgedPrior.startMappings.app = forgedAliases.map((alias) =>
    mapping(alias, forgedPrior.prior.app),
  );
  assert.throws(
    () => assertMainTransactionJournal(forgedPrior),
    /Journal prior conflicts with the durable release manifest/,
  );

  // The App target is inherited whole, never half-moved.
  const moved = structuredClone(journal);
  moved.startMappings.app = moved.startMappings.app.map(({ alias }) =>
    mapping(alias, moved.candidates.app),
  );
  const plan = planInheritedMainTransactionRecovery({
    journal: moved,
    reason: "main-stale-before-forward",
  });
  assert.equal(plan.decision, "verify-noop");
  assert.deepEqual(plan.rollbackAuthority, { targets: [], aliases: [] });
});

test("terminal App recovery residual restores both reviewed aliases only", () => {
  const forwardBaseline = preparedWithCandidatePrefix(0);
  const forgedForwardStart = startMainTransactionOperation(forwardBaseline, {
    type: "promote",
    target: "governance",
  });
  const journal = structuredClone(forwardBaseline);
  journal.startMappings.app = journal.startMappings.app.map(({ alias }) =>
    mapping(alias, journal.candidates.app),
  );

  assert.throws(
    () =>
      startMainTransactionOperation(journal, {
        type: "promote",
        target: "governance",
      }),
    /activation prefix/,
  );
  forgedForwardStart.startMappings.app = journal.startMappings.app;
  assert.throws(
    () => assertMainTransactionJournalHistory([journal, forgedForwardStart]),
    /activation prefix/,
  );

  const plan = planInheritedMainTransactionRecovery({
    journal,
    reason: "forward-operation-failed",
  });

  assert.equal(plan.decision, "restore-inherited");
  assert.deepEqual(plan.rollbackAuthority, {
    targets: ["app"],
    aliases: [...journal.prior.app.aliases].sort(),
  });
  assert.deepEqual(
    plan.actions.map(({ kind, target, alias }) => ({ kind, target, alias })),
    [...journal.prior.app.aliases]
      .reverse()
      .map((alias) => ({ kind: "app_alias_restore", target: "app", alias })),
  );
  assert.equal(
    plan.actions.some(({ kind }) => kind === "ordinary_rollback"),
    false,
  );
  assert.equal(
    plan.actions.some(({ target }) => target === "legacy-app"),
    false,
  );
  assert.deepEqual(assertMainInheritedTransactionRecoveryPlan(plan), plan);

  const recovering = startInheritedMainTransactionRecovery({
    journal,
    recoveryPlan: plan,
  });
  assert.equal(recovering.status, "recovering");
});

test("terminal mixed App recovery residual restores only the moved alias", () => {
  const journal = structuredClone(preparedWithCandidatePrefix(0));
  const movedAlias = journal.startMappings.app[0].alias;
  journal.startMappings.app[0] = mapping(movedAlias, journal.candidates.app);

  const plan = planInheritedMainTransactionRecovery({
    journal,
    reason: "forward-operation-failed",
  });

  assert.equal(plan.decision, "restore-inherited");
  assert.deepEqual(plan.rollbackAuthority, {
    targets: ["app"],
    aliases: [movedAlias],
  });
  assert.deepEqual(
    plan.actions.map(({ kind, target, alias }) => ({ kind, target, alias })),
    [{ kind: "app_alias_restore", target: "app", alias: movedAlias }],
  );
});

test("all-candidate reader is verify-only without rollback authority", () => {
  const plan = planInheritedMainTransactionRecovery({
    journal: preparedWithCandidatePrefix(4),
    reason: "main-stale-before-forward",
  });
  assert.equal(plan.decision, "verify-noop");
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.rollbackAuthority, { targets: [], aliases: [] });
  assert.throws(
    () => assertMainInheritedTransactionRecoveryPlan(plan),
    /not executable/,
  );
  assert.throws(
    () =>
      startInheritedMainTransactionRecovery({
        journal: plan.journal,
        recoveryPlan: plan,
      }),
    /not executable/,
  );
});

test("raw transaction wrapper requires and preserves v3 release bindings", async () => {
  const release = releaseForTargets([], "shadow");
  const prior = priorState();
  const startMappings = startMappingsAtPrior(prior);
  const input = {
    mode: "shadow",
    identity,
    release,
    prior,
    startMappings,
    candidates: { app: null, governance: null, reserve: null, ui: null },
    assertFreshness: async () => ({ sha: SHA }),
    uploadJournal: acknowledgedUploader(),
  };
  const result = await runMainTransactionImpl(input);
  assert.deepEqual(result.journal.release, release);
  assert.deepEqual(result.journal.startMappings, startMappings);
  await assert.rejects(
    runMainTransactionImpl({ ...input, release: undefined }),
    /manifest|malformed/,
  );
  const tampered = structuredClone(startMappings);
  tampered.reserve[0].deploymentId = "dpl_operator123";
  await assert.rejects(
    runMainTransactionImpl({ ...input, startMappings: tampered }),
    /mapping/,
  );
});
