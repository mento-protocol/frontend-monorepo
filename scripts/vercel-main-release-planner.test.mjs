import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAIN_TARGET_CONTRACTS } from "./vercel-main-plan.mjs";
import { createMainReleaseBaseline } from "./vercel-main-release-planner.mjs";
import { recomputeMainReleasePlan } from "./vercel-main-release-reconciliation.mjs";
import { PRODUCTION_GENERATED_ALIAS_CONTRACTS } from "./vercel-production-generated-aliases.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const TARGETS = ["app", "governance", "reserve", "ui"];
const ALIASES = {
  app: ["app.mento.org", "appmentoorg-env-v3-mentolabs.vercel.app"],
  governance: ["governance.mento.org"],
  reserve: ["reserve.mento.org"],
  ui: ["ui.mento.org"],
};
const PRODUCTION_PRIORS = JSON.parse(
  readFileSync(
    new URL("./fixtures/vercel-main-plan/valid-priors.json", import.meta.url),
    "utf8",
  ),
);

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
    aliases:
      target === "app"
        ? [...ALIASES[target]].sort()
        : [
            ...ALIASES[target],
            PRODUCTION_GENERATED_ALIAS_CONTRACTS[target].generatedProjectAlias,
          ].toSorted(),
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

function productionSnapshot() {
  return {
    schema: "vercel-main-planning-snapshot:v1",
    states: TARGETS.flatMap((target) =>
      structuredClone(PRODUCTION_PRIORS.priorStates[target].states),
    ).sort((left, right) => left.alias.localeCompare(right.alias)),
  };
}

function ordinaryGeneratedAliasSubsets(target) {
  const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
  return [
    contract.generatedProjectAlias,
    `${contract.generatedProjectSlug}-fixture-author-${contract.generatedScopeSlug}.vercel.app`,
    contract.generatedGitMainAlias,
  ].reduce(
    (subsets, alias) => [
      ...subsets,
      ...subsets.map((subset) => [...subset, alias].toSorted()),
    ],
    [[]],
  );
}

function productionBaseline(planningSnapshot = productionSnapshot()) {
  const gitAdapter = {
    resolveCommit: (sha) => sha,
    isAncestor: () => true,
    firstParent: () => PRODUCTION_PRIORS.firstParent,
  };
  const runPlanner = ({ base, head }) => ({
    base,
    deployments: TARGETS.filter(
      (target) =>
        PRODUCTION_PRIORS.priorStates[target].states[0].git.sha === base,
    ),
    head,
    reason: "affected-packages",
  });
  const result = createMainReleaseBaseline({
    mode: PRODUCTION_PRIORS.mode,
    mainOwnershipMode: PRODUCTION_PRIORS.mainOwnershipMode,
    deploySha: PRODUCTION_PRIORS.deploySha,
    upstreamRunId: "123",
    projectIds: PRODUCTION_PRIORS.projectIds,
    planningSnapshot,
    rollbackOnlyTargets: [],
    gitAdapter,
    runPlanner,
  });
  return { ...result, gitAdapter, runPlanner };
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

test("baseline canonicalizes production generated-alias supersets and recomputes the exact plan", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    assert.ok(
      PRODUCTION_PRIORS.priorStates[target].states[0].aliases.length >
        MAIN_TARGET_CONTRACTS[target].aliases.length,
    );
  }

  const { manifest, planning, gitAdapter, runPlanner } = productionBaseline();
  for (const target of TARGETS) {
    for (const leaf of manifest.originalPriors[target].planningLeaves) {
      assert.deepEqual(leaf.aliases, [
        ...MAIN_TARGET_CONTRACTS[target].aliases,
      ]);
    }
  }
  assert.deepEqual(
    recomputeMainReleasePlan({ manifest, gitAdapter, runPlanner }),
    planning,
  );
});

test("baseline accepts every finite ordinary generated-alias subset and recomputes exactly", () => {
  for (const target of ["governance", "reserve", "ui"]) {
    for (const generatedAliases of ordinaryGeneratedAliasSubsets(target)) {
      const census = productionSnapshot();
      for (const state of census.states.filter(
        ({ projectName }) =>
          projectName === MAIN_TARGET_CONTRACTS[target].projectName,
      )) {
        state.aliases = [
          ...MAIN_TARGET_CONTRACTS[target].aliases,
          ...generatedAliases,
        ].toSorted();
      }

      const { manifest, planning, gitAdapter, runPlanner } =
        productionBaseline(census);
      const first = recomputeMainReleasePlan({
        manifest,
        gitAdapter,
        runPlanner,
      });
      const second = recomputeMainReleasePlan({
        manifest,
        gitAdapter,
        runPlanner,
      });
      const label = `${target}: ${JSON.stringify(generatedAliases)}`;
      assert.deepEqual(first, planning, label);
      assert.deepEqual(second, planning, label);
      assert.equal(JSON.stringify(first), JSON.stringify(planning), label);
      assert.equal(JSON.stringify(second), JSON.stringify(first), label);
    }
  }
});

test("production-shaped baseline alias supersets remain fail-closed", () => {
  const cases = [
    {
      name: "App extra alias",
      target: "app",
      mutate(aliases) {
        aliases.push("appmentoorg-git-main-mentolabs.vercel.app");
        aliases.sort();
      },
      error: /alias-set-ambiguous/,
    },
    {
      name: "missing reviewed alias",
      target: "governance",
      mutate(aliases) {
        aliases.splice(aliases.indexOf("governance.mento.org"), 1);
      },
      error: /alias-set-ambiguous/,
    },
    {
      name: "unsorted aliases",
      target: "reserve",
      mutate(aliases) {
        aliases.reverse();
      },
      error: /Canonical deployment aliases are malformed/,
    },
    {
      name: "duplicate alias",
      target: "ui",
      mutate(aliases) {
        aliases.push(aliases.at(-1));
      },
      error: /Canonical deployment aliases are malformed/,
    },
    {
      name: "malformed alias",
      target: "governance",
      mutate(aliases) {
        aliases.push("https://attacker.invalid/path");
        aliases.sort();
      },
      error: /Alias hostname is malformed/,
    },
  ];

  for (const scenario of cases) {
    const census = productionSnapshot();
    for (const state of census.states.filter(
      ({ projectName }) =>
        projectName === MAIN_TARGET_CONTRACTS[scenario.target].projectName,
    )) {
      scenario.mutate(state.aliases);
    }
    assert.throws(
      () => productionBaseline(census),
      scenario.error,
      scenario.name,
    );
  }
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
