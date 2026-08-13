import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import { planMainDeployments } from "./vercel-main-plan.mjs";
import {
  VERCEL_DEPLOYMENT_CENSUS_PROOF_SCHEMA,
  VERCEL_DEPLOYMENT_PAGES_SCHEMA,
  normalizeVercelDeploymentPages,
  runCli,
} from "./vercel-cost-deployment-census.mjs";

const START = "2026-07-01T00:00:00.000Z";
const END = "2026-07-08T00:00:00.000Z";
const START_MS = Date.parse(START);
const END_MS = Date.parse(END);
const TEAM_ID = "team_mento123";
const PROJECT_IDS = Object.freeze({
  app: "prj_app123",
  governance: "prj_governance123",
  reserve: "prj_reserve123",
  ui: "prj_ui123",
});
const SHA = Object.freeze({
  appPreview: "1000000000000000000000000000000000000001",
  appLegacy: "1000000000000000000000000000000000000002",
  appUnknown: "1000000000000000000000000000000000000003",
  governanceMain: "dddddddddddddddddddddddddddddddddddddddd",
  reservePreview: "1000000000000000000000000000000000000004",
  uiManual: "1000000000000000000000000000000000000005",
});
const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);
const scriptPath = new URL(
  "./vercel-cost-deployment-census.mjs",
  import.meta.url,
).pathname;

function releaseManifest() {
  const input = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  const priorSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  for (const target of ["app", "governance", "reserve", "ui"]) {
    for (const state of input.priorStates[target].states) {
      state.git.sha = priorSha;
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
  return createMainReleaseManifest({
    upstreamRunId: "700",
    plan,
    originalPriors,
  });
}

function mainMetadata() {
  const manifest = releaseManifest();
  const intent = createMainCandidateIntent({
    target: "governance",
    deploySha: SHA.governanceMain,
    upstreamRunId: "700",
    originRunId: "800",
    originAttempt: "1",
    originTransactionId: "main-0123456789abcdef0123456789abcdef",
    projectId: PROJECT_IDS.governance,
    releaseManifest: manifest,
  });
  return {
    githubCommitOrg: "mento-protocol",
    githubCommitRepo: "frontend-monorepo",
    githubCommitRef: "main",
    githubCommitSha: SHA.governanceMain,
    ...createMainCandidateVercelMetadata({ intent }),
  };
}

function gitMetadata(sha, ref) {
  return {
    githubCommitOrg: "mento-protocol",
    githubCommitRepo: "frontend-monorepo",
    githubCommitRef: ref,
    githubCommitSha: sha,
  };
}

function deployment({
  uid,
  projectId,
  createdAt,
  readyState,
  url,
  meta,
  target,
  prebuilt,
  ...extra
}) {
  return {
    uid,
    projectId,
    createdAt,
    readyState,
    url,
    ...(meta === undefined ? {} : { meta }),
    ...(target === undefined ? {} : { target }),
    ...(prebuilt === undefined ? {} : { prebuilt }),
    ...extra,
  };
}

function page(requestCursor, deployments, next, prev = null) {
  return {
    requestCursor,
    response: {
      deployments,
      pagination: { count: deployments.length, next, prev },
    },
  };
}

function project(target, pages) {
  return {
    target,
    projectId: PROJECT_IDS[target],
    query: {
      path: "/v7/deployments",
      teamId: TEAM_ID,
      projectId: PROJECT_IDS[target],
      since: START_MS - 1,
      until: END_MS,
      limit: 100,
    },
    pages,
  };
}

function annotation(path, source, evidenceUrl) {
  return { path, source, evidenceUrl };
}

function fixture() {
  const appPreview = deployment({
    uid: "dpl_AppPreview1",
    projectId: PROJECT_IDS.app,
    createdAt: Date.parse("2026-07-07T01:00:00.000Z"),
    readyState: "READY",
    url: "app-preview.vercel.app",
    prebuilt: true,
    meta: {
      ...gitMetadata(SHA.appPreview, "feature/address-book"),
      mentoControllerKey: `vercel-preview:v1:pr:744:target:app:sha:${SHA.appPreview}`,
    },
    officialFieldAddedLater: { ignored: true },
  });
  const appLegacy = deployment({
    uid: "dpl_AppLegacy1",
    projectId: PROJECT_IDS.app,
    createdAt: Date.parse("2026-07-06T01:00:00.000Z"),
    readyState: "CANCELED",
    state: "CANCELED",
    url: "app-v2.vercel.app",
    target: "production",
    prebuilt: false,
    meta: gitMetadata(SHA.appLegacy, "v2"),
  });
  const appCursor = Date.parse("2026-07-05T00:00:00.000Z");
  const appUnknown = deployment({
    uid: "dpl_AppUnknown1",
    projectId: PROJECT_IDS.app,
    createdAt: Date.parse("2026-07-04T01:00:00.000Z"),
    readyState: "READY",
    url: "app-unknown.vercel.app",
    meta: { githubCommitSha: SHA.appUnknown },
  });
  const governanceMain = deployment({
    uid: "dpl_GovernanceMain1",
    projectId: PROJECT_IDS.governance,
    createdAt: Date.parse("2026-07-05T02:00:00.000Z"),
    readyState: "ERROR",
    url: "governance-main.vercel.app",
    target: "production",
    prebuilt: true,
    meta: mainMetadata(),
    customEnvironment: null,
  });
  const reservePreview = deployment({
    uid: "dpl_ReservePreview1",
    projectId: PROJECT_IDS.reserve,
    createdAt: Date.parse("2026-07-03T03:00:00.000Z"),
    readyState: "READY",
    url: "reserve-preview.vercel.app",
    prebuilt: false,
    meta: gitMetadata(SHA.reservePreview, "feature/reserve"),
  });
  const uiManual = deployment({
    uid: "dpl_UiManual1",
    projectId: PROJECT_IDS.ui,
    createdAt: Date.parse("2026-07-02T04:00:00.000Z"),
    readyState: "READY",
    url: "ui-manual.vercel.app",
    target: "production",
    prebuilt: true,
    meta: {
      ...gitMetadata(SHA.uiManual, "main"),
      mentoTransaction: "123-1-ui",
    },
  });
  return {
    schema: VERCEL_DEPLOYMENT_PAGES_SCHEMA,
    window: { startUtc: START, endUtcExclusive: END },
    projects: [
      project("app", [
        page(END_MS, [appPreview, appLegacy], appCursor),
        page(appCursor, [appUnknown], null, END_MS),
      ]),
      project("governance", [page(END_MS, [governanceMain], null)]),
      project("reserve", [page(END_MS, [reservePreview], null)]),
      project("ui", [page(END_MS, [uiManual], null)]),
    ],
    annotations: {
      dpl_AppPreview1: annotation(
        "preview",
        "github-actions-prebuilt",
        "https://app-preview.vercel.app/",
      ),
      dpl_AppLegacy1: annotation(
        "legacy-v2",
        "vercel-native",
        "https://app-v2.vercel.app/",
      ),
      dpl_AppUnknown1: annotation(
        "unknown",
        "unknown",
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123",
      ),
      dpl_GovernanceMain1: annotation(
        "main",
        "github-actions-prebuilt",
        "https://governance-main.vercel.app/",
      ),
      dpl_ReservePreview1: annotation(
        "preview",
        "vercel-native",
        "https://reserve-preview.vercel.app/",
      ),
      dpl_UiManual1: annotation(
        "main",
        "manual",
        "https://ui-manual.vercel.app/",
      ),
    },
  };
}

function normalize(value = fixture(), indentation) {
  return normalizeVercelDeploymentPages(
    JSON.stringify(value, null, indentation),
  );
}

function findDeployment(value, uid) {
  for (const projectValue of value.projects) {
    for (const pageValue of projectValue.pages) {
      const result = pageValue.response.deployments.find(
        (candidate) => candidate.uid === uid,
      );
      if (result) return result;
    }
  }
  throw new Error(`missing test deployment ${uid}`);
}

function appendLowerPaddingDeployment(value, overrides = {}) {
  const projectValue = value.projects.find((entry) => entry.target === "ui");
  const pageValue = projectValue.pages.at(-1);
  const row = deployment({
    uid: "dpl_UiLowerPad1",
    projectId: PROJECT_IDS.ui,
    createdAt: START_MS - 1,
    readyState: "READY",
    url: "ui-lower-pad.vercel.app",
    ...overrides,
  });
  pageValue.response.deployments.push(row);
  pageValue.response.pagination.count += 1;
  return row;
}

function cliPaths(prefix = "vercel-census-") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const input = join(directory, "pages.json");
  const output = join(directory, "census.jsonl");
  const proof = join(directory, "proof.json");
  writeFileSync(input, JSON.stringify(fixture()), { mode: 0o600 });
  return { directory, input, output, proof };
}

function cliArguments({ input, output, proof }) {
  return ["--input", input, "--output", output, "--proof", proof];
}

function assertNoBundleResidue(directory) {
  assert.deepEqual(
    readdirSync(directory).filter((name) => name.startsWith(".vercel-census-")),
    [],
  );
}

test("normalizes two-page raw v7 responses for all four targets", () => {
  const result = normalize();
  assert.equal(result.rows.length, 6);
  assert.equal(
    result.proofObject.schema,
    VERCEL_DEPLOYMENT_CENSUS_PROOF_SCHEMA,
  );
  assert.equal(result.proofObject.sourceSchema, VERCEL_DEPLOYMENT_PAGES_SCHEMA);
  assert.equal(result.proofObject.pageCount, 5);
  assert.equal(result.proofObject.rowCount, 6);
  assert.equal(result.proofObject.annotationCount, 6);
  assert.equal(result.proofObject.deploymentCensusComplete, true);
  assert.deepEqual(
    result.proofObject.projects.map(
      ({ target, pageCount, terminalRequestCursor, terminalNextCursor }) => ({
        target,
        pageCount,
        terminalRequestCursor,
        terminalNextCursor,
      }),
    ),
    [
      {
        target: "app",
        pageCount: 2,
        terminalRequestCursor: Date.parse("2026-07-05T00:00:00.000Z"),
        terminalNextCursor: null,
      },
      {
        target: "governance",
        pageCount: 1,
        terminalRequestCursor: END_MS,
        terminalNextCursor: null,
      },
      {
        target: "reserve",
        pageCount: 1,
        terminalRequestCursor: END_MS,
        terminalNextCursor: null,
      },
      {
        target: "ui",
        pageCount: 1,
        terminalRequestCursor: END_MS,
        terminalNextCursor: null,
      },
    ],
  );
  assert.ok(result.output.endsWith("\n"));
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row), [
      "deploymentId",
      "target",
      "path",
      "source",
      "outcome",
      "sourceSha",
      "createdAtUtc",
      "evidenceUrl",
    ]);
  }
  assert.deepEqual(
    result.rows.map((row) => row.deploymentId),
    [
      "dpl_UiManual1",
      "dpl_ReservePreview1",
      "dpl_AppUnknown1",
      "dpl_GovernanceMain1",
      "dpl_AppLegacy1",
      "dpl_AppPreview1",
    ],
  );
  assert.equal(
    result.rows.find((row) => row.deploymentId === "dpl_AppPreview1").sourceSha,
    SHA.appPreview,
  );
  assert.equal(
    result.rows.find((row) => row.deploymentId === "dpl_UiManual1").sourceSha,
    null,
  );
  assert.equal(
    result.rows.find((row) => row.deploymentId === "dpl_AppUnknown1").sourceSha,
    null,
  );
  assert.equal(
    result.rows.find((row) => row.deploymentId === "dpl_GovernanceMain1")
      .outcome,
    "error",
  );
  assert.equal(
    result.rows.find((row) => row.deploymentId === "dpl_AppLegacy1").outcome,
    "canceled",
  );
});

test("is deterministic while binding ignored raw provider bytes", () => {
  const compact = normalize(fixture());
  const formatted = normalize(fixture(), 2);
  assert.equal(compact.output, formatted.output);
  assert.equal(
    compact.proofObject.outputSha256,
    formatted.proofObject.outputSha256,
  );
  assert.notEqual(
    compact.proofObject.inputSha256,
    formatted.proofObject.inputSha256,
  );

  const changedIgnoredField = fixture();
  findDeployment(
    changedIgnoredField,
    "dpl_AppPreview1",
  ).officialFieldAddedLater = {
    ignored: false,
  };
  const changed = normalize(changedIgnoredField);
  assert.equal(compact.output, changed.output);
  assert.notEqual(
    compact.proofObject.inputSha256,
    changed.proofObject.inputSha256,
  );
});

test("normalizes unordered provider rows and pages with a stable final sort", () => {
  const baseline = normalize();
  const value = fixture();
  const [firstPage, secondPage] = value.projects[0].pages;
  const [appPreview, appLegacy] = firstPage.response.deployments;
  const [appUnknown] = secondPage.response.deployments;
  firstPage.response.deployments = [appUnknown, appLegacy];
  firstPage.response.pagination.count = 2;
  secondPage.response.deployments = [appPreview];
  secondPage.response.pagination.count = 1;

  const reordered = normalize(value);
  assert.equal(reordered.output, baseline.output);
  assert.deepEqual(reordered.rows, baseline.rows);
});

test("breaks equal-timestamp sort ties by deployment ID", () => {
  const value = fixture();
  const preview = findDeployment(value, "dpl_AppPreview1");
  const legacy = findDeployment(value, "dpl_AppLegacy1");
  legacy.createdAt = preview.createdAt;
  const pageValue = value.projects[0].pages[0];
  pageValue.response.deployments = [preview, legacy];

  const ids = normalize(value).rows.map((row) => row.deploymentId);
  assert.ok(ids.indexOf("dpl_AppLegacy1") < ids.indexOf("dpl_AppPreview1"));
});

test("excludes the lower one-millisecond query pad before annotation", () => {
  const baseline = normalize();
  const value = fixture();
  const padding = appendLowerPaddingDeployment(value);
  padding.officialFieldAddedLater = { retainedOnlyInRawEvidence: true };

  const normalized = normalize(value);
  assert.equal(normalized.output, baseline.output);
  assert.equal(normalized.proofObject.rowCount, 6);
  assert.equal(normalized.proofObject.annotationCount, 6);
  assert.notEqual(
    normalized.proofObject.inputSha256,
    baseline.proofObject.inputSha256,
  );
});

test("normalizes a structurally complete empty census as newline-terminated JSONL", () => {
  const value = fixture();
  value.projects = value.projects.map((entry) =>
    project(entry.target, [page(END_MS, [], null)]),
  );
  value.annotations = {};
  const result = normalize(value);
  assert.equal(result.output, "\n");
  assert.equal(result.proofObject.rowCount, 0);
  assert.equal(result.proofObject.deploymentCensusComplete, true);
});

test("accepts omitted optional environment fields on a signed GitHub main row", () => {
  const value = fixture();
  const row = findDeployment(value, "dpl_GovernanceMain1");
  delete row.target;
  delete row.customEnvironment;
  const normalized = normalize(value);
  assert.equal(
    normalized.rows.find(
      (entry) => entry.deploymentId === "dpl_GovernanceMain1",
    ).source,
    "github-actions-prebuilt",
  );
});

test("accepts a bare Vercel hostname beginning with http", () => {
  const value = fixture();
  const row = findDeployment(value, "dpl_AppUnknown1");
  row.url = "http-preview.vercel.app";
  value.annotations.dpl_AppUnknown1.evidenceUrl =
    "https://http-preview.vercel.app/";
  assert.equal(
    normalize(value).rows.find(
      (entry) => entry.deploymentId === "dpl_AppUnknown1",
    ).evidenceUrl,
    "https://http-preview.vercel.app/",
  );
});

test("writes private output and proof through the credential-free CLI", () => {
  const paths = cliPaths();
  const result = spawnSync(
    process.execPath,
    [scriptPath, ...cliArguments(paths)],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Normalized 6 Vercel deployment records/);
  assert.equal(readFileSync(paths.output, "utf8"), normalize().output);
  assert.equal(
    JSON.parse(readFileSync(paths.proof, "utf8")).deploymentCensusComplete,
    true,
  );
  assert.equal(statSync(paths.output).mode & 0o777, 0o600);
  assert.equal(statSync(paths.proof).mode & 0o777, 0o600);
  assert.equal(statSync(paths.output).nlink, 1);
  assert.equal(statSync(paths.proof).nlink, 1);
  assertNoBundleResidue(paths.directory);

  const retry = spawnSync(
    process.execPath,
    [scriptPath, ...cliArguments(paths)],
    { encoding: "utf8" },
  );
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /refusing to overwrite evidence/);
});

for (const [name, hook] of [
  [
    "rolls back both stages when writing the proof stage fails",
    {
      beforeWrite(role) {
        if (role === "proof") throw new Error("injected proof write failure");
      },
    },
  ],
  [
    "rolls back a published output when proof publication fails",
    {
      beforePublish(role) {
        if (role === "proof") {
          throw new Error("injected proof publication failure");
        }
      },
    },
  ],
]) {
  test(name, () => {
    const paths = cliPaths("vercel-census-rollback-");
    assert.throws(() => runCli(cliArguments(paths), hook), /injected proof/);
    assert.equal(existsSync(paths.output), false);
    assert.equal(existsSync(paths.proof), false);
    assertNoBundleResidue(paths.directory);
  });
}

test("preserves a preexisting destination and leaves no staged residue", () => {
  const paths = cliPaths("vercel-census-existing-");
  writeFileSync(paths.proof, "operator evidence\n", { mode: 0o600 });
  assert.throws(
    () => runCli(cliArguments(paths)),
    /proof already exists; refusing to overwrite evidence/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(readFileSync(paths.proof, "utf8"), "operator evidence\n");
  assertNoBundleResidue(paths.directory);
});

test("rolls back its output when a proof destination wins the publish race", () => {
  const paths = cliPaths("vercel-census-publish-race-");
  assert.throws(
    () =>
      runCli(cliArguments(paths), {
        beforePublish(role) {
          if (role === "proof") {
            writeFileSync(paths.proof, "racing operator evidence\n", {
              mode: 0o600,
            });
          }
        },
      }),
    /EEXIST/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(readFileSync(paths.proof, "utf8"), "racing operator evidence\n");
  assertNoBundleResidue(paths.directory);
});

test("rejects a preexisting hardlinked destination without touching it", () => {
  const paths = cliPaths("vercel-census-hardlink-");
  const operatorEvidence = join(paths.directory, "operator-proof.json");
  writeFileSync(operatorEvidence, "operator evidence\n", { mode: 0o600 });
  linkSync(operatorEvidence, paths.proof);
  assert.throws(
    () => runCli(cliArguments(paths)),
    /proof already exists; refusing to overwrite evidence/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(readFileSync(paths.proof, "utf8"), "operator evidence\n");
  assert.equal(statSync(operatorEvidence).nlink, 2);
  assertNoBundleResidue(paths.directory);
});

test("rejects a preexisting symlink destination without touching it", () => {
  const paths = cliPaths("vercel-census-symlink-output-");
  const operatorEvidence = join(paths.directory, "operator-proof.json");
  writeFileSync(operatorEvidence, "operator evidence\n", { mode: 0o600 });
  symlinkSync(operatorEvidence, paths.proof);
  assert.throws(
    () => runCli(cliArguments(paths)),
    /proof already exists; refusing to overwrite evidence/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(readFileSync(paths.proof, "utf8"), "operator evidence\n");
  assertNoBundleResidue(paths.directory);
});

test("requires output and proof to share one canonical real parent", () => {
  const paths = cliPaths("vercel-census-parent-a-");
  const other = mkdtempSync(join(tmpdir(), "vercel-census-parent-b-"));
  paths.proof = join(other, "proof.json");
  assert.throws(
    () => runCli(cliArguments(paths)),
    /must share one canonical real parent/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(existsSync(paths.proof), false);
  assertNoBundleResidue(paths.directory);
  assertNoBundleResidue(other);
});

test("rejects a writable evidence destination parent", () => {
  const paths = cliPaths("vercel-census-writable-parent-");
  chmodSync(paths.directory, 0o770);
  assert.throws(
    () => runCli(cliArguments(paths)),
    /must not be group- or world-writable/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(existsSync(paths.proof), false);
  assertNoBundleResidue(paths.directory);
});

test("rejects a symlinked evidence destination parent", () => {
  const paths = cliPaths("vercel-census-symlink-parent-");
  const realParent = mkdtempSync(join(tmpdir(), "vercel-census-real-parent-"));
  const parentLink = join(paths.directory, "linked-parent");
  symlinkSync(realParent, parentLink);
  paths.output = join(parentLink, "census.jsonl");
  paths.proof = join(parentLink, "proof.json");
  assert.throws(
    () => runCli(cliArguments(paths)),
    /parent must be a real directory, not a symlink/,
  );
  assert.equal(existsSync(paths.output), false);
  assert.equal(existsSync(paths.proof), false);
  assertNoBundleResidue(realParent);
});

test("refuses a symlinked private input", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-census-link-"));
  const source = join(directory, "pages-source.json");
  const input = join(directory, "pages.json");
  writeFileSync(source, JSON.stringify(fixture()), { mode: 0o600 });
  symlinkSync(source, input);
  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--input",
      input,
      "--output",
      join(directory, "census.jsonl"),
      "--proof",
      join(directory, "proof.json"),
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular, non-symlink file/);
});

const failClosedCases = [
  [
    "rejects an extra envelope key",
    (value) => {
      value.unexpected = true;
    },
    /must contain exactly/,
  ],
  [
    "rejects a v6 query",
    (value) => {
      value.projects[0].query.path = "/v6/deployments";
    },
    /must be \/v7\/deployments/,
  ],
  [
    "rejects a mixed project query",
    (value) => {
      value.projects[0].query.projectId = PROJECT_IDS.ui;
    },
    /projectId conflicts/,
  ],
  [
    "rejects a query that does not cover the exact window",
    (value) => {
      value.projects[0].query.since = START_MS;
    },
    /since=startMs-1/,
  ],
  [
    "rejects a mixed team query",
    (value) => {
      value.projects[0].query.teamId = "team_other123";
    },
    /same Vercel team ID/,
  ],
  [
    "rejects a missing logical target",
    (value) => {
      value.projects[3].target = "reserve";
    },
    /each logical target once/,
  ],
  [
    "rejects a cursor discontinuity",
    (value) => {
      value.projects[0].pages[1].requestCursor -= 1;
    },
    /breaks the cursor chain/,
  ],
  [
    "rejects a repeated cursor",
    (value) => {
      const first = value.projects[0].pages[0];
      first.response.pagination.next = first.requestCursor;
      value.projects[0].pages[1].requestCursor = first.requestCursor;
    },
    /pagination.next is invalid|repeats an earlier cursor/,
  ],
  [
    "rejects a missing terminal page",
    (value) => {
      value.projects[1].pages[0].response.pagination.next = Date.parse(
        "2026-07-04T00:00:00.000Z",
      );
    },
    /missing its terminal next:null page/,
  ],
  [
    "rejects too many pages",
    (value) => {
      value.projects[1].pages = Array.from({ length: 101 }, () =>
        structuredClone(value.projects[1].pages[0]),
      );
    },
    /must contain 1-100 pages/,
  ],
  [
    "rejects a pagination count mismatch",
    (value) => {
      value.projects[1].pages[0].response.pagination.count += 1;
    },
    /count must equal deployments.length/,
  ],
  [
    "rejects duplicate deployment IDs across projects",
    (value) => {
      const firstPage = value.projects[0].pages[0];
      firstPage.response.deployments.push(
        structuredClone(firstPage.response.deployments[1]),
      );
      firstPage.response.pagination.count += 1;
    },
    /appears more than once/,
  ],
  [
    "rejects deployment timestamps outside the bounded query",
    (value) => {
      findDeployment(value, "dpl_UiManual1").createdAt = END_MS;
    },
    /outside the bounded query/,
  ],
  [
    "rejects deployment timestamps before the lower query pad",
    (value) => {
      findDeployment(value, "dpl_UiManual1").createdAt = START_MS - 2;
    },
    /outside the bounded query/,
  ],
  [
    "validates the project identity of an excluded padding row",
    (value) => {
      appendLowerPaddingDeployment(value, {
        projectId: PROJECT_IDS.app,
      });
    },
    /projectId conflicts with its project envelope/,
  ],
  [
    "rejects a duplicate deployment ID in an excluded padding row",
    (value) => {
      appendLowerPaddingDeployment(value, {
        uid: "dpl_UiManual1",
      });
    },
    /appears more than once/,
  ],
  [
    "rejects malformed deployment IDs",
    (value) => {
      const row = findDeployment(value, "dpl_UiManual1");
      row.uid = "bad";
    },
    /no exact maintainer annotation|uid.*malformed/,
  ],
  [
    "rejects conflicting id and uid",
    (value) => {
      findDeployment(value, "dpl_UiManual1").id = "dpl_Other";
    },
    /id conflicts with uid/,
  ],
  [
    "rejects conflicting raw project identity",
    (value) => {
      findDeployment(value, "dpl_UiManual1").project = PROJECT_IDS.app;
    },
    /project conflicts with projectId/,
  ],
  [
    "rejects conflicting state and readyState",
    (value) => {
      findDeployment(value, "dpl_AppLegacy1").state = "READY";
    },
    /state conflicts with readyState/,
  ],
  [
    "rejects unknown provider states",
    (value) => {
      findDeployment(value, "dpl_UiManual1").readyState = "SUCCEEDED";
    },
    /readyState is unsupported/,
  ],
  [
    "rejects documented nonterminal provider states",
    (value) => {
      findDeployment(value, "dpl_UiManual1").readyState = "BUILDING";
    },
    /nonterminal/,
  ],
  [
    "rejects missing raw deployment URLs",
    (value) => {
      findDeployment(value, "dpl_UiManual1").url = null;
    },
    /url is required/,
  ],
  [
    "rejects custom-domain raw URLs",
    (value) => {
      findDeployment(value, "dpl_UiManual1").url = "ui.mento.org";
    },
    /root \*\.vercel\.app/,
  ],
  [
    "rejects private dashboard evidence URLs",
    (value) => {
      value.annotations.dpl_UiManual1.evidenceUrl =
        "https://vercel.com/mento/ui/deployments/one";
    },
    /public GitHub run\/deployment or root \*\.vercel\.app/,
  ],
  [
    "rejects a Vercel evidence URL that conflicts with the raw deployment URL",
    (value) => {
      value.annotations.dpl_UiManual1.evidenceUrl = "https://other.vercel.app/";
    },
    /evidence URL conflicts with raw url/,
  ],
  [
    "rejects missing annotations",
    (value) => {
      delete value.annotations.dpl_UiManual1;
    },
    /no exact maintainer annotation/,
  ],
  [
    "rejects surplus annotations",
    (value) => {
      value.annotations.dpl_Extra = annotation(
        "unknown",
        "unknown",
        "https://extra.vercel.app/",
      );
    },
    /must match the deployment census exactly/,
  ],
  [
    "rejects unsupported annotation path",
    (value) => {
      value.annotations.dpl_UiManual1.path = "production";
    },
    /annotation.path is unsupported/,
  ],
  [
    "rejects unsupported annotation source",
    (value) => {
      value.annotations.dpl_UiManual1.source = "cli";
    },
    /annotation.source is unsupported/,
  ],
  [
    "rejects malformed Git SHAs",
    (value) => {
      findDeployment(value, "dpl_ReservePreview1").meta.githubCommitSha = "ABC";
    },
    /githubCommitSha is malformed/,
  ],
  [
    "rejects conflicting Git SHA fields",
    (value) => {
      findDeployment(value, "dpl_ReservePreview1").gitSource = {
        sha: SHA.appPreview,
      };
    },
    /conflicting Git SHAs/,
  ],
  [
    "rejects conflicting partial Git SHA fields",
    (value) => {
      const row = findDeployment(value, "dpl_AppUnknown1");
      row.gitSource = { sha: SHA.uiManual };
    },
    /conflicting Git SHAs/,
  ],
  [
    "rejects incomplete Git identity",
    (value) => {
      delete findDeployment(value, "dpl_ReservePreview1").meta.githubCommitRepo;
    },
    /lacks a complete in-scope Git identity/,
  ],
  [
    "rejects out-of-scope Git identity",
    (value) => {
      findDeployment(value, "dpl_ReservePreview1").meta.githubCommitOrg =
        "someone-else";
    },
    /lacks a complete in-scope Git identity/,
  ],
  [
    "rejects a preview controller signature for another target",
    (value) => {
      findDeployment(value, "dpl_AppPreview1").meta.mentoControllerKey =
        `vercel-preview:v1:pr:744:target:ui:sha:${SHA.appPreview}`;
    },
    /preview signature conflicts/,
  ],
  [
    "rejects a preview annotation with a production raw environment",
    (value) => {
      findDeployment(value, "dpl_AppPreview1").target = "production";
    },
    /preview environment conflicts/,
  ],
  [
    "rejects an incomplete main candidate signature",
    (value) => {
      delete findDeployment(value, "dpl_GovernanceMain1").meta
        .mentoStableIntentDigest;
    },
    /main signature is malformed/,
  ],
  [
    "rejects a GitHub main row in the wrong raw environment",
    (value) => {
      findDeployment(value, "dpl_GovernanceMain1").target = "preview";
    },
    /main environment conflicts/,
  ],
  [
    "rejects malformed raw custom environments",
    (value) => {
      findDeployment(value, "dpl_AppUnknown1").customEnvironment = "v3";
    },
    /customEnvironment must be an object/,
  ],
  [
    "rejects Mento metadata annotated as Vercel-native",
    (value) => {
      value.annotations.dpl_AppPreview1.source = "vercel-native";
    },
    /Mento metadata conflicts/,
  ],
  [
    "rejects prebuilt rows annotated as Vercel-native",
    (value) => {
      findDeployment(value, "dpl_ReservePreview1").prebuilt = true;
    },
    /prebuilt conflicts/,
  ],
  [
    "rejects malformed legacy-v2 signatures",
    (value) => {
      findDeployment(value, "dpl_AppLegacy1").meta.githubCommitRef = "main";
    },
    /legacy-v2 signature is malformed/,
  ],
  [
    "rejects conflicting alternate project IDs",
    (value) => {
      findDeployment(value, "dpl_AppUnknown1").project = {
        id: PROJECT_IDS.ui,
      };
    },
    /project conflicts with projectId/,
  ],
];

for (const [name, mutate, expected] of failClosedCases) {
  test(name, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => normalize(value), expected);
  });
}
