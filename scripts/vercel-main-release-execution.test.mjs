import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertMainReleaseExecution,
  createMainReleaseExecution,
  createMainReleaseSelection,
  decodeMainReleaseExecution,
  digestMainReleaseExecution,
  encodeMainReleaseExecution,
} from "./vercel-main-release-execution.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";

const SHA = "a".repeat(40);
const PRIOR_SHA = "b".repeat(40);
const TARGETS = ["app", "governance", "reserve", "ui"];
const RELEASE_ORDER = ["governance", "reserve", "ui", "app"];

function plan(stagedTargets = TARGETS) {
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

function originalPriors(planning) {
  return Object.fromEntries(
    RELEASE_ORDER.map((target) =>
      planning.priors.find((prior) => prior.target === target),
    ).map((prior) => [
      prior.target,
      {
        deploymentId: prior.deploymentId,
        deploymentUrl: prior.deploymentUrl,
        aliases: prior.aliases,
        projectId: `prj_${prior.target}`,
        projectName: `${prior.target}.mento.org`,
        readyState: "READY",
        target: "production",
        customEnvironmentSlug: null,
        planningLeaves: prior.aliases.map((alias) => ({
          alias,
          deploymentId: prior.deploymentId,
          deploymentUrl: prior.deploymentUrl,
          aliases: prior.aliases,
          projectId: `prj_${prior.target}`,
          projectName: `${prior.target}.mento.org`,
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
    ]),
  );
}

function manifest(stagedTargets = TARGETS) {
  const planning = plan(stagedTargets);
  return createMainReleaseManifest({
    upstreamRunId: "123",
    plan: planning,
    originalPriors: originalPriors(planning),
  });
}

function execution(stagedTargets = TARGETS) {
  const release = manifest(stagedTargets);
  return createMainReleaseExecution({
    decision:
      stagedTargets.length === 0
        ? "capture-new-baseline"
        : "resume-existing-release",
    reason:
      stagedTargets.length === 0
        ? "no-mapped-release-metadata"
        : "current-main-release-is-an-interrupted-prefix",
    manifest: release,
    upstream: {
      runId: "123",
      runAttempt: "2",
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/2",
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/456",
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

test("release execution derives its entire operational projection from the stable manifest", () => {
  const value = execution(["governance", "app"]);
  assert.deepEqual(value.projection, {
    projectIds: {
      governance: "prj_governance",
      reserve: "prj_reserve",
      ui: "prj_ui",
      app: "prj_app",
    },
    stagedTargets: ["governance", "app"],
    activeTargets: ["governance", "app"],
    shadowTargets: [],
    noTarget: false,
  });
  assert.equal(value.upstream.runId, value.manifest.upstreamRunId);
});

test("no-target is represented by one manifest-derived execution without candidate state", () => {
  const value = execution([]);
  assert.equal(value.projection.noTarget, true);
  assert.deepEqual(value.projection.stagedTargets, []);
  assert.deepEqual(value.projection.activeTargets, []);
});

test("execution encoding is canonical and identity-bound", () => {
  const value = execution(["reserve"]);
  const encoded = encodeMainReleaseExecution(value);
  assert.deepEqual(
    decodeMainReleaseExecution(encoded, {
      deploySha: SHA,
      upstreamRunId: "123",
      releaseId: value.manifest.releaseId,
    }),
    value,
  );
  assert.match(digestMainReleaseExecution(value), /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      decodeMainReleaseExecution(encoded, {
        deploySha: "e".repeat(40),
      }),
    /expected SHA/,
  );
});

test("execution rejects an altered projection, selection, or current upstream", () => {
  const value = execution(["ui"]);
  assert.throws(
    () =>
      assertMainReleaseExecution({
        ...value,
        projection: { ...value.projection, noTarget: true },
      }),
    /projection differs/,
  );
  assert.throws(
    () =>
      assertMainReleaseExecution({
        ...value,
        selection: {
          ...value.selection,
          planningSnapshotDigest: "invalid",
        },
      }),
    /planning snapshot digest/,
  );
  assert.throws(
    () =>
      assertMainReleaseExecution({
        ...value,
        upstream: { ...value.upstream, runId: "124" },
      }),
    /stable manifest/,
  );
});

test("execution selection binds discovery, projects, manifest, and ownership", () => {
  const value = execution(["governance"]);
  for (const selection of [
    { ...value.selection, providerDiscoveryDigest: "invalid" },
    {
      ...value.selection,
      projectIds: {
        ...value.selection.projectIds,
        governance: "prj_other",
      },
    },
    {
      ...value.selection,
      mode: "shadow",
    },
    {
      ...value.selection,
      mainOwnershipMode: {
        ...value.selection.mainOwnershipMode,
        ui: "shadow",
      },
    },
    {
      ...value.selection,
      selectedManifest: {
        ...value.selection.selectedManifest,
        releasePlanDigest: "e".repeat(64),
      },
    },
  ]) {
    assert.throws(
      () => assertMainReleaseExecution({ ...value, selection }),
      /selection|manifest/,
    );
  }
});

test("execution rechecks fresh rollback-only coverage for reuse", () => {
  const value = execution(["governance"]);
  for (const [decision, reason] of [
    [
      "resume-existing-release",
      "current-main-release-is-an-interrupted-prefix",
    ],
    ["verify-existing-release", "current-main-release-already-complete"],
  ]) {
    assert.throws(
      () =>
        assertMainReleaseExecution({
          ...value,
          decision,
          reason,
          selection: {
            ...value.selection,
            rollbackOnlyTargets: ["ui"],
          },
        }),
      /omits fresh rollback-only targets: ui/,
      decision,
    );
  }
  assert.deepEqual(
    assertMainReleaseExecution({
      ...value,
      selection: {
        ...value.selection,
        rollbackOnlyTargets: ["governance"],
      },
    }).selection.rollbackOnlyTargets,
    ["governance"],
  );
});

test("capture-new execution binds the fresh rollback-only set exactly", () => {
  const value = execution(["governance"]);
  assert.throws(
    () =>
      assertMainReleaseExecution({
        ...value,
        decision: "capture-new-baseline",
        reason: "no-mapped-release-metadata",
        selection: {
          ...value.selection,
          rollbackOnlyTargets: ["governance"],
        },
      }),
    /manifest conflicts with fresh rollback-only targets/,
  );
});

test("execution binds both upstream URLs to the exact repository run and attempt", () => {
  const value = execution(["governance"]);
  for (const upstream of [
    {
      ...value.upstream,
      runUrl: "https://github.com/other/frontend-monorepo/actions/runs/123",
    },
    {
      ...value.upstream,
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/124",
    },
    {
      ...value.upstream,
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123",
    },
    {
      ...value.upstream,
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/3",
    },
    {
      ...value.upstream,
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/124/job/456",
    },
    {
      ...value.upstream,
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/0",
    },
    {
      ...value.upstream,
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/456?attempt=2",
    },
  ]) {
    assert.throws(
      () => assertMainReleaseExecution({ ...value, upstream }),
      /exact repository run|malformed/,
    );
  }
});

// The retired legacy App deployment owned the execution's ninth key and the
// selection's fifth. Neither may re-enter a canonical execution.
test("execution and selection reject retired legacy App v2 fields", () => {
  const value = execution(["app"]);
  assert.deepEqual(Object.keys(value), [
    "schema",
    "decision",
    "reason",
    "manifest",
    "upstream",
    "selection",
    "projection",
  ]);
  assert.deepEqual(Object.keys(value.selection), [
    "schema",
    "providerDiscoveryDigest",
    "planningSnapshotDigest",
    "rollbackOnlyTargets",
    "projectIds",
    "mode",
    "mainOwnershipMode",
    "selectedManifest",
  ]);
  assert.throws(
    () =>
      assertMainReleaseExecution({
        ...value,
        legacyAppV2: { alias: "v2-app.mento.org" },
      }),
    /Main release execution contains forbidden or missing fields/,
  );
  assert.throws(
    () =>
      assertMainReleaseExecution({
        ...value,
        selection: {
          ...value.selection,
          legacyAppV2Digest: "f".repeat(64),
        },
      }),
    /Main release selection contains forbidden or missing fields/,
  );
});
