import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import { resolveMainCandidateHandoff } from "./vercel-main-candidate-controller.mjs";
import { createMainCandidateVercelProvider } from "./vercel-main-candidate-provider.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import { planMainDeployments } from "./vercel-main-plan.mjs";

const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);

function releaseManifest() {
  const input = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  const priorSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  for (const target of ["app", "governance", "reserve", "ui"]) {
    for (const state of input.priorStates[target].states)
      state.git.sha = priorSha;
  }
  const plan = planMainDeployments({
    mode: input.mode,
    mainOwnershipMode: input.mainOwnershipMode,
    deploySha: input.deploySha,
    projectIds: input.projectIds,
    priorStates: input.priorStates,
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
  return createMainReleaseManifest({
    upstreamRunId: "700",
    plan,
    originalPriors,
  });
}

function intent(target = "ui") {
  const manifest = releaseManifest();
  return createMainCandidateIntent({
    target,
    deploySha: "dddddddddddddddddddddddddddddddddddddddd",
    upstreamRunId: "700",
    originRunId: "800",
    originAttempt: "1",
    originTransactionId: "main-0123456789abcdef0123456789abcdef",
    projectId: manifest.originalPriors[target].projectId,
    releaseManifest: manifest,
  });
}

function deploymentResponse(
  currentIntent,
  { id = "dpl_0123456789abcdef", githubDeployment = false } = {},
) {
  return {
    id,
    url: `${currentIntent.target}-candidate.vercel.app`,
    projectId: currentIntent.projectId,
    name: currentIntent.projectName,
    readyState: "READY",
    target: currentIntent.environment.target,
    customEnvironment:
      currentIntent.environment.customEnvironmentSlug === null
        ? undefined
        : { slug: currentIntent.environment.customEnvironmentSlug },
    source: "cli",
    creator: { uid: "user_fixture123", username: "chapati" },
    meta: {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
      githubCommitSha: currentIntent.deploySha,
      ...createMainCandidateVercelMetadata({ intent: currentIntent }),
      ...(githubDeployment ? { githubDeployment: "1" } : {}),
    },
  };
}

test("provider lists a complete bounded project and stable-identity census", async () => {
  const currentIntent = intent();
  const calls = [];
  const provider = createMainCandidateVercelProvider({
    intent: currentIntent,
    client: {
      requestWithRetry: async (path) => {
        calls.push(path);
        return {
          deployments: [{ uid: "dpl_0123456789abcdef" }],
          pagination: { next: null },
        };
      },
    },
  });
  assert.deepEqual(await provider.listCandidateDeploymentIds(), {
    deploymentIds: ["dpl_0123456789abcdef"],
    complete: true,
  });
  assert.match(calls[0], /projectId=prj_ui/);
  assert.match(calls[0], /meta-mentoReleaseId=/);
  assert.match(calls[0], /meta-mentoCandidateId=/);
  assert.doesNotMatch(
    calls[0],
    /target=/,
    "metadata filters plus exact inspection govern both App and ordinary environments",
  );
});

test("provider fails closed before filtering duplicate candidate summaries", async () => {
  let call = 0;
  const provider = createMainCandidateVercelProvider({
    intent: intent(),
    client: {
      requestWithRetry: async () => ({
        deployments: [{ uid: "dpl_0123456789abcdef" }],
        pagination: { next: call++ === 0 ? 1 : null },
      }),
    },
  });
  await assert.rejects(
    () => provider.listCandidateDeploymentIds(),
    /ambiguous/,
  );
});

test("provider returns every unique candidate from a complete paginated census", async () => {
  const currentIntent = intent();
  let page = 0;
  const provider = createMainCandidateVercelProvider({
    intent: currentIntent,
    client: {
      requestWithRetry: async () => {
        page += 1;
        return page === 1
          ? {
              deployments: [{ uid: "dpl_0123456789abcdef" }],
              pagination: { next: 1 },
            }
          : {
              deployments: [{ uid: "dpl_abcdef0123456789" }],
              pagination: { next: null },
            };
      },
    },
  });
  assert.deepEqual(await provider.listCandidateDeploymentIds(), {
    deploymentIds: ["dpl_0123456789abcdef", "dpl_abcdef0123456789"],
    complete: true,
  });
  assert.equal(page, 2);
});

test("unbound provider callbacks resolve a raw-metadata candidate without artifact authority", async () => {
  const currentIntent = intent();
  const response = deploymentResponse(currentIntent);
  const provider = createMainCandidateVercelProvider({
    intent: currentIntent,
    client: {
      requestWithRetry: async () => ({
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      }),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  const handoff = await resolveMainCandidateHandoff({
    intent: currentIntent,
    provider,
    smokeCandidate: async (candidate) => ({
      immutableUrl: candidate.deploymentUrl,
      servedSha: currentIntent.deploySha,
      status: "passed",
    }),
  });
  assert.equal(handoff.action, "reuse");
  assert.equal(handoff.executionMode, "reuse");
  assert.deepEqual(handoff.metrics, {
    buildDurationMs: null,
    deploymentDurationMs: null,
    cacheHit: null,
  });
});

test("pre-plan mapped inspection reconstructs an older App v3 candidate without a current intent", async () => {
  const oldIntent = intent("app");
  const response = deploymentResponse(oldIntent);
  const provider = createMainCandidateVercelProvider({
    client: {
      requestWithRetry: async () =>
        assert.fail("mapped inspection does not list by a new release"),
      inspectDeployment: async (id) => {
        assert.equal(id, response.id);
        return response;
      },
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  const mapped = await provider.inspectMappedCandidate({
    deploymentId: response.id,
    target: "app",
    projectId: oldIntent.projectId,
  });
  assert.equal(mapped.metadata.candidateId, oldIntent.candidateId);
  assert.equal(mapped.metadata.releaseManifest.releaseId, oldIntent.releaseId);
  assert.deepEqual(
    {
      target: mapped.canonicalState.target,
      customEnvironmentSlug: mapped.canonicalState.customEnvironmentSlug,
    },
    { target: null, customEnvironmentSlug: "v3" },
  );
  assert.equal(mapped.canonicalState.git.sha, oldIntent.deploySha);
});

test("pre-plan release census resolves one exact staged candidate without prior GitHub artifacts", async () => {
  const oldIntent = intent("reserve");
  const response = deploymentResponse(oldIntent);
  const listingPaths = [];
  const provider = createMainCandidateVercelProvider({
    client: {
      requestWithRetry: async (path) => {
        listingPaths.push(path);
        return {
          deployments: [{ uid: response.id }],
          pagination: { next: null },
        };
      },
      inspectDeployment: async (id) => {
        assert.equal(id, response.id);
        return response;
      },
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  const resolved = await provider.resolveReleaseCandidate({
    manifest: oldIntent.releaseManifest,
    target: "reserve",
    projectId: oldIntent.projectId,
  });
  assert.equal(listingPaths.length, 2);
  assert.ok(
    listingPaths.every(
      (path) =>
        path.includes(`meta-mentoReleaseId=${oldIntent.releaseId}`) &&
        path.includes(`meta-mentoCandidateId=${oldIntent.candidateId}`),
    ),
  );
  assert.equal(resolved.intent.digest, oldIntent.digest);
  assert.equal(resolved.candidate.deploymentId, response.id);
  assert.equal(
    resolved.candidate.metadata.releaseManifest.releaseId,
    oldIntent.releaseId,
  );
});

test("pre-plan release census fails closed when repeated visibility changes or is ambiguous", async () => {
  const oldIntent = intent("ui");
  const response = deploymentResponse(oldIntent);
  for (const listings of [
    [
      { deployments: [], pagination: { next: null } },
      {
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      },
    ],
    [
      {
        deployments: [{ uid: response.id }, { uid: "dpl_abcdef0123456789" }],
        pagination: { next: null },
      },
      {
        deployments: [{ uid: response.id }, { uid: "dpl_abcdef0123456789" }],
        pagination: { next: null },
      },
    ],
  ]) {
    let call = 0;
    const provider = createMainCandidateVercelProvider({
      client: {
        requestWithRetry: async () => listings[call++],
        inspectDeployment: async () => response,
        listDeploymentAliases: async () => ({ aliases: [] }),
      },
    });
    await assert.rejects(
      () =>
        provider.resolveReleaseCandidate({
          manifest: oldIntent.releaseManifest,
          target: "ui",
          projectId: oldIntent.projectId,
        }),
      /census (?:changed|is ambiguous)/,
    );
  }
});

test("mapped inspection binds its observed project to the manifest rollback prior", async () => {
  const oldIntent = intent("app");
  const response = deploymentResponse(oldIntent);
  response.projectId = "prj_wrong";
  const provider = createMainCandidateVercelProvider({
    client: {
      requestWithRetry: async () =>
        assert.fail("mapped inspection does not list by a new release"),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  await assert.rejects(
    () =>
      provider.inspectMappedCandidate({
        deploymentId: response.id,
        target: "app",
        projectId: "prj_wrong",
      }),
    /release manifest conflicts/,
  );
});

test("mapped inspection admits native Git deployments for every live main environment only when no candidate markers exist", async () => {
  for (const target of ["governance", "reserve", "ui", "app"]) {
    const oldIntent = intent(target);
    const response = deploymentResponse(oldIntent);
    response.source = "git";
    for (const key of Object.keys(response.meta)) {
      if (key.startsWith("mento")) delete response.meta[key];
    }
    const provider = createMainCandidateVercelProvider({
      client: {
        requestWithRetry: async () =>
          assert.fail("mapped inspection does not list"),
        inspectDeployment: async () => response,
        listDeploymentAliases: async () => ({ aliases: [] }),
      },
    });
    const mapped = await provider.inspectMappedCandidate({
      deploymentId: response.id,
      target,
      projectId: oldIntent.projectId,
    });
    assert.equal(mapped.metadata, null);
    assert.deepEqual(
      {
        target: mapped.canonicalState.target,
        customEnvironmentSlug: mapped.canonicalState.customEnvironmentSlug,
      },
      target === "app"
        ? { target: null, customEnvironmentSlug: "v3" }
        : { target: "production", customEnvironmentSlug: null },
    );
  }
});

test("mapped inspection rejects non-Git native deployment sources", async () => {
  const currentIntent = intent("reserve");
  for (const source of ["cli", "manual", "unknown", undefined]) {
    const response = deploymentResponse(currentIntent);
    response.source = source;
    for (const key of Object.keys(response.meta)) {
      if (key.startsWith("mento")) delete response.meta[key];
    }
    const provider = createMainCandidateVercelProvider({
      client: {
        requestWithRetry: async () =>
          assert.fail("mapped inspection does not list"),
        inspectDeployment: async () => response,
        listDeploymentAliases: async () => ({ aliases: [] }),
      },
    });
    await assert.rejects(
      () =>
        provider.inspectMappedCandidate({
          deploymentId: response.id,
          target: "reserve",
          projectId: currentIntent.projectId,
        }),
      /native mapped deployment source is not Git/,
    );
  }
});

test("mapped inspection keeps Mento-marked candidates CLI-only", async () => {
  const currentIntent = intent("ui");
  const response = deploymentResponse(currentIntent);
  response.source = "git";
  const provider = createMainCandidateVercelProvider({
    client: {
      requestWithRetry: async () =>
        assert.fail("mapped inspection does not list"),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  await assert.rejects(
    () =>
      provider.inspectMappedCandidate({
        deploymentId: response.id,
        target: "ui",
        projectId: currentIntent.projectId,
      }),
    /candidate Vercel source is not CLI/,
  );
});

test("candidate inspection and release reuse remain CLI-only", async () => {
  const currentIntent = intent("ui");
  const response = deploymentResponse(currentIntent);
  response.source = "git";
  const provider = createMainCandidateVercelProvider({
    intent: currentIntent,
    client: {
      requestWithRetry: async () => ({
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      }),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  for (const inspect of [
    () => provider.inspectCandidateState(response.id),
    () => provider.inspectCandidate(response.id),
    () =>
      provider.resolveReleaseCandidate({
        manifest: currentIntent.releaseManifest,
        target: "ui",
        projectId: currentIntent.projectId,
      }),
  ]) {
    await assert.rejects(inspect, /candidate Vercel source is not CLI/);
  }
});

test("mapped inspection rejects partial or unknown Mento candidate metadata instead of treating it as native", async () => {
  const currentIntent = intent("app");
  for (const patch of [
    (metadata) => {
      delete metadata.mentoCandidateSchema;
    },
    (metadata) => {
      for (const key of Object.keys(metadata)) {
        if (key.startsWith("mento")) delete metadata[key];
      }
      metadata.mentoUnknownCandidateField = "unexpected";
    },
  ]) {
    const response = deploymentResponse(currentIntent);
    patch(response.meta);
    const provider = createMainCandidateVercelProvider({
      client: {
        requestWithRetry: async () =>
          assert.fail("mapped inspection does not list"),
        inspectDeployment: async () => response,
        listDeploymentAliases: async () => ({ aliases: [] }),
      },
    });
    await assert.rejects(
      () =>
        provider.inspectMappedCandidate({
          deploymentId: response.id,
          target: "app",
          projectId: currentIntent.projectId,
        }),
      /partial/,
    );
  }
});

test("mapped inspection rejects GitHub-owned metadata", async () => {
  const currentIntent = intent();
  const response = deploymentResponse(currentIntent, {
    githubDeployment: true,
  });
  const provider = createMainCandidateVercelProvider({
    client: {
      requestWithRetry: async () =>
        assert.fail("mapped inspection does not list"),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
  await assert.rejects(
    () =>
      provider.inspectMappedCandidate({
        deploymentId: response.id,
        target: "ui",
        projectId: currentIntent.projectId,
      }),
    /GitHub-owned/,
  );
});

test("mapped inspection requires the actual custom Next deployment ID", async () => {
  const currentIntent = intent();
  for (const metaPatch of [
    (meta) => {
      delete meta.mentoNextDeploymentId;
    },
    (meta) => {
      meta.mentoNextDeploymentId = "mr-ui-different";
    },
  ]) {
    const response = deploymentResponse(currentIntent);
    metaPatch(response.meta);
    const provider = createMainCandidateVercelProvider({
      client: {
        requestWithRetry: async () =>
          assert.fail("mapped inspection does not list"),
        inspectDeployment: async () => response,
        listDeploymentAliases: async () => ({ aliases: [] }),
      },
    });
    await assert.rejects(
      () =>
        provider.inspectMappedCandidate({
          deploymentId: response.id,
          target: "ui",
          projectId: currentIntent.projectId,
        }),
      /metadata/,
    );
  }
});
