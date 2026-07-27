import assert from "node:assert/strict";
import { test } from "node:test";

import { createMainReleaseBaseline } from "./vercel-main-release-planner.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const TARGETS = ["app", "governance", "reserve", "ui"];
const ALIASES = {
  app: ["app.mento.org", "appmentoorg-env-v3-mentolabs.vercel.app"],
  governance: ["governance.mento.org"],
  reserve: ["reserve.mento.org"],
  ui: ["ui.mento.org"],
};

function state(target, alias, git = {}) {
  return {
    alias,
    deploymentId: `dpl_${target}Prior123`,
    deploymentUrl: `https://${target}-prior.vercel.app`,
    creatorUsername: "mentolabs",
    projectId: `prj_${target}`,
    projectName: `${target}.mento.org`,
    readyState: "READY",
    target: target === "app" ? null : "production",
    customEnvironmentSlug: target === "app" ? "v3" : null,
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "main",
      sha: BASE,
      ...git,
    },
    aliases: [...ALIASES[target]].sort(),
  };
}

function snapshot(overrides = {}) {
  return {
    schema: "vercel-main-planning-snapshot:v1",
    states: TARGETS.flatMap((target) =>
      ALIASES[target].map((alias) =>
        state(target, alias, overrides[target] ?? {}),
      ),
    ).sort((left, right) => left.alias.localeCompare(right.alias)),
  };
}

function baseline(planningSnapshot = snapshot()) {
  return createMainReleaseBaseline({
    mode: "active",
    mainOwnershipMode: Object.fromEntries(
      TARGETS.map((target) => [target, "github"]),
    ),
    deploySha: HEAD,
    upstreamRunId: "123",
    projectIds: Object.fromEntries(
      TARGETS.map((target) => [target, `prj_${target}`]),
    ),
    planningSnapshot,
    rollbackOnlyTargets: [],
    gitAdapter: {
      resolveCommit: (sha) => sha,
      isAncestor: () => true,
      firstParent: () => BASE,
    },
    runPlanner: () => ({
      base: BASE,
      deployments: ["governance", "ui"],
      head: HEAD,
      reason: "affected-packages",
    }),
  });
}

test("baseline creates one exact manifest directly from the provider planning snapshot", () => {
  const value = baseline();
  assert.deepEqual(value.planning.stagedTargets, ["governance", "ui"]);
  assert.deepEqual(value.manifest.stagedTargets, ["governance", "ui"]);
  assert.deepEqual(value.manifest.activeTargets, ["governance", "ui"]);
  assert.equal(value.manifest.deploySha, HEAD);
  assert.equal(value.manifest.upstreamRunId, "123");
  assert.equal(value.manifest.originalPriors.app.planningLeaves.length, 2);
});

test("baseline preserves fail-closed missing Git evidence inside the manifest", () => {
  const missing = snapshot();
  missing.states.find(({ alias }) => alias === "reserve.mento.org").git = null;
  const value = baseline(missing);
  assert.ok(value.planning.stagedTargets.includes("reserve"));
  assert.equal(
    value.manifest.originalPriors.reserve.planningLeaves[0].git.status,
    "missing",
  );
});

test("baseline rejects a snapshot whose aliases disagree on one prior", () => {
  const ambiguous = snapshot();
  ambiguous.states.find(({ alias }) => alias === "app.mento.org").deploymentId =
    "dpl_otherAppPrior123";
  assert.throws(
    () => baseline(ambiguous),
    /rollback-target-ambiguous|prior is ambiguous/,
  );
});
