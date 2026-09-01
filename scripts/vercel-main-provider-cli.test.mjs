import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
  decodeMainCandidateReceipt,
} from "./vercel-main-candidate.mjs";
import {
  createMainReleaseManifest,
  decideMainPreplanReconciliation,
} from "./vercel-main-release-reconciliation.mjs";
import {
  MAIN_TARGET_CONTRACTS,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import { PRODUCTION_GENERATED_ALIAS_CONTRACTS } from "./vercel-production-generated-aliases.mjs";
import { generateVercelMainReleaseId } from "./vercel-prebuilt.mjs";
import {
  appendGithubOutputs,
  assertMainProviderDiscovery,
  createMainCanonicalMappings,
  decodeMainPreplanHandoff,
  encodeMainPreplanHandoff,
  mainProviderCliFailureExitCode,
  MAIN_PROVIDER_CLI_MAX_JSON_BYTES,
  MAIN_PROVIDER_CLI_RETRY_EXIT_CODE,
  MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES,
  MAIN_PREPLAN_HANDOFF_MAX_JSON_BYTES,
  readPrivateJson,
  renderMainProviderCliFailure,
  reviewedRunnerTemp,
  runMainProviderCli,
  writeMainPreplanDecisionOutputs,
  writePrivateJson,
} from "./vercel-main-provider-cli.mjs";

const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);
const SHA = "d".repeat(40);
const PRIOR_SHA = "a".repeat(40);
const LINUX_MAX_ARG_STRING_BYTES = 128 * 1024;
const MAIN_PREPLAN_HANDOFF_ENV_OVERHEAD_BYTES = Buffer.byteLength(
  "MAIN_PREPLAN_HANDOFF=\0",
  "utf8",
);

function fixtureInput() {
  const input = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  for (const target of ["app", "governance", "reserve", "ui"]) {
    for (const state of input.priorStates[target].states) {
      state.git.sha = PRIOR_SHA;
    }
  }
  return input;
}

function releaseManifest({
  deploySha = SHA,
  upstreamRunId = "700",
  active = false,
  productionIdPaddingBytes = 0,
} = {}) {
  const input = fixtureInput();
  input.deploySha = deploySha;
  if (active) {
    input.mode = "active";
    input.mainOwnershipMode = {
      app: "github",
      governance: "github",
      reserve: "github",
      ui: "github",
    };
  }
  if (productionIdPaddingBytes > 0) {
    for (const [target, prior] of Object.entries(input.priorStates)) {
      for (const state of prior.states) {
        state.deploymentId = `dpl_${target}${"A".repeat(productionIdPaddingBytes)}`;
        state.deploymentUrl = `https://${target}mento-${"b".repeat(9)}-mentolabs.vercel.app`;
        state.projectId = `prj_${target}${"C".repeat(productionIdPaddingBytes)}`;
      }
    }
    input.projectIds = Object.fromEntries(
      Object.entries(input.priorStates).map(([target, prior]) => [
        target,
        prior.states[0].projectId,
      ]),
    );
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
  return createMainReleaseManifest({ upstreamRunId, plan, originalPriors });
}

function productionShapedDecision({ productionIdPaddingBytes = 26 } = {}) {
  const manifest = releaseManifest({
    active: true,
    productionIdPaddingBytes,
  });
  const candidates = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => [
      target,
      {
        deploymentId: `dpl_${target}${"D".repeat(productionIdPaddingBytes)}`,
        deploymentUrl: `https://${target}mento-${"e".repeat(9)}-mentolabs.vercel.app`,
        manifest,
      },
    ]),
  );
  return decideMainPreplanReconciliation({
    nextDeploySha: "e".repeat(40),
    nextUpstreamRunId: "701",
    candidateReleases: [{ manifest, candidates }],
    currentMappings: Object.fromEntries(
      ["governance", "reserve", "ui", "app"].map((target) => {
        const current =
          target === "app"
            ? candidates[target]
            : manifest.originalPriors[target];
        return [
          target,
          manifest.originalPriors[target].aliases.map((alias) => ({
            alias,
            deploymentId: current.deploymentId,
            deploymentUrl: current.deploymentUrl,
          })),
        ];
      }),
    ),
    rollbackOnlyTargets: [],
  });
}

function candidateIntent(target = "ui") {
  const manifest = releaseManifest();
  return createMainCandidateIntent({
    target,
    deploySha: manifest.deploySha,
    upstreamRunId: manifest.upstreamRunId,
    originRunId: "800",
    originAttempt: "1",
    originTransactionId: "main-0123456789abcdef0123456789abcdef",
    projectId: manifest.originalPriors[target].projectId,
    releaseManifest: manifest,
  });
}

function planningSnapshot(patches = {}) {
  const input = fixtureInput();
  const states = Object.values(input.priorStates)
    .flatMap(({ states: entries }) => entries)
    .map((state) => ({
      ...state,
      ...(patches[state.alias] ?? {}),
    }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
  return { schema: "vercel-main-planning-snapshot:v1", states };
}

function projectIds() {
  return fixtureInput().projectIds;
}

function testContext(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-provider-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fileCommands = join(directory, "_runner_file_commands");
  mkdirSync(fileCommands, { mode: 0o700 });
  const githubOutput = join(fileCommands, "set_output_fixture");
  writeFileSync(githubOutput, "", { mode: 0o600 });
  chmodSync(githubOutput, 0o600);
  const values = projectIds();
  const env = {
    RUNNER_TEMP: directory,
    GITHUB_OUTPUT: githubOutput,
    VERCEL_TOKEN: "test-secret-token",
    VERCEL_ORG_ID: "team_fixture",
    VERCEL_PROJECT_ID_APP: values.app,
    VERCEL_PROJECT_ID_GOVERNANCE: values.governance,
    VERCEL_PROJECT_ID_RESERVE: values.reserve,
    VERCEL_PROJECT_ID_UI: values.ui,
    DEPLOY_SHA: SHA,
    UPSTREAM_RUN_ID: "700",
  };
  const stdout = {
    value: "",
    write(chunk) {
      this.value += chunk;
    },
  };
  return { directory, env, githubOutput, stdout };
}

function writeJson(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function captureRejection(operation, pattern) {
  try {
    await operation();
  } catch (error) {
    assert.match(error.message, pattern);
    return error;
  }
  assert.fail("Expected operation to reject");
}

function planningStateClient(firstSnapshot, secondSnapshot = firstSnapshot) {
  let calls = 0;
  return {
    mainPlanningAliasState: async ({ alias }) => {
      const source =
        calls < firstSnapshot.states.length ? firstSnapshot : secondSnapshot;
      calls += 1;
      return structuredClone(
        source.states.find((state) => state.alias === alias),
      );
    },
    calls: () => calls,
  };
}

function deploymentResponse(intent, id = "dpl_candidate0123456789") {
  return {
    id,
    url: `${intent.target}-candidate.vercel.app`,
    projectId: intent.projectId,
    name: intent.projectName,
    readyState: "READY",
    target: intent.environment.target,
    customEnvironment:
      intent.environment.customEnvironmentSlug === null
        ? undefined
        : { slug: intent.environment.customEnvironmentSlug },
    source: "cli",
    creator: { uid: "user_fixture123", username: "fixture-author" },
    meta: {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
      githubCommitSha: intent.deploySha,
      ...createMainCandidateVercelMetadata({ intent }),
    },
  };
}

function candidateSmokeStateClient(response) {
  return () => ({
    requestWithRetry: async () => ({
      deployments: [{ uid: response.id }],
      pagination: { next: null },
    }),
    inspectDeployment: async () => response,
    listDeploymentAliases: async () => ({ aliases: [] }),
  });
}

function candidateSmokeHttpResponse({
  url,
  intent,
  status = 200,
  redirected = false,
  servedSha = intent.deploySha,
  onCancel = () => {},
}) {
  return {
    status,
    redirected,
    url,
    headers: {
      get: (name) => (name === "x-mento-deployment-sha" ? servedSha : null),
    },
    body: {
      cancel: async () => onCancel(),
    },
  };
}

function generatedCreatorAlias(target, creatorUsername = "fixture-author") {
  const { generatedProjectSlug, generatedScopeSlug } =
    PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
  return `${generatedProjectSlug}-${creatorUsername}-${generatedScopeSlug}.vercel.app`;
}

function aliasSubsets(values) {
  return Array.from({ length: 2 ** values.length }, (_, mask) =>
    values.filter((_, index) => (mask & (1 << index)) !== 0).toSorted(),
  );
}

test("canonical mappings preserve exactly the four reviewed target alias sets", async (t) => {
  const context = testContext(t);
  const expected = createMainCanonicalMappings({
    planningSnapshot: planningSnapshot(),
    projectIds: projectIds(),
  });
  assert.deepEqual(Object.keys(expected.mappings), [
    "governance",
    "reserve",
    "ui",
    "app",
  ]);
  assert.deepEqual(
    expected.mappings.app.map(({ alias }) => alias),
    ["app.mento.org", "appmentoorg-env-v3-mentolabs.vercel.app"],
  );
  // The retired legacy App topology must never re-enter the canonical set.
  assert.doesNotMatch(JSON.stringify(expected.mappings), /v2-app\.mento\.org/);

  const planningPath = writeJson(
    context.directory,
    "planning.json",
    planningSnapshot(),
  );
  const output = join(context.directory, "mappings.json");
  await runMainProviderCli({
    argv: [
      "canonical-mappings",
      "--planning-snapshot",
      planningPath,
      "--output",
      output,
    ],
    env: context.env,
    stdout: context.stdout,
  });
  assert.deepEqual(readJson(output), expected);
  assert.equal(statSync(output).mode & 0o777, 0o600);

  const wrongProject = planningSnapshot({
    "ui.mento.org": { projectId: "prj_wrong" },
  });
  assert.throws(
    () =>
      createMainCanonicalMappings({
        planningSnapshot: wrongProject,
        projectIds: projectIds(),
      }),
    /identity conflicts/,
  );
  const wrongTopology = planningSnapshot({
    "app.mento.org": { deploymentId: "dpl_other123" },
  });
  assert.throws(
    () =>
      createMainCanonicalMappings({
        planningSnapshot: wrongTopology,
        projectIds: projectIds(),
      }),
    /topology conflicts/,
  );
  assert.throws(
    () =>
      createMainCanonicalMappings({
        planningSnapshot: planningSnapshot({
          "ui.mento.org": { deploymentId: "not-a-deployment-id" },
        }),
        projectIds: projectIds(),
      }),
    /deployment ID is malformed/,
  );
  await assert.rejects(
    runMainProviderCli({
      argv: [
        "canonical-mappings",
        "--planning-snapshot",
        planningPath,
        "--legacy-snapshot",
        planningPath,
        "--output",
        join(context.directory, "retired-legacy.json"),
      ],
      env: context.env,
      stdout: context.stdout,
    }),
    /option/,
  );
});

test("preplan discovery groups mapped manifests and marks unowned mappings rollback-only", async (t) => {
  const context = testContext(t);
  const first = releaseManifest({
    deploySha: "c".repeat(40),
    upstreamRunId: "699",
  });
  const second = releaseManifest({ deploySha: SHA, upstreamRunId: "700" });
  const snapshot = planningSnapshot({
    "governance.mento.org": {
      deploymentId: "dpl_governanceCandidate123",
      deploymentUrl: "https://governance-candidate.vercel.app",
    },
    "reserve.mento.org": {
      deploymentId: "dpl_reserveCandidate123",
      deploymentUrl: "https://reserve-candidate.vercel.app",
    },
  });
  const planningPath = writeJson(context.directory, "planning.json", snapshot);
  const projectsPath = writeJson(
    context.directory,
    "projects.json",
    projectIds(),
  );
  const output = join(context.directory, "discovery.json");
  const providerFactory = ({ client, intent }) => {
    assert.equal(client.kind, "fake-client");
    assert.equal(
      intent,
      undefined,
      "pre-plan discovery must not use a current intent",
    );
    return {
      inspectMappedCandidate: async ({ deploymentId }) => {
        return {
          canonicalState: {},
          metadata:
            deploymentId === "dpl_governanceCandidate123"
              ? { releaseManifest: first }
              : deploymentId === "dpl_reserveCandidate123"
                ? { releaseManifest: second }
                : null,
        };
      },
      resolveReleaseCandidate: async ({ manifest, target }) => {
        const selectedTarget =
          manifest.releaseId === first.releaseId ? "governance" : "reserve";
        return target === selectedTarget
          ? {
              intent: {},
              candidate: {
                deploymentId: `dpl_${target}Candidate123`,
                deploymentUrl: `https://${target}-candidate.vercel.app`,
              },
            }
          : null;
      },
    };
  };
  const result = await runMainProviderCli({
    argv: [
      "preplan-discover",
      "--planning-snapshot",
      planningPath,
      "--project-ids",
      projectsPath,
      "--output",
      output,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: ({ token, teamId }) => {
      assert.equal(token, context.env.VERCEL_TOKEN);
      assert.equal(teamId, context.env.VERCEL_ORG_ID);
      return { kind: "fake-client" };
    },
    providerFactory,
  });
  assert.deepEqual(
    result.discovery.candidateReleases.map(
      ({ manifest }) => manifest.releaseId,
    ),
    [first.releaseId, second.releaseId].sort(),
  );
  assert.equal(readJson(output).discovery.candidateReleases.length, 2);
  assert.deepEqual(result.discovery.rollbackOnlyTargets, ["app", "ui"]);
  for (const rollbackOnlyTargets of [
    ["ui", "app"],
    ["app", "app"],
    ["unknown"],
  ]) {
    const malformed = structuredClone(result);
    malformed.discovery.rollbackOnlyTargets = rollbackOnlyTargets;
    assert.throws(
      () => assertMainProviderDiscovery(malformed),
      /candidate discovery is malformed/,
    );
  }
  assert.deepEqual(result.projectIds, projectIds());
  assert.match(result.planningSnapshotDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(
    context.stdout.value,
    /test-secret-token|releaseManifest/,
  );
});

test("preplan decision binds current SHA and upstream run to one exact release ID", async (t) => {
  const context = testContext(t);
  chmodSync(context.githubOutput, 0o644);
  const snapshot = planningSnapshot();
  const planningPath = writeJson(context.directory, "planning.json", snapshot);
  const projectsPath = writeJson(
    context.directory,
    "projects.json",
    projectIds(),
  );
  const discoveryPath = join(context.directory, "discovery.json");
  await runMainProviderCli({
    argv: [
      "preplan-discover",
      "--planning-snapshot",
      planningPath,
      "--project-ids",
      projectsPath,
      "--output",
      discoveryPath,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => ({ kind: "discovery-client" }),
    providerFactory: () => ({
      inspectMappedCandidate: async () => {
        return {
          canonicalState: {},
          metadata: null,
        };
      },
      resolveReleaseCandidate: async () =>
        assert.fail("native mappings have no release candidates"),
    }),
  });
  const output = join(context.directory, "decision.json");
  const liveClient = planningStateClient(snapshot);
  const result = await runMainProviderCli({
    argv: [
      "preplan-decide",
      "--discovery",
      discoveryPath,
      "--planning-snapshot",
      planningPath,
      "--output",
      output,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => liveClient,
  });
  assert.equal(liveClient.calls(), snapshot.states.length * 2);
  assert.equal(result.decision, "capture-new-baseline");
  const expectedReleaseId = generateVercelMainReleaseId({
    repository: "mento-protocol/frontend-monorepo",
    commitSha: SHA,
    upstreamRunId: "700",
  });
  assert.equal(
    readFileSync(context.githubOutput, "utf8"),
    [
      "decision=capture-new-baseline",
      "reason=no-mapped-release-metadata",
      `release_id=${expectedReleaseId}`,
      `handoff=${encodeMainPreplanHandoff(result, {
        nextDeploySha: SHA,
        nextUpstreamRunId: "700",
      })}`,
      "",
    ].join("\n"),
  );
  assert.equal(statSync(context.githubOutput).mode & 0o777, 0o600);
  assert.deepEqual(readJson(output), result);

  const encoded = encodeMainPreplanHandoff(result, {
    nextDeploySha: SHA,
    nextUpstreamRunId: "700",
  });
  assert.ok(
    Buffer.byteLength(encoded, "utf8") < MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES,
  );
  assert.deepEqual(
    decodeMainPreplanHandoff(encoded, {
      nextDeploySha: SHA,
      nextUpstreamRunId: "700",
    }),
    result,
  );
  const materialized = join(context.directory, "materialized.json");
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: ["preplan-materialize", "--output", materialized],
        env: { ...context.env, MAIN_PREPLAN_HANDOFF: encoded },
        stdout: context.stdout,
      }),
    /Only restore-before-planning/,
  );
  assert.throws(() => readFileSync(materialized), /ENOENT/);
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "preplan-materialize",
          "--output",
          join(context.directory, "tampered-materialized.json"),
        ],
        env: {
          ...context.env,
          MAIN_PREPLAN_HANDOFF: `${encoded.slice(0, -1)}A`,
        },
        stdout: context.stdout,
      }),
    /decode|canonical|inconsistent|malformed/,
  );
});

test("preplan decision restores a manifest-bound mixed App recovery residual", async (t) => {
  const context = testContext(t);
  const inherited = releaseManifest({
    deploySha: "c".repeat(40),
    upstreamRunId: "699",
    active: true,
  });
  const appCandidate = {
    deploymentId: "dpl_appRecoveryResidual123",
    deploymentUrl: "https://app-recovery-residual.vercel.app",
  };
  const candidateAlias = inherited.originalPriors.app.aliases[0];
  const snapshot = planningSnapshot(
    Object.fromEntries(
      inherited.originalPriors.app.aliases.map((alias) => [
        alias,
        alias === candidateAlias
          ? {
              ...appCandidate,
              aliases: [alias],
              git: {
                org: "mento-protocol",
                repo: "frontend-monorepo",
                ref: "main",
                sha: inherited.deploySha,
              },
            }
          : {
              aliases: [alias],
            },
      ]),
    ),
  );
  const planningPath = writeJson(context.directory, "planning.json", snapshot);
  const projectsPath = writeJson(
    context.directory,
    "projects.json",
    projectIds(),
  );
  const discoveryPath = join(context.directory, "discovery.json");
  await runMainProviderCli({
    argv: [
      "preplan-discover",
      "--planning-snapshot",
      planningPath,
      "--project-ids",
      projectsPath,
      "--output",
      discoveryPath,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => ({ kind: "discovery-client" }),
    providerFactory: () => ({
      inspectMappedCandidate: async ({ deploymentId, target }) => ({
        canonicalState: {},
        metadata:
          target === "app" && deploymentId === appCandidate.deploymentId
            ? { releaseManifest: inherited }
            : null,
      }),
      resolveReleaseCandidate: async ({ manifest, target }) => {
        assert.equal(manifest.releaseId, inherited.releaseId);
        return target === "app"
          ? { intent: {}, candidate: appCandidate }
          : null;
      },
    }),
  });

  const output = join(context.directory, "decision.json");
  const result = await runMainProviderCli({
    argv: [
      "preplan-decide",
      "--discovery",
      discoveryPath,
      "--planning-snapshot",
      planningPath,
      "--output",
      output,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => planningStateClient(snapshot),
  });

  assert.equal(result.decision, "restore-before-planning");
  assert.equal(result.reason, "older-main-release-is-an-app-recovery-residual");
  assert.deepEqual(result.rollbackAuthorization, {
    reason: "restore-inherited",
    targets: ["app"],
    aliases: [candidateAlias],
  });
  assert.deepEqual(result.rollbackOnlyTargets, [
    "app",
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(readJson(output), result);
});

test("preplan materialization accepts only inherited restore and exposes ordered active targets", async (t) => {
  const context = testContext(t);
  const inherited = releaseManifest({
    deploySha: "c".repeat(40),
    upstreamRunId: "699",
    active: true,
  });
  const governanceCandidate = {
    deploymentId: "dpl_governanceInherited123",
    deploymentUrl: "https://governance-inherited.vercel.app",
    manifest: inherited,
  };
  const currentMappings = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => {
      const prior = inherited.originalPriors[target];
      const current = target === "governance" ? governanceCandidate : prior;
      return [
        target,
        prior.aliases.map((alias) => ({
          alias,
          deploymentId: current.deploymentId,
          deploymentUrl: current.deploymentUrl,
        })),
      ];
    }),
  );
  const decision = decideMainPreplanReconciliation({
    nextDeploySha: SHA,
    nextUpstreamRunId: "700",
    candidateReleases: [
      {
        manifest: inherited,
        candidates: {
          governance: governanceCandidate,
          reserve: null,
          ui: null,
          app: null,
        },
      },
    ],
    currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(decision.decision, "restore-before-planning");
  const encoded = encodeMainPreplanHandoff(decision, {
    nextDeploySha: SHA,
    nextUpstreamRunId: "700",
  });
  const completeCandidates = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => [
      target,
      {
        deploymentId: `dpl_${target}MaximumShape123`,
        deploymentUrl: `https://${target}-maximum-shape.vercel.app`,
        manifest: inherited,
      },
    ]),
  );
  const maximumShapeDecision = decideMainPreplanReconciliation({
    nextDeploySha: SHA,
    nextUpstreamRunId: "700",
    candidateReleases: [
      {
        manifest: inherited,
        candidates: completeCandidates,
      },
    ],
    currentMappings: Object.fromEntries(
      ["governance", "reserve", "ui", "app"].map((target) => [
        target,
        inherited.originalPriors[target].aliases.map((alias) => ({
          alias,
          deploymentId: completeCandidates[target].deploymentId,
          deploymentUrl: completeCandidates[target].deploymentUrl,
        })),
      ]),
    ),
    rollbackOnlyTargets: [],
  });
  const maximumShapeHandoff = encodeMainPreplanHandoff(maximumShapeDecision, {
    nextDeploySha: SHA,
    nextUpstreamRunId: "700",
  });
  assert.ok(
    Buffer.byteLength(maximumShapeHandoff, "utf8") <=
      MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES,
  );
  assert.deepEqual(
    decodeMainPreplanHandoff(maximumShapeHandoff, {
      nextDeploySha: SHA,
      nextUpstreamRunId: "700",
    }),
    maximumShapeDecision,
  );
  const productionShapeDecision = productionShapedDecision();
  const productionShapeSerialized = JSON.stringify(productionShapeDecision);
  assert.equal(productionShapeDecision.decision, "restore-before-planning");
  assert.equal(
    productionShapeDecision.reason,
    "older-main-release-is-an-app-recovery-residual",
  );
  const productionShapeHandoff = encodeMainPreplanHandoff(
    productionShapeDecision,
    {
      nextDeploySha: "e".repeat(40),
      nextUpstreamRunId: "701",
    },
  );
  assert.ok(
    Buffer.byteLength(productionShapeSerialized, "utf8") > 49_152,
    "production-shaped pre-plan must exceed the legacy 64 KiB base64url limit",
  );
  assert.ok(
    Buffer.byteLength(productionShapeSerialized, "utf8") <=
      MAIN_PREPLAN_HANDOFF_MAX_JSON_BYTES,
  );
  assert.ok(Buffer.byteLength(productionShapeHandoff, "utf8") > 64 * 1024);
  assert.ok(
    Buffer.byteLength(productionShapeHandoff, "utf8") <=
      MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES,
  );
  assert.ok(
    Math.ceil((MAIN_PREPLAN_HANDOFF_MAX_JSON_BYTES * 4) / 3) <=
      MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES,
    "every accepted JSON payload must fit the encoded handoff bound",
  );
  assert.ok(
    MAIN_PREPLAN_HANDOFF_ENV_OVERHEAD_BYTES +
      MAIN_PREPLAN_HANDOFF_MAX_ENCODED_BYTES <
      LINUX_MAX_ARG_STRING_BYTES,
    "the largest handoff must fit one Linux environment entry",
  );
  assert.deepEqual(
    decodeMainPreplanHandoff(productionShapeHandoff, {
      nextDeploySha: "e".repeat(40),
      nextUpstreamRunId: "701",
    }),
    productionShapeDecision,
  );
  assert.throws(
    () =>
      encodeMainPreplanHandoff(
        productionShapedDecision({ productionIdPaddingBytes: 2_500 }),
        {
          nextDeploySha: "e".repeat(40),
          nextUpstreamRunId: "701",
        },
      ),
    /JSON size bound/,
  );
  const output = join(context.directory, "restore-before-planning.json");
  await runMainProviderCli({
    argv: ["preplan-materialize", "--output", output],
    env: { ...context.env, MAIN_PREPLAN_HANDOFF: encoded },
    stdout: context.stdout,
  });
  assert.deepEqual(readJson(output), decision);
  assert.equal(
    readFileSync(context.githubOutput, "utf8"),
    [
      'inherited_candidate_targets=["governance"]',
      `inherited_journal_deploy_sha=${inherited.deploySha}`,
      "",
    ].join("\n"),
  );
});

test("post-census preplan output failures are typed, non-retryable, and value-free", (t) => {
  const context = testContext(t);
  const result = {
    schema: "vercel-main-preplan-reconciliation:v2",
    decision: "capture-new-baseline",
    reason: "no-mapped-release-metadata",
    rollbackOnlyTargets: [],
    reconciliation: null,
    rollbackAuthorization: null,
  };
  const output = join(context.directory, "decision.json");
  const secret = `${context.env.VERCEL_TOKEN} /private/provider/path`;
  const cases = [
    [
      "preplan-handoff-encode-failed",
      {
        encodeMainPreplanHandoff: () => {
          throw new Error(secret);
        },
        writePrivateJson: assert.fail,
        appendGithubOutputs: assert.fail,
      },
    ],
    [
      "preplan-private-output-write-failed",
      {
        encodeMainPreplanHandoff: () => "safe-handoff",
        writePrivateJson: () => {
          throw new Error(secret);
        },
        appendGithubOutputs: assert.fail,
      },
    ],
    [
      "preplan-github-output-append-failed",
      {
        encodeMainPreplanHandoff: () => "safe-handoff",
        writePrivateJson: () => undefined,
        appendGithubOutputs: () => {
          throw new Error(secret);
        },
      },
    ],
  ];

  for (const [failureCode, operations] of cases) {
    let error;
    try {
      writeMainPreplanDecisionOutputs({
        output,
        result,
        releaseId: "release_fixture",
        runnerTemp: context.directory,
        env: context.env,
        operations,
      });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof Error);
    assert.equal(
      renderMainProviderCliFailure(error),
      `Vercel main provider command failed (${failureCode})\n`,
    );
    assert.equal(mainProviderCliFailureExitCode(error), 1);
    assert.doesNotMatch(
      renderMainProviderCliFailure(error),
      /test-secret-token|private\/provider\/path/,
    );
  }
  assert.throws(() => statSync(output), /ENOENT/);
});

test("preplan decision rejects alias drift after discovery before baseline or rollback authorization", async (t) => {
  const context = testContext(t);
  const original = planningSnapshot();
  const planningPath = writeJson(context.directory, "planning.json", original);
  const projectsPath = writeJson(
    context.directory,
    "projects.json",
    projectIds(),
  );
  const discoveryPath = join(context.directory, "discovery.json");
  await runMainProviderCli({
    argv: [
      "preplan-discover",
      "--planning-snapshot",
      planningPath,
      "--project-ids",
      projectsPath,
      "--output",
      discoveryPath,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => ({ kind: "discovery-client" }),
    providerFactory: () => ({
      inspectMappedCandidate: async () => {
        return {
          canonicalState: {},
          metadata: null,
        };
      },
      resolveReleaseCandidate: async () => null,
    }),
  });
  const changed = planningSnapshot({
    "ui.mento.org": {
      deploymentId: "dpl_changedAfterDiscovery123",
      deploymentUrl: "https://changed-after-discovery.vercel.app",
    },
  });
  for (const [client, failureCode] of [
    [planningStateClient(changed), "planning-census-stale"],
    [planningStateClient(original, changed), "planning-census-unstable"],
  ]) {
    const output = join(
      context.directory,
      `decision-drift-${client.calls()}.json`,
    );
    const planningDriftError = await captureRejection(
      () =>
        runMainProviderCli({
          argv: [
            "preplan-decide",
            "--discovery",
            discoveryPath,
            "--planning-snapshot",
            planningPath,
            "--output",
            output,
          ],
          env: context.env,
          stdout: context.stdout,
          stateClientFactory: () => client,
        }),
      /Vercel provider census failed/,
    );
    assert.throws(() => statSync(output));
    assert.equal(
      renderMainProviderCliFailure(planningDriftError),
      `Vercel main provider command failed (${failureCode})\n`,
    );
    assert.equal(
      mainProviderCliFailureExitCode(planningDriftError),
      MAIN_PROVIDER_CLI_RETRY_EXIT_CODE,
    );
    assert.equal(readFileSync(context.githubOutput, "utf8"), "");
  }

  const timeoutError = new Error(
    `${context.env.VERCEL_TOKEN} prj_private123 /v13/deployments/private`,
  );
  timeoutError.code = "VERCEL_API_READ_TIMEOUT";
  const planningTimeoutError = await captureRejection(
    () =>
      runMainProviderCli({
        argv: [
          "preplan-decide",
          "--discovery",
          discoveryPath,
          "--planning-snapshot",
          planningPath,
          "--output",
          join(context.directory, "planning-timeout.json"),
        ],
        env: context.env,
        stdout: context.stdout,
        stateClientFactory: () => ({
          mainPlanningAliasState: async () => {
            throw timeoutError;
          },
        }),
      }),
    /Vercel provider census failed/,
  );
  assert.equal(
    renderMainProviderCliFailure(planningTimeoutError),
    "Vercel main provider command failed (planning-census-read-timeout)\n",
  );
  assert.doesNotMatch(
    renderMainProviderCliFailure(planningTimeoutError),
    /test-secret-token|prj_private123|v13|deployments|private/,
  );
  assert.equal(mainProviderCliFailureExitCode(planningTimeoutError), 1);

  const reconciliationOutput = join(
    context.directory,
    "reconciliation-failure.json",
  );
  const reconciliationError = await captureRejection(
    () =>
      runMainProviderCli({
        argv: [
          "preplan-decide",
          "--discovery",
          discoveryPath,
          "--planning-snapshot",
          planningPath,
          "--output",
          reconciliationOutput,
        ],
        env: { ...context.env, DEPLOY_SHA: context.env.VERCEL_TOKEN },
        stdout: context.stdout,
        stateClientFactory: () => planningStateClient(original),
      }),
    /Vercel preplan reconciliation failed/,
  );
  assert.throws(() => statSync(reconciliationOutput));
  assert.equal(
    renderMainProviderCliFailure(reconciliationError),
    "Vercel main provider command failed (preplan-reconciliation-failed)\n",
  );
  assert.equal(mainProviderCliFailureExitCode(reconciliationError), 1);
  assert.equal(readFileSync(context.githubOutput, "utf8"), "");

  const secretSemanticError = new Error(
    `${context.env.VERCEL_TOKEN} prj_private123 /private/provider/path`,
  );
  secretSemanticError.mainProviderFailureCode = "preplan-reconciliation-failed";
  assert.equal(
    renderMainProviderCliFailure(secretSemanticError),
    "Vercel main provider command failed (preplan-reconciliation-failed)\n",
  );
  assert.doesNotMatch(
    renderMainProviderCliFailure(secretSemanticError),
    /test-secret-token|prj_private123|\/private\/provider\/path/,
  );

  // MGP-18 retired the legacy App census. Neither pre-plan command may accept
  // a legacy snapshot again, so the option itself must stay unsupported.
  for (const command of ["preplan-discover", "preplan-decide"]) {
    await assert.rejects(
      () =>
        runMainProviderCli({
          argv: [
            command,
            ...(command === "preplan-decide"
              ? ["--discovery", discoveryPath]
              : ["--project-ids", projectsPath]),
            "--planning-snapshot",
            planningPath,
            "--legacy-snapshot",
            planningPath,
            "--output",
            join(context.directory, `${command}-retired-legacy.json`),
          ],
          env: context.env,
          stdout: context.stdout,
          stateClientFactory: () => planningStateClient(original),
        }),
      /option/,
    );
  }
  assert.equal(readFileSync(context.githubOutput, "utf8"), "");
});

test("candidate preflight performs a stable double census and emits create", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const output = join(context.directory, "preflight.json");
  let lists = 0;
  const result = await runMainProviderCli({
    argv: ["candidate-preflight", "--intent", intentPath, "--output", output],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => ({
      requestWithRetry: async () => {
        lists += 1;
        return { deployments: [], pagination: { next: null } };
      },
    }),
  });
  assert.equal(lists, 2);
  assert.equal(result.outcome, "create-if-zero");
  assert.equal(readFileSync(context.githubOutput, "utf8"), "action=create\n");

  const driftOutput = join(context.directory, "drift.json");
  let driftLists = 0;
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-preflight",
          "--intent",
          intentPath,
          "--output",
          driftOutput,
        ],
        env: {
          ...context.env,
          GITHUB_OUTPUT: join(context.directory, "other-gh-output"),
        },
        stdout: context.stdout,
        stateClientFactory: () => ({
          requestWithRetry: async () => {
            driftLists += 1;
            return {
              deployments:
                driftLists === 1 ? [] : [{ uid: "dpl_candidate0123456789" }],
              pagination: { next: null },
            };
          },
        }),
      }),
    /census changed/,
  );
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.throws(() => statSync(driftOutput));
});

test("candidate finalization reuses one fresh candidate and rejects smoke mismatch", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const response = deploymentResponse(intent);
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const smokePath = writeJson(context.directory, "smoke.json", {
    immutableUrl: response.url,
    servedSha: intent.deploySha,
    status: "passed",
  });
  const output = join(context.directory, "handoff.json");
  const stateClientFactory = () => ({
    requestWithRetry: async () => ({
      deployments: [{ uid: response.id }],
      pagination: { next: null },
    }),
    inspectDeployment: async () => response,
    listDeploymentAliases: async () => ({
      aliases: [
        {
          alias: PRODUCTION_GENERATED_ALIAS_CONTRACTS.ui.generatedProjectAlias,
        },
      ],
    }),
  });
  const result = await runMainProviderCli({
    argv: [
      "candidate-finalize",
      "--intent",
      intentPath,
      "--smoke",
      smokePath,
      "--output",
      output,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory,
  });
  assert.equal(result.action, "reuse");
  const outputs = Object.fromEntries(
    readFileSync(context.githubOutput, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  assert.equal(outputs.action, "reuse");
  assert.equal(outputs.deployment_id, response.id);
  assert.deepEqual(
    decodeMainCandidateReceipt(outputs.receipt, intent),
    result.receipt,
  );
  assert.equal(
    readJson(output).receipt.immutableSmoke.servedSha,
    intent.deploySha,
  );

  const creationPreflightPath = join(
    context.directory,
    "creation-preflight.json",
  );
  const creationPreflight = await runMainProviderCli({
    argv: [
      "candidate-preflight",
      "--intent",
      intentPath,
      "--output",
      creationPreflightPath,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: () => ({
      requestWithRetry: async () => ({
        deployments: [],
        pagination: { next: null },
      }),
    }),
  });
  assert.equal(creationPreflight.outcome, "create-if-zero");
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-finalize",
          "--intent",
          intentPath,
          "--smoke",
          smokePath,
          "--preflight",
          creationPreflightPath,
          "--output",
          join(context.directory, "missing-base-handoff.json"),
        ],
        env: context.env,
        stdout: context.stdout,
        stateClientFactory: () => ({
          requestWithRetry: async () => ({
            deployments: [{ uid: response.id }],
            pagination: { next: null },
          }),
          inspectDeployment: async () => response,
          listDeploymentAliases: async () => ({ aliases: [] }),
        }),
      }),
    /candidate generated-alias topology mismatch/,
  );

  const admissionPreflightPath = join(
    context.directory,
    "admission-preflight.json",
  );
  const admissionPreflight = await runMainProviderCli({
    argv: [
      "candidate-preflight",
      "--intent",
      intentPath,
      "--output",
      admissionPreflightPath,
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: candidateSmokeStateClient(response),
  });
  assert.equal(admissionPreflight.outcome, "reuse-existing");
  const rerunResult = await runMainProviderCli({
    argv: [
      "candidate-finalize",
      "--intent",
      intentPath,
      "--smoke",
      smokePath,
      "--preflight",
      admissionPreflightPath,
      "--output",
      join(context.directory, "detached-rerun-handoff.json"),
    ],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: candidateSmokeStateClient(response),
  });
  assert.equal(rerunResult.action, "reuse");
  assert.deepEqual(rerunResult.canonicalState.aliases, []);

  const badSmokePath = writeJson(context.directory, "bad-smoke.json", {
    immutableUrl: response.url,
    servedSha: "e".repeat(40),
    status: "passed",
  });
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-finalize",
          "--intent",
          intentPath,
          "--smoke",
          badSmokePath,
          "--output",
          join(context.directory, "bad-handoff.json"),
        ],
        env: context.env,
        stdout: context.stdout,
        stateClientFactory,
      }),
    /resolution blocked/,
  );
});

test("inherited ordinary candidate finalization uses the fixed served-prior alias contract", async (t) => {
  const context = testContext(t);
  for (const target of ["governance", "reserve", "ui"]) {
    const intent = candidateIntent(target);
    const response = deploymentResponse(intent);
    const intentPath = writeJson(
      context.directory,
      `${target}-inherited-intent.json`,
      intent,
    );
    const smokePath = writeJson(
      context.directory,
      `${target}-inherited-smoke.json`,
      {
        immutableUrl: response.url,
        servedSha: intent.deploySha,
        status: "passed",
      },
    );
    const stateClientFactory = (aliases) => () => ({
      requestWithRetry: async () => ({
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      }),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({
        aliases: aliases.map((alias) => ({ alias })),
      }),
    });
    const contract = PRODUCTION_GENERATED_ALIAS_CONTRACTS[target];
    const protectedAlias = MAIN_TARGET_CONTRACTS[target].aliases[0];
    for (const [index, residualAliases] of aliasSubsets([
      contract.generatedProjectAlias,
      contract.generatedProjectDefaultAlias,
      generatedCreatorAlias(target),
      contract.generatedGitMainAlias,
    ]).entries()) {
      const aliases = [protectedAlias, ...residualAliases].toSorted();
      writeFileSync(context.githubOutput, "", { mode: 0o600 });
      chmodSync(context.githubOutput, 0o600);
      const result = await runMainProviderCli({
        argv: [
          "candidate-finalize-inherited",
          "--intent",
          intentPath,
          "--smoke",
          smokePath,
          "--output",
          join(context.directory, `${target}-subset-${index}-handoff.json`),
        ],
        env: context.env,
        stdout: context.stdout,
        stateClientFactory: stateClientFactory(aliases),
      });
      assert.equal(result.action, "reuse");
      assert.deepEqual(result.canonicalState.aliases, aliases);
    }
    const otherTarget = target === "governance" ? "reserve" : "governance";
    for (const [name, aliases, expected] of [
      [
        "missing-protected",
        [contract.generatedProjectAlias],
        /missing its reviewed protected alias/,
      ],
      [
        "wrong-protected",
        [MAIN_TARGET_CONTRACTS[otherTarget].aliases[0]],
        /missing its reviewed protected alias/,
      ],
      [
        "custom-protected",
        [`${target}-preview.mento.org`],
        /missing its reviewed protected alias/,
      ],
      [
        "unknown-residual",
        [protectedAlias, `${target}-unknown.vercel.app`].toSorted(),
        /served-prior generated-alias topology mismatch/,
      ],
    ]) {
      writeFileSync(context.githubOutput, "", { mode: 0o600 });
      chmodSync(context.githubOutput, 0o600);
      await assert.rejects(
        () =>
          runMainProviderCli({
            argv: [
              "candidate-finalize-inherited",
              "--intent",
              intentPath,
              "--smoke",
              smokePath,
              "--output",
              join(context.directory, `${target}-${name}-handoff.json`),
            ],
            env: context.env,
            stdout: context.stdout,
            stateClientFactory: stateClientFactory(aliases),
          }),
        expected,
        `${target}: ${name}`,
      );
    }
  }
});

test("candidate smoke uses the target's direct immutable route and preserves the SHA-bound receipt URL", async (t) => {
  const context = testContext(t);
  for (const target of ["app", "governance", "reserve", "ui"]) {
    const intent = candidateIntent(target);
    const response = deploymentResponse(intent);
    const intentPath = writeJson(
      context.directory,
      `${target}-intent.json`,
      intent,
    );
    const output = join(context.directory, `${target}-candidate-smoke.json`);
    let cancelled = false;
    const stateClientFactory = () => ({
      requestWithRetry: async () => ({
        deployments: [{ uid: response.id }],
        pagination: { next: null },
      }),
      inspectDeployment: async () => response,
      listDeploymentAliases: async () => ({ aliases: [] }),
    });
    const expectedUrl = new URL(
      target === "ui" ? "/basic-components" : "/",
      `https://${response.url}`,
    ).toString();
    const result = await runMainProviderCli({
      argv: ["candidate-smoke", "--intent", intentPath, "--output", output],
      env: context.env,
      stdout: context.stdout,
      stateClientFactory,
      fetchImpl: async (url, options) => {
        assert.equal(url, expectedUrl, target);
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "manual");
        return {
          status: 200,
          redirected: false,
          url,
          headers: {
            get: (name) =>
              name === "x-mento-deployment-sha" ? intent.deploySha : null,
          },
          body: {
            cancel: async () => {
              cancelled = true;
            },
          },
        };
      },
    });
    assert.deepEqual(result, {
      immutableUrl: `https://${response.url}`,
      servedSha: intent.deploySha,
      status: "passed",
    });
    assert.equal(cancelled, true, target);
    assert.deepEqual(readJson(output), result);
    assert.equal(
      readFileSync(context.githubOutput, "utf8"),
      `deployment_id=${response.id}\n`,
    );
    writeFileSync(context.githubOutput, "", { mode: 0o600 });
  }
});

test("candidate smoke retries a timeout once before accepting the immutable candidate", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const response = deploymentResponse(intent);
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const output = join(context.directory, "candidate-smoke.json");
  const retryDelays = [];
  let calls = 0;
  let cancelled = 0;
  const result = await runMainProviderCli({
    argv: ["candidate-smoke", "--intent", intentPath, "--output", output],
    env: context.env,
    stdout: context.stdout,
    stateClientFactory: candidateSmokeStateClient(response),
    sleepImpl: async (milliseconds) => {
      retryDelays.push(milliseconds);
    },
    fetchImpl: async (url) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("candidate edge timed out");
        error.name = "TimeoutError";
        throw error;
      }
      return candidateSmokeHttpResponse({
        url,
        intent,
        onCancel: () => {
          cancelled += 1;
        },
      });
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(retryDelays, [1_000]);
  assert.equal(cancelled, 1);
  assert.equal(result.status, "passed");
});

test("candidate smoke retries transient edge statuses before accepting the immutable candidate", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const response = deploymentResponse(intent);
  const intentPath = writeJson(context.directory, "intent.json", intent);

  for (const transientStatus of [404, 503]) {
    const retryDelays = [];
    let calls = 0;
    let cancelled = 0;
    const result = await runMainProviderCli({
      argv: [
        "candidate-smoke",
        "--intent",
        intentPath,
        "--output",
        join(context.directory, `candidate-smoke-${transientStatus}.json`),
      ],
      env: context.env,
      stdout: context.stdout,
      stateClientFactory: candidateSmokeStateClient(response),
      sleepImpl: async (milliseconds) => {
        retryDelays.push(milliseconds);
      },
      fetchImpl: async (url) => {
        calls += 1;
        return candidateSmokeHttpResponse({
          url,
          intent,
          status: calls === 1 ? transientStatus : 200,
          onCancel: () => {
            cancelled += 1;
          },
        });
      },
    });

    assert.equal(calls, 2, String(transientStatus));
    assert.deepEqual(retryDelays, [1_000], String(transientStatus));
    assert.equal(cancelled, 2, String(transientStatus));
    assert.equal(result.status, "passed", String(transientStatus));
  }
});

test("candidate smoke fails after bounded transient retries and cancels every response body", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const response = deploymentResponse(intent);
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const retryDelays = [];
  let calls = 0;
  let cancelled = 0;

  const error = await captureRejection(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-smoke",
          "--intent",
          intentPath,
          "--output",
          join(context.directory, "candidate-smoke.json"),
        ],
        env: context.env,
        stdout: context.stdout,
        stateClientFactory: candidateSmokeStateClient(response),
        sleepImpl: async (milliseconds) => {
          retryDelays.push(milliseconds);
        },
        fetchImpl: async (url) => {
          calls += 1;
          return candidateSmokeHttpResponse({
            url,
            intent,
            status: 503,
            onCancel: () => {
              cancelled += 1;
            },
          });
        },
      }),
    /HTTP smoke failed/,
  );

  assert.equal(calls, 4);
  assert.deepEqual(retryDelays, [1_000, 1_000, 1_000]);
  assert.equal(cancelled, 4);
  assert.equal(
    renderMainProviderCliFailure(error),
    "Vercel main provider command failed (candidate-smoke-edge-transient-exhausted)\n",
  );
  assert.equal(mainProviderCliFailureExitCode(error), 1);
});

test("candidate smoke classifies exhausted transport retries without exposing transport details", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const response = deploymentResponse(intent);
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const retryDelays = [];
  let calls = 0;
  const error = await captureRejection(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-smoke",
          "--intent",
          intentPath,
          "--output",
          join(context.directory, "candidate-smoke.json"),
        ],
        env: context.env,
        stdout: context.stdout,
        stateClientFactory: candidateSmokeStateClient(response),
        sleepImpl: async (milliseconds) => {
          retryDelays.push(milliseconds);
        },
        fetchImpl: async () => {
          calls += 1;
          throw new Error(
            `${context.env.VERCEL_TOKEN} private transport error`,
          );
        },
      }),
    /HTTP smoke failed/,
  );

  assert.equal(calls, 4);
  assert.deepEqual(retryDelays, [1_000, 1_000, 1_000]);
  assert.equal(
    renderMainProviderCliFailure(error),
    "Vercel main provider command failed (candidate-smoke-edge-transport-exhausted)\n",
  );
  assert.doesNotMatch(
    renderMainProviderCliFailure(error),
    /test-secret-token|private transport error/,
  );
  assert.equal(mainProviderCliFailureExitCode(error), 1);
});

test("candidate smoke fails closed for UI redirects, host or path changes, SHA mismatches, and non-2xx responses", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent("ui");
  const response = deploymentResponse(intent);
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const stateClientFactory = () => ({
    requestWithRetry: async () => ({
      deployments: [{ uid: response.id }],
      pagination: { next: null },
    }),
    inspectDeployment: async () => response,
    listDeploymentAliases: async () => ({ aliases: [] }),
  });

  for (const [name, patch] of [
    ["redirect", { status: 307 }],
    ["followed-redirect", { redirected: true }],
    ["wrong-host", { url: "https://attacker.example/basic-components" }],
    ["wrong-path", { url: `https://${response.url}/form-components` }],
    [
      "wrong-sha",
      {
        headers: {
          get: () => "e".repeat(40),
        },
      },
    ],
    ["bad-status", { status: 400 }],
    ["rate-limited", { status: 429 }],
    ["outside-http-status-range", { status: 600 }],
  ]) {
    let calls = 0;
    const retryDelays = [];
    await assert.rejects(
      () =>
        runMainProviderCli({
          argv: [
            "candidate-smoke",
            "--intent",
            intentPath,
            "--output",
            join(context.directory, `${name}.json`),
          ],
          env: context.env,
          stdout: context.stdout,
          stateClientFactory,
          sleepImpl: async (milliseconds) => {
            retryDelays.push(milliseconds);
          },
          fetchImpl: async (url) => {
            calls += 1;
            return {
              status: 200,
              redirected: false,
              url,
              headers: { get: () => intent.deploySha },
              ...patch,
            };
          },
        }),
      /HTTP smoke/,
    );
    assert.equal(calls, 1, name);
    assert.deepEqual(retryDelays, [], name);
  }
});

test("CLI rejects malformed arguments, token options, and non-private paths without leaking secrets", async (t) => {
  const context = testContext(t);
  const planningPath = writeJson(
    context.directory,
    "planning.json",
    planningSnapshot(),
  );
  for (const argv of [
    ["candidate-preflight", "--token", context.env.VERCEL_TOKEN],
    ["candidate-preflight", "--intent"],
    ["unknown", "--output", join(context.directory, "x.json")],
  ]) {
    await assert.rejects(
      () =>
        runMainProviderCli({
          argv,
          env: context.env,
          stdout: context.stdout,
        }),
      /missing|unsupported|malformed/,
    );
  }
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "canonical-mappings",
          "--planning-snapshot",
          planningPath,
          "--output",
          join(tmpdir(), "outside-main-provider.json"),
        ],
        env: context.env,
        stdout: context.stdout,
      }),
    /path is missing or unsafe/,
  );
  assert.doesNotMatch(context.stdout.value, /test-secret-token/);
  assert.equal(
    renderMainProviderCliFailure(new Error(context.env.VERCEL_TOKEN)),
    "Vercel main provider command failed\n",
  );
  assert.equal(
    mainProviderCliFailureExitCode(new Error(context.env.VERCEL_TOKEN)),
    1,
  );
});

test("private inputs and nested GitHub outputs reject hardlinks and symlinks", async (t) => {
  const context = testContext(t);
  const intent = candidateIntent();
  const intentPath = writeJson(context.directory, "intent.json", intent);
  const linkedIntent = join(context.directory, "linked-intent.json");
  linkSync(intentPath, linkedIntent);
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-preflight",
          "--intent",
          linkedIntent,
          "--output",
          join(context.directory, "linked-input-result.json"),
        ],
        env: context.env,
        stdout: context.stdout,
      }),
    /missing, unsafe, or malformed/,
  );
  unlinkSync(linkedIntent);
  const symlinkedIntent = join(context.directory, "symlinked-intent.json");
  symlinkSync(intentPath, symlinkedIntent);
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-preflight",
          "--intent",
          symlinkedIntent,
          "--output",
          join(context.directory, "symlinked-input-result.json"),
        ],
        env: context.env,
        stdout: context.stdout,
      }),
    /missing, unsafe, or malformed/,
  );

  const commandDirectory = dirname(context.githubOutput);
  const outputSource = join(context.directory, "github-output-source");
  writeFileSync(outputSource, "", { mode: 0o600 });
  const hardlinkedOutput = join(commandDirectory, "set_output_hardlink");
  linkSync(outputSource, hardlinkedOutput);
  const stateClientFactory = () => ({
    requestWithRetry: async () => ({
      deployments: [],
      pagination: { next: null },
    }),
  });
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-preflight",
          "--intent",
          intentPath,
          "--output",
          join(context.directory, "hardlink-output-result.json"),
        ],
        env: { ...context.env, GITHUB_OUTPUT: hardlinkedOutput },
        stdout: context.stdout,
        stateClientFactory,
      }),
    /GITHUB_OUTPUT could not be written safely/,
  );

  const symlinkedOutput = join(commandDirectory, "set_output_symlink");
  symlinkSync(outputSource, symlinkedOutput);
  await assert.rejects(
    () =>
      runMainProviderCli({
        argv: [
          "candidate-preflight",
          "--intent",
          intentPath,
          "--output",
          join(context.directory, "symlink-output-result.json"),
        ],
        env: { ...context.env, GITHUB_OUTPUT: symlinkedOutput },
        stdout: context.stdout,
        stateClientFactory,
      }),
    /GITHUB_OUTPUT could not be written safely/,
  );
  assert.equal(readFileSync(outputSource, "utf8"), "");
});

test("private bridge IO rejects noncanonical, permissive, oversized, and existing paths", (t) => {
  const context = testContext(t);
  const input = writeJson(context.directory, "input.json", { value: true });

  assert.deepEqual(readPrivateJson(input, "input", context.directory), {
    value: true,
  });
  assert.throws(
    () =>
      readPrivateJson(
        `${context.directory}//input.json`,
        "input",
        context.directory,
      ),
    /path is missing or unsafe/,
  );
  chmodSync(input, 0o644);
  assert.throws(
    () => readPrivateJson(input, "input", context.directory),
    /unsafe/,
  );
  chmodSync(input, 0o600);

  const oversized = join(context.directory, "oversized.json");
  writeFileSync(oversized, "x".repeat(MAIN_PROVIDER_CLI_MAX_JSON_BYTES + 1), {
    mode: 0o600,
  });
  assert.throws(
    () => readPrivateJson(oversized, "oversized", context.directory),
    /missing, unsafe, or malformed/,
  );

  const existingOutput = join(context.directory, "existing-output.json");
  writeFileSync(existingOutput, "{}\n", { mode: 0o600 });
  assert.throws(
    () => writePrivateJson(existingOutput, { value: true }, context.directory),
    /could not be written safely/,
  );
  assert.equal(readFileSync(existingOutput, "utf8"), "{}\n");

  const extendedLimit = MAIN_PROVIDER_CLI_MAX_JSON_BYTES * 4;
  const serializedEnvelopeBytes = Buffer.byteLength(
    `${JSON.stringify({ value: "" })}\n`,
    "utf8",
  );
  const extendedValue = {
    value: "x".repeat(extendedLimit - serializedEnvelopeBytes),
  };
  const extendedOutput = join(context.directory, "extended-output.json");
  writePrivateJson(
    extendedOutput,
    extendedValue,
    context.directory,
    extendedLimit,
  );
  assert.equal(statSync(extendedOutput).size, extendedLimit);
  assert.equal(
    readPrivateJson(
      extendedOutput,
      "extended input",
      context.directory,
      extendedLimit,
    ).value.length,
    extendedValue.value.length,
  );
  assert.throws(
    () => readPrivateJson(extendedOutput, "extended input", context.directory),
    /missing, unsafe, or malformed/,
  );
  assert.throws(
    () =>
      writePrivateJson(
        join(context.directory, "oversized-extended-output.json"),
        { value: `${extendedValue.value}x` },
        context.directory,
        extendedLimit,
      ),
    /exceeds its size bound/,
  );

  assert.throws(
    () => reviewedRunnerTemp(`${context.directory}/.`),
    /RUNNER_TEMP is missing or unsafe/,
  );
  const linkedRoot = join(context.directory, "linked-root");
  symlinkSync(context.directory, linkedRoot);
  assert.throws(
    () => reviewedRunnerTemp(linkedRoot),
    /RUNNER_TEMP is missing or unsafe/,
  );

  chmodSync(context.githubOutput, 0o644);
  appendGithubOutputs(context.env, { result: "value" });
  assert.equal(readFileSync(context.githubOutput, "utf8"), "result=value\n");
  assert.equal(statSync(context.githubOutput).mode & 0o777, 0o600);
  writeFileSync(context.githubOutput, "", { mode: 0o600 });
  for (const mode of [0o664, 0o666]) {
    chmodSync(context.githubOutput, mode);
    assert.throws(
      () => appendGithubOutputs(context.env, { result: "value" }),
      /could not be written safely/,
    );
    assert.equal(statSync(context.githubOutput).mode & 0o777, mode);
  }
  chmodSync(context.githubOutput, 0o600);
  writeFileSync(
    context.githubOutput,
    "x".repeat(MAIN_PROVIDER_CLI_MAX_JSON_BYTES),
    { mode: 0o600 },
  );
  assert.throws(
    () => appendGithubOutputs(context.env, { result: "value" }),
    /could not be written safely/,
  );
  assert.throws(
    () =>
      appendGithubOutputs(
        {
          ...context.env,
          GITHUB_OUTPUT: join(tmpdir(), "outside-github-output"),
        },
        { result: "value" },
      ),
    /path is missing or unsafe/,
  );
});
