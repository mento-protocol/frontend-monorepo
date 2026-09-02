import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMainForwardTransactionJournal,
  createMainInheritedRecoveryJournal,
} from "./vercel-main-release-journal.mjs";
import {
  createMainReleaseExecution,
  createMainReleaseSelection,
} from "./vercel-main-release-execution.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";

const SHA = "a".repeat(40);
const PRIOR_SHA = "b".repeat(40);
const TARGETS = ["app", "governance", "reserve", "ui"];
const RELEASE_ORDER = ["governance", "reserve", "ui", "app"];
const UPSTREAM_RUN_ID = "123";
const IDENTITY = Object.freeze({ runId: "800", runAttempt: "3" });

function plan(stagedTargets) {
  const selected = TARGETS.filter((target) => stagedTargets.includes(target));
  return {
    schema: "vercel-main-plan:v2",
    mode: "active",
    deploySha: SHA,
    mainOwnershipMode: Object.fromEntries(
      TARGETS.map((target) => [target, "github"]),
    ),
    plan: [...selected],
    stagedTargets: [...selected],
    activeTargets: [...selected],
    shadowTargets: [],
    priors: TARGETS.map((target) => ({
      target,
      aliases: [`${target}.mento.org`],
      deploymentId: `dpl_${target}Prior123`,
      deploymentUrl: `https://${target}-prior.vercel.app`,
      servedSha: PRIOR_SHA,
    })),
    ranges: [],
    reasons: [],
  };
}

function manifest(stagedTargets = []) {
  const planning = plan(stagedTargets);
  return createMainReleaseManifest({
    upstreamRunId: UPSTREAM_RUN_ID,
    plan: planning,
    originalPriors: Object.fromEntries(
      RELEASE_ORDER.map((target) => {
        const prior = planning.priors.find((entry) => entry.target === target);
        return [
          target,
          {
            deploymentId: prior.deploymentId,
            deploymentUrl: prior.deploymentUrl,
            aliases: prior.aliases,
            projectId: `prj_${target}`,
            projectName: `${target}.mento.org`,
            readyState: "READY",
            target: "production",
            customEnvironmentSlug: null,
            planningLeaves: prior.aliases.map((alias) => ({
              alias,
              deploymentId: prior.deploymentId,
              deploymentUrl: prior.deploymentUrl,
              aliases: prior.aliases,
              projectId: `prj_${target}`,
              projectName: `${target}.mento.org`,
              readyState: "READY",
              target: "production",
              customEnvironmentSlug: null,
              git: {
                status: "complete",
                org: "mento-protocol",
                repo: "frontend-monorepo",
                ref: "main",
                sha: PRIOR_SHA,
              },
            })),
            servedSha: PRIOR_SHA,
          },
        ];
      }),
    ),
  });
}

function execution(stagedTargets = []) {
  const release = manifest(stagedTargets);
  return createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: release,
    upstream: {
      runId: UPSTREAM_RUN_ID,
      runAttempt: "2",
      runUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${UPSTREAM_RUN_ID}/attempts/2`,
      buildAndTestJobUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${UPSTREAM_RUN_ID}/job/456`,
    },
    selection: createMainReleaseSelection({
      providerDiscoveryDigest: "c".repeat(64),
      planningSnapshotDigest: "d".repeat(64),
      rollbackOnlyTargets: release.rollbackOnlyTargets,
      projectIds: Object.fromEntries(
        RELEASE_ORDER.map((target) => [target, `prj_${target}`]),
      ),
      mode: release.mode,
      mainOwnershipMode: release.mainOwnershipMode,
      selectedManifest: release,
    }),
  });
}

function priorMappings(releaseExecution) {
  return {
    schema: "vercel-main-canonical-mappings:v1",
    mappings: Object.fromEntries(
      RELEASE_ORDER.map((target) => {
        const prior = releaseExecution.manifest.originalPriors[target];
        return [
          target,
          prior.aliases.map((alias) => ({
            alias,
            deploymentId: prior.deploymentId,
            deploymentUrl: prior.deploymentUrl,
          })),
        ];
      }),
    ),
  };
}

function emptyReceipts() {
  return { app: null, governance: null, reserve: null, ui: null };
}

function forwardJournal(overrides = {}) {
  const releaseExecution = overrides.execution ?? execution();
  return createMainForwardTransactionJournal({
    releaseExecution,
    currentMappings:
      overrides.currentMappings ?? priorMappings(releaseExecution),
    candidateReceipts: overrides.candidateReceipts ?? emptyReceipts(),
    ...IDENTITY,
  });
}

test("forward journal binds exactly the four reviewed protected targets", () => {
  const journal = forwardJournal();
  assert.deepEqual(Object.keys(journal.prior), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(Object.keys(journal.startMappings), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(Object.keys(journal.candidates), [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(journal.status, "prepared");
  assert.equal(journal.sequence, 0);
  assert.equal(journal.deploySha, SHA);
  assert.equal(journal.runId, IDENTITY.runId);
  assert.equal(journal.runAttempt, IDENTITY.runAttempt);
});

test("prior state copies each target's exact manifest prior identity", () => {
  const releaseExecution = execution();
  const journal = forwardJournal({ execution: releaseExecution });
  for (const target of ["app", "governance", "reserve", "ui"]) {
    const prior = releaseExecution.manifest.originalPriors[target];
    assert.deepEqual(journal.prior[target], {
      deploymentId: prior.deploymentId,
      deploymentUrl: prior.deploymentUrl,
      aliases: [...prior.aliases],
    });
    assert.deepEqual(
      journal.startMappings[target].map(({ alias }) => alias),
      [...prior.aliases],
    );
    for (const mapping of journal.startMappings[target]) {
      assert.equal(mapping.deploymentId, prior.deploymentId);
      assert.equal(mapping.deploymentUrl, prior.deploymentUrl);
    }
  }
});

// MGP-18 retired the legacy App deployment. The canonical mapping set is
// exactly the four release targets; a fifth key can never re-enter it.
test("canonical mappings reject a retired legacy target, extra keys, and gaps", () => {
  const releaseExecution = execution();
  const base = priorMappings(releaseExecution);
  const withLegacy = structuredClone(base);
  withLegacy.mappings["legacy-app"] = [
    {
      alias: "v2-app.mento.org",
      deploymentId: "dpl_legacyPrior123",
      deploymentUrl: "https://legacy-prior.vercel.app",
    },
  ];
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: withLegacy,
      }),
    /mapping targets contains forbidden or missing fields/,
  );

  const missingTarget = structuredClone(base);
  delete missingTarget.mappings.ui;
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: missingTarget,
      }),
    /mapping targets contains forbidden or missing fields/,
  );

  const reordered = {
    schema: base.schema,
    mappings: Object.fromEntries(
      ["app", "governance", "reserve", "ui"].map((target) => [
        target,
        base.mappings[target],
      ]),
    ),
  };
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: reordered,
      }),
    /mapping targets contains forbidden or missing fields/,
  );

  const wrongSchema = structuredClone(base);
  wrongSchema.schema = "vercel-main-canonical-mappings:v2";
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: wrongSchema,
      }),
    /canonical mappings schema is unsupported/,
  );

  const extraField = structuredClone(base);
  extraField.mappings.app[0].projectId = "prj_app";
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: extraField,
      }),
    /mapping contains forbidden or missing fields/,
  );
});

test("canonical mappings reject incomplete alias coverage and noncanonical order", () => {
  const releaseExecution = execution();
  const base = priorMappings(releaseExecution);

  const shortAliases = structuredClone(base);
  shortAliases.mappings.app = shortAliases.mappings.app.slice(1);
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: shortAliases,
      }),
    /app mappings are incomplete/,
  );

  // Every reviewed target maps exactly one alias, so noncanonical order is
  // only observable on a target with an appended second mapping.
  const swappedAliases = structuredClone(base);
  swappedAliases.mappings.app = [
    {
      ...swappedAliases.mappings.app[0],
      alias: "zzz-app.mento.org",
    },
    ...swappedAliases.mappings.app,
  ];
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: swappedAliases,
      }),
    /app aliases are not canonical|app mappings are incomplete/,
  );

  const malformedId = structuredClone(base);
  malformedId.mappings.governance[0].deploymentId = "governance-prior";
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        currentMappings: malformedId,
      }),
    /governance deployment ID is malformed/,
  );
});

test("forward journal rejects a receipt for an unselected target", () => {
  const releaseExecution = execution();
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        candidateReceipts: { ...emptyReceipts(), ui: { forged: true } },
      }),
    /receipt exists for unselected ui/,
  );
  assert.throws(
    () =>
      forwardJournal({
        execution: releaseExecution,
        candidateReceipts: {
          governance: null,
          app: null,
          reserve: null,
          ui: null,
        },
      }),
    /candidate receipts contains forbidden or missing fields/,
  );
});

test("forward journal rejects a malformed downstream attempt identity", () => {
  const releaseExecution = execution();
  for (const [runId, runAttempt] of [
    ["0", "3"],
    ["800", "0"],
    ["not-a-run", "3"],
  ]) {
    assert.throws(
      () =>
        createMainForwardTransactionJournal({
          releaseExecution,
          currentMappings: priorMappings(releaseExecution),
          candidateReceipts: emptyReceipts(),
          runId,
          runAttempt,
        }),
      /is malformed/,
    );
  }
});

test("inherited recovery journal requires a restore-before-planning decision", () => {
  assert.throws(
    () =>
      createMainInheritedRecoveryJournal({
        preplan: {
          schema: "vercel-main-preplan-reconciliation:v2",
          decision: "capture-new-baseline",
          reason: "no-mapped-release-metadata",
          rollbackOnlyTargets: [],
          reconciliation: null,
          rollbackAuthorization: null,
        },
        nextDeploySha: SHA,
        nextUpstreamRunId: UPSTREAM_RUN_ID,
        currentMappings: priorMappings(execution()),
        candidateReceipts: emptyReceipts(),
        ...IDENTITY,
      }),
    /requires restore decision|malformed|forbidden/,
  );
});
