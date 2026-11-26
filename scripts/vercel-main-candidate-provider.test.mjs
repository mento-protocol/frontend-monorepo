import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES,
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
  isBridgeEraCandidateMetadata,
  isRetiredEraCandidateMetadata,
} from "./vercel-main-candidate.mjs";
import {
  assertMainCandidateHandoff,
  assertMainServedPriorCandidateHandoff,
  discoverMainPreplanCandidateReleases,
  preflightMainCandidateProvider,
  resolveMainCandidateHandoff,
  resolveMainServedPriorCandidateHandoff,
} from "./vercel-main-candidate-controller.mjs";
import { createMainCandidateVercelProvider } from "./vercel-main-candidate-provider.mjs";
import {
  createMainReleaseManifest,
  decideMainPreplanReconciliation,
} from "./vercel-main-release-reconciliation.mjs";
import {
  MAIN_TARGET_CONTRACTS,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import { PRODUCTION_GENERATED_ALIAS_CONTRACTS } from "./vercel-production-generated-aliases.mjs";
import { generateVercelMainCandidateDeploymentId } from "./vercel-prebuilt.mjs";

const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);

function releaseManifest() {
  const input = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  const priorSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  for (const target of ["app", "reserve"]) {
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
      deployments: ["app", "reserve"],
      reason: "global-build-input",
    }),
  });
  const originalPriors = Object.fromEntries(
    ["reserve", "app"].map((target) => {
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

function intent(
  target = "reserve",
  {
    originAttempt = "1",
    originTransactionId = "main-0123456789abcdef0123456789abcdef",
  } = {},
) {
  const manifest = releaseManifest();
  return createMainCandidateIntent({
    target,
    deploySha: "dddddddddddddddddddddddddddddddddddddddd",
    upstreamRunId: "700",
    originRunId: "800",
    originAttempt,
    originTransactionId,
    projectId: manifest.originalPriors[target].projectId,
    releaseManifest: manifest,
  });
}

function originForAttempt(originAttempt) {
  return {
    originAttempt,
    originTransactionId:
      originAttempt === "1"
        ? "main-0123456789abcdef0123456789abcdef"
        : "main-fedcba9876543210fedcba9876543210",
  };
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
  {
    candidateAttempt,
    currentAttempt = "1",
    deploymentUrl,
    admittedBeforeJob = false,
    servedPrior = false,
  } = {},
) {
  const currentIntent = intent(target, originForAttempt(currentAttempt));
  const candidateIntent = intent(
    target,
    originForAttempt(candidateAttempt ?? currentAttempt),
  );
  const response = deploymentResponse(candidateIntent, {
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
  const admissionPreflight = admittedBeforeJob
    ? await preflightMainCandidateProvider({ intent: currentIntent, provider })
    : null;
  const handoff = await resolve({
    intent: currentIntent,
    provider,
    admissionPreflight,
    smokeCandidate: async (candidate) => ({
      immutableUrl: candidate.deploymentUrl,
      servedSha: currentIntent.deploySha,
      status: "passed",
    }),
  });
  return admittedBeforeJob ? { handoff, admissionPreflight } : handoff;
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
  assert.match(calls[0], /projectId=prj_reserve/);
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
    PRODUCTION_GENERATED_ALIAS_CONTRACTS.reserve.generatedProjectAlias;
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

test("automatic ordinary candidate finalization permits the base and the exact creator alias", async () => {
  for (const target of ["reserve"]) {
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

test("a later attempt reuses a detached ordinary candidate after recovery moved its generated aliases", async () => {
  for (const target of ["reserve"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    for (const aliases of subsets([
      contract.generatedProjectAlias,
      generatedCreatorAlias(target),
    ])) {
      const { handoff, admissionPreflight } = await resolveHandoff(
        target,
        aliases,
        {
          candidateAttempt: "1",
          currentAttempt: "2",
          admittedBeforeJob: true,
        },
      );
      assert.equal(handoff.action, "reuse");
      assert.deepEqual(handoff.canonicalState.aliases, aliases);
      assert.deepEqual(
        assertMainCandidateHandoff(handoff, admissionPreflight),
        handoff,
      );
      assert.deepEqual(
        assertMainCandidateHandoff(
          JSON.parse(JSON.stringify(handoff)),
          admissionPreflight,
        ),
        handoff,
      );
    }
  }
});

test("a later attempt still rejects unreviewed aliases on a detached ordinary candidate", async () => {
  for (const target of ["reserve"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    for (const [name, aliases] of [
      ["git-main", [contract.generatedGitMainAlias]],
      ["project-default", [contract.generatedProjectDefaultAlias]],
      ["protected", MAIN_TARGET_CONTRACTS[target].aliases],
      ["unknown", [`${target}-preview.mento.org`]],
    ]) {
      await assert.rejects(
        () =>
          resolveHandoff(target, aliases, {
            candidateAttempt: "1",
            currentAttempt: "2",
            admittedBeforeJob: true,
          }),
        /reused-candidate generated-alias topology mismatch/,
        `${target}: ${name}`,
      );
    }
  }
});

test("a fresh skip-domain candidate finalizes before Vercel moves the generated alias to it", async () => {
  // Vercel leaves the generated project alias on the still-serving prior until
  // `vercel promote`, so a fresh candidate legitimately carries none.
  for (const target of ["app", "reserve"]) {
    for (const aliases of [[], [generatedCreatorAlias(target)]]) {
      const handoff = await resolveHandoff(target, aliases);
      assert.equal(handoff.action, "reuse");
      assert.deepEqual(handoff.canonicalState.aliases, aliases);
      assert.deepEqual(assertMainCandidateHandoff(handoff), handoff);
    }
  }
});

test("automatic ordinary candidate finalization rejects non-candidate alias topologies", async () => {
  for (const target of ["reserve"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const otherTarget = "app";
    for (const [
      name,
      aliases,
      expected = /candidate generated-alias topology mismatch/,
    ] of [
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
  for (const target of ["reserve"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const otherTarget = "app";
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
        // A served prior may carry the project's other production domains, but
        // never another main target's reviewed protected domain.
        "another target's reviewed protected domain",
        [
          protectedAlias,
          MAIN_TARGET_CONTRACTS[otherTarget].aliases[0],
          contract.generatedProjectAlias,
        ].toSorted(),
        /carries another target's reviewed protected domain/,
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
  for (const target of ["reserve"]) {
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
  for (const target of ["reserve"]) {
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const handoff = await resolveHandoff(target, [
      contract.generatedProjectAlias,
    ]);
    for (const [
      name,
      aliases,
      expected = /candidate generated-alias topology mismatch/,
    ] of [
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
  for (const target of ["reserve"]) {
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

// App is an ordinary production candidate: it proves the same reviewed
// generated-alias topology as every other target, in both candidate and
// served-prior modes.
test("App candidate finalization uses the ordinary generated-alias contract", async () => {
  const handoff = await resolveHandoff("app", [
    "appmentoorg-mentolabs.vercel.app",
  ]);
  assert.equal(handoff.intent.target, "app");
  assert.deepEqual(handoff.canonicalState.aliases, [
    "appmentoorg-mentolabs.vercel.app",
  ]);
  assert.deepEqual(assertMainCandidateHandoff(handoff), handoff);

  const fresh = await resolveHandoff("app", []);
  assert.deepEqual(fresh.canonicalState.aliases, []);
  await assert.rejects(
    () => resolveHandoff("app", ["appmentoorg.vercel.app"]),
    /generated-alias topology mismatch/,
  );
});

test("App served-prior finalization proves its reviewed protected alias", async () => {
  const servedPrior = await resolveHandoff(
    "app",
    ["app.mento.org", "appmentoorg-mentolabs.vercel.app"],
    { servedPrior: true },
  );
  assert.deepEqual(
    assertMainServedPriorCandidateHandoff(servedPrior),
    servedPrior,
  );
  await assert.rejects(
    () =>
      resolveHandoff("app", ["appmentoorg-mentolabs.vercel.app"], {
        servedPrior: true,
      }),
    /missing its reviewed protected alias/,
  );
});

test("pre-plan mapped inspection reconstructs a marked current-contract candidate", async () => {
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
    { target: "production", customEnvironmentSlug: null },
  );
  assert.equal(mapped.canonicalState.git.sha, oldIntent.deploySha);
});

// A candidate seal is immutable, so a manifest sealed while `app.mento.org`
// still hung off the retired `v3` custom environment stays readable forever.
// These helpers build both shapes that environment ever sealed - the bridge
// era's single reviewed App alias and the two-alias topology that preceded it -
// digest-rebound so each fixture is a genuine seal rather than a corrupt one.
const BRIDGE_ERA_APP_ALIASES = Object.freeze(["app.mento.org"]);
const PRE_CONVERSION_APP_ALIASES = Object.freeze([
  "app.mento.org",
  "appmentoorg-env-v3-mentolabs.vercel.app",
]);

// Decodes the release manifest a genuine seal carries, exactly as sealed.
function sealedManifest(metadata) {
  const encoded = Array.from(
    { length: Number(metadata.mentoReleaseManifestChunkCount) },
    (_, index) => metadata[`mentoReleaseManifestChunk${index}`],
  ).join("");
  return JSON.parse(
    inflateRawSync(Buffer.from(encoded, "base64url")).toString("utf8"),
  );
}

// Every seal written before ADR 0018 retired `ui` carries a three-target
// manifest: the retired activation order, the retired ownership key order, and
// a UI prior. This rebuilds a current two-target manifest in that universe,
// with UI following Reserve's ownership and selection and a structurally valid
// prior taken from a genuine ui-era seal, so the result is exactly what that
// era sealed. It rewrites the manifest in place, which keeps its top-level key
// order.
function toUiEraManifest(manifest) {
  const uiPrior = sealedManifest(
    HISTORICAL_SEALS.uiEra.seals.app.deployment.meta,
  ).originalPriors.ui;
  const followReserve = (targets) =>
    targets.flatMap((target) =>
      target === "reserve" ? ["reserve", "ui"] : [target],
    );
  manifest.mainOwnershipMode = {
    app: manifest.mainOwnershipMode.app,
    reserve: manifest.mainOwnershipMode.reserve,
    ui: manifest.mainOwnershipMode.reserve,
  };
  manifest.stagedTargets = followReserve(manifest.stagedTargets);
  manifest.activeTargets = followReserve(manifest.activeTargets);
  const { reserve, ...rest } = manifest.originalPriors;
  manifest.originalPriors = { reserve, ui: uiPrior, ...rest };
  return manifest;
}

// Every seal written before ADR 0017 retired `governance` carries a
// four-target manifest: the ui-era universe plus a Governance prior, with
// Governance first in the retired activation order. Governance follows
// Reserve's ownership and selection, and its prior is taken from a genuine
// governance-era seal.
function toGovernanceEraManifest(manifest) {
  toUiEraManifest(manifest);
  const governancePrior = sealedManifest(
    HISTORICAL_SEALS.governanceEra.seals.app.deployment.meta,
  ).originalPriors.governance;
  const followReserve = (targets) =>
    targets.includes("reserve") ? ["governance", ...targets] : targets;
  manifest.mainOwnershipMode = {
    app: manifest.mainOwnershipMode.app,
    governance: manifest.mainOwnershipMode.reserve,
    reserve: manifest.mainOwnershipMode.reserve,
    ui: manifest.mainOwnershipMode.ui,
  };
  manifest.stagedTargets = followReserve(manifest.stagedTargets);
  manifest.activeTargets = followReserve(manifest.activeTargets);
  manifest.originalPriors = {
    governance: governancePrior,
    ...manifest.originalPriors,
  };
  return manifest;
}

// The bridge era ended long before Governance was retired, so every
// bridge-era manifest is four-target as well.
function applyBridgeEraAppTopology(aliases) {
  return (currentManifest) => {
    const manifest = toGovernanceEraManifest(currentManifest);
    const prior = manifest.originalPriors.app;
    prior.target = null;
    prior.customEnvironmentSlug = "v3";
    prior.aliases = [...aliases].toSorted();
    const leaf = prior.planningLeaves[0];
    prior.planningLeaves = [...aliases].toSorted().map((alias) => ({
      ...leaf,
      alias,
      aliases: [...aliases].toSorted(),
      target: null,
      customEnvironmentSlug: "v3",
    }));
    return manifest;
  };
}

const applyPreConversionAppTopology = applyBridgeEraAppTopology(
  PRE_CONVERSION_APP_ALIASES,
);

// An independent pin of the sealed wire format. A bridge-era candidate's stable
// digest is a sha256 over exactly this body: the ordinary production
// environment for every target - a deployment served from the retired custom
// environment fails its production expectation long before its metadata is
// read - and the bridge-era manifest. Rebinding it, rather than swapping only
// the encoded manifest, is what makes the fixture a genuine seal instead of a
// corrupt one.
const CANDIDATE_INTENT_SCHEMA = "vercel-main-candidate-intent:v3";
const CANDIDATE_REPOSITORY = "mento-protocol/frontend-monorepo";

function sealedEnvironment() {
  return { target: "production", customEnvironmentSlug: null };
}

function sealedMetadata(currentIntent, mutate, overrides = {}) {
  const manifest = mutate(structuredClone(currentIntent.releaseManifest));
  const { target, deploySha, projectId, projectName } = currentIntent;
  const candidateId = generateVercelMainCandidateDeploymentId({
    repository: CANDIDATE_REPOSITORY,
    target,
    commitSha: deploySha,
    upstreamRunId: currentIntent.upstreamRunId,
  });
  const stableIntentDigest = createHash("sha256")
    .update(
      JSON.stringify({
        schema: CANDIDATE_INTENT_SCHEMA,
        repository: CANDIDATE_REPOSITORY,
        releaseId: manifest.releaseId,
        candidateId,
        target,
        environment: sealedEnvironment(),
        deploySha,
        upstreamRunId: currentIntent.upstreamRunId,
        source: "cli",
        projectId,
        projectName,
        releaseManifest: manifest,
      }),
    )
    .digest("hex");
  const encoded = deflateRawSync(
    Buffer.from(JSON.stringify(manifest), "utf8"),
    {
      level: 9,
    },
  ).toString("base64url");
  const chunks = encoded.match(
    new RegExp(`.{1,${MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES}}`, "g"),
  );
  const metadata = createMainCandidateVercelMetadata({ intent: currentIntent });
  for (const key of Object.keys(metadata)) {
    if (key.startsWith("mentoReleaseManifestChunk")) delete metadata[key];
  }
  metadata.mentoReleaseId = manifest.releaseId;
  metadata.mentoCandidateId = candidateId;
  metadata.mentoNextDeploymentId = candidateId;
  metadata.mentoStableIntentDigest = stableIntentDigest;
  metadata.mentoReleaseManifestChunkCount = String(chunks.length);
  for (const [index, chunk] of chunks.entries()) {
    metadata[`mentoReleaseManifestChunk${index}`] = chunk;
  }
  const sealed = { ...metadata, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete sealed[key];
  }
  return sealed;
}

function preConversionMetadata(currentIntent, overrides = {}) {
  return sealedMetadata(
    currentIntent,
    applyPreConversionAppTopology,
    overrides,
  );
}

function mappedProvider(response) {
  return createMainCandidateVercelProvider({
    client: {
      requestWithRetry: async () =>
        assert.fail("mapped inspection does not list by a new release"),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    },
  });
}

// Seals are immutable. A mapping sealed while `app.mento.org` still hung off
// the retired `v3` custom environment - the bridge era's single-alias App
// prior, or the two-alias topology before it - stays readable permanently and
// classifies as an unmarked rollback-only prior. The deployments themselves are
// ordinary production deployments; only the manifest's App prior differs.
// End-to-end proof against seals produced by the REAL modules at merge commits
// 3df6e091 (#890) and 1a362e5d (#879). This is the exact wire format the
// currently serving App production deployment carries, so pre-planning must
// classify it rather than abort.
const HISTORICAL_SEALS = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/vercel-main-candidate/historical-seals.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function genuineSealResponse(deployment) {
  const response = {
    ...deployment,
    customEnvironment:
      deployment.customEnvironmentSlug === null
        ? undefined
        : { slug: deployment.customEnvironmentSlug },
    meta: { ...deployment.meta },
  };
  delete response.customEnvironmentSlug;
  return response;
}

test("pre-planning classifies a genuine historical seal as rollback-only", async () => {
  for (const [era, target] of [
    ["bridgeEra", "app"],
    ["governanceEra", "app"],
    ["governanceEra", "reserve"],
    ["uiEra", "app"],
    ["uiEra", "reserve"],
  ]) {
    const { deployment } = HISTORICAL_SEALS[era].seals[target];
    const response = genuineSealResponse(deployment);
    const mapped = await mappedProvider(response).inspectMappedCandidate({
      deploymentId: response.id,
      target,
      projectId: deployment.projectId,
    });
    assert.equal(mapped.metadata, null, `${era}/${target}`);
    assert.equal(mapped.canonicalState.deploymentId, deployment.id);
    assert.deepEqual(
      {
        target: mapped.canonicalState.target,
        customEnvironmentSlug: mapped.canonicalState.customEnvironmentSlug,
      },
      { target: "production", customEnvironmentSlug: null },
      `${era}/${target}`,
    );
  }
});

test("a mapping sealed during or before the bridge era is admitted as rollback-only", async () => {
  for (const aliases of [BRIDGE_ERA_APP_ALIASES, PRE_CONVERSION_APP_ALIASES]) {
    for (const target of ["reserve", "app"]) {
      const oldIntent = intent(target);
      const response = deploymentResponse(oldIntent);
      response.meta = {
        ...response.meta,
        ...sealedMetadata(oldIntent, applyBridgeEraAppTopology(aliases)),
      };
      const mapped = await mappedProvider(response).inspectMappedCandidate({
        deploymentId: response.id,
        target,
        projectId: oldIntent.projectId,
      });
      assert.equal(mapped.metadata, null, `${target} ${aliases.length}`);
      assert.deepEqual(
        {
          target: mapped.canonicalState.target,
          customEnvironmentSlug: mapped.canonicalState.customEnvironmentSlug,
        },
        { target: "production", customEnvironmentSlug: null },
      );
    }
  }
  // The deployment itself is still held to the production contract: one served
  // from the retired custom environment is rejected before its metadata is even
  // read, so the manifest admission can never launder a v3 deployment in.
  const appIntent = intent("app");
  const v3Response = deploymentResponse(appIntent);
  v3Response.target = null;
  v3Response.customEnvironment = { slug: "v3" };
  await assert.rejects(
    () =>
      mappedProvider(v3Response).inspectMappedCandidate({
        deploymentId: v3Response.id,
        target: "app",
        projectId: appIntent.projectId,
      }),
    /Unexpected deployment target/,
  );
});

// The bridge-era App prior is an allowance, never a bypass: a seal that carries
// it but is corrupt anywhere else is not a bridge-era mapping and must still
// fail the run closed rather than be downgraded to a rollback-only prior.
test("a corrupt seal carrying the bridge-era App topology still fails closed", async () => {
  const oldIntent = intent("app");
  const context = {
    target: "app",
    projectId: oldIntent.projectId,
    projectName: oldIntent.projectName,
    deploySha: oldIntent.deploySha,
  };
  // The uncorrupted fixture is genuinely admitted, so each case below isolates
  // exactly one corruption.
  assert.equal(
    isBridgeEraCandidateMetadata(preConversionMetadata(oldIntent), context),
    true,
  );
  for (const [name, mutate, overrides] of [
    [
      "manifest carries only the App prior",
      (manifest) => {
        applyPreConversionAppTopology(manifest);
        manifest.originalPriors = { app: manifest.originalPriors.app };
        return manifest;
      },
      {},
    ],
    [
      "another target's prior",
      (manifest) => {
        applyPreConversionAppTopology(manifest);
        manifest.originalPriors.governance.aliases = ["app.mento.org"];
        return manifest;
      },
      {},
    ],
    [
      "manifest key set",
      (manifest) => ({ ...applyPreConversionAppTopology(manifest), extra: 1 }),
      {},
    ],
    [
      "release ID",
      (manifest) => {
        applyPreConversionAppTopology(manifest);
        manifest.releaseId = `mr-${"0".repeat(18)}`;
        return manifest;
      },
      {},
    ],
    [
      "candidate ID",
      applyPreConversionAppTopology,
      { mentoCandidateId: `mr-app-${"0".repeat(18)}` },
    ],
    [
      "stable intent digest",
      applyPreConversionAppTopology,
      { mentoStableIntentDigest: "0".repeat(64) },
    ],
    [
      "audit origin",
      applyPreConversionAppTopology,
      { mentoOriginRunId: undefined },
    ],
  ]) {
    const metadata = sealedMetadata(oldIntent, mutate, overrides);
    assert.equal(isBridgeEraCandidateMetadata(metadata, context), false, name);
    const response = deploymentResponse(oldIntent);
    response.meta = { ...response.meta, ...metadata };
    if (Object.hasOwn(overrides, "mentoOriginRunId")) {
      delete response.meta.mentoOriginRunId;
    }
    await assert.rejects(
      () =>
        mappedProvider(response).inspectMappedCandidate({
          deploymentId: response.id,
          target: "app",
          projectId: oldIntent.projectId,
        }),
      /Main (?:release manifest|candidate)/,
      name,
    );
  }
});

// Only the two topologies the retired custom environment actually sealed are
// admitted. Every near miss - the retired alias set without the retired
// environment, the retired environment with an extra alias, or an ordinary
// unreadable manifest - fails closed.
test("only the two exact bridge-era App topologies are admitted", async () => {
  const oldIntent = intent("app");
  const context = {
    target: "app",
    projectId: oldIntent.projectId,
    projectName: oldIntent.projectName,
    deploySha: oldIntent.deploySha,
  };
  for (const [name, mutate] of [
    [
      // A production-shaped App prior carrying the retired two-alias topology
      // was never sealed by any code.
      "retired aliases without the retired environment",
      (manifest) => {
        applyPreConversionAppTopology(manifest);
        manifest.originalPriors.app.target = "production";
        manifest.originalPriors.app.customEnvironmentSlug = null;
        for (const leaf of manifest.originalPriors.app.planningLeaves) {
          leaf.target = "production";
          leaf.customEnvironmentSlug = null;
        }
        return manifest;
      },
    ],
    [
      "the retired environment with a third alias",
      (manifest) => {
        applyPreConversionAppTopology(manifest);
        manifest.originalPriors.app.aliases.push("appmentoorg.vercel.app");
        return manifest;
      },
    ],
    [
      "a current-contract manifest that is merely unreadable",
      (manifest) => {
        manifest.originalPriors.reserve.aliases = ["app.mento.org"];
        return manifest;
      },
    ],
    [
      // The retired environment may only ever appear on the App prior.
      "the retired environment on an ordinary prior",
      (manifest) => {
        const prior =
          toGovernanceEraManifest(manifest).originalPriors.governance;
        prior.target = null;
        prior.customEnvironmentSlug = "v3";
        for (const leaf of prior.planningLeaves) {
          leaf.target = null;
          leaf.customEnvironmentSlug = "v3";
        }
        return manifest;
      },
    ],
  ]) {
    const metadata = sealedMetadata(oldIntent, mutate);
    assert.equal(isBridgeEraCandidateMetadata(metadata, context), false, name);
    const response = deploymentResponse(oldIntent);
    response.meta = { ...response.meta, ...metadata };
    await assert.rejects(
      () =>
        mappedProvider(response).inspectMappedCandidate({
          deploymentId: response.id,
          target: "app",
          projectId: oldIntent.projectId,
        }),
      /Main release manifest/,
      name,
    );
  }
  // A current-contract seal must never be laundered through the bridge-era
  // admission either.
  assert.equal(
    isBridgeEraCandidateMetadata(
      createMainCandidateVercelMetadata({ intent: oldIntent }),
      context,
    ),
    false,
  );
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
  const oldIntent = intent("reserve");
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
          target: "reserve",
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
  for (const target of ["reserve", "app"]) {
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
        { target: "production", customEnvironmentSlug: null },
      );
    }
  }
});

test("unmarked mappings that self-report the reviewed SHA remain rollback-only", async () => {
  const reviewedSha = "e".repeat(40);
  for (const target of ["reserve", "app"]) {
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
  const currentIntent = intent("reserve");
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
      target: "reserve",
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
  const currentIntent = intent("reserve");
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
      target: "reserve",
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
        target: "reserve",
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
      meta.mentoNextDeploymentId = "mr-reserve-different";
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
          target: "reserve",
          projectId: currentIntent.projectId,
        }),
      /metadata/,
    );
  }
});

// ADR 0017 retired `governance` as a main target while every reviewed domain
// was served by a deployment sealed against the four-target universe, and ADR
// 0018 then retired `ui` while every reviewed domain was served by a
// deployment sealed against the three-target universe. The first release
// after each retirement must therefore meet only retired-era seals, classify
// each one as an unmarked rollback-only prior, capture a new baseline, and
// force-select every current target, rather than deadlock on an unreadable
// manifest. End-to-end proof against seals produced by the REAL modules at
// 982342ad and 618e6176.
for (const [era, retiredTarget] of [
  ["governanceEra", "Governance"],
  ["uiEra", "UI"],
]) {
  test(`the first release after the ${retiredTarget} retirement captures a new baseline`, async () => {
    const seals = HISTORICAL_SEALS[era].seals;
    const targets = ["reserve", "app"];
    const responses = new Map(
      targets.map((target) => [
        seals[target].deployment.id,
        genuineSealResponse(seals[target].deployment),
      ]),
    );
    const provider = createMainCandidateVercelProvider({
      client: {
        requestWithRetry: async () =>
          assert.fail("a rollback-only mapping is never resolved as a release"),
        inspectDeployment: async (id) => responses.get(id),
        listDeploymentAliases: async () => ({ aliases: [] }),
      },
    });
    const currentMappings = Object.fromEntries(
      targets.map((target) => [
        target,
        [
          {
            alias: `${target}.mento.org`,
            deploymentId: seals[target].deployment.id,
            deploymentUrl: seals[target].deployment.url,
          },
        ],
      ]),
    );
    const projectIds = {
      app: seals.app.deployment.projectId,
      reserve: seals.reserve.deployment.projectId,
    };
    const discovery = await discoverMainPreplanCandidateReleases({
      currentMappings,
      projectIds,
      provider,
    });
    assert.deepEqual(discovery.rollbackOnlyTargets, ["app", "reserve"]);
    assert.deepEqual(discovery.candidateReleases, []);

    const nextDeploySha = "e".repeat(40);
    const decision = decideMainPreplanReconciliation({
      nextDeploySha,
      nextUpstreamRunId: "701",
      candidateReleases: discovery.candidateReleases,
      currentMappings,
      rollbackOnlyTargets: discovery.rollbackOnlyTargets,
    });
    assert.equal(decision.decision, "capture-new-baseline");
    assert.equal(decision.reason, "no-mapped-release-metadata");
    assert.deepEqual(decision.rollbackOnlyTargets, ["app", "reserve"]);
    assert.equal(decision.reconciliation, null);
    assert.equal(decision.rollbackAuthorization, null);

    const input = JSON.parse(readFileSync(fixtureUrl, "utf8"));
    for (const target of targets) {
      for (const state of input.priorStates[target].states) {
        state.deploymentId = seals[target].deployment.id;
        state.deploymentUrl = `https://${seals[target].deployment.url}`;
        state.git.sha = seals[target].context.deploySha;
      }
    }
    const plannerCalls = [];
    const plan = planMainDeployments({
      mode: "active",
      mainOwnershipMode: { app: "github", reserve: "github" },
      deploySha: nextDeploySha,
      projectIds,
      priorStates: input.priorStates,
      rollbackOnlyTargets: decision.rollbackOnlyTargets,
      gitAdapter: {
        firstParent: () => input.firstParent,
        isAncestor: () => true,
        resolveCommit: (sha) => sha,
      },
      runPlanner: ({ base, head }) => {
        plannerCalls.push({ base, head });
        return { base, head, deployments: [], reason: "non-runtime-only" };
      },
    });
    assert.deepEqual(plan.stagedTargets, ["app", "reserve"]);
    assert.deepEqual(plan.activeTargets, ["app", "reserve"]);
    assert.deepEqual(
      plan.reasons.map(({ target, reason }) => ({ target, reason })),
      ["app", "reserve"].map((target) => ({
        target,
        reason: "served-mapping-rollback-only",
      })),
    );
    assert.equal(plannerCalls.length, 0);
  });
}

// The governance-era universe is an allowance, never a bypass: a four-target
// seal that is corrupt anywhere else, or that is not exactly the retired
// contract, is not a governance-era mapping and must still fail the run closed
// rather than be downgraded to a rollback-only prior.
test("a corrupt governance-era seal still fails closed", async () => {
  const oldIntent = intent("reserve");
  const context = {
    target: "reserve",
    projectId: oldIntent.projectId,
    projectName: oldIntent.projectName,
    deploySha: oldIntent.deploySha,
  };
  // The uncorrupted rebuild is genuinely admitted, so each case below
  // isolates exactly one corruption.
  assert.equal(
    isRetiredEraCandidateMetadata(
      sealedMetadata(oldIntent, toGovernanceEraManifest),
      context,
    ),
    true,
  );
  for (const [name, mutate, overrides = {}] of [
    [
      "Governance prior aliases",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        manifest.originalPriors.governance.aliases = ["app.mento.org"];
        return manifest;
      },
    ],
    [
      "Governance prior project",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        manifest.originalPriors.governance.projectName = "reserve.mento.org";
        return manifest;
      },
    ],
    [
      "Governance prior environment",
      (manifest) => {
        const prior =
          toGovernanceEraManifest(manifest).originalPriors.governance;
        prior.target = null;
        prior.customEnvironmentSlug = "v3";
        for (const leaf of prior.planningLeaves) {
          leaf.target = null;
          leaf.customEnvironmentSlug = "v3";
        }
        return manifest;
      },
    ],
    [
      "Governance prior missing",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        delete manifest.originalPriors.governance;
        return manifest;
      },
    ],
    [
      "current activation order",
      (manifest) => {
        const { governance, ...rest } =
          toGovernanceEraManifest(manifest).originalPriors;
        manifest.originalPriors = { ...rest, governance };
        return manifest;
      },
    ],
    [
      "ownership key order",
      (manifest) => {
        const { governance, ...rest } =
          toGovernanceEraManifest(manifest).mainOwnershipMode;
        manifest.mainOwnershipMode = { ...rest, governance };
        return manifest;
      },
    ],
    [
      "ownership without Governance",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        delete manifest.mainOwnershipMode.governance;
        return manifest;
      },
    ],
    [
      "a fifth target",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        manifest.mainOwnershipMode.docs = "github";
        return manifest;
      },
    ],
    [
      "staged targets out of the retired order",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        manifest.stagedTargets = [...manifest.stagedTargets].reverse();
        return manifest;
      },
    ],
    [
      "release ID",
      (manifest) => {
        toGovernanceEraManifest(manifest);
        manifest.releaseId = `mr-${"0".repeat(24)}`;
        return manifest;
      },
    ],
    [
      "stable intent digest",
      toGovernanceEraManifest,
      { mentoStableIntentDigest: "0".repeat(64) },
    ],
    ["audit origin", toGovernanceEraManifest, { mentoOriginRunId: undefined }],
  ]) {
    const metadata = sealedMetadata(oldIntent, mutate, overrides);
    assert.equal(isRetiredEraCandidateMetadata(metadata, context), false, name);
    assert.equal(isBridgeEraCandidateMetadata(metadata, context), false, name);
    const response = deploymentResponse(oldIntent);
    response.meta = { ...response.meta, ...metadata };
    if (Object.hasOwn(overrides, "mentoOriginRunId")) {
      delete response.meta.mentoOriginRunId;
    }
    await assert.rejects(
      () =>
        mappedProvider(response).inspectMappedCandidate({
          deploymentId: response.id,
          target: "reserve",
          projectId: oldIntent.projectId,
        }),
      /Main (?:release manifest|candidate)/,
      name,
    );
  }
  // A genuine governance-era seal rebound to another observed deployment is
  // not that mapping either.
  const { deployment } = HISTORICAL_SEALS.governanceEra.seals.reserve;
  const rebound = genuineSealResponse(deployment);
  rebound.meta.githubCommitSha = "b".repeat(40);
  await assert.rejects(
    () =>
      mappedProvider(rebound).inspectMappedCandidate({
        deploymentId: rebound.id,
        target: "reserve",
        projectId: deployment.projectId,
      }),
    /Main (?:release manifest|candidate)/,
  );
  // A Governance deployment is no longer a mapped target at all.
  const governance = genuineSealResponse(
    HISTORICAL_SEALS.governanceEra.seals.governance.deployment,
  );
  await assert.rejects(
    () =>
      mappedProvider(governance).inspectMappedCandidate({
        deploymentId: governance.id,
        target: "governance",
        projectId: governance.projectId,
      }),
    /Main mapped candidate target is malformed/,
  );
});

// The ui-era universe is an allowance, never a bypass: a three-target seal
// that is corrupt anywhere else, or that is not exactly the retired contract,
// is not a ui-era mapping and must still fail the run closed rather than be
// downgraded to a rollback-only prior.
test("a corrupt ui-era seal still fails closed", async () => {
  const oldIntent = intent("app");
  const context = {
    target: "app",
    projectId: oldIntent.projectId,
    projectName: oldIntent.projectName,
    deploySha: oldIntent.deploySha,
  };
  // The uncorrupted rebuild is genuinely admitted, so each case below
  // isolates exactly one corruption.
  assert.equal(
    isRetiredEraCandidateMetadata(
      sealedMetadata(oldIntent, toUiEraManifest),
      context,
    ),
    true,
  );
  for (const [name, mutate, overrides = {}] of [
    [
      "UI prior aliases",
      (manifest) => {
        toUiEraManifest(manifest);
        manifest.originalPriors.ui.aliases = ["app.mento.org"];
        return manifest;
      },
    ],
    [
      "UI prior project",
      (manifest) => {
        toUiEraManifest(manifest);
        manifest.originalPriors.ui.projectName = "reserve.mento.org";
        return manifest;
      },
    ],
    [
      "UI prior environment",
      (manifest) => {
        const prior = toUiEraManifest(manifest).originalPriors.ui;
        prior.target = null;
        prior.customEnvironmentSlug = "v3";
        for (const leaf of prior.planningLeaves) {
          leaf.target = null;
          leaf.customEnvironmentSlug = "v3";
        }
        return manifest;
      },
    ],
    [
      "UI prior missing",
      (manifest) => {
        toUiEraManifest(manifest);
        delete manifest.originalPriors.ui;
        return manifest;
      },
    ],
    [
      "current activation order",
      (manifest) => {
        const { ui, ...rest } = toUiEraManifest(manifest).originalPriors;
        manifest.originalPriors = { ...rest, ui };
        return manifest;
      },
    ],
    [
      "ownership key order",
      (manifest) => {
        const { app, ...rest } = toUiEraManifest(manifest).mainOwnershipMode;
        manifest.mainOwnershipMode = { ...rest, app };
        return manifest;
      },
    ],
    [
      "ownership without UI",
      (manifest) => {
        toUiEraManifest(manifest);
        delete manifest.mainOwnershipMode.ui;
        return manifest;
      },
    ],
    [
      "a fourth target",
      (manifest) => {
        toUiEraManifest(manifest);
        manifest.mainOwnershipMode.docs = "github";
        return manifest;
      },
    ],
    [
      "staged targets out of the retired order",
      (manifest) => {
        toUiEraManifest(manifest);
        manifest.stagedTargets = [...manifest.stagedTargets].reverse();
        return manifest;
      },
    ],
    [
      "release ID",
      (manifest) => {
        toUiEraManifest(manifest);
        manifest.releaseId = `mr-${"0".repeat(24)}`;
        return manifest;
      },
    ],
    [
      "stable intent digest",
      toUiEraManifest,
      { mentoStableIntentDigest: "0".repeat(64) },
    ],
    ["audit origin", toUiEraManifest, { mentoOriginRunId: undefined }],
  ]) {
    const metadata = sealedMetadata(oldIntent, mutate, overrides);
    assert.equal(isRetiredEraCandidateMetadata(metadata, context), false, name);
    assert.equal(isBridgeEraCandidateMetadata(metadata, context), false, name);
    const response = deploymentResponse(oldIntent);
    response.meta = { ...response.meta, ...metadata };
    if (Object.hasOwn(overrides, "mentoOriginRunId")) {
      delete response.meta.mentoOriginRunId;
    }
    await assert.rejects(
      () =>
        mappedProvider(response).inspectMappedCandidate({
          deploymentId: response.id,
          target: "app",
          projectId: oldIntent.projectId,
        }),
      /Main (?:release manifest|candidate)/,
      name,
    );
  }
  // A genuine ui-era seal rebound to another observed deployment is not that
  // mapping either.
  const { deployment } = HISTORICAL_SEALS.uiEra.seals.app;
  const rebound = genuineSealResponse(deployment);
  rebound.meta.githubCommitSha = "b".repeat(40);
  await assert.rejects(
    () =>
      mappedProvider(rebound).inspectMappedCandidate({
        deploymentId: rebound.id,
        target: "app",
        projectId: deployment.projectId,
      }),
    /Main (?:release manifest|candidate)/,
  );
  // A UI deployment is no longer a mapped target at all, in either era.
  for (const era of ["uiEra", "governanceEra"]) {
    const ui = genuineSealResponse(HISTORICAL_SEALS[era].seals.ui.deployment);
    await assert.rejects(
      () =>
        mappedProvider(ui).inspectMappedCandidate({
          deploymentId: ui.id,
          target: "ui",
          projectId: ui.projectId,
        }),
      /Main mapped candidate target is malformed/,
      era,
    );
  }
});
