import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

import {
  MAIN_ACTIVE_EVENT_SCHEMA,
  reduceMainActiveTransition,
} from "./vercel-main-active-controller.mjs";
import {
  canonicalizeMainCandidateVercelMetadata,
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import { mainTransactionJournalArtifactName } from "./vercel-main-transaction.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const action = parse(
  read(".github/actions/vercel-main-active-transition/action.yml"),
);
const preparedFixture = JSON.parse(
  read("scripts/fixtures/vercel-main-transaction/prepared-shadow.json"),
);
const TARGETS = ["app", "governance", "reserve", "ui"];

function preparedFor(activeTargets, { pendingApp = false } = {}) {
  const journal = structuredClone(preparedFixture);
  for (const target of TARGETS) {
    if (!activeTargets.includes(target)) journal.candidates[target] = null;
  }
  if (pendingApp) {
    const intent = createMainCandidateIntent({
      target: "app",
      deploySha: journal.release.deploySha,
      upstreamRunId: journal.release.upstreamRunId,
      originRunId: journal.runId,
      originAttempt: journal.runAttempt,
      originTransactionId: journal.transactionId,
      projectId: journal.release.originalPriors.app.projectId,
      projectName: journal.release.originalPriors.app.projectName,
      releaseManifest: journal.release,
    });
    journal.candidates.app = {
      ...journal.candidates.app,
      deploymentId: null,
      deploymentUrl: null,
      discovery: {
        ...journal.candidates.app.discovery,
        candidateId: intent.candidateId,
        immutableSmoke: null,
      },
    };
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
      const candidate =
        target === "legacy-app"
          ? journal.candidates.app
          : journal.candidates[target];
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

function appCandidateReceipt(journal) {
  const intent = createMainCandidateIntent({
    target: "app",
    deploySha: journal.release.deploySha,
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

function driveToCommandReturn(initial, activeTargets) {
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
      result: { outcome: "success", reason: null, candidate: null },
    }),
    activeTargets,
  );
  history.push(returned.journal);
  return { authorized, history };
}

test("App receipt attachment is durably followed by a receipt-free verification", () => {
  const activeTargets = ["app"];
  const initial = preparedFor(activeTargets, { pendingApp: true });
  const { history } = driveToCommandReturn(initial, activeTargets);
  const providerReceipt = appCandidateReceipt(initial);
  const appDeployment = {
    deploymentId: providerReceipt.candidate.deploymentId,
    deploymentUrl: providerReceipt.candidate.deploymentUrl,
    readyState: "READY",
  };

  const attached = reduce(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: initial.deploySha,
      currentMappings: mappings(history.at(-1)),
      appCandidateReceipt: providerReceipt,
      appDeployment,
    }),
    activeTargets,
  );
  assert.equal(attached.journal.status, "command_returned");
  assert.equal(attached.journal.operations.at(-1).state, "command_returned");
  assert.equal(
    attached.journal.candidates.app.deploymentId,
    "dpl_appCandidate123",
  );
  assert.equal(attached.afterUploadAction, "verify");
  history.push(attached.journal);

  assert.throws(
    () =>
      reduce(
        initial,
        history,
        event("dispatch", {
          uploadReceipt: receipt(history.at(-1)),
          freshSha: initial.deploySha,
          currentMappings: mappings(history.at(-1)),
        }),
        activeTargets,
      ),
    /already in progress/,
  );

  const verified = reduce(
    initial,
    history,
    event("verify", {
      uploadReceipt: receipt(history.at(-1)),
      freshSha: initial.deploySha,
      currentMappings: mappings(history.at(-1)),
      appCandidateReceipt: null,
      appDeployment,
    }),
    activeTargets,
  );
  assert.equal(verified.journal.status, "verified");
  assert.equal(verified.journal.operations.at(-1).state, "verified");
  assert.equal(verified.journal.operations.at(-1).mappingState, "candidate");
  assert.equal(verified.afterUploadAction, "dispatch");
  assert.equal(verified.confirmedMutationCommands, 1);
  assert.equal(verified.possibleMutationCommands, 1);
});

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
      appCandidateReceipt: null,
      appDeployment: null,
    }),
    activeTargets,
  );
  assert.equal(verified.journal.status, "verified");
  assert.equal(verified.journal.operations.at(-1).state, "verified");
  assert.equal(verified.afterUploadAction, "dispatch");
});

test("the composite checkpoints the App attachment before a receipt-free second turn", () => {
  const steps = action.runs.steps;
  const attachment = steps.find((step) => step.id === "verify");
  const attachmentCheckpoint = steps.find(
    (step) => step.id === "checkpoint-verified",
  );
  const complete = steps.find((step) => step.id === "verify-app-candidate");
  const upload = steps.find((step) => step.id === "upload-app-verified");
  const checkpoint = steps.find(
    (step) => step.id === "checkpoint-app-verified",
  );

  assert.match(attachment.run, /active-event-verify-app/);
  assert.match(attachment.run, /--app-candidate-receipt/);
  assert.ok(
    attachmentCheckpoint,
    "missing durable checkpoint after receipt attachment",
  );
  assert.ok(complete, "missing the second App verification turn");
  assert.match(complete.if, /checkpoint-verified/);
  assert.match(complete.if, /after_upload_action == 'verify'/);
  assert.match(complete.if, /app_v3_deploy/);
  assert.match(complete.run, /active-freshness/);
  assert.match(complete.run, /current-receipt\.json/);
  assert.match(complete.run, /current-history\.json/);
  assert.match(complete.run, /install -m 0600 \/dev\/null/);
  assert.match(complete.run, /printf '%s\\n' null/);
  assert.match(complete.run, /active-event-verify-app/);
  assert.match(
    complete.run,
    /--app-candidate-receipt .*app-null-receipt\.json/,
  );
  assert.match(complete.run, /--app-deployment .*app-deployment\.json/);
  assert.doesNotMatch(complete.run, /jq -n/);
  assert.match(complete.run, /run-active/);
  assert.ok(upload, "missing upload of the completed App verification");
  assert.ok(checkpoint, "missing checkpoint of the completed App verification");
  assert.ok(steps.indexOf(attachmentCheckpoint) < steps.indexOf(complete));
  assert.ok(steps.indexOf(complete) < steps.indexOf(upload));
  assert.ok(steps.indexOf(upload) < steps.indexOf(checkpoint));
  assert.equal(
    steps.filter(
      (step) =>
        step.name === "Execute only the durably authorized Vercel command",
    ).length,
    1,
    "the composite must still authorize only one Vercel command",
  );
});
