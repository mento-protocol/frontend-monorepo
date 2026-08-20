import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
  ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
  ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA,
  ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
  CANONICAL_STATE_KEYS,
  MAIN_PLANNING_SNAPSHOT_SCHEMA,
  VercelStateClient,
  assertAppTransactionCandidateOutput,
  assertActiveAliasMappingSpec,
  assertActiveDeploymentStateProof,
  assertActiveAliasMappingSet,
  assertActiveAliasMappings,
  assertActiveDeploymentStateSpec,
  assertCanonicalOutput,
  assertMainPlanningSnapshot,
  assertSnapshotSpec,
  canonicalizeAliasMapping,
  canonicalizeAppTransactionCandidate,
  canonicalizeAliases,
  canonicalizeDeploymentState,
  canonicalizeMainPlanningDeploymentState,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
  captureMainPlanningSnapshot,
  captureActiveDeploymentStateProof,
  captureProtectedSnapshot,
  compareProtectedSnapshots,
  createActiveDeploymentStateProof,
  parseArguments,
  renderCliFailure,
  runCli,
  writeAppTransactionCandidate,
  writeActiveDeploymentStateProof,
  writeCanonicalJson,
  writeMainPlanningSnapshot,
} from "./vercel-deployment-state.mjs";
import {
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import { MAIN_TARGET_CONTRACTS } from "./vercel-main-plan.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  createMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";

const fixtureDirectory = new URL(
  "./fixtures/vercel-deployment-state/",
  import.meta.url,
);

function fixture(name) {
  return JSON.parse(readFileSync(new URL(name, fixtureDirectory), "utf8"));
}

function canonicalizeFixture(value) {
  return canonicalizeDeploymentState({
    aliasResponse: value.aliasResponse,
    deploymentResponse: value.deploymentResponse,
    aliasesResponse: value.aliasesResponse,
    expected: value.expected,
  });
}

function canonicalizePlanningFixture(value) {
  return canonicalizeMainPlanningDeploymentState({
    aliasResponse: value.aliasResponse,
    deploymentResponse: value.deploymentResponse,
    aliasesResponse: value.aliasesResponse,
    expected: value.expected,
  });
}

function privateTestDirectory(testContext) {
  const directory = mkdtempSync(join(process.cwd(), ".vercel-state-test-"));
  testContext.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function activeReleaseManifest({
  deploySha,
  projects,
  priorSha = "b".repeat(40),
  rollbackOnly = false,
  stagedTargets,
}) {
  const targets = ["app", "governance", "reserve", "ui"];
  const plannedTargets =
    stagedTargets === undefined
      ? targets
      : targets.filter((target) => stagedTargets.includes(target));
  const plan = {
    schema: "vercel-main-plan:v2",
    mode: "active",
    mainOwnershipMode: Object.fromEntries(
      targets.map((target) => [target, "github"]),
    ),
    deploySha,
    stagedTargets: plannedTargets,
    activeTargets: plannedTargets,
    shadowTargets: [],
    plan: plannedTargets,
    priors: targets.map((target) => ({
      target,
      deploymentId: `dpl_${target}Prior123`,
      deploymentUrl: `https://${target}-prior.vercel.app`,
      aliases: [...MAIN_TARGET_CONTRACTS[target].aliases].sort(),
      servedSha: priorSha,
    })),
    ranges: rollbackOnly
      ? []
      : [
          {
            base: priorSha,
            head: deploySha,
            kind: "served",
            reason: "global-build-input",
            targets: plannedTargets,
            deployments: plannedTargets,
          },
        ],
    reasons: plannedTargets.map((target) => ({
      target,
      base: priorSha,
      reason: rollbackOnly
        ? "served-mapping-rollback-only"
        : "global-build-input",
    })),
  };
  const originalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      const contract = MAIN_TARGET_CONTRACTS[target];
      const aliases = [...contract.aliases].sort();
      const prior = {
        deploymentId: `dpl_${target}Prior123`,
        deploymentUrl: `https://${target}-prior.vercel.app`,
        aliases,
        projectId: projects[target].projectId,
        projectName: projects[target].projectName,
        readyState: "READY",
        target: contract.target,
        customEnvironmentSlug: contract.customEnvironmentSlug,
      };
      return [
        target,
        {
          ...prior,
          planningLeaves: aliases.map((alias) => ({
            alias,
            ...prior,
            git: {
              status: "complete",
              org: "mento-protocol",
              repo: "frontend-monorepo",
              ref: "main",
              sha: priorSha,
            },
          })),
          servedSha: priorSha,
        },
      ];
    }),
  );
  return createMainReleaseManifest({
    upstreamRunId: "54321",
    plan,
    originalPriors,
  });
}

function activeStateSpec({ rollbackOnly = false } = {}) {
  const deploySha = "abcdef0123456789abcdef0123456789abcdef01";
  const projects = {
    app: {
      projectId: "prj_appactive123",
      projectName: "app.mento.org",
      expectedDisposition: "githubPrebuilt",
      deploymentId: "dpl_appactive123",
      deploymentUrl: "https://app-active-immutable.vercel.app",
      target: null,
      customEnvironmentSlug: "v3",
    },
    governance: {
      projectId: "prj_governanceactive123",
      projectName: "governance.mento.org",
      expectedDisposition: "githubPrebuilt",
      deploymentId: "dpl_governanceactive123",
      deploymentUrl: "https://governance-active-immutable.vercel.app",
      target: "production",
      customEnvironmentSlug: null,
    },
    reserve: {
      projectId: "prj_reserveactive123",
      projectName: "reserve.mento.org",
      expectedDisposition: "githubPrebuilt",
      deploymentId: "dpl_reserveactive123",
      deploymentUrl: "https://reserve-active-immutable.vercel.app",
      target: "production",
      customEnvironmentSlug: null,
    },
    ui: {
      projectId: "prj_uiactive123",
      projectName: "ui.mento.org",
      expectedDisposition: "githubPrebuilt",
      deploymentId: "dpl_uiactive123",
      deploymentUrl: "https://ui-active-immutable.vercel.app",
      target: "production",
      customEnvironmentSlug: null,
    },
  };
  return {
    schema: ACTIVE_DEPLOYMENT_STATE_SPEC_SCHEMA,
    deploySha,
    runId: "12345",
    runAttempt: "2",
    transactionId: "main-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    releaseManifest: activeReleaseManifest({
      deploySha,
      projects,
      priorSha: rollbackOnly ? deploySha : undefined,
      rollbackOnly,
    }),
    mainOwnershipMode: {
      app: "github",
      governance: "github",
      reserve: "github",
      ui: "github",
    },
    stagedTargets: ["app", "governance", "reserve", "ui"],
    activeTargets: ["app", "governance", "reserve", "ui"],
    shadowTargets: [],
    projects,
    legacyAppV2: {
      alias: "v2-app.mento.org",
      deployment: "dpl_legacyappv2",
      deploymentUrl: "https://app-v2-immutable.vercel.app",
      projectId: "prj_appactive123",
      projectName: "app.mento.org",
      readyState: "READY",
      target: "production",
      customEnvironmentSlug: null,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "v2",
        sha: "1111111111111111111111111111111111111111",
      },
    },
  };
}

function activeStateSpecWithInactiveUi() {
  const spec = activeStateSpec();
  spec.projects.ui = {
    ...spec.projects.ui,
    expectedDisposition: null,
    deploymentId: null,
    deploymentUrl: null,
  };
  spec.stagedTargets = ["app", "governance", "reserve"];
  spec.activeTargets = ["app", "governance", "reserve"];
  spec.releaseManifest = activeReleaseManifest({
    deploySha: spec.deploySha,
    projects: spec.projects,
    stagedTargets: spec.stagedTargets,
  });
  return spec;
}

test("recovered-prior App state accepts no candidate and rejects an unexpected one", () => {
  const spec = activeStateSpec();
  spec.projects.app = {
    ...spec.projects.app,
    expectedDisposition: "recoveredPrior",
    deploymentId: null,
    deploymentUrl: null,
  };
  const emptyCandidateSet = activeDeploymentInspections(spec);
  emptyCandidateSet.app = [];
  const recovered = createActiveDeploymentStateProof({
    spec,
    deployments: emptyCandidateSet,
    legacyV2: legacyAppV2Proof(spec),
  });
  assert.equal(recovered.outcome, "proven");
  assert.equal(recovered.projects.app.counts.scanned, 0);

  const unexpectedCandidateSet = activeDeploymentInspections(spec);
  unexpectedCandidateSet.app = [];
  unexpectedCandidateSet.app.push({
    deploymentId: "dpl_unexpectedapp123",
    response: activeDeploymentResponse(spec, "app", {
      deploymentId: "dpl_unexpectedapp123",
      deploymentUrl: "https://unexpected-app.vercel.app",
    }),
  });
  const unexpected = createActiveDeploymentStateProof({
    spec,
    deployments: unexpectedCandidateSet,
    legacyV2: legacyAppV2Proof(spec),
  });
  assert.equal(unexpected.outcome, "unproven");
  assert.equal(unexpected.projects.app.counts.manualDuplicates, 1);

  const invalidTarget = structuredClone(spec);
  invalidTarget.projects.governance = {
    ...invalidTarget.projects.governance,
    expectedDisposition: "recoveredPrior",
    deploymentId: null,
    deploymentUrl: null,
  };
  assert.throws(
    () =>
      createActiveDeploymentStateProof({
        spec: invalidTarget,
        deployments: activeDeploymentInspections(invalidTarget),
        legacyV2: legacyAppV2Proof(invalidTarget),
      }),
    /governance recovered-prior deployment expectation is malformed/,
  );
});

function activeDeploymentResponse(
  spec,
  logicalTarget,
  {
    deploymentId = spec.projects[logicalTarget].deploymentId,
    deploymentUrl = spec.projects[logicalTarget].deploymentUrl,
    source = "cli",
    meta = {},
  } = {},
) {
  const project = spec.projects[logicalTarget];
  const workflowMeta = createMainCandidateVercelMetadata({
    intent: createMainCandidateIntent({
      target: logicalTarget,
      deploySha: spec.deploySha,
      upstreamRunId: spec.releaseManifest.upstreamRunId,
      originRunId: spec.runId,
      originAttempt: spec.runAttempt,
      originTransactionId: spec.transactionId,
      projectId: project.projectId,
      projectName: project.projectName,
      releaseManifest: spec.releaseManifest,
    }),
  });
  return {
    id: deploymentId,
    url: deploymentUrl,
    projectId: project.projectId,
    name: project.projectName,
    readyState: "READY",
    target: project.target,
    customEnvironment:
      project.customEnvironmentSlug === null
        ? null
        : { slug: project.customEnvironmentSlug },
    source,
    meta: {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
      githubCommitSha: spec.deploySha,
      ...workflowMeta,
      ...meta,
    },
  };
}

function activeDeploymentInspections(spec) {
  return Object.fromEntries(
    Object.keys(spec.projects).map((logicalTarget) => {
      const deploymentId = spec.projects[logicalTarget].deploymentId;
      return [
        logicalTarget,
        deploymentId === null
          ? []
          : [
              {
                deploymentId,
                response: activeDeploymentResponse(spec, logicalTarget),
              },
            ],
      ];
    }),
  );
}

function inactiveUiInspection(
  spec,
  { readyState = "CANCELED", source = "git" } = {},
) {
  const deploymentId = "dpl_FnzVkA6HCgEaubHhF3DNgivYKqkk";
  const project = spec.projects.ui;
  const response = {
    id: deploymentId,
    url: "uimento-lxu9dr6ck-mentolabs.vercel.app",
    projectId: project.projectId,
    name: project.projectName,
    readyState,
    target: project.target,
    customEnvironment: null,
    source,
    meta: {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
      githubCommitSha: spec.deploySha,
    },
  };
  return { deploymentId, response };
}

function legacyAppV2Proof(spec) {
  const legacy = spec.legacyAppV2;
  return {
    ownership: "native-vercel-git",
    state: {
      alias: legacy.alias,
      deploymentId: legacy.deployment,
      deploymentUrl: legacy.deploymentUrl,
      creatorUsername: null,
      projectId: legacy.projectId,
      projectName: legacy.projectName,
      readyState: legacy.readyState,
      target: legacy.target,
      customEnvironmentSlug: legacy.customEnvironmentSlug,
      git: { ...legacy.git },
      aliases: [legacy.alias],
    },
  };
}

test("ordinary production fixture emits only canonical allowlisted state", () => {
  const state = canonicalizeFixture(fixture("valid-production.json"));
  assert.deepEqual(Object.keys(state), CANONICAL_STATE_KEYS);
  assert.deepEqual(state, {
    alias: "governance.mento.org",
    deploymentId: "dpl_governance123",
    deploymentUrl: "https://governance-immutable.vercel.app",
    creatorUsername: "chapati",
    projectId: "prj_governance123",
    projectName: "governance.mento.org",
    readyState: "READY",
    target: "production",
    customEnvironmentSlug: null,
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "main",
      sha: "0123456789abcdef0123456789abcdef01234567",
    },
    aliases: [
      "governance.mento.org",
      "governancementoorg-mentolabs.vercel.app",
    ],
  });
});

test("custom v3 fixture proves slug independently from target", () => {
  const state = canonicalizeFixture(fixture("valid-custom-v3.json"));
  assert.equal(state.target, null);
  assert.equal(state.customEnvironmentSlug, "v3");
  assert.equal(state.alias, "app.mento.org");
});

test("main planning capture sanitizes Git ambiguity without weakening rollback identity", () => {
  const production = fixture("valid-production.json");
  const valid = canonicalizePlanningFixture(production);
  assert.deepEqual(valid.git, {
    org: "mento-protocol",
    repo: "frontend-monorepo",
    ref: "main",
    sha: "0123456789abcdef0123456789abcdef01234567",
  });

  const missing = canonicalizePlanningFixture({
    ...production,
    deploymentResponse: {
      ...production.deploymentResponse,
      meta: {
        protectionBypass: "test-sensitive-value-never-output",
      },
    },
  });
  assert.equal(missing.git, null);
  assert.doesNotMatch(
    JSON.stringify(missing),
    /protectionBypass|test-sensitive-value-never-output/,
  );

  for (const meta of [
    {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
    },
    {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
      githubCommitSha: "not-a-sha",
    },
    {
      githubCommitOrg: "unsafe value",
      githubCommitRepo: "frontend-monorepo",
      githubCommitRef: "main",
      githubCommitSha: "0123456789abcdef0123456789abcdef01234567",
    },
  ]) {
    const malformed = canonicalizePlanningFixture({
      ...production,
      deploymentResponse: {
        ...production.deploymentResponse,
        meta,
      },
    });
    assert.deepEqual(malformed.git, {});
  }

  const conflictingRawSources = canonicalizePlanningFixture({
    ...production,
    deploymentResponse: {
      ...production.deploymentResponse,
      gitSource: {
        org: "different-org",
        repo: "frontend-monorepo",
        ref: "main",
        sha: "0123456789abcdef0123456789abcdef01234567",
      },
    },
  });
  assert.deepEqual(conflictingRawSources.git, {});

  const wrongSource = canonicalizePlanningFixture({
    ...production,
    deploymentResponse: {
      ...production.deploymentResponse,
      meta: {
        ...production.deploymentResponse.meta,
        githubCommitOrg: "other-org",
      },
    },
  });
  assert.deepEqual(wrongSource.git, {
    org: "other-org",
    repo: "frontend-monorepo",
    ref: "main",
    sha: "0123456789abcdef0123456789abcdef01234567",
  });
});

test("main planning capture keeps every non-Git activation-state check strict", () => {
  const production = fixture("valid-production.json");
  const scenarios = [
    {
      label: "deployment ID",
      mutate(value) {
        value.deploymentResponse.id = "dpl_other123";
      },
    },
    {
      label: "URL",
      mutate(value) {
        value.deploymentResponse.url = "https://example.com";
      },
    },
    {
      label: "project",
      mutate(value) {
        value.deploymentResponse.projectId = "prj_other123";
      },
    },
    {
      label: "name",
      mutate(value) {
        value.deploymentResponse.name = "reserve.mento.org";
      },
    },
    {
      label: "readiness",
      mutate(value) {
        value.deploymentResponse.readyState = "BUILDING";
      },
    },
    {
      label: "target",
      mutate(value) {
        value.deploymentResponse.target = "preview";
      },
    },
    {
      label: "creator",
      mutate(value) {
        value.deploymentResponse.creator.username = "unsafe user";
      },
    },
    {
      label: "aliases",
      mutate(value) {
        value.aliasesResponse.aliases = [{ alias: "other.mento.org" }];
      },
    },
  ];
  for (const scenario of scenarios) {
    const input = structuredClone(production);
    scenario.mutate(input);
    assert.throws(
      () => canonicalizePlanningFixture(input),
      undefined,
      scenario.label,
    );
  }
});

test("main planning snapshot preserves cross-alias valid Git conflicts for planner classification", async () => {
  const base = canonicalizePlanningFixture(fixture("valid-production.json"));
  const aliases = [
    "governance.mento.org",
    "governancementoorg-mentolabs.vercel.app",
  ];
  const states = await captureMainPlanningSnapshot(
    {
      mainPlanningAliasState: async (entry) => ({
        ...base,
        alias: entry.alias,
        git:
          entry.alias === aliases[0]
            ? base.git
            : {
                ...base.git,
                sha: "abcdef0123456789abcdef0123456789abcdef01",
              },
      }),
    },
    aliases.map((alias) => ({
      alias,
      ...fixture("valid-production.json").expected,
    })),
  );
  assert.equal(states.schema, MAIN_PLANNING_SNAPSHOT_SCHEMA);
  assert.equal(states.states.length, 2);
  assert.notDeepEqual(states.states[0].git, states.states[1].git);
  assert.deepEqual(assertMainPlanningSnapshot(states), states);
});

test("main planning snapshot rejects rollback, alias-set, and mapping-race ambiguity", async () => {
  const production = fixture("valid-production.json");
  const base = canonicalizePlanningFixture(production);
  const aliases = [
    "governance.mento.org",
    "governancementoorg-mentolabs.vercel.app",
  ];
  const spec = aliases.map((alias) => ({
    alias,
    ...production.expected,
  }));
  await assert.rejects(
    () =>
      captureMainPlanningSnapshot(
        {
          mainPlanningAliasState: async (entry) => ({
            ...base,
            alias: entry.alias,
            deploymentId:
              entry.alias === aliases[0] ? base.deploymentId : "dpl_other123",
          }),
        },
        spec,
      ),
    /do not share one rollback deployment/,
  );
  await assert.rejects(
    () =>
      captureMainPlanningSnapshot(
        {
          mainPlanningAliasState: async (entry) => ({
            ...base,
            alias: entry.alias,
            aliases:
              entry.alias === aliases[0]
                ? base.aliases
                : ["governancementoorg-mentolabs.vercel.app"],
          }),
        },
        spec,
      ),
    /alias sets conflict/,
  );

  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  let lookups = 0;
  client.resolveAlias = async (alias) => ({
    ...production.aliasResponse,
    alias,
    deploymentId: ++lookups === 1 ? "dpl_governance123" : "dpl_concurrent123",
  });
  client.inspectDeployment = async () => production.deploymentResponse;
  client.listDeploymentAliases = async () => production.aliasesResponse;
  await assert.rejects(
    () => client.mainPlanningAliasState(spec[0]),
    /changed during inspection/,
  );

  const appFixture = fixture("valid-custom-v3.json");
  const appBase = canonicalizePlanningFixture(appFixture);
  const appAliases = [
    "app.mento.org",
    "appmentoorg-env-v3-mentolabs.vercel.app",
  ];
  await assert.rejects(
    () =>
      captureMainPlanningSnapshot(
        {
          mainPlanningAliasState: async (entry) => ({
            ...appBase,
            alias: entry.alias,
            aliases: [...appBase.aliases, "unexpected-v3.mento.org"].sort(),
          }),
        },
        appAliases.map((alias) => ({ alias, ...appFixture.expected })),
      ),
    /do not exactly match the reviewed set/,
  );
});

test("minimal alias mapping exposes only read-only drift fields", () => {
  const production = fixture("valid-production.json");
  const mapping = canonicalizeAliasMapping({
    alias: "governance.mento.org",
    aliasResponse: production.aliasResponse,
    deploymentResponse: {
      ...production.deploymentResponse,
      meta: {
        ...production.deploymentResponse.meta,
        mentoTransaction: "123-1-governance",
        buildEnv: { SECRET: "test-value-not-printed" },
      },
    },
  });
  assert.deepEqual(mapping, {
    alias: "governance.mento.org",
    deploymentId: "dpl_governance123",
    deploymentUrl: "https://governance-immutable.vercel.app",
    projectId: "prj_governance123",
  });
  assert.doesNotMatch(
    JSON.stringify(mapping),
    /test-value-not-printed|buildEnv/,
  );
});

test("active alias mapping set captures exactly every protected alias", () => {
  const spec = {
    schema: ACTIVE_ALIAS_MAPPING_SET_SCHEMA,
    aliases: [
      "app.mento.org",
      "appmentoorg-env-v3-mentolabs.vercel.app",
      "appmentoorg-git-v2-mentolabs.vercel.app",
      "appmentoorg-mentolabs.vercel.app",
      "appmentoorg.vercel.app",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
      "v2-app.mento.org",
    ],
  };
  assert.equal(assertActiveAliasMappingSet(spec), spec);
  const mappings = assertActiveAliasMappings(
    spec.aliases.map((alias, index) => ({
      alias,
      deploymentId: `dpl_active${index}123`,
      deploymentUrl: `https://active-${index}.vercel.app`,
    })),
  );
  assert.equal(mappings.length, 9);
  assert.throws(
    () =>
      assertActiveAliasMappingSet({ ...spec, aliases: spec.aliases.slice(1) }),
    /mapping set is malformed/,
  );
  assert.throws(
    () => assertActiveAliasMappings(mappings.slice(1)),
    /mappings are malformed/,
  );
});

test("dynamic active alias mapping spec binds every capture to its exact project", async (t) => {
  const directory = privateTestDirectory(t);
  const spec = {
    schema: ACTIVE_ALIAS_MAPPING_SPEC_SCHEMA,
    bindings: [
      {
        alias: "app.mento.org",
        projectId: "prj_app123",
        target: "app",
      },
      {
        alias: "v2-app.mento.org",
        projectId: "prj_app123",
        target: "legacy-app",
      },
    ],
  };
  assert.deepEqual(assertActiveAliasMappingSpec(spec), spec);
  assert.throws(
    () =>
      assertActiveAliasMappingSpec({
        ...spec,
        bindings: [],
      }),
    /malformed/,
  );
  assert.throws(
    () =>
      assertActiveAliasMappingSpec({
        ...spec,
        bindings: [...spec.bindings, spec.bindings[1]],
      }),
    /ambiguous/,
  );
  assert.throws(
    () =>
      assertActiveAliasMappingSpec({
        ...spec,
        bindings: [{ ...spec.bindings[0], target: "unknown" }],
      }),
    /ambiguous/,
  );

  const specPath = join(directory, "mapping-spec.json");
  const outputPath = join(directory, "mappings.json");
  writeFileSync(specPath, JSON.stringify(spec), { mode: 0o600 });
  const mappings = new Map([
    [
      "app.mento.org",
      {
        alias: "app.mento.org",
        deploymentId: "dpl_appCurrent123",
        deploymentUrl: "https://app-current.vercel.app",
        projectId: "prj_app123",
      },
    ],
    [
      "v2-app.mento.org",
      {
        alias: "v2-app.mento.org",
        deploymentId: "dpl_appLegacy123",
        deploymentUrl: "https://app-legacy.vercel.app",
        projectId: "prj_app123",
      },
    ],
  ]);
  await runCli({
    argv: ["alias-mappings", "--spec", specPath, "--output", outputPath],
    env: {
      RUNNER_TEMP: directory,
      VERCEL_ORG_ID: "team_active123",
      VERCEL_TOKEN: "active-mapping-token-never-output",
    },
    clientFactory: () => ({
      aliasMapping: async (alias) => mappings.get(alias),
    }),
  });
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), [
    {
      alias: "app.mento.org",
      deploymentId: "dpl_appCurrent123",
      deploymentUrl: "https://app-current.vercel.app",
    },
    {
      alias: "v2-app.mento.org",
      deploymentId: "dpl_appLegacy123",
      deploymentUrl: "https://app-legacy.vercel.app",
      projectId: "prj_app123",
    },
  ]);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);

  const wrongProjectOutput = join(directory, "wrong-project.json");
  await assert.rejects(
    () =>
      runCli({
        argv: [
          "alias-mappings",
          "--spec",
          specPath,
          "--output",
          wrongProjectOutput,
        ],
        env: {
          RUNNER_TEMP: directory,
          VERCEL_ORG_ID: "team_active123",
          VERCEL_TOKEN: "active-mapping-token-never-output",
        },
        clientFactory: () => ({
          aliasMapping: async (alias) => ({
            ...mappings.get(alias),
            projectId:
              alias === "v2-app.mento.org" ? "prj_wrong123" : "prj_app123",
          }),
        }),
      }),
    /conflicts with its spec/,
  );
});

function appCandidateFixture(overrides = {}) {
  const app = fixture("valid-custom-v3.json");
  const expected = {
    projectId: "prj_app123",
    projectName: "app.mento.org",
    deploySha: "abcdef0123456789abcdef0123456789abcdef01",
    runId: "800",
    runAttempt: "3",
    transactionId: "main-0123456789abcdef0123456789abcdef",
    customEnvironmentSlug: "v3",
    nextDeploymentId: "m-app-0123456789abcdef012",
  };
  return {
    expected: { ...expected, ...(overrides.expected ?? {}) },
    deploymentResponse: {
      ...app.deploymentResponse,
      meta: {
        ...app.deploymentResponse.meta,
        mentoTransactionId: expected.transactionId,
        mentoRunId: expected.runId,
        mentoRunAttempt: expected.runAttempt,
        mentoNextDeploymentId: expected.nextDeploymentId,
        protectionBypass: "test-sensitive-value-never-output",
        ...(overrides.meta ?? {}),
      },
      ...(overrides.deploymentResponse ?? {}),
    },
  };
}

test("App transaction candidate is exact, canonical, and redacted", () => {
  const input = appCandidateFixture();
  const result = canonicalizeAppTransactionCandidate(input);
  assert.deepEqual(result, {
    deploymentId: "dpl_appv3abc",
    deploymentUrl: "https://app-v3-immutable.vercel.app",
    projectId: "prj_app123",
    projectName: "app.mento.org",
    deploySha: "abcdef0123456789abcdef0123456789abcdef01",
    runId: "800",
    runAttempt: "3",
    transactionId: "main-0123456789abcdef0123456789abcdef",
    customEnvironmentSlug: "v3",
  });
  assert.deepEqual(assertAppTransactionCandidateOutput(result), result);
  assert.doesNotMatch(
    JSON.stringify(result),
    /nextDeploymentId|protectionBypass|test-sensitive-value-never-output/,
  );
});

test("App transaction candidate rejects same SHA and transaction with wrong run or attempt", () => {
  for (const meta of [
    { mentoRunId: "801" },
    { mentoRunAttempt: "4" },
    { mentoNextDeploymentId: "m-app-different123" },
  ]) {
    assert.throws(
      () => canonicalizeAppTransactionCandidate(appCandidateFixture({ meta })),
      /identity does not match/,
    );
  }
});

test("App transaction candidate discovery uses filtered bounded pagination and exact inspection", async () => {
  const input = appCandidateFixture();
  const requests = [];
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  client.requestWithRetry = async (path) => {
    requests.push(path);
    if (path.startsWith("/v6/deployments")) {
      const url = new URL(path, "https://api.vercel.com");
      assert.equal(url.searchParams.get("projectId"), "prj_app123");
      assert.equal(url.searchParams.get("target"), "v3");
      assert.equal(
        url.searchParams.get("meta-mentoTransactionId"),
        input.expected.transactionId,
      );
      if (url.searchParams.get("until") === null) {
        return {
          deployments: [{ uid: "dpl_appv3abc" }],
          pagination: { next: 12345 },
        };
      }
      assert.equal(url.searchParams.get("until"), "12345");
      return { deployments: [], pagination: { next: null } };
    }
    assert.equal(path, "/v13/deployments/dpl_appv3abc?withGitRepoInfo=true");
    return input.deploymentResponse;
  };
  const result = await client.discoverAppTransactionCandidate(input.expected);
  assert.equal(result.deploymentId, "dpl_appv3abc");
  assert.equal(requests.length, 3);

  let attempts = 0;
  const retryClient = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  retryClient.request = async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("transient");
    return { ok: true };
  };
  assert.deepEqual(
    await retryClient.requestWithRetry("/read-only", { attempts: 3 }),
    { ok: true },
  );
  assert.equal(attempts, 3);

  let rateLimitedCalls = 0;
  const rateLimitedClient = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      rateLimitedCalls += 1;
      return { ok: false, status: 429 };
    },
  });
  await assert.rejects(
    () => rateLimitedClient.requestWithRetry("/read-only", { attempts: 3 }),
    (error) => {
      assert.match(error.message, /HTTP 429/);
      assert.equal(error.code, "VERCEL_API_READ_RATE_LIMITED");
      return true;
    },
  );
  assert.equal(rateLimitedCalls, 1);
});

test("canonical Vercel state reads retry transient failures and fail closed after bounded persistent failures", async () => {
  const reads = [
    {
      name: "alias lookup",
      path: "/v4/aliases/governance.mento.org",
      invoke: (client) => client.resolveAlias("governance.mento.org"),
    },
    {
      name: "deployment inspection",
      path: "/v13/deployments/dpl_governance123",
      invoke: (client) => client.inspectDeployment("dpl_governance123"),
    },
    {
      name: "deployment alias listing",
      path: "/v2/deployments/dpl_governance123/aliases",
      invoke: (client) => client.listDeploymentAliases("dpl_governance123"),
    },
    {
      name: "project inspection",
      path: "/v9/projects/prj_governance123",
      invoke: (client) => client.inspectProject("prj_governance123"),
    },
  ];

  for (const read of reads) {
    let transientCalls = 0;
    const transientClient = new VercelStateClient({
      token: "fixture-token",
      teamId: "team_fixture123",
      fetchImplementation: async (input, init) => {
        transientCalls += 1;
        const url = new URL(input);
        assert.equal(url.pathname, read.path, read.name);
        assert.equal(url.searchParams.get("teamId"), "team_fixture123");
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        if (transientCalls < 3) throw new Error("transient transport failure");
        return { ok: true, json: async () => ({ ok: true }) };
      },
    });
    assert.deepEqual(await read.invoke(transientClient), { ok: true });
    assert.equal(transientCalls, 3, `${read.name} must retry twice`);

    let persistentCalls = 0;
    const persistentClient = new VercelStateClient({
      token: "fixture-token",
      teamId: "team_fixture123",
      fetchImplementation: async () => {
        persistentCalls += 1;
        throw new Error("persistent transport failure");
      },
    });
    await assert.rejects(
      () => read.invoke(persistentClient),
      (error) => {
        assert.match(error.message, /Vercel API request failed/);
        assert.equal(error.code, "VERCEL_API_READ_TRANSPORT");
        return true;
      },
      `${read.name} must fail closed after the bounded retry limit`,
    );
    assert.equal(persistentCalls, 3, `${read.name} must make at most 3 reads`);
  }
});

test("App discovery stabilizes zero and exact pending candidates within a bounded window", async () => {
  const input = appCandidateFixture();
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  let lists = 0;
  let inspections = 0;
  const sleeps = [];
  client.listAppTransactionDeploymentIds = async () => {
    lists += 1;
    return lists === 1 ? [] : ["dpl_appv3abc"];
  };
  client.requestWithRetry = async () => {
    inspections += 1;
    return {
      ...input.deploymentResponse,
      readyState: inspections === 1 ? "BUILDING" : "READY",
    };
  };
  const result = await client.discoverAppTransactionCandidate(input.expected, {
    maximumAttempts: 4,
    stabilizationDelayMs: 5,
    sleepImplementation: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.equal(result.deploymentId, "dpl_appv3abc");
  assert.equal(lists, 3);
  assert.equal(inspections, 2);
  assert.deepEqual(sleeps, [5, 5]);

  inspections = 0;
  client.listAppTransactionDeploymentIds = async () => ["dpl_appv3abc"];
  client.requestWithRetry = async () => ({
    ...input.deploymentResponse,
    readyState: "BUILDING",
    meta: {
      ...input.deploymentResponse.meta,
      mentoRunAttempt: "wrong",
    },
  });
  await assert.rejects(
    () =>
      client.discoverAppTransactionCandidate(input.expected, {
        maximumAttempts: 4,
        stabilizationDelayMs: 0,
        sleepImplementation: async () => {
          assert.fail("identity mismatch must not retry");
        },
      }),
    /identity does not match/,
  );
});

test("App transaction candidate discovery fails closed on zero, multiple, and unbounded pages", async () => {
  const input = appCandidateFixture();
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  client.listAppTransactionDeploymentIds = async () => [];
  await assert.rejects(
    () =>
      client.discoverAppTransactionCandidate(input.expected, {
        maximumAttempts: 1,
        sleepImplementation: async () => {},
        stabilizationDelayMs: 0,
      }),
    /did not stabilize/,
  );

  client.listAppTransactionDeploymentIds = async () => [
    "dpl_appv3abc",
    "dpl_appv3def",
  ];
  client.requestWithRetry = async (path) => ({
    ...input.deploymentResponse,
    id: path.includes("dpl_appv3def") ? "dpl_appv3def" : "dpl_appv3abc",
    url: path.includes("dpl_appv3def")
      ? "app-v3-other.vercel.app"
      : "app-v3-immutable.vercel.app",
  });
  await assert.rejects(
    () => client.discoverAppTransactionCandidate(input.expected),
    /exactly one match; received 2/,
  );

  const paginatedClient = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  paginatedClient.requestWithRetry = async () => ({
    deployments: [],
    pagination: { next: 12345 },
  });
  await assert.rejects(
    () =>
      paginatedClient.listAppTransactionDeploymentIds(input.expected, {
        maximumPages: 2,
      }),
    /cursor is malformed|bounded limit/,
  );
});

test("direct deployment verification binds both exact ID and immutable URL", () => {
  const production = fixture("valid-production.json");
  assert.doesNotThrow(() =>
    canonicalizeDeploymentState({
      ...production,
      expected: {
        ...production.expected,
        deployment: "dpl_governance123",
        deploymentUrl: "https://governance-immutable.vercel.app",
      },
    }),
  );
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        expected: {
          ...production.expected,
          deployment: "dpl_other123",
          deploymentUrl: "https://governance-immutable.vercel.app",
        },
      }),
    /Unexpected deployment ID/,
  );
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        expected: {
          ...production.expected,
          deployment: "dpl_governance123",
          deploymentUrl: "https://different-immutable.vercel.app",
        },
      }),
    /Unexpected deployment URL/,
  );
});

test("wrong project and repository fixtures fail closed", () => {
  const production = fixture("valid-production.json");
  const wrongProject = fixture("wrong-project.json");
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        expected: {
          ...production.expected,
          projectId: wrongProject.expectedProjectId,
        },
      }),
    /Unexpected deployment project ID/,
  );

  const wrongRepository = fixture("wrong-repository.json");
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        expected: {
          ...production.expected,
          git: {
            ...production.expected.git,
            repo: wrongRepository.repository,
          },
        },
      }),
    /Unexpected deployment Git repository/,
  );
});

test("conflicting Git metadata and non-ready state are rejected", () => {
  const production = fixture("valid-production.json");
  const conflict = fixture("conflicting-git.json");
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        deploymentResponse: {
          ...production.deploymentResponse,
          gitSource: conflict.gitSource,
        },
      }),
    /Git SHA metadata conflicts/,
  );

  const nonReady = fixture("non-ready.json");
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        deploymentResponse: {
          ...production.deploymentResponse,
          readyState: nonReady.readyState,
        },
      }),
    /Unexpected deployment readiness/,
  );

  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        deploymentResponse: {
          ...production.deploymentResponse,
          gitSource: {
            org: "mento-protocol",
            repo: 123,
            ref: "main",
            sha: production.expected.git.sha,
          },
        },
      }),
    /Git repository is malformed/,
  );
});

test("wrong or malformed deployment environments fail closed", () => {
  const production = fixture("valid-production.json");
  const appV3 = fixture("valid-custom-v3.json");
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        deploymentResponse: {
          ...production.deploymentResponse,
          target: "preview",
        },
      }),
    /Unexpected deployment target/,
  );
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...production,
        deploymentResponse: {
          ...production.deploymentResponse,
          customEnvironment: { slug: "v3" },
        },
      }),
    /Unexpected deployment custom environment/,
  );
  assert.throws(
    () =>
      canonicalizeDeploymentState({
        ...appV3,
        deploymentResponse: {
          ...appV3.deploymentResponse,
          customEnvironment: "v3",
        },
      }),
    /custom environment is malformed/,
  );
});

test("aliases are canonicalized, deduplicated, sorted, and validated", () => {
  assert.deepEqual(canonicalizeAliases(fixture("duplicate-aliases.json")), [
    "governance.mento.org",
    "governancementoorg-mentolabs.vercel.app",
  ]);
  assert.throws(
    () => canonicalizeAliases(fixture("malformed-aliases.json")),
    /malformed/,
  );
  assert.equal(
    canonicalizeHostname("HTTPS://Governance.Mento.Org"),
    "governance.mento.org",
  );
  for (const value of [
    "http://governance.mento.org",
    "https://governance.mento.org:8443",
    "https://governance.mento.org/path",
    "https://governance.mento.org?token=value",
    "https://governance.mento.org#fragment",
  ]) {
    assert.throws(() => canonicalizeHostname(value), /malformed/);
  }
  const credentialedHostname = [
    "https://user",
    ":secret@governance.mento.org",
  ].join("");
  assert.throws(() => canonicalizeHostname(credentialedHostname), /malformed/);
  assert.equal(
    canonicalizeDeploymentUrl("https://immutable.vercel.app"),
    "https://immutable.vercel.app",
  );
  assert.throws(
    () => canonicalizeDeploymentUrl("https://governance.mento.org"),
    /immutable vercel\.app/,
  );
});

test("sensitive API fields cannot reach canonical JSON", () => {
  const production = fixture("valid-production.json");
  const sensitive = fixture("sensitive-response.json");
  const state = canonicalizeDeploymentState({
    ...production,
    aliasResponse: {
      ...production.aliasResponse,
      protectionBypass: sensitive.extra.protectionBypass,
    },
    deploymentResponse: {
      ...production.deploymentResponse,
      ...sensitive.extra,
    },
    aliasesResponse: {
      aliases: production.aliasesResponse.aliases.map((alias) => ({
        ...alias,
        protectionBypass: sensitive.extra.protectionBypass,
      })),
    },
  });
  const output = JSON.stringify(state);
  assert.equal(state.creatorUsername, "fixture-author");
  assert.doesNotMatch(output, /test-value-not-printed/);
  assert.doesNotMatch(
    output,
    /protectionBypass|buildEnv|email|avatar|test-value-not-printed-user-id|env/,
  );
});

test("creator username canonicalization is narrow and fail-closed", () => {
  const production = fixture("valid-production.json");
  assert.equal(
    canonicalizeDeploymentState({
      ...production,
      deploymentResponse: {
        ...production.deploymentResponse,
        creator: { uid: "user_fixture123", username: "Chapati" },
      },
    }).creatorUsername,
    "chapati",
  );
  assert.equal(
    canonicalizeDeploymentState({
      ...production,
      deploymentResponse: {
        ...production.deploymentResponse,
        creator: { uid: "user_fixture123" },
      },
    }).creatorUsername,
    null,
  );
  for (const creator of [
    "chapati",
    [],
    { username: "" },
    { username: "chapati.example" },
    { username: "chapati_user" },
    { username: "a".repeat(64) },
  ]) {
    assert.throws(
      () =>
        canonicalizeDeploymentState({
          ...production,
          deploymentResponse: {
            ...production.deploymentResponse,
            creator,
          },
        }),
      /creator/,
    );
  }
});

test("creator display names and Git author metadata cannot authorize aliases", () => {
  const production = fixture("valid-production.json");
  const state = canonicalizeDeploymentState({
    ...production,
    deploymentResponse: {
      ...production.deploymentResponse,
      creator: {
        uid: "user_fixture123",
        username: "actual-creator",
        name: "chapati",
      },
      meta: {
        ...production.deploymentResponse.meta,
        githubCommitAuthorLogin: "chapati23",
        githubCommitAuthorName: "chapati",
      },
    },
  });
  assert.equal(state.creatorUsername, "actual-creator");
  const output = JSON.stringify(state);
  assert.doesNotMatch(output, /chapati23|githubCommitAuthor|"name"/);
});

test("canonical output boundary rejects every non-allowlisted field", () => {
  const state = canonicalizeFixture(fixture("valid-production.json"));
  assert.equal(assertCanonicalOutput(state), state);
  assert.throws(
    () =>
      assertCanonicalOutput({
        ...state,
        buildEnv: { PRIVATE_VALUE: "test-value-must-not-print" },
      }),
    (error) => {
      assert.match(error.message, /forbidden fields/);
      assert.doesNotMatch(error.message, /test-value-must-not-print/);
      return true;
    },
  );
  assert.throws(
    () =>
      assertCanonicalOutput({
        ...state,
        git: { ...state.git, token: "test-value-must-not-print" },
      }),
    /forbidden fields/,
  );
  assert.throws(
    () =>
      assertCanonicalOutput({
        ...state,
        aliases: [...state.aliases].reverse(),
      }),
    /aliases are malformed/,
  );
  assert.throws(
    () =>
      assertCanonicalOutput({
        ...state,
        creatorUsername: "Chapati",
      }),
    /creator username is malformed/,
  );
});

test("snapshot specs reject duplicates and non-Mento provenance", () => {
  const base = {
    alias: "governance.mento.org",
    projectId: "prj_governance123",
    projectName: "governance.mento.org",
    target: "production",
    customEnvironmentSlug: null,
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "main",
    },
  };
  assert.doesNotThrow(() => assertSnapshotSpec([base]));
  assert.throws(() => assertSnapshotSpec([base, base]), /duplicated/);
  assert.throws(
    () => assertSnapshotSpec([{ ...base, git: { ...base.git, org: "fork" } }]),
    /mento-protocol/,
  );
  assert.throws(
    () =>
      assertSnapshotSpec([
        { ...base, target: undefined, customEnvironmentSlug: undefined },
      ]),
    /environment is malformed/,
  );
  assert.throws(
    () =>
      assertSnapshotSpec([
        { ...base, target: null, customEnvironmentSlug: "production" },
      ]),
    /environment is malformed/,
  );
});

test("protected snapshot comparison detects every mapping change", () => {
  const state = canonicalizeFixture(fixture("valid-production.json"));
  assert.doesNotThrow(() => compareProtectedSnapshots([state], [state]));
  assert.throws(
    () =>
      compareProtectedSnapshots(
        [state],
        [
          {
            ...state,
            deploymentId: "dpl_changed123",
            deploymentUrl: "https://governance-changed.vercel.app",
          },
        ],
      ),
    (error) => {
      assert.match(error.message, /read-only and attempted no repair/);
      assert.match(error.message, /dpl_governance123/);
      assert.match(error.message, /dpl_changed123/);
      assert.match(error.message, /governance-immutable\.vercel\.app/);
      assert.match(error.message, /governance-changed\.vercel\.app/);
      assert.match(
        error.message,
        /"restoreCommand":"vercel alias set https:\/\/governance-immutable\.vercel\.app governance\.mento\.org"/,
      );
      assert.doesNotMatch(error.message, /--token|&&|\n/);
      return true;
    },
  );

  const sensitiveValue = "test-value-must-not-print";
  assert.throws(
    () =>
      compareProtectedSnapshots(
        [state],
        [{ ...state, deploymentId: `dpl_changed;${sensitiveValue}` }],
      ),
    (error) => {
      assert.match(
        error.message,
        /Snapshot deployment ID is missing or malformed/,
      );
      assert.doesNotMatch(error.message, new RegExp(sensitiveValue));
      return true;
    },
  );
});

test("CLI parser accepts only each command's exact option set", () => {
  const cases = [
    ["active-proof", "--spec", "spec.json", "--output", "proof.json"],
    [
      "app-candidate",
      "--expected",
      "expected.json",
      "--output",
      "candidate.json",
    ],
    ["compare", "--before", "before.json", "--after", "after.json"],
    ["planning-snapshot", "--spec", "spec.json", "--output", "snapshot.json"],
    ["snapshot", "--spec", "spec.json", "--output", "snapshot.json"],
    [
      "deployment",
      "--expected",
      "expected.json",
      "--output",
      "deployment.json",
    ],
    [
      "project",
      "--project-id",
      "prj_test",
      "--project-name",
      "app.mento.org",
      "--root-directory",
      "apps/app.mento.org",
    ],
  ];
  for (const argv of cases) {
    const parsed = parseArguments(argv);
    assert.equal(parsed.command, argv[0]);
    assert.equal(Object.keys(parsed.options).length, (argv.length - 1) / 2);
  }

  for (const argv of [
    [],
    ["unknown"],
    ["compare", "before.json", "after.json"],
    ["compare", "--before", "before.json", "--after"],
    ["compare", "--before", "--after", "after.json"],
    [
      "compare",
      "--before",
      "before.json",
      "--before",
      "duplicate.json",
      "--after",
      "after.json",
    ],
    [
      "compare",
      "--before",
      "before.json",
      "--after",
      "after.json",
      "--output",
      "unexpected.json",
    ],
    ["snapshot", "--spec", "spec.json"],
    ["project", "--project-id", "prj_test", "extra"],
  ]) {
    assert.throws(() => parseArguments(argv));
  }
});

test("compare is tokenless and never constructs a Vercel client", async (t) => {
  const directory = privateTestDirectory(t);
  const state = canonicalizeFixture(fixture("valid-production.json"));
  const before = join(directory, "before.json");
  const after = join(directory, "after.json");
  writeFileSync(before, JSON.stringify([state]), { mode: 0o600 });
  writeFileSync(after, JSON.stringify([state]), { mode: 0o600 });
  let clientsConstructed = 0;
  let stdout = "";

  await runCli({
    argv: ["compare", "--before", before, "--after", after],
    env: {},
    stdout: { write: (value) => (stdout += value) },
    clientFactory: () => {
      clientsConstructed += 1;
      throw new Error("client must remain unused");
    },
  });

  assert.equal(clientsConstructed, 0);
  assert.equal(stdout, "Protected alias mappings verified\n");
  assert.doesNotMatch(stdout, new RegExp(directory));
});

test("network subcommands construct a client only after strict parsing", async () => {
  let clientsConstructed = 0;
  const clientFactory = (options) => {
    clientsConstructed += 1;
    assert.deepEqual(options, {
      token: "test-token-never-printed",
      teamId: "team_test123",
    });
    return {
      assertProject: async (expected) =>
        assert.deepEqual(expected, {
          projectId: "prj_test123",
          projectName: "app.mento.org",
          rootDirectory: "apps/app.mento.org",
        }),
    };
  };
  let stdout = "";

  await assert.rejects(() =>
    runCli({
      argv: ["project", "--project-id", "prj_test123", "--unknown", "value"],
      env: {
        VERCEL_ORG_ID: "team_test123",
        VERCEL_TOKEN: "test-token-never-printed",
      },
      clientFactory,
    }),
  );
  assert.equal(clientsConstructed, 0);

  await runCli({
    argv: [
      "project",
      "--project-id",
      "prj_test123",
      "--project-name",
      "app.mento.org",
      "--root-directory",
      "apps/app.mento.org",
    ],
    env: {
      VERCEL_ORG_ID: "team_test123",
      VERCEL_TOKEN: "test-token-never-printed",
    },
    stdout: { write: (value) => (stdout += value) },
    clientFactory,
  });
  assert.equal(clientsConstructed, 1);
  assert.equal(stdout, "Vercel project configuration verified\n");
  assert.doesNotMatch(stdout, /test-token-never-printed/);
});

test("private canonical output is exclusive, mode 0600, and symlink-safe", (t) => {
  const directory = privateTestDirectory(t);
  const state = canonicalizeFixture(fixture("valid-production.json"));
  const output = join(directory, "state.json");

  writeCanonicalJson(output, state, { runnerTemp: directory });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(readFileSync(output, "utf8"), `${JSON.stringify(state)}\n`);

  assert.throws(
    () => writeCanonicalJson(output, state, { runnerTemp: directory }),
    /could not be created safely/,
  );
  assert.equal(readFileSync(output, "utf8"), `${JSON.stringify(state)}\n`);

  const target = join(directory, "target.json");
  const symlink = join(directory, "symlink.json");
  writeFileSync(target, "sentinel", { mode: 0o600 });
  symlinkSync(target, symlink);
  assert.throws(
    () => writeCanonicalJson(symlink, state, { runnerTemp: directory }),
    /could not be created safely/,
  );
  assert.equal(readFileSync(target, "utf8"), "sentinel");

  const nested = join(directory, "nested");
  mkdirSync(nested);
  assert.throws(
    () =>
      writeCanonicalJson(join(nested, "state.json"), state, {
        runnerTemp: directory,
      }),
    /path is missing or unsafe/,
  );
  assert.throws(
    () => writeCanonicalJson("relative.json", state, { runnerTemp: directory }),
    /path is missing or unsafe/,
  );
});

test("planning snapshots and App candidates use distinct validated private writers", (t) => {
  const directory = privateTestDirectory(t);
  const planningState = canonicalizePlanningFixture(
    fixture("valid-production.json"),
  );
  const planning = {
    schema: MAIN_PLANNING_SNAPSHOT_SCHEMA,
    states: [planningState],
  };
  const candidate = canonicalizeAppTransactionCandidate(appCandidateFixture());
  const planningPath = join(directory, "planning.json");
  const candidatePath = join(directory, "candidate.json");
  writeMainPlanningSnapshot(planningPath, planning, {
    runnerTemp: directory,
  });
  writeAppTransactionCandidate(candidatePath, candidate, {
    runnerTemp: directory,
  });
  assert.equal(
    readFileSync(planningPath, "utf8"),
    `${JSON.stringify(planning)}\n`,
  );
  assert.equal(
    readFileSync(candidatePath, "utf8"),
    `${JSON.stringify(candidate)}\n`,
  );
  assert.throws(
    () =>
      writeMainPlanningSnapshot(
        join(directory, "bad-planning.json"),
        { schema: MAIN_PLANNING_SNAPSHOT_SCHEMA, states: [candidate] },
        { runnerTemp: directory },
      ),
    /planning deployment state/,
  );
  assert.throws(
    () =>
      writeAppTransactionCandidate(
        join(directory, "bad-candidate.json"),
        planning,
        { runnerTemp: directory },
      ),
    /App transaction candidate/,
  );
});

test("private output rejects a symlinked runner temp ancestor", (t) => {
  const directory = privateTestDirectory(t);
  const actual = join(directory, "actual");
  const linked = join(directory, "linked");
  mkdirSync(actual);
  symlinkSync(actual, linked);
  const output = join(linked, "state.json");
  const state = canonicalizeFixture(fixture("valid-production.json"));

  assert.throws(
    () => writeCanonicalJson(output, state, { runnerTemp: linked }),
    /directory is missing or unsafe/,
  );
  assert.equal(existsSync(join(actual, "state.json")), false);
});

test("CLI entrypoint redacts ordinary failures and compares without credentials", (t) => {
  const directory = privateTestDirectory(t);
  const state = canonicalizeFixture(fixture("valid-production.json"));
  const before = join(directory, "before.json");
  const after = join(directory, "after.json");
  const script = fileURLToPath(
    new URL("./vercel-deployment-state.mjs", import.meta.url),
  );
  writeFileSync(before, JSON.stringify([state]), { mode: 0o600 });
  writeFileSync(after, JSON.stringify([state]), { mode: 0o600 });

  const compared = spawnSync(
    process.execPath,
    [script, "compare", "--before", before, "--after", after],
    { encoding: "utf8", env: {} },
  );
  assert.equal(compared.status, 0);
  assert.equal(compared.stdout, "Protected alias mappings verified\n");
  assert.equal(compared.stderr, "");

  const sensitivePath = join(directory, "private-test-value.json");
  const failed = spawnSync(
    process.execPath,
    [script, "compare", "--before", sensitivePath],
    { encoding: "utf8", env: {} },
  );
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.equal(
    failed.stderr,
    "Vercel deployment state failed category=state-validation-failed\n",
  );
  assert.doesNotMatch(failed.stderr, /private-test-value|\/private\//);
  assert.equal(
    renderCliFailure(new Error(`${sensitivePath}: test-token-never-printed`)),
    "Vercel deployment state failed category=state-validation-failed\n",
  );
});

test("state inspector contains no deployment, alias, or promotion mutation", () => {
  const source = readFileSync(
    new URL("./vercel-deployment-state.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(source, /from\s+"node:child_process"/);
  assert.doesNotMatch(source, /\b(?:exec|execFile|fork|spawn)(?:Sync)?\s*\(/);
  assert.doesNotMatch(
    source,
    /\bvercel\s+(?:deploy|promote|rollback|remove)\b/,
  );
  assert.equal(source.match(/vercel alias set/g)?.length, 1);
});

test("client uses only official read endpoints and never parses error bodies", async () => {
  const production = fixture("valid-production.json");
  const requests = [];
  const responses = new Map([
    ["/v4/aliases/governance.mento.org", production.aliasResponse],
    ["/v13/deployments/dpl_governance123", production.deploymentResponse],
    ["/v2/deployments/dpl_governance123/aliases", production.aliasesResponse],
    [
      "/v9/projects/prj_governance123",
      {
        id: "prj_governance123",
        name: "governance.mento.org",
        rootDirectory: "apps/governance.mento.org",
      },
    ],
  ]);
  const client = new VercelStateClient({
    token: "fixture-token-never-logged",
    teamId: "team_fixture123",
    fetchImplementation: async (url, init) => {
      requests.push({ url, init });
      const body = responses.get(url.pathname);
      return {
        ok: body !== undefined,
        status: body === undefined ? 500 : 200,
        json: async () => body,
        text: async () => {
          throw new Error("raw error body must not be read");
        },
      };
    },
  });
  const states = await captureProtectedSnapshot(client, [
    {
      alias: "governance.mento.org",
      ...production.expected,
    },
  ]);
  assert.equal(states.length, 1);
  await client.assertProject({
    projectId: "prj_governance123",
    projectName: "governance.mento.org",
    rootDirectory: "apps/governance.mento.org",
  });
  assert.equal(requests.length, 5);
  assert.deepEqual(
    [...new Set(requests.map(({ url }) => url.pathname))].sort(),
    [
      "/v13/deployments/dpl_governance123",
      "/v2/deployments/dpl_governance123/aliases",
      "/v4/aliases/governance.mento.org",
      "/v9/projects/prj_governance123",
    ],
  );
  for (const request of requests) {
    assert.equal(request.url.origin, "https://api.vercel.com");
    assert.equal(request.url.searchParams.get("teamId"), "team_fixture123");
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.body, undefined);
    assert.equal(
      request.init.headers.Authorization,
      "Bearer fixture-token-never-logged",
    );
  }
  const deploymentRequest = requests.find(({ url }) =>
    url.pathname.startsWith("/v13/deployments/"),
  );
  assert.equal(
    deploymentRequest.url.searchParams.get("withGitRepoInfo"),
    "true",
  );

  let errorBodyRead = false;
  const failingClient = new VercelStateClient({
    token: "fixture-token-never-logged",
    teamId: "team_fixture123",
    fetchImplementation: async () => ({
      ok: false,
      status: 500,
      json: async () => {
        errorBodyRead = true;
        return { protectionBypass: "test-value-not-printed" };
      },
      text: async () => {
        errorBodyRead = true;
        return "test-value-not-printed";
      },
    }),
  });
  await assert.rejects(
    () => failingClient.inspectProject("prj_missing123"),
    (error) => {
      assert.match(error.message, /HTTP 500/);
      assert.doesNotMatch(
        error.message,
        /fixture-token|test-value-not-printed/,
      );
      return true;
    },
  );
  assert.equal(errorBodyRead, false);

  const throwingClient = new VercelStateClient({
    token: "fixture-token-never-logged",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("test-value-not-printed");
    },
  });
  await assert.rejects(
    () => throwingClient.inspectProject("prj_missing123"),
    (error) => {
      assert.equal(error.message, "Vercel API request failed");
      assert.doesNotMatch(error.message, /test-value-not-printed/);
      return true;
    },
  );
});

test("client direct-deployment lookup preserves the requested deployment ID", async () => {
  const production = fixture("valid-production.json");
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async () => {
      throw new Error("unused");
    },
  });
  client.inspectDeployment = async () => ({
    ...production.deploymentResponse,
    id: "dpl_different123",
  });
  client.listDeploymentAliases = async () => production.aliasesResponse;
  await assert.rejects(
    client.canonicalDeploymentState({
      deployment: "dpl_governance123",
      deploymentUrl: "https://governance-immutable.vercel.app",
      ...production.expected,
    }),
    /Unexpected deployment ID/,
  );
});

test("client alias check uses only the minimal redacted mapping path", async () => {
  const production = fixture("valid-production.json");
  const requests = [];
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async (url) => {
      requests.push(url.pathname);
      if (url.pathname === "/v4/aliases/governance.mento.org") {
        return {
          ok: true,
          status: 200,
          json: async () => production.aliasResponse,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...production.deploymentResponse,
          meta: {
            ...production.deploymentResponse.meta,
            mentoTransaction: "123-1-governance",
          },
          buildEnv: { SECRET: "test-value-not-printed" },
        }),
      };
    },
  });
  const mapping = await client.aliasMapping("governance.mento.org");
  assert.deepEqual(requests, [
    "/v4/aliases/governance.mento.org",
    "/v13/deployments/dpl_governance123",
    "/v4/aliases/governance.mento.org",
  ]);
  assert.deepEqual(mapping, {
    alias: "governance.mento.org",
    deploymentId: "dpl_governance123",
    deploymentUrl: "https://governance-immutable.vercel.app",
    projectId: "prj_governance123",
  });
  assert.doesNotMatch(
    JSON.stringify(mapping),
    /test-value-not-printed|buildEnv/,
  );
});

test("client alias check rejects a mapping that changes mid-read", async () => {
  const production = fixture("valid-production.json");
  let aliasLookups = 0;
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async (url) => {
      if (url.pathname === "/v4/aliases/governance.mento.org") {
        aliasLookups += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...production.aliasResponse,
            deploymentId:
              aliasLookups === 1 ? "dpl_governance123" : "dpl_concurrent123",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => production.deploymentResponse,
      };
    },
  });
  await assert.rejects(
    () => client.aliasMapping("governance.mento.org"),
    /changed during inspection/,
  );
});

test("protected snapshot capture rejects an alias mapping race", async () => {
  const production = fixture("valid-production.json");
  let aliasLookups = 0;
  const client = new VercelStateClient({
    token: "fixture-token",
    teamId: "team_fixture123",
    fetchImplementation: async (url) => {
      if (url.pathname === "/v4/aliases/governance.mento.org") {
        aliasLookups += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...production.aliasResponse,
            deploymentId:
              aliasLookups === 1 ? "dpl_governance123" : "dpl_concurrent123",
          }),
        };
      }
      if (url.pathname.startsWith("/v13/deployments/")) {
        return {
          ok: true,
          status: 200,
          json: async () => production.deploymentResponse,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => production.aliasesResponse,
      };
    },
  });
  await assert.rejects(
    () =>
      captureProtectedSnapshot(client, [
        { alias: "governance.mento.org", ...production.expected },
      ]),
    /changed during inspection/,
  );
});

test("reviewed custom-v3 aliases must converge on one immutable deployment", async () => {
  const base = canonicalizeFixture(fixture("valid-custom-v3.json"));
  const client = {
    canonicalAliasState: async (entry) => ({
      ...base,
      alias: entry.alias,
      deploymentId:
        entry.alias === "app.mento.org" ? base.deploymentId : "dpl_other123",
    }),
  };
  const expected = fixture("valid-custom-v3.json").expected;
  await assert.rejects(
    () =>
      captureProtectedSnapshot(client, [
        { alias: "app.mento.org", ...expected },
        {
          alias: "appmentoorg-env-v3-mentolabs.vercel.app",
          ...expected,
        },
      ]),
    /do not share one deployment/,
  );
});

test("reviewed custom-v3 aliases exactly equal the current two-alias topology", async () => {
  const base = canonicalizeFixture(fixture("valid-custom-v3.json"));
  const expected = fixture("valid-custom-v3.json").expected;
  const aliases = ["app.mento.org", "appmentoorg-env-v3-mentolabs.vercel.app"];
  const client = {
    canonicalAliasState: async (entry) => ({ ...base, alias: entry.alias }),
  };
  const exact = aliases.map((alias) => ({ alias, ...expected }));
  assert.equal((await captureProtectedSnapshot(client, exact)).length, 2);

  await assert.rejects(
    () => captureProtectedSnapshot(client, exact.slice(0, 1)),
    /do not exactly match the deployment alias set/,
  );
  await assert.rejects(
    () =>
      captureProtectedSnapshot(client, [
        ...exact,
        { alias: "unexpected-v3.mento.org", ...expected },
      ]),
    /do not exactly match the deployment alias set/,
  );
});

test("active deployment proof binds every GitHub prebuilt and keeps legacy App v2 separate", () => {
  const spec = activeStateSpec();
  assert.equal(
    ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA,
    "vercel-active-deployment-state-proof:v5",
  );
  assert.equal(assertActiveDeploymentStateSpec(spec), spec);
  const proof = createActiveDeploymentStateProof({
    spec,
    deployments: activeDeploymentInspections(spec),
    legacyV2: legacyAppV2Proof(spec),
  });

  assert.equal(proof.schema, ACTIVE_DEPLOYMENT_STATE_PROOF_SCHEMA);
  assert.equal(proof.outcome, "proven");
  for (const logicalTarget of Object.keys(spec.projects)) {
    assert.deepEqual(proof.projects[logicalTarget].counts, {
      scanned: 1,
      githubPrebuilt: 1,
      githubShadowStage: 0,
      nativeGitOwner: 0,
      nativeGitDuplicates: 0,
      manualDuplicates: 0,
      inertCanceled: 0,
      unknown: 0,
      legacyV2: 0,
    });
    assert.deepEqual(proof.projects[logicalTarget].ids.githubPrebuilt, [
      spec.projects[logicalTarget].deploymentId,
    ]);
  }
  assert.equal(proof.legacyAppV2.ownership, "native-vercel-git");
  assert.equal(proof.legacyAppV2.git.ref, "v2");
  assert.doesNotMatch(
    JSON.stringify(proof),
    /meta|protectionBypass|token-never-output|rawResponse/,
  );
  assert.equal(assertActiveDeploymentStateProof(proof), proof);
});

test("active deployment proof records an exact canceled inactive deployment as inert evidence", () => {
  const spec = activeStateSpecWithInactiveUi();
  const deployments = activeDeploymentInspections(spec);
  const canceled = inactiveUiInspection(spec);
  deployments.ui = [canceled];

  const proof = createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: legacyAppV2Proof(spec),
  });

  assert.equal(proof.outcome, "proven");
  assert.equal(proof.projects.ui.expectedDisposition, null);
  assert.deepEqual(proof.projects.ui.counts, {
    scanned: 1,
    githubPrebuilt: 0,
    githubShadowStage: 0,
    nativeGitOwner: 0,
    nativeGitDuplicates: 0,
    manualDuplicates: 0,
    inertCanceled: 1,
    unknown: 0,
    legacyV2: 0,
  });
  assert.deepEqual(proof.projects.ui.ids.inertCanceled, [
    canceled.deploymentId,
  ]);
  assert.deepEqual(proof.projects.ui.records.inertCanceled, [
    {
      deploymentId: canceled.deploymentId,
      deploymentUrl: "https://uimento-lxu9dr6ck-mentolabs.vercel.app",
      projectId: spec.projects.ui.projectId,
      projectName: spec.projects.ui.projectName,
      readyState: "CANCELED",
      target: "production",
      customEnvironmentSlug: null,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: spec.deploySha,
      },
      source: "git",
      workflowMetadataMatches: false,
    },
  ]);
  assert.equal(assertActiveDeploymentStateProof(proof), proof);

  const tampered = structuredClone(proof);
  tampered.projects.ui.records.inertCanceled[0].readyState = "ERROR";
  assert.throws(
    () => assertActiveDeploymentStateProof(tampered),
    /inertCanceled deployment record is malformed/,
  );
});

test("active deployment proof does not let a canceled expected candidate satisfy its disposition", () => {
  const spec = activeStateSpec();
  const deployments = activeDeploymentInspections(spec);
  deployments.ui[0].response.readyState = "CANCELED";

  const proof = createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: legacyAppV2Proof(spec),
  });

  assert.equal(proof.outcome, "unproven");
  assert.deepEqual(proof.projects.ui.ids.githubPrebuilt, []);
  assert.deepEqual(proof.projects.ui.ids.inertCanceled, []);
  assert.deepEqual(proof.projects.ui.ids.unknown, [
    spec.projects.ui.deploymentId,
  ]);
});

test("active deployment proof keeps errors and pending deployments unknown", () => {
  for (const readyState of [
    "ERROR",
    "BLOCKED",
    "BUILDING",
    "INITIALIZING",
    "QUEUED",
  ]) {
    const spec = activeStateSpecWithInactiveUi();
    const deployments = activeDeploymentInspections(spec);
    const entry = inactiveUiInspection(spec, { readyState });
    deployments.ui = [entry];

    const proof = createActiveDeploymentStateProof({
      spec,
      deployments,
      legacyV2: legacyAppV2Proof(spec),
    });

    assert.equal(proof.outcome, "unproven", readyState);
    assert.deepEqual(
      proof.projects.ui.ids.unknown,
      [entry.deploymentId],
      readyState,
    );
    assert.equal(proof.projects.ui.counts.inertCanceled, 0, readyState);
  }
});

test("active deployment proof fails closed when canceled identity fields do not match", () => {
  const scenarios = [
    {
      label: "project ID",
      mutate(entry) {
        entry.response.projectId = "prj_wrongui123";
      },
    },
    {
      label: "project name",
      mutate(entry) {
        entry.response.name = "wrong-ui.mento.org";
      },
    },
    {
      label: "target",
      mutate(entry) {
        entry.response.target = null;
      },
    },
    {
      label: "custom environment",
      mutate(entry) {
        entry.response.customEnvironment = { slug: "preview" };
      },
    },
    {
      label: "malformed identity",
      mutate(entry) {
        entry.response.project = { id: "prj_conflictingui123" };
      },
    },
  ];

  for (const scenario of scenarios) {
    const spec = activeStateSpecWithInactiveUi();
    const deployments = activeDeploymentInspections(spec);
    const entry = inactiveUiInspection(spec);
    scenario.mutate(entry);
    deployments.ui = [entry];

    const proof = createActiveDeploymentStateProof({
      spec,
      deployments,
      legacyV2: legacyAppV2Proof(spec),
    });

    assert.equal(proof.outcome, "unproven", scenario.label);
    assert.deepEqual(
      proof.projects.ui.ids.unknown,
      [entry.deploymentId],
      scenario.label,
    );
    assert.equal(proof.projects.ui.counts.inertCanceled, 0, scenario.label);
  }

  const spec = activeStateSpecWithInactiveUi();
  const deployments = activeDeploymentInspections(spec);
  const mismatchedId = inactiveUiInspection(spec);
  mismatchedId.response.id = "dpl_wrongresponseid123";
  deployments.ui = [mismatchedId];
  assert.throws(
    () =>
      createActiveDeploymentStateProof({
        spec,
        deployments,
        legacyV2: legacyAppV2Proof(spec),
      }),
    /Git identity is missing/,
  );

  const wrongShaSpec = activeStateSpecWithInactiveUi();
  const wrongShaDeployments = activeDeploymentInspections(wrongShaSpec);
  const wrongSha = inactiveUiInspection(wrongShaSpec);
  wrongSha.response.meta.githubCommitSha = "e".repeat(40);
  wrongShaDeployments.ui = [wrongSha];
  assert.throws(
    () =>
      createActiveDeploymentStateProof({
        spec: wrongShaSpec,
        deployments: wrongShaDeployments,
        legacyV2: legacyAppV2Proof(wrongShaSpec),
      }),
    /SHA does not match census/,
  );
});

test("active deployment proof keeps an unexpected ready inactive deployment as a duplicate", () => {
  const spec = activeStateSpecWithInactiveUi();
  const deployments = activeDeploymentInspections(spec);
  const ready = inactiveUiInspection(spec, { readyState: "READY" });
  deployments.ui = [ready];

  const proof = createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: legacyAppV2Proof(spec),
  });

  assert.equal(proof.outcome, "unproven");
  assert.deepEqual(proof.projects.ui.ids.manualDuplicates, [
    ready.deploymentId,
  ]);
  assert.equal(proof.projects.ui.counts.inertCanceled, 0);
  assert.equal(proof.projects.ui.counts.unknown, 0);
});

test("first-cutover proof accepts source-free candidates and the exact same-SHA rollback prior", () => {
  for (const candidateSource of [undefined, "git", "cli", "redeploy"]) {
    for (const priorSource of [undefined, "git", "cli", "redeploy"]) {
      const spec = activeStateSpec({ rollbackOnly: true });
      const deployments = activeDeploymentInspections(spec);
      deployments.governance[0].response.source = candidateSource;
      const prior = spec.releaseManifest.originalPriors.governance;
      const priorResponse = activeDeploymentResponse(spec, "governance", {
        deploymentId: prior.deploymentId,
        deploymentUrl: prior.deploymentUrl,
        source: priorSource,
      });
      for (const key of Object.keys(priorResponse.meta)) {
        if (key.startsWith("mento")) delete priorResponse.meta[key];
      }
      deployments.governance.push({
        deploymentId: prior.deploymentId,
        response: priorResponse,
      });
      const proof = createActiveDeploymentStateProof({
        spec,
        deployments,
        legacyV2: legacyAppV2Proof(spec),
      });
      assert.equal(
        proof.outcome,
        "proven",
        `candidate=${candidateSource} prior=${priorSource}`,
      );
      assert.deepEqual(proof.projects.governance.ids.nativeGitDuplicates, [
        prior.deploymentId,
      ]);
      assert.equal(
        proof.projects.governance.records.githubPrebuilt[0]
          .workflowMetadataMatches,
        true,
      );
      assert.equal(
        proof.projects.governance.priorDeploymentId,
        prior.deploymentId,
      );
      assert.equal(
        proof.projects.governance.priorDeploymentUrl,
        prior.deploymentUrl,
      );
      assert.equal(proof.projects.governance.priorServedSha, spec.deploySha);
    }
  }

  const gitTelemetryCases = [
    {
      label: "wrong organization",
      mutate(response) {
        response.meta.githubCommitOrg = "foreign-org";
      },
      expectedPriorGit: {
        org: "foreign-org",
        repo: "frontend-monorepo",
        ref: "main",
      },
    },
    {
      label: "wrong ref",
      mutate(response) {
        response.meta.githubCommitRef = "feature";
      },
      expectedPriorGit: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "feature",
      },
    },
    {
      label: "missing organization and ref",
      mutate(response) {
        delete response.meta.githubCommitOrg;
        delete response.meta.githubCommitRef;
      },
      expectedPriorGit: {
        org: null,
        repo: null,
        ref: null,
      },
    },
    {
      label: "conflicting organization",
      mutate(response, spec) {
        response.gitSource = {
          org: "foreign-org",
          repo: "frontend-monorepo",
          ref: "main",
          sha: spec.deploySha,
        };
      },
      expectedPriorGit: {
        org: null,
        repo: null,
        ref: null,
      },
    },
  ];
  for (const telemetryCase of gitTelemetryCases) {
    const spec = activeStateSpec({ rollbackOnly: true });
    const prior = spec.releaseManifest.originalPriors.governance;
    const priorResponse = activeDeploymentResponse(spec, "governance", {
      deploymentId: prior.deploymentId,
      deploymentUrl: prior.deploymentUrl,
    });
    for (const key of Object.keys(priorResponse.meta)) {
      if (key.startsWith("mento")) delete priorResponse.meta[key];
    }
    telemetryCase.mutate(priorResponse, spec);
    const deployments = activeDeploymentInspections(spec);
    deployments.governance.push({
      deploymentId: prior.deploymentId,
      response: priorResponse,
    });
    const proof = createActiveDeploymentStateProof({
      spec,
      deployments,
      legacyV2: legacyAppV2Proof(spec),
    });
    assert.equal(proof.outcome, "proven", telemetryCase.label);
    assert.deepEqual(
      proof.projects.governance.records.nativeGitDuplicates[0].git,
      {
        ...telemetryCase.expectedPriorGit,
        sha: spec.deploySha,
      },
      telemetryCase.label,
    );

    const candidateDeployments = activeDeploymentInspections(spec);
    telemetryCase.mutate(candidateDeployments.governance[0].response, spec);
    const candidateProof = createActiveDeploymentStateProof({
      spec,
      deployments: candidateDeployments,
      legacyV2: legacyAppV2Proof(spec),
    });
    assert.equal(candidateProof.outcome, "unproven", telemetryCase.label);
    assert.deepEqual(
      candidateProof.projects.governance.ids.githubPrebuilt,
      [],
      telemetryCase.label,
    );
    assert.deepEqual(
      candidateProof.projects.governance.ids.manualDuplicates,
      [spec.projects.governance.deploymentId],
      telemetryCase.label,
    );
  }

  const spec = activeStateSpec({ rollbackOnly: true });
  const deployments = activeDeploymentInspections(spec);
  deployments.governance.push({
    deploymentId: "dpl_governanceSpoofedPrior123",
    response: activeDeploymentResponse(spec, "governance", {
      deploymentId: "dpl_governanceSpoofedPrior123",
      deploymentUrl: "https://governance-spoofed-prior.vercel.app",
      source: "git",
    }),
  });
  const proof = createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: legacyAppV2Proof(spec),
  });
  assert.equal(proof.outcome, "unproven");
  assert.deepEqual(proof.projects.governance.ids.manualDuplicates, [
    "dpl_governanceSpoofedPrior123",
  ]);
});

test("active deployment proof accepts a stable candidate from an earlier audit attempt", () => {
  const spec = activeStateSpec();
  const deployments = activeDeploymentInspections(spec);
  const response = deployments.governance[0].response;
  for (const key of Object.keys(response.meta)) {
    if (key.startsWith("mento")) delete response.meta[key];
  }
  Object.assign(
    response.meta,
    createMainCandidateVercelMetadata({
      intent: createMainCandidateIntent({
        target: "governance",
        deploySha: spec.deploySha,
        upstreamRunId: spec.releaseManifest.upstreamRunId,
        originRunId: "12344",
        originAttempt: "1",
        originTransactionId: "main-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        projectId: spec.projects.governance.projectId,
        projectName: spec.projects.governance.projectName,
        releaseManifest: spec.releaseManifest,
      }),
    }),
  );

  const proof = createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: legacyAppV2Proof(spec),
  });

  assert.equal(proof.outcome, "proven");
  assert.deepEqual(proof.projects.governance.ids.githubPrebuilt, [
    spec.projects.governance.deploymentId,
  ]);
});

test("active deployment proof rejects retired and mismatched candidate metadata", () => {
  const spec = activeStateSpec();
  const classify = (mutate) => {
    const deployments = activeDeploymentInspections(spec);
    const entry = deployments.governance[0];
    mutate(entry.response);
    const proof = createActiveDeploymentStateProof({
      spec,
      deployments,
      legacyV2: legacyAppV2Proof(spec),
    });
    assert.equal(proof.outcome, "unproven");
    assert.deepEqual(proof.projects.governance.ids.githubPrebuilt, []);
    assert.deepEqual(proof.projects.governance.ids.manualDuplicates, [
      spec.projects.governance.deploymentId,
    ]);
  };

  classify((response) => {
    for (const key of Object.keys(response.meta)) {
      if (key.startsWith("mento")) delete response.meta[key];
    }
    response.meta.mentoTransaction = `${spec.runId}-${spec.runAttempt}-governance`;
  });
  classify((response) => {
    response.meta.mentoReleaseId = "mr-000000000000000000000000";
  });
  classify((response) => {
    response.meta.mentoTransaction = "retired-metadata-must-not-be-accepted";
  });
  classify((response) => {
    for (const key of Object.keys(response.meta)) {
      if (key.startsWith("mento")) delete response.meta[key];
    }
    const reserve = spec.projects.reserve;
    Object.assign(
      response.meta,
      createMainCandidateVercelMetadata({
        intent: createMainCandidateIntent({
          target: "reserve",
          deploySha: spec.deploySha,
          upstreamRunId: spec.releaseManifest.upstreamRunId,
          originRunId: spec.runId,
          originAttempt: spec.runAttempt,
          originTransactionId: spec.transactionId,
          projectId: reserve.projectId,
          projectName: reserve.projectName,
          releaseManifest: spec.releaseManifest,
        }),
      }),
    );
  });

  const wrongManifestProject = structuredClone(spec);
  wrongManifestProject.releaseManifest.originalPriors.governance.projectId =
    "prj_wrongproject123";
  assert.throws(
    () => assertActiveDeploymentStateSpec(wrongManifestProject),
    /conflicts/,
  );
  const wrongManifestTarget = structuredClone(spec);
  wrongManifestTarget.releaseManifest.stagedTargets = [
    "governance",
    "reserve",
    "ui",
  ];
  wrongManifestTarget.releaseManifest.activeTargets = [
    "governance",
    "reserve",
    "ui",
  ];
  assert.throws(
    () => assertActiveDeploymentStateSpec(wrongManifestTarget),
    /release manifest conflicts with state identity/,
  );
});

test("active deployment proof treats non-prior same-SHA identities as duplicates regardless of source", () => {
  const spec = activeStateSpec();
  const deployments = activeDeploymentInspections(spec);
  const project = spec.projects.app;
  deployments.app.push(
    {
      deploymentId: "dpl_appnative456",
      response: activeDeploymentResponse(spec, "app", {
        deploymentId: "dpl_appnative456",
        deploymentUrl: "https://app-native-duplicate.vercel.app",
        source: "git",
      }),
    },
    {
      deploymentId: "dpl_appmanual456",
      response: activeDeploymentResponse(spec, "app", {
        deploymentId: "dpl_appmanual456",
        deploymentUrl: "https://app-manual-duplicate.vercel.app",
      }),
    },
    {
      deploymentId: "dpl_appunknown456",
      response: {
        id: "dpl_appunknown456",
        url: "app-unknown-duplicate.vercel.app",
        projectId: project.projectId,
        project: { id: "prj_conflictingproject123" },
        name: project.projectName,
        readyState: "READY",
        target: null,
        customEnvironment: { slug: "v3" },
        source: "cli",
        meta: {
          githubCommitOrg: "mento-protocol",
          githubCommitRepo: "frontend-monorepo",
          githubCommitRef: "main",
          githubCommitSha: spec.deploySha,
        },
      },
    },
  );

  const proof = createActiveDeploymentStateProof({
    spec,
    deployments,
    legacyV2: legacyAppV2Proof(spec),
  });
  assert.equal(proof.outcome, "unproven");
  assert.deepEqual(proof.projects.app.counts, {
    scanned: 4,
    githubPrebuilt: 1,
    githubShadowStage: 0,
    nativeGitOwner: 0,
    nativeGitDuplicates: 0,
    manualDuplicates: 2,
    inertCanceled: 0,
    unknown: 1,
    legacyV2: 0,
  });
  assert.deepEqual(proof.projects.app.ids.manualDuplicates, [
    "dpl_appmanual456",
    "dpl_appnative456",
  ]);
  assert.deepEqual(proof.projects.app.ids.unknown, ["dpl_appunknown456"]);
  assert.deepEqual(proof.projects.app.ids.legacyV2, []);
});

test("active deployment state validation rejects ambiguity and noncanonical or expanded evidence", () => {
  const spec = activeStateSpec();
  const noncanonical = structuredClone(spec);
  noncanonical.projects.app.deploymentUrl += "/";
  assert.throws(
    () => assertActiveDeploymentStateSpec(noncanonical),
    /project is malformed/,
  );
  const collidingLegacy = structuredClone(spec);
  collidingLegacy.legacyAppV2.deployment =
    spec.projects.governance.deploymentId;
  assert.throws(
    () => assertActiveDeploymentStateSpec(collidingLegacy),
    /Legacy App v2 state is malformed/,
  );

  const duplicateInspection = activeDeploymentInspections(spec);
  duplicateInspection.ui.push(duplicateInspection.ui[0]);
  assert.throws(
    () =>
      createActiveDeploymentStateProof({
        spec,
        deployments: duplicateInspection,
        legacyV2: legacyAppV2Proof(spec),
      }),
    /ambiguous/,
  );

  const proof = createActiveDeploymentStateProof({
    spec,
    deployments: activeDeploymentInspections(spec),
    legacyV2: legacyAppV2Proof(spec),
  });
  assert.throws(
    () => assertActiveDeploymentStateProof({ ...proof, rawResponse: {} }),
    /forbidden fields/,
  );
  const tampered = structuredClone(proof);
  tampered.projects.reserve.counts.scanned = 2;
  assert.throws(
    () => assertActiveDeploymentStateProof(tampered),
    /count is malformed/,
  );
  const collidingUrl = structuredClone(proof);
  collidingUrl.projects.ui.expectedDeploymentUrl =
    proof.projects.governance.expectedDeploymentUrl;
  assert.throws(
    () => assertActiveDeploymentStateProof(collidingUrl),
    /proof is malformed/,
  );
  const foreignLegacy = structuredClone(proof);
  foreignLegacy.projects.reserve.ids.legacyV2.push("dpl_foreignlegacy123");
  foreignLegacy.projects.reserve.counts.legacyV2 += 1;
  foreignLegacy.projects.reserve.counts.scanned += 1;
  assert.throws(
    () => assertActiveDeploymentStateProof(foreignLegacy),
    /legacyV2 deployment records conflict/,
  );
});

test("active deployment proof fails closed for missing or mismatched expected deployments", () => {
  const spec = activeStateSpec();
  const scenarios = [
    {
      label: "missing",
      mutate(entries) {
        entries.length = 0;
      },
    },
    {
      label: "project",
      mutate(entries) {
        entries[0].response.projectId = "prj_wrong123";
      },
    },
    {
      label: "ref",
      classification: "manualDuplicates",
      mutate(entries) {
        entries[0].response.meta.githubCommitRef = "feature";
      },
    },
    {
      label: "environment",
      mutate(entries) {
        entries[0].response.customEnvironment.slug = "preview";
      },
    },
    {
      label: "readiness",
      mutate(entries) {
        entries[0].response.readyState = "BUILDING";
      },
    },
    {
      label: "workflow metadata",
      classification: "manualDuplicates",
      mutate(entries) {
        entries[0].response.meta.mentoRunAttempt = "3";
      },
    },
  ];

  for (const scenario of scenarios) {
    const deployments = activeDeploymentInspections(spec);
    scenario.mutate(deployments.app);
    const proof = createActiveDeploymentStateProof({
      spec,
      deployments,
      legacyV2: legacyAppV2Proof(spec),
    });
    assert.equal(proof.outcome, "unproven", scenario.label);
    if (scenario.label === "missing") {
      assert.equal(proof.projects.app.counts.scanned, 0);
      assert.equal(proof.projects.app.counts.unknown, 0);
    } else if (scenario.classification === "manualDuplicates") {
      assert.equal(proof.projects.app.counts.manualDuplicates, 1);
    } else {
      assert.equal(proof.projects.app.counts.unknown, 1, scenario.label);
    }
    assert.equal(proof.projects.app.counts.githubPrebuilt, 0, scenario.label);
  }

  for (const [label, mutate] of [
    [
      "missing SHA",
      (response) => {
        delete response.meta.githubCommitSha;
      },
    ],
    [
      "mismatched SHA",
      (response) => {
        response.meta.githubCommitSha =
          "2222222222222222222222222222222222222222";
      },
    ],
    [
      "conflicting SHA",
      (response) => {
        response.gitSource = {
          org: "mento-protocol",
          repo: "frontend-monorepo",
          ref: "main",
          sha: "2222222222222222222222222222222222222222",
        };
      },
    ],
  ]) {
    const deployments = activeDeploymentInspections(spec);
    mutate(deployments.app[0].response);
    assert.throws(
      () =>
        createActiveDeploymentStateProof({
          spec,
          deployments,
          legacyV2: legacyAppV2Proof(spec),
        }),
      /Git SHA|SHA does not match census/,
      label,
    );
  }
});

test("exact-SHA deployment listing uses a bounded v7 SHA census without detail reads", async () => {
  const spec = activeStateSpec();
  const requests = [];
  const client = new VercelStateClient({
    token: "active-proof-token-never-output",
    teamId: "team_active123",
    fetchImplementation: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          deployments: [
            {
              uid: "dpl_second123",
              projectId: spec.projects.app.projectId,
              // Listing metadata is optional and must not make an unrelated
              // malformed field turn into a detail-read amplification path.
              meta: "ignored-summary-metadata",
            },
            {
              id: "dpl_first123",
              projectId: spec.projects.app.projectId,
            },
          ],
          pagination: { next: null },
        }),
      };
    },
  });
  assert.deepEqual(
    await client.listExactShaDeploymentIds({
      projectId: spec.projects.app.projectId,
      deploySha: spec.deploySha,
    }),
    ["dpl_first123", "dpl_second123"],
  );
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.pathname, "/v7/deployments");
  assert.equal(
    request.searchParams.get("projectId"),
    spec.projects.app.projectId,
  );
  assert.equal(request.searchParams.get("sha"), spec.deploySha);
  assert.equal(request.searchParams.get("limit"), "3");
  assert.equal(request.searchParams.has("meta-githubCommitSha"), false);
  assert.equal(request.searchParams.has("target"), false);
  assert.equal(request.searchParams.has("until"), false);
  assert.equal(request.searchParams.get("teamId"), "team_active123");
  assert.doesNotMatch(
    requests.map(String).join("\n"),
    /active-proof-token-never-output/,
  );

  const malformed = new VercelStateClient({
    token: "test-token",
    teamId: "team_active123",
    fetchImplementation: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deployments: [], pagination: {} }),
    }),
  });
  await assert.rejects(
    () =>
      malformed.listExactShaDeploymentIds({
        projectId: spec.projects.app.projectId,
        deploySha: spec.deploySha,
      }),
    /list is malformed/,
  );
});

test("exact-SHA deployment listing rejects malformed, duplicate, and over-bound census results", async () => {
  const spec = activeStateSpec();
  const expectation = {
    projectId: spec.projects.app.projectId,
    deploySha: spec.deploySha,
  };
  const candidate = (id) => ({
    id,
    projectId: spec.projects.app.projectId,
  });
  const clientFor = (response) =>
    new VercelStateClient({
      token: "test-token",
      teamId: "team_active123",
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        json: async () => response,
      }),
    });

  for (const [response, message] of [
    [{ deployments: [], pagination: {} }, /deployment list is malformed/],
    [
      { deployments: [], pagination: { next: "123" } },
      /census exceeded its bounded limit/,
    ],
    [
      {
        deployments: [
          candidate("dpl_one123"),
          candidate("dpl_two123"),
          candidate("dpl_three123"),
        ],
        pagination: { next: null },
      },
      /census exceeded its bounded limit/,
    ],
    [
      {
        deployments: [
          candidate("dpl_duplicate123"),
          candidate("dpl_duplicate123"),
        ],
        pagination: { next: null },
      },
      /list is ambiguous/,
    ],
    [
      {
        deployments: [{ id: "dpl_wrongproject123", projectId: "prj_wrong123" }],
        pagination: { next: null },
      },
      /list is ambiguous/,
    ],
  ]) {
    await assert.rejects(
      () =>
        clientFor(structuredClone(response)).listExactShaDeploymentIds(
          expectation,
        ),
      message,
    );
  }
});

test("active deployment capture rejects a changing paginated set and otherwise emits a pure proof", async () => {
  const spec = activeStateSpec();
  const responses = Object.fromEntries(
    Object.keys(spec.projects).map((logicalTarget) => [
      spec.projects[logicalTarget].deploymentId,
      activeDeploymentResponse(spec, logicalTarget),
    ]),
  );
  const listCalls = new Map();
  const client = {
    async listExactShaDeploymentIds({ projectId, deploySha }) {
      assert.equal(deploySha, spec.deploySha);
      const logicalTarget = Object.keys(spec.projects).find(
        (target) => spec.projects[target].projectId === projectId,
      );
      listCalls.set(logicalTarget, (listCalls.get(logicalTarget) ?? 0) + 1);
      return [spec.projects[logicalTarget].deploymentId];
    },
    async inspectDeployment(deploymentId) {
      return responses[deploymentId];
    },
    async canonicalLegacyV2State(expected) {
      assert.deepEqual(expected, spec.legacyAppV2);
      return legacyAppV2Proof(spec);
    },
  };
  assert.equal(
    (await captureActiveDeploymentStateProof(client, spec)).outcome,
    "proven",
  );
  assert.deepEqual(Object.fromEntries(listCalls), {
    app: 3,
    governance: 3,
    reserve: 3,
    ui: 3,
  });

  const racingClient = {
    ...client,
    async listExactShaDeploymentIds({ projectId }) {
      const logicalTarget = Object.keys(spec.projects).find(
        (target) => spec.projects[target].projectId === projectId,
      );
      const calls = (listCalls.get(`race-${logicalTarget}`) ?? 0) + 1;
      listCalls.set(`race-${logicalTarget}`, calls);
      return calls === 2 && logicalTarget === "app"
        ? [spec.projects.app.deploymentId, "dpl_concurrent123"]
        : [spec.projects[logicalTarget].deploymentId];
    },
  };
  await assert.rejects(
    () => captureActiveDeploymentStateProof(racingClient, spec),
    /changed during inspection/,
  );
});

test("active deployment capture verifies detail-only Git source SHA fields once", async () => {
  const spec = activeStateSpec();
  const responses = Object.fromEntries(
    Object.keys(spec.projects).map((logicalTarget) => [
      spec.projects[logicalTarget].deploymentId,
      activeDeploymentResponse(spec, logicalTarget),
    ]),
  );
  delete responses[spec.projects.app.deploymentId].meta.githubCommitSha;
  responses[spec.projects.app.deploymentId].gitSource = {
    sha: spec.deploySha,
  };
  delete responses[spec.projects.governance.deploymentId].meta.githubCommitSha;
  responses[spec.projects.governance.deploymentId].gitRepo = {
    sha: spec.deploySha,
  };
  const inspectionCalls = new Map();
  const client = {
    async listExactShaDeploymentIds({ projectId, deploySha }) {
      assert.equal(deploySha, spec.deploySha);
      const logicalTarget = Object.keys(spec.projects).find(
        (target) => spec.projects[target].projectId === projectId,
      );
      return [spec.projects[logicalTarget].deploymentId];
    },
    async inspectDeployment(deploymentId) {
      inspectionCalls.set(
        deploymentId,
        (inspectionCalls.get(deploymentId) ?? 0) + 1,
      );
      return responses[deploymentId];
    },
    async canonicalLegacyV2State() {
      return legacyAppV2Proof(spec);
    },
  };
  assert.equal(
    (await captureActiveDeploymentStateProof(client, spec)).outcome,
    "proven",
  );
  assert.deepEqual(
    Object.fromEntries(inspectionCalls),
    Object.fromEntries(
      Object.values(spec.projects).map((project) => [project.deploymentId, 1]),
    ),
  );

  const mismatched = structuredClone(responses);
  mismatched[spec.projects.app.deploymentId].gitSource.sha =
    "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  await assert.rejects(
    () =>
      captureActiveDeploymentStateProof(
        {
          ...client,
          inspectDeployment: async (deploymentId) => mismatched[deploymentId],
        },
        spec,
      ),
    /SHA does not match census/,
  );
});

test("legacy App v2 proof ignores source telemetry but rejects identity and mapping drift", async () => {
  const spec = activeStateSpec();
  const legacy = spec.legacyAppV2;
  const clientFor = ({
    source = "git",
    ref = "v2",
    firstDeployment = legacy.deployment,
    race = false,
  } = {}) => {
    let aliasReads = 0;
    return new VercelStateClient({
      token: "legacy-token-never-output",
      teamId: "team_active123",
      fetchImplementation: async (url) => {
        let body;
        if (url.pathname === "/v4/aliases/v2-app.mento.org") {
          aliasReads += 1;
          body = {
            alias: legacy.alias,
            deploymentId:
              race && aliasReads === 2
                ? "dpl_legacyconcurrent"
                : firstDeployment,
            projectId: legacy.projectId,
          };
        } else if (url.pathname === `/v13/deployments/${legacy.deployment}`) {
          body = {
            id: legacy.deployment,
            url: legacy.deploymentUrl,
            projectId: legacy.projectId,
            name: legacy.projectName,
            readyState: "READY",
            target: "production",
            customEnvironment: null,
            source,
            meta: {
              githubCommitOrg: "mento-protocol",
              githubCommitRepo: "frontend-monorepo",
              githubCommitRef: ref,
              githubCommitSha: legacy.git.sha,
              secretMetadata: "legacy-secret-never-output",
            },
          };
        } else if (
          url.pathname === `/v2/deployments/${legacy.deployment}/aliases`
        ) {
          body = { aliases: [{ alias: legacy.alias }] };
        }
        return {
          ok: body !== undefined,
          status: body === undefined ? 404 : 200,
          json: async () => body,
        };
      },
    });
  };

  for (const source of [undefined, "git", "cli", "redeploy"]) {
    const result = await clientFor({ source }).canonicalLegacyV2State(legacy);
    assert.deepEqual(result, legacyAppV2Proof(spec));
    assert.doesNotMatch(JSON.stringify(result), /legacy-secret-never-output/);
  }

  const wrongAlias = { ...legacy, alias: "app.mento.org" };
  await assert.rejects(
    () => clientFor().canonicalLegacyV2State(wrongAlias),
    /expectation is malformed/,
  );
  await assert.rejects(
    () => clientFor({ ref: "main" }).canonicalLegacyV2State(legacy),
    /Unexpected deployment Git ref/,
  );
  await assert.rejects(
    () =>
      clientFor({
        firstDeployment: "dpl_legacywrong",
      }).canonicalLegacyV2State(legacy),
    /mapping does not match/,
  );
  await assert.rejects(
    () => clientFor({ race: true }).canonicalLegacyV2State(legacy),
    /changed during inspection/,
  );
});

test("active-proof CLI reads credentials only from env and writes a private proven artifact", async (t) => {
  const directory = privateTestDirectory(t);
  const spec = activeStateSpec();
  const specPath = join(directory, "active-spec.json");
  const outputPath = join(directory, "active-proof.json");
  writeFileSync(specPath, JSON.stringify(spec), { mode: 0o600 });
  const responses = Object.fromEntries(
    Object.keys(spec.projects).map((logicalTarget) => [
      spec.projects[logicalTarget].deploymentId,
      activeDeploymentResponse(spec, logicalTarget),
    ]),
  );
  let stdout = "";
  await runCli({
    argv: ["active-proof", "--spec", specPath, "--output", outputPath],
    env: {
      RUNNER_TEMP: directory,
      VERCEL_ORG_ID: "team_active123",
      VERCEL_TOKEN: "active-cli-token-never-output",
    },
    stdout: { write: (value) => (stdout += value) },
    clientFactory: ({ token, teamId }) => {
      assert.equal(token, "active-cli-token-never-output");
      assert.equal(teamId, "team_active123");
      return {
        listExactShaDeploymentIds: async ({ projectId }) => {
          const project = Object.values(spec.projects).find(
            (entry) => entry.projectId === projectId,
          );
          return [project.deploymentId];
        },
        inspectDeployment: async (deploymentId) => responses[deploymentId],
        canonicalLegacyV2State: async () => legacyAppV2Proof(spec),
      };
    },
  });
  const proof = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(proof.outcome, "proven");
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(stdout, "Canonical active deployment state proof written\n");
  assert.doesNotMatch(
    `${stdout}${JSON.stringify(proof)}`,
    /active-cli-token-never-output/,
  );

  const secondOutput = join(directory, "direct-write.json");
  writeActiveDeploymentStateProof(secondOutput, proof, {
    runnerTemp: directory,
  });
  assert.equal(statSync(secondOutput).mode & 0o777, 0o600);
});

test("active-proof CLI writes canonical duplicate evidence before failing unproven", async (t) => {
  const directory = privateTestDirectory(t);
  const spec = activeStateSpec();
  const specPath = join(directory, "active-spec.json");
  const outputPath = join(directory, "unproven-proof.json");
  writeFileSync(specPath, JSON.stringify(spec), { mode: 0o600 });
  const duplicateId = "dpl_governancenative999";
  const responses = Object.fromEntries(
    Object.keys(spec.projects).map((logicalTarget) => [
      spec.projects[logicalTarget].deploymentId,
      activeDeploymentResponse(spec, logicalTarget),
    ]),
  );
  responses[duplicateId] = activeDeploymentResponse(spec, "governance", {
    deploymentId: duplicateId,
    deploymentUrl: "https://governance-native-duplicate.vercel.app",
    source: "git",
    meta: {
      protectionBypass: "raw-secret-never-output",
    },
  });
  let stdout = "";
  await assert.rejects(
    () =>
      runCli({
        argv: ["active-proof", "--spec", specPath, "--output", outputPath],
        env: {
          RUNNER_TEMP: directory,
          VERCEL_ORG_ID: "team_active123",
          VERCEL_TOKEN: "unproven-cli-token-never-output",
        },
        stdout: { write: (value) => (stdout += value) },
        clientFactory: () => ({
          listExactShaDeploymentIds: async ({ projectId }) => {
            const logicalTarget = Object.keys(spec.projects).find(
              (target) => spec.projects[target].projectId === projectId,
            );
            return logicalTarget === "governance"
              ? [spec.projects.governance.deploymentId, duplicateId].sort()
              : [spec.projects[logicalTarget].deploymentId];
          },
          inspectDeployment: async (deploymentId) => responses[deploymentId],
          canonicalLegacyV2State: async () => legacyAppV2Proof(spec),
        }),
      }),
    /unproven/,
  );
  const proofText = readFileSync(outputPath, "utf8");
  const proof = JSON.parse(proofText);
  assert.equal(proof.outcome, "unproven");
  assert.deepEqual(proof.projects.governance.ids.manualDuplicates, [
    duplicateId,
  ]);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(stdout, "");
  assert.doesNotMatch(
    proofText,
    /raw-secret-never-output|protectionBypass|unproven-cli-token-never-output/,
  );
  assert.equal(
    renderCliFailure(
      new Error("unproven-cli-token-never-output raw-secret-never-output"),
    ),
    "Vercel deployment state failed category=state-validation-failed\n",
  );
  assert.equal(
    renderCliFailure(new Error("Active deployment state is unproven")),
    "Vercel deployment state failed category=active-census-unproven\n",
  );
  const transport = new Error("active-proof-token-never-output");
  transport.code = "VERCEL_API_READ_TRANSPORT";
  assert.equal(
    renderCliFailure(transport),
    "Vercel deployment state failed category=provider-read-transport\n",
  );
});
