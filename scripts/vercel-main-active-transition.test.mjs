import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

import {
  MAIN_ACTIVE_EVENT_SCHEMA,
  reduceMainActiveTransition,
} from "./vercel-main-active-controller.mjs";
import { mainTransactionJournalArtifactName } from "./vercel-main-transaction.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const actionSource = read(
  ".github/actions/vercel-main-active-transition/action.yml",
);
const action = parse(actionSource);
const preparedFixture = JSON.parse(
  read("scripts/fixtures/vercel-main-transaction/prepared-shadow.json"),
);
const TARGETS = ["app", "governance", "reserve", "ui"];

function preparedFor(activeTargets) {
  const journal = structuredClone(preparedFixture);
  for (const target of TARGETS) {
    if (!activeTargets.includes(target)) journal.candidates[target] = null;
  }
  return journal;
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

function mappings(journal, candidateTargets = []) {
  return Object.entries(journal.prior)
    .flatMap(([target, prior]) => {
      const candidate = journal.candidates[target];
      const selected = candidateTargets.includes(target) ? candidate : prior;
      return prior.aliases.map((alias) => ({
        alias,
        deploymentId: selected.deploymentId,
        deploymentUrl: selected.deploymentUrl,
      }));
    })
    .toSorted((left, right) => left.alias.localeCompare(right.alias));
}

function event(kind, additional = {}) {
  return { schema: MAIN_ACTIVE_EVENT_SCHEMA, kind, ...additional };
}

function reduce(initial, history, input, activeTargets) {
  return reduceMainActiveTransition({
    preparedJournal: initial,
    activeTargets,
    shadowTargets: [],
    stagedCandidates: initial.candidates,
    mainOwnershipMode: initial.release.mainOwnershipMode,
    projectIds: Object.fromEntries(
      TARGETS.map((target) => [
        target,
        initial.release.originalPriors[target].projectId,
      ]),
    ),
    history,
    event: input,
  });
}

function driveToCommandReturn(
  initial,
  activeTargets,
  {
    commandResult = { outcome: "success", reason: null, candidate: null },
  } = {},
) {
  const history = [];
  const initialized = reduce(
    initial,
    history,
    event("initialize"),
    activeTargets,
  );
  history.push(initialized.journal);
  const dispatched = reduce(
    initial,
    history,
    event("dispatch", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: initial.deploySha,
      currentMappings: mappings(history.at(-1)),
    }),
    activeTargets,
  );
  history.push(dispatched.journal);
  const authorized = reduce(
    initial,
    history,
    event("authorize", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: initial.deploySha,
      currentMappings: mappings(history.at(-1)),
    }),
    activeTargets,
  );
  const returned = reduce(
    initial,
    history,
    event("command-returned", {
      uploadReceipt: receipt(history.at(-1)),
      operationId: authorized.operationId,
      command: authorized.command,
      result: commandResult,
    }),
    activeTargets,
  );
  history.push(returned.journal);
  return { authorized, returned, history };
}

test("ordinary mappings remain a one-turn verification", () => {
  const activeTargets = ["governance"];
  const initial = preparedFor(activeTargets);
  const { history } = driveToCommandReturn(initial, activeTargets);
  const verified = reduce(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: initial.deploySha,
      currentMappings: mappings(history.at(-1), ["governance"]),
    }),
    activeTargets,
  );
  assert.equal(verified.journal.status, "verified");
  assert.equal(verified.journal.operations.at(-1).state, "verified");
  assert.equal(verified.afterUploadAction, "dispatch");
});

test("active checkpoints stage canonical files before replacing pre-existing destinations", () => {
  const checkpoints = [
    ["checkpoint-started", "started"],
    ["checkpoint-returned", "returned"],
    ["checkpoint-verified", "verified"],
  ];

  for (const [checkpointId, checkpointName] of checkpoints) {
    const checkpoint = action.runs.steps.find(
      (step) => step.id === checkpointId,
    );
    const tempPrefix = `\\$RUNNER_TEMP/active-\\$SLOT-${checkpointName}`;

    assert.ok(checkpoint, `missing ${checkpointId}`);
    assert.match(
      checkpoint.run,
      new RegExp(
        `active-journal-history .*--output "${tempPrefix}-history\\.json"`,
      ),
    );
    assert.match(
      checkpoint.run,
      new RegExp(
        `active-journal-receipt .*--output "${tempPrefix}-receipt\\.json"`,
      ),
    );
    assert.match(
      checkpoint.run,
      new RegExp(
        `install -m 0600 "${tempPrefix}-history\\.json" "\\$JOURNAL_DIRECTORY/current-history\\.json"`,
      ),
    );
    assert.match(
      checkpoint.run,
      new RegExp(
        `install -m 0600 "${tempPrefix}-receipt\\.json" "\\$JOURNAL_DIRECTORY/current-receipt\\.json"`,
      ),
    );
  }

  assert.doesNotMatch(
    actionSource,
    /active-journal-(?:history|receipt)[^\n]*--output "\$JOURNAL_DIRECTORY\/current-(?:history|receipt)\.json"/,
  );
});

// The activation composite is now uniform: one authorize, one command, one
// verification turn, and no App-only branch.
test("the composite has exactly one verification turn and no App-only branch", () => {
  const steps = action.runs.steps;
  const verify = steps.find((step) => step.id === "verify");
  const verifiedCheckpoint = steps.find(
    (step) => step.id === "checkpoint-verified",
  );
  assert.ok(verify, "missing the verification turn");
  assert.ok(verifiedCheckpoint, "missing the durable verified checkpoint");
  assert.match(verify.run, /active-event-verify /);
  assert.equal(
    verify.if.replace(/\s+/g, " ").trim(),
    "steps.checkpoint-returned.outcome == 'success'",
  );
  // The retired App custom-environment deploy and its second verification
  // turn cannot re-enter the composite.
  assert.doesNotMatch(actionSource, /app_v3_deploy/);
  assert.doesNotMatch(actionSource, /active-event-verify-app/);
  assert.doesNotMatch(actionSource, /app-candidate-receipt/);
  assert.doesNotMatch(actionSource, /app-operation-cwd/);
  assert.equal(
    steps.filter((step) => step.id === "verify-app-candidate").length,
    0,
  );
  assert.ok(steps.indexOf(verify) < steps.indexOf(verifiedCheckpoint));
  assert.equal(
    steps.filter(
      (step) =>
        step.name === "Execute only the durably authorized Vercel command",
    ).length,
    1,
    "the composite must still authorize only one Vercel command",
  );
});
