import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import { planMainDeployments } from "./vercel-main-plan.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import {
  normalizeVercelDeploymentPages,
  VERCEL_DEPLOYMENT_PAGES_SCHEMA,
} from "./vercel-cost-deployment-census.mjs";

const TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const TEAM_ID = "team_mento123";
const PROJECT_IDS = Object.freeze({
  app: "prj_app123",
  governance: "prj_governance123",
  reserve: "prj_reserve123",
  ui: "prj_ui123",
});
const READY_STATES = Object.freeze({
  ready: "READY",
  error: "ERROR",
  canceled: "CANCELED",
});
const planFixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseManifest(deploySha, projectIds) {
  const input = JSON.parse(readFileSync(planFixtureUrl, "utf8"));
  const priorSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  input.deploySha = deploySha;
  input.projectIds = projectIds;
  for (const target of TARGETS) {
    for (const state of input.priorStates[target].states) {
      state.git.sha = priorSha;
      state.projectId = projectIds[target];
    }
  }
  const plan = planMainDeployments({
    mode: input.mode,
    mainOwnershipMode: input.mainOwnershipMode,
    deploySha,
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
      deployments: TARGETS,
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
  return createMainReleaseManifest({
    upstreamRunId: "700",
    plan,
    originalPriors,
  });
}

function gitMetadata(sha, ref) {
  return {
    githubCommitOrg: "mento-protocol",
    githubCommitRepo: "frontend-monorepo",
    githubCommitRef: ref,
    githubCommitSha: sha,
  };
}

function mainMetadata(row, projectIds) {
  const intent = createMainCandidateIntent({
    target: row.target,
    deploySha: row.sourceSha,
    upstreamRunId: "700",
    originRunId: "800",
    originAttempt: "1",
    originTransactionId: "main-0123456789abcdef0123456789abcdef",
    projectId: projectIds[row.target],
    releaseManifest: releaseManifest(row.sourceSha, projectIds),
  });
  return {
    ...gitMetadata(row.sourceSha, "main"),
    ...createMainCandidateVercelMetadata({ intent }),
  };
}

function rawDeployment(row, pullRequestNumber, projectIds) {
  const value = {
    uid: row.deploymentId,
    projectId: projectIds[row.target],
    createdAt: Date.parse(row.createdAtUtc),
    readyState: READY_STATES[row.outcome],
    url: new URL(row.evidenceUrl).hostname,
  };
  if (row.source === "github-actions-prebuilt") {
    value.prebuilt = true;
    if (row.path === "preview") {
      value.meta = {
        ...gitMetadata(row.sourceSha, `fixture/pr-${pullRequestNumber}`),
        mentoControllerKey: `vercel-preview:v1:pr:${pullRequestNumber}:target:${row.target}:sha:${row.sourceSha}`,
      };
    } else {
      value.meta = mainMetadata(row, projectIds);
      if (row.target === "app") {
        value.customEnvironment = { slug: "v3" };
      } else {
        value.target = "production";
      }
    }
  } else if (
    ["vercel-native", "vercel-native-suppressed"].includes(row.source)
  ) {
    value.prebuilt = false;
    value.meta = gitMetadata(
      row.sourceSha,
      row.path === "legacy-v2" ? "v2" : row.path,
    );
    if (row.source === "vercel-native-suppressed") {
      value.source = "git";
    }
    if (["main", "legacy-v2"].includes(row.path)) {
      value.target = "production";
    }
  }
  return value;
}

function parseRows(raw) {
  return raw
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function createSyntheticVercelDeploymentEvidence({
  directory,
  name,
  censusRaw,
  startUtc,
  endUtcExclusive,
  projectIds = PROJECT_IDS,
}) {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtcExclusive);
  const rows = parseRows(censusRaw);
  const annotations = {};
  let pullRequestNumber = 1;
  const projects = TARGETS.map((target) => {
    const targetRows = rows.filter((row) => row.target === target);
    const deployments = targetRows.map((row) => {
      annotations[row.deploymentId] = {
        path: row.path,
        source: row.source,
        evidenceUrl: row.evidenceUrl,
      };
      const deployment = rawDeployment(row, pullRequestNumber, projectIds);
      pullRequestNumber += 1;
      return deployment;
    });
    return {
      target,
      projectId: projectIds[target],
      query: {
        path: "/v7/deployments",
        teamId: TEAM_ID,
        projectId: projectIds[target],
        since: start - 1,
        until: end,
        limit: 100,
      },
      pages: [
        {
          requestCursor: end,
          response: {
            deployments,
            pagination: {
              count: deployments.length,
              next: null,
              prev: null,
            },
          },
        },
      ],
    };
  });
  const input = `${JSON.stringify({
    schema: VERCEL_DEPLOYMENT_PAGES_SCHEMA,
    window: { startUtc, endUtcExclusive },
    projects,
    annotations,
  })}\n`;
  const normalized = normalizeVercelDeploymentPages(input);
  assert.equal(normalized.output, censusRaw);
  const pagesPath = join(directory, `${name}.deployment-pages.json`);
  const proofPath = join(directory, `${name}.deployment-census-proof.json`);
  writeFileSync(pagesPath, input, { mode: 0o600 });
  writeFileSync(proofPath, normalized.proof, { mode: 0o600 });
  return {
    pagesPath,
    pagesSha256: sha256(input),
    proofPath,
    proofSha256: sha256(normalized.proof),
    censusSha256: normalized.proofObject.outputSha256,
  };
}
