import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createMainCandidateIntent } from "./vercel-main-candidate.mjs";
import {
  discoverMainPreplanCandidateReleases,
  preflightMainCandidateProvider,
} from "./vercel-main-candidate-controller.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  createMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";
import { planMainDeployments } from "./vercel-main-plan.mjs";

const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);

function intent() {
  const input = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  for (const target of ["app", "governance", "reserve", "ui"]) {
    for (const state of input.priorStates[target].states) {
      state.git.sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    }
  }
  const plan = planMainDeployments({
    mode: input.mode,
    mainOwnershipMode: input.mainOwnershipMode,
    deploySha: input.deploySha,
    projectIds: input.projectIds,
    priorStates: input.priorStates,
    rollbackOnlyTargets: [],
    gitAdapter: {
      firstParent: () => input.firstParent,
      isAncestor: () => true,
      resolveCommit: (sha) => sha,
    },
    runPlanner: ({ base, head }) => ({
      base,
      head,
      deployments: ["app", "governance", "reserve", "ui"],
      reason: "global-build-input",
    }),
  });
  const originalPriors = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => {
      const state = input.priorStates[target].states[0];
      const prior = plan.priors.find((entry) => entry.target === target);
      return [
        target,
        {
          deploymentId: prior.deploymentId,
          deploymentUrl: prior.deploymentUrl,
          aliases: prior.aliases,
          projectId: state.projectId,
          projectName: state.projectName,
          readyState: "READY",
          target: state.target,
          customEnvironmentSlug: state.customEnvironmentSlug,
          planningLeaves: input.priorStates[target].states.map((leaf) => ({
            alias: leaf.alias,
            deploymentId: prior.deploymentId,
            deploymentUrl: prior.deploymentUrl,
            aliases: prior.aliases,
            projectId: state.projectId,
            projectName: state.projectName,
            readyState: "READY",
            target: state.target,
            customEnvironmentSlug: state.customEnvironmentSlug,
            git: { status: "complete", ...leaf.git },
          })),
          servedSha: prior.servedSha,
        },
      ];
    }),
  );
  const releaseManifest = createMainReleaseManifest({
    upstreamRunId: "700",
    plan,
    originalPriors,
  });
  return createMainCandidateIntent({
    target: "ui",
    deploySha: "dddddddddddddddddddddddddddddddddddddddd",
    upstreamRunId: "700",
    originRunId: "800",
    originAttempt: "1",
    originTransactionId: "main-0123456789abcdef0123456789abcdef",
    projectId: releaseManifest.originalPriors.ui.projectId,
    releaseManifest,
  });
}

function listing(deploymentIds) {
  return { deploymentIds, complete: true };
}

function mappingsFromManifest(manifest) {
  return Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
      target,
      manifest.originalPriors[target].aliases.map((alias) => ({
        alias,
        deploymentId: manifest.originalPriors[target].deploymentId,
        deploymentUrl: manifest.originalPriors[target].deploymentUrl,
      })),
    ]),
  );
}

function projectIdsFromManifest(manifest) {
  return Object.fromEntries(
    ["app", "governance", "reserve", "ui"].map((target) => [
      target,
      manifest.originalPriors[target].projectId,
    ]),
  );
}

test("preflight requires two stable zero censuses before create", async () => {
  let calls = 0;
  const result = await preflightMainCandidateProvider({
    intent: intent(),
    provider: {
      listCandidateDeploymentIds: async () => {
        calls += 1;
        return listing([]);
      },
      inspectCandidate: async () => assert.fail("zero census cannot inspect"),
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.outcome, "create-if-zero");
});

test("preflight rejects eventual visibility and deletion between censuses", async () => {
  for (const observations of [
    [[], ["dpl_0123456789abcdef"]],
    [["dpl_0123456789abcdef"], []],
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        preflightMainCandidateProvider({
          intent: intent(),
          provider: {
            listCandidateDeploymentIds: async () =>
              listing(observations[calls++]),
            inspectCandidate: async () =>
              assert.fail("unstable census cannot inspect"),
          },
        }),
      /census changed/,
    );
    assert.equal(calls, 2);
  }
});

test("preflight rejects a duplicate census and relists before inspecting reuse", async () => {
  await assert.rejects(
    () =>
      preflightMainCandidateProvider({
        intent: intent(),
        provider: {
          listCandidateDeploymentIds: async () =>
            listing(["dpl_0123456789abcdef", "dpl_abcdef0123456789"]),
          inspectCandidate: async () =>
            assert.fail("duplicate census cannot inspect"),
        },
      }),
    /multiple candidates/,
  );
  let calls = 0;
  await assert.rejects(
    () =>
      preflightMainCandidateProvider({
        intent: intent(),
        provider: {
          listCandidateDeploymentIds: async () => {
            calls += 1;
            return listing(["dpl_0123456789abcdef"]);
          },
          inspectCandidate: async () => {
            throw new Error("inspect after stable census");
          },
        },
      }),
    /inspect after stable census/,
  );
  assert.equal(calls, 2);
});

test("pre-plan discovery expands mapped release metadata into exact staged candidates", async () => {
  const currentIntent = intent();
  const manifest = currentIntent.releaseManifest;
  const currentMappings = mappingsFromManifest(manifest);
  currentMappings.governance = currentMappings.governance.map((mapping) => ({
    ...mapping,
    deploymentId: "dpl_governanceCandidate123",
    deploymentUrl: "governance-candidate.vercel.app",
  }));
  const inspections = [];
  const resolutions = [];
  const result = await discoverMainPreplanCandidateReleases({
    currentMappings,
    projectIds: projectIdsFromManifest(manifest),
    provider: {
      inspectMappedCandidate: async ({ deploymentId, target }) => {
        inspections.push({ deploymentId, target });
        return {
          canonicalState: {},
          metadata:
            deploymentId === "dpl_governanceCandidate123"
              ? { releaseManifest: manifest }
              : null,
        };
      },
      resolveReleaseCandidate: async ({ target }) => {
        resolutions.push(target);
        return {
          intent: {},
          candidate: {
            deploymentId: `dpl_${target}Candidate123`,
            deploymentUrl: `${target}-candidate.vercel.app`,
          },
        };
      },
    },
  });
  assert.equal(result.schema, "vercel-main-preplan-candidate-discovery:v2");
  assert.deepEqual(result.rollbackOnlyTargets, ["app", "reserve", "ui"]);
  assert.equal(result.candidateReleases.length, 1);
  assert.deepEqual(
    Object.keys(result.candidateReleases[0].candidates),
    manifest.stagedTargets,
  );
  assert.deepEqual(resolutions, manifest.stagedTargets);
  assert.equal(
    inspections.filter(({ target }) => target === "app").length,
    1,
    "duplicate App aliases on one deployment are inspected once",
  );
});

test("pre-plan discovery marks every fully native mapping rollback-only", async () => {
  const manifest = intent().releaseManifest;
  let resolutions = 0;
  const result = await discoverMainPreplanCandidateReleases({
    currentMappings: mappingsFromManifest(manifest),
    projectIds: projectIdsFromManifest(manifest),
    provider: {
      inspectMappedCandidate: async () => {
        return {
          canonicalState: {},
          metadata: null,
        };
      },
      resolveReleaseCandidate: async () => {
        resolutions += 1;
        return null;
      },
    },
  });
  assert.deepEqual(result.candidateReleases, []);
  assert.deepEqual(result.rollbackOnlyTargets, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.equal(resolutions, 0);
});
