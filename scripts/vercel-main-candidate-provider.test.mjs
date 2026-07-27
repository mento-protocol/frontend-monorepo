import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import {
  assertMainCandidateHandoff,
  assertMainServedPriorCandidateHandoff,
  resolveMainCandidateHandoff,
  resolveMainServedPriorCandidateHandoff,
} from "./vercel-main-candidate-controller.mjs";
import { createMainCandidateVercelProvider } from "./vercel-main-candidate-provider.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import {
  MAIN_TARGET_CONTRACTS,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import { PRODUCTION_GENERATED_ALIAS_CONTRACTS } from "./vercel-production-generated-aliases.mjs";

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
  {
    id = "dpl_0123456789abcdef",
    githubDeployment = false,
    url = `${currentIntent.target}-candidate.vercel.app`,
  } = {},
) {
  return {
    id,
    url,
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

function deploymentAliases(aliases) {
  return { aliases: aliases.map((alias) => ({ alias })) };
}

function generatedCreatorAlias(target, creatorUsername = "chapati") {
  const { generatedProjectSlug, generatedScopeSlug } =
    PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
  return `${generatedProjectSlug}-${creatorUsername}-${generatedScopeSlug}.vercel.app`;
}

function subsets(values) {
  return Array.from({ length: 2 ** values.length }, (_, mask) =>
    values.filter((_, index) => (mask & (1 << index)) !== 0).toSorted(),
  );
}

async function resolveHandoff(
  target,
  aliases,
  { deploymentUrl, servedPrior = false } = {},
) {
  const currentIntent = intent(target);
  const response = deploymentResponse(currentIntent, {
    ...(deploymentUrl === undefined ? {} : { url: deploymentUrl }),
  });
  const provider = createMainCandidateVercelProvider({
    intent: currentIntent,
    client: {
      requestWithRetry: async () => ({
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      }),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => deploymentAliases(aliases),
    },
  });
  const resolve = servedPrior
    ? resolveMainServedPriorCandidateHandoff
    : resolveMainCandidateHandoff;
  return resolve({
    intent: currentIntent,
    provider,
    smokeCandidate: async (candidate) => ({
      immutableUrl: candidate.deploymentUrl,
      servedSha: currentIntent.deploySha,
      status: "passed",
    }),
  });
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
  const generatedProjectAlias =
    PRODUCTION_GENERATED_ALIAS_CONTRACTS.ui.generatedProjectAlias;
  const provider = createMainCandidateVercelProvider({
    intent: currentIntent,
    client: {
      requestWithRetry: async () => ({
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      }),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () =>
        deploymentAliases([generatedProjectAlias]),
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

test("automatic ordinary candidate finalization requires the base and permits the exact creator alias", async () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    for (const aliases of [
      [contract.generatedProjectAlias],
      [
        contract.generatedProjectAlias,
        generatedCreatorAlias(target),
      ].toSorted(),
    ]) {
      const handoff = await resolveHandoff(target, aliases);
      assert.equal(handoff.action, "reuse");
      assert.deepEqual(handoff.canonicalState.aliases, aliases);
      assert.deepEqual(assertMainCandidateHandoff(handoff), handoff);
    }
  }
});

test("automatic ordinary candidate finalization rejects non-candidate alias topologies", async () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const otherTarget = target === "governance" ? "reserve" : "governance";
    for (const [
      name,
      aliases,
      expected = /candidate generated-alias topology mismatch/,
    ] of [
      ["empty", []],
      ["creator only", [generatedCreatorAlias(target)]],
      ["git-main only", [contract.generatedGitMainAlias]],
      [
        "base plus git-main",
        [contract.generatedGitMainAlias, contract.generatedProjectAlias],
      ],
      [
        "unreviewed Git branch",
        [
          contract.generatedProjectAlias,
          `${contract.generatedProjectSlug}-git-feature-${contract.generatedScopeSlug}.vercel.app`,
        ].toSorted(),
      ],
      [
        "custom",
        [
          contract.generatedProjectAlias,
          `${target}-preview.mento.org`,
        ].toSorted(),
      ],
      [
        "immutable hostname",
        [
          contract.generatedProjectAlias,
          `${target}-candidate.vercel.app`,
        ].toSorted(),
        /immutable-host separation/,
      ],
      [
        "wrong target",
        [
          contract.generatedProjectAlias,
          PRODUCTION_GENERATED_ALIAS_CONTRACTS[otherTarget]
            .generatedProjectAlias,
        ].toSorted(),
      ],
      [
        "creator near miss",
        [
          contract.generatedProjectAlias,
          generatedCreatorAlias(target, "chapati2"),
        ].toSorted(),
      ],
      [
        "project-default",
        [
          contract.generatedProjectAlias,
          `${contract.generatedProjectSlug}.vercel.app`,
        ].toSorted(),
      ],
    ]) {
      await assert.rejects(
        () => resolveHandoff(target, aliases),
        expected,
        `${target}: ${name}`,
      );
    }
  }
});

test("automatic inherited ordinary finalization requires its protected alias and accepts every generated residual subset", async () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const otherTarget = target === "governance" ? "reserve" : "governance";
    const protectedAlias = MAIN_TARGET_CONTRACTS[target].aliases[0];
    let validHandoff;
    for (const residualAliases of subsets([
      contract.generatedProjectAlias,
      contract.generatedProjectDefaultAlias,
      generatedCreatorAlias(target),
      contract.generatedGitMainAlias,
    ])) {
      const aliases = [protectedAlias, ...residualAliases].toSorted();
      const handoff = await resolveHandoff(target, aliases, {
        servedPrior: true,
      });
      validHandoff = handoff;
      assert.deepEqual(handoff.canonicalState.aliases, aliases);
      assert.deepEqual(assertMainServedPriorCandidateHandoff(handoff), handoff);
      assert.deepEqual(
        assertMainServedPriorCandidateHandoff(
          JSON.parse(JSON.stringify(handoff)),
        ),
        handoff,
      );
    }
    for (const [name, aliases, expected] of [
      [
        "missing protected alias",
        [contract.generatedProjectAlias],
        /missing its reviewed protected alias/,
      ],
      [
        "wrong protected alias",
        [
          MAIN_TARGET_CONTRACTS[otherTarget].aliases[0],
          contract.generatedProjectAlias,
        ].toSorted(),
        /missing its reviewed protected alias/,
      ],
      [
        "custom protected alias",
        [
          `${target}-preview.mento.org`,
          contract.generatedProjectAlias,
        ].toSorted(),
        /missing its reviewed protected alias/,
      ],
      [
        "unknown generated residual",
        [protectedAlias, `${target}-unknown.vercel.app`].toSorted(),
        /served-prior generated-alias topology mismatch/,
      ],
    ]) {
      await assert.rejects(
        () => resolveHandoff(target, aliases, { servedPrior: true }),
        expected,
        `${target}: live ${name}`,
      );
      const serialized = structuredClone(validHandoff);
      serialized.canonicalState.aliases = aliases;
      assert.throws(
        () => assertMainServedPriorCandidateHandoff(serialized),
        expected,
        `${target}: serialized ${name}`,
      );
    }
  }
});

test("automatic ordinary finalization keeps the immutable hostname outside generated aliases", async () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const generatedProjectAlias =
      PRODUCTION_GENERATED_ALIAS_CONTRACTS[target].generatedProjectAlias;
    await assert.rejects(
      () =>
        resolveHandoff(target, [generatedProjectAlias], {
          deploymentUrl: generatedProjectAlias,
        }),
      /immutable-host separation/,
      target,
    );
  }
});

test("deserialized ordinary candidate handoffs recheck the exact alias topology", async () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const handoff = await resolveHandoff(target, [
      contract.generatedProjectAlias,
    ]);
    for (const [
      name,
      aliases,
      expected = /candidate generated-alias topology mismatch/,
    ] of [
      ["empty", []],
      ["creator only", [generatedCreatorAlias(target)]],
      [
        "git-main",
        [contract.generatedGitMainAlias, contract.generatedProjectAlias],
      ],
      [
        "custom",
        [
          contract.generatedProjectAlias,
          `${target}-preview.mento.org`,
        ].toSorted(),
      ],
      [
        "immutable hostname",
        [
          contract.generatedProjectAlias,
          `${target}-candidate.vercel.app`,
        ].toSorted(),
        /immutable-host separation/,
      ],
    ]) {
      const serialized = structuredClone(handoff);
      serialized.canonicalState.aliases = aliases;
      assert.throws(
        () => assertMainCandidateHandoff(serialized),
        expected,
        `${target}: ${name}`,
      );
    }
  }
});

test("deserialized ordinary handoffs reject mutable generated aliases as the immutable hostname", async () => {
  for (const target of ["governance", "reserve", "ui"]) {
    const generatedProjectAlias =
      PRODUCTION_GENERATED_ALIAS_CONTRACTS[target].generatedProjectAlias;
    const handoff = await resolveHandoff(target, [generatedProjectAlias]);
    const serialized = structuredClone(handoff);
    const deploymentUrl = `https://${generatedProjectAlias}`;
    const candidate = {
      ...serialized.candidate,
      deploymentUrl,
    };
    const immutableSmoke = {
      ...serialized.immutableSmoke,
      immutableUrl: deploymentUrl,
    };
    const receipt = createMainCandidateReceipt({
      intent: serialized.intent,
      candidate,
      immutableSmoke,
    });
    serialized.candidate = receipt.candidate;
    serialized.receipt = receipt;
    serialized.immutableSmoke = receipt.immutableSmoke;
    serialized.canonicalState.deploymentUrl = deploymentUrl;
    serialized.canonicalState.alias = generatedProjectAlias;
    assert.throws(
      () => assertMainCandidateHandoff(serialized),
      /immutable-host separation/,
      target,
    );
  }
});

test("App candidate finalization remains on the custom-v3 contract path", async () => {
  const handoff = await resolveHandoff("app", []);
  assert.equal(handoff.intent.target, "app");
  assert.deepEqual(handoff.canonicalState.aliases, []);
  assert.deepEqual(assertMainCandidateHandoff(handoff), handoff);
});

test("served-prior finalization rejects App before zero-census resolution or create-handoff assertion", async () => {
  const currentIntent = intent("app");
  let listCalls = 0;
  const provider = {
    listCandidateDeploymentIds: async () => {
      listCalls += 1;
      return { deploymentIds: [], complete: true };
    },
    inspectCandidate: async () =>
      assert.fail("zero-census App inspection must not run"),
  };
  await assert.rejects(
    () =>
      resolveMainServedPriorCandidateHandoff({
        intent: currentIntent,
        provider,
        smokeCandidate: async () =>
          assert.fail("zero-census App smoke must not run"),
      }),
    /excludes App/,
  );
  assert.equal(listCalls, 0);

  const createHandoff = await resolveMainCandidateHandoff({
    intent: currentIntent,
    provider,
    smokeCandidate: async () =>
      assert.fail("zero-census App smoke must not run"),
  });
  assert.equal(createHandoff.action, "create");
  assert.equal(listCalls, 2);
  assert.throws(
    () => assertMainServedPriorCandidateHandoff(createHandoff),
    /excludes App/,
  );
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

test("mapped inspection admits unmarked priors regardless of optional provider source", async () => {
  for (const target of ["governance", "reserve", "ui", "app"]) {
    for (const source of [undefined, "git", "cli", "redeploy"]) {
      const oldIntent = intent(target);
      const response = deploymentResponse(oldIntent);
      if (source === undefined) delete response.source;
      else response.source = source;
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
  }
});

test("unmarked mappings that self-report the reviewed SHA remain rollback-only", async () => {
  const reviewedSha = "e".repeat(40);
  for (const target of ["governance", "reserve", "ui", "app"]) {
    for (const source of [undefined, "git", "cli", "redeploy"]) {
      const oldIntent = intent(target);
      const response = deploymentResponse(oldIntent);
      if (source === undefined) delete response.source;
      else response.source = source;
      for (const key of Object.keys(response.meta)) {
        if (key.startsWith("mento")) delete response.meta[key];
      }
      response.meta.githubCommitSha = reviewedSha;
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
      assert.equal(mapped.canonicalState.git.sha, reviewedSha);
    }
  }
});

test("mapped inspection admits complete Mento candidates regardless of optional provider source", async () => {
  const currentIntent = intent("ui");
  for (const source of [undefined, "git", "cli", "redeploy"]) {
    const response = deploymentResponse(currentIntent);
    if (source === undefined) delete response.source;
    else response.source = source;
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
      target: "ui",
      projectId: currentIntent.projectId,
    });
    assert.equal(mapped.metadata.candidateId, currentIntent.candidateId);
    assert.equal(
      mapped.metadata.releaseManifest.releaseId,
      currentIntent.releaseId,
    );
  }
});

test("candidate inspection and release reuse ignore optional provider source", async () => {
  const currentIntent = intent("ui");
  for (const source of [undefined, "git", "cli", "redeploy"]) {
    const response = deploymentResponse(currentIntent);
    if (source === undefined) delete response.source;
    else response.source = source;
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
    const state = await provider.inspectCandidateState(response.id);
    assert.equal(state.git.sha, currentIntent.deploySha);
    const candidate = await provider.inspectCandidate(response.id);
    assert.equal(candidate.metadata.candidateId, currentIntent.candidateId);
    const resolved = await provider.resolveReleaseCandidate({
      manifest: currentIntent.releaseManifest,
      target: "ui",
      projectId: currentIntent.projectId,
    });
    assert.equal(resolved.candidate.deploymentId, response.id);
    assert.equal(resolved.intent.digest, currentIntent.digest);
  }
});

test("optional provider source does not bypass canonical mapped identity", async () => {
  const currentIntent = intent("reserve");
  for (const [patch, error] of [
    [
      (response) => {
        response.readyState = "BUILDING";
      },
      /Unexpected deployment readiness/,
    ],
    [
      (response) => {
        response.projectId = "prj_wrong";
      },
      /Unexpected deployment project ID/,
    ],
    [
      (response) => {
        response.target = "preview";
      },
      /Unexpected deployment target/,
    ],
    [
      (response) => {
        delete response.meta.githubCommitRepo;
      },
      /Main candidate SHA is malformed/,
    ],
  ]) {
    const response = deploymentResponse(currentIntent);
    response.source = "redeploy";
    patch(response);
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
      error,
    );
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
