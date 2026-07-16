import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPrebuiltOutput,
  assertPrebuiltReadyForUpload,
  assertPulledProject,
  assertSafeVercelArguments,
  assertVercelPullStaging,
  assertVercelInspection,
  buildVercelBuildArguments,
  buildVercelDeploymentLookupUrl,
  buildVercelDeployArguments,
  buildVercelInspectArguments,
  buildVercelPullArguments,
  deployWithAmbiguityRecovery,
  environmentForVercelCli,
  materializeExactGitTree,
  materializeVercelRepoLink,
  parseVercelDeploymentLookup,
  parseVercelDeploymentJson,
  PILOT_TARGET,
  prepareVercelPullStaging,
  queryVercelDeployments,
  smokeUiPreview,
  stageVercelPullForCandidate,
  stageTrustedRuntime,
  trustedPnpmInstallLayout,
  trustedVercelCliPath,
  validateExactSha,
  validateGitBranch,
  validatePilotContract,
  validateSourceCheckout,
  withValidatedPrebuiltUpload,
} from "./vercel-prebuilt-workflow.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYMENT_ID = "m-ui-0123456789abcdef012";
const DEPLOYMENT_URL = "https://ui-pilot-abc.vercel.app";
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD_ENVIRONMENT_SCRIPT = fileURLToPath(
  new URL("./vercel-build-environment.mjs", import.meta.url),
);

function checkUiPreviewEnvironment(projectDirectory) {
  return execFileSync(
    process.execPath,
    [
      BUILD_ENVIRONMENT_SCRIPT,
      "check",
      "--target",
      "ui",
      "--environment",
      "preview",
      "--project-directory",
      projectDirectory,
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: {
        CI: "1",
        NEXT_PUBLIC_VERCEL_ENV: "preview",
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function uploadFixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "vercel-upload-ui-"));
  const vercelOrgId = "team_example";
  const vercelProjectId = "prj_ui";
  const projectState = join(
    repoRoot,
    PILOT_TARGET.expectedRootDirectory,
    ".vercel",
  );
  const outputDirectory = join(projectState, "output");
  mkdirSync(outputDirectory, { recursive: true });
  materializeVercelRepoLink({
    repoRoot,
    expectedRootDirectory: PILOT_TARGET.expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
  writeFileSync(
    join(projectState, "project.json"),
    JSON.stringify({
      orgId: vercelOrgId,
      projectId: vercelProjectId,
      settings: { rootDirectory: PILOT_TARGET.expectedRootDirectory },
    }),
  );
  writeFileSync(
    join(outputDirectory, "config.json"),
    JSON.stringify({ version: 3, deploymentId: DEPLOYMENT_ID }),
  );
  writeFileSync(
    join(outputDirectory, "builds.json"),
    JSON.stringify({ target: "preview", cliVersion: "56.2.0" }),
  );
  mkdirSync(join(outputDirectory, "static", "nested"), { recursive: true });
  writeFileSync(join(outputDirectory, "static", "nested", "asset.js"), "ok");
  writeFileSync(
    `${repoRoot}.provenance.json`,
    JSON.stringify({ commitSha: SHA }),
    { mode: 0o600 },
  );
  return {
    repoRoot,
    projectState,
    outputDirectory,
    options: {
      repoRoot,
      logicalTarget: PILOT_TARGET.logicalTarget,
      expectedRootDirectory: PILOT_TARGET.expectedRootDirectory,
      vercelOrgId,
      vercelProjectId,
      deploymentId: DEPLOYMENT_ID,
      commitSha: SHA,
    },
    cleanup() {
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(`${repoRoot}.provenance.json`, { force: true });
    },
  };
}
const CONTROLLER_KEY = `vercel-preview:v1:pr:519:target:ui:sha:${SHA}`;
const LOOKUP_STARTED_AT = 1_720_000_000_000;
const LOOKUP_NOW = LOOKUP_STARTED_AT + 60_000;

function pilotContract(overrides = {}) {
  return {
    ...PILOT_TARGET,
    deployPermitted: true,
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    vercelOrgId: "team_example",
    vercelProjectId: "prj_example",
    idempotencyKey: `vercel-pilot:v1:ui:sha:${SHA}:run:1:attempt:1`,
    pullRequestNumber: "",
    provenance: "manual-pilot",
    workflowRunUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/1",
    githubRepository: "mento-protocol/frontend-monorepo",
    githubRef: "refs/heads/main",
    githubWorkflowRef:
      "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main",
    ...overrides,
  };
}

function pulledStagingFixture() {
  const runnerTemp = mkdtempSync(join(tmpdir(), "vercel-pull-runner-"));
  const stagingRoot = join(runnerTemp, "mento-vercel-pull-staging");
  const candidateRoot = join(runnerTemp, "mento-vercel-candidate-source");
  const vercelOrgId = "team_example";
  const vercelProjectId = "prj_ui";
  const expectedRootDirectory = PILOT_TARGET.expectedRootDirectory;
  prepareVercelPullStaging({
    runnerTemp,
    stagingRoot,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
  });
  const appState = join(stagingRoot, expectedRootDirectory, ".vercel");
  mkdirSync(appState, { mode: 0o700 });
  writeFileSync(
    join(appState, "project.json"),
    JSON.stringify({ settings: { rootDirectory: expectedRootDirectory } }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(appState, ".env.preview.local"),
    "NEXT_PUBLIC_STORAGE_URL=https://storage.example\n",
    { mode: 0o600 },
  );
  return {
    runnerTemp,
    stagingRoot,
    candidateRoot,
    appState,
    expectedRootDirectory,
    vercelOrgId,
    vercelProjectId,
    options: {
      runnerTemp,
      stagingRoot,
      expectedRootDirectory,
      vercelOrgId,
      vercelProjectId,
    },
    cleanup() {
      rmSync(runnerTemp, { force: true, recursive: true });
    },
  };
}

test("pilot contract accepts only the UI preview mapping and exact SHA", () => {
  assert.deepEqual(validatePilotContract(pilotContract()), pilotContract());
  for (const overrides of [
    { logicalTarget: "app" },
    { deploymentMode: "staged-production" },
    { vercelTarget: "production" },
    { commitSha: "main" },
    { gitBranch: "dependabot/npm_and_yarn/example-1.0.0" },
    { deployPermitted: false },
    { githubRepository: "someone/fork" },
    { githubRef: "refs/heads/feature/ui-pilot" },
    {
      githubWorkflowRef:
        "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/feature",
    },
  ]) {
    assert.throws(() => validatePilotContract(pilotContract(overrides)));
  }
});

test("automatic preview contract binds PR, environment, provenance, and exact SHA", () => {
  const automatic = pilotContract({
    githubEnvironment: "preview/ui/pr-519",
    idempotencyKey: `vercel-preview:v1:pr:519:target:ui:sha:${SHA}`,
    pullRequestNumber: "519",
    provenance: "preview-controller:v1",
    githubWorkflowRef:
      "mento-protocol/frontend-monorepo/.github/workflows/vercel-preview-worker.yml@refs/heads/main",
  });
  assert.deepEqual(validatePilotContract(automatic), automatic);
  for (const overrides of [
    { githubEnvironment: "preview/ui/pr-520" },
    { idempotencyKey: `vercel-preview:v1:pr:520:target:ui:sha:${SHA}` },
    { pullRequestNumber: "520" },
    { provenance: "manual-pilot" },
    {
      githubWorkflowRef:
        "mento-protocol/frontend-monorepo/.github/workflows/vercel-prebuilt-pilot.yml@refs/heads/main",
    },
  ]) {
    assert.throws(() => validatePilotContract({ ...automatic, ...overrides }));
  }
});

test("branch and SHA validation rejects mutable, option-like, and control input", () => {
  assert.equal(validateExactSha(SHA), SHA);
  assert.equal(validateGitBranch("feature/ui-pilot"), "feature/ui-pilot");
  for (const branch of ["-main", " main", "main\nother", "refs/heads/main"]) {
    assert.throws(() => validateGitBranch(branch));
  }
  for (const sha of ["main", SHA.toUpperCase(), SHA.slice(1), "0".repeat(64)]) {
    assert.throws(() => validateExactSha(sha));
  }
});

test("source validation proves exact HEAD is reachable from the same-repo branch", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-source-"));
  const remote = join(directory, "remote.git");
  const source = join(directory, "source");
  try {
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", source]);
    execFileSync("git", [
      "-C",
      source,
      "config",
      "user.email",
      "ci@example.com",
    ]);
    execFileSync("git", ["-C", source, "config", "user.name", "CI"]);
    writeFileSync(join(source, "fixture.txt"), "main\n");
    execFileSync("git", ["-C", source, "add", "fixture.txt"]);
    execFileSync("git", ["-C", source, "commit", "-m", "fixture"]);
    execFileSync("git", ["-C", source, "remote", "add", "origin", remote]);
    execFileSync("git", ["-C", source, "push", "origin", "main"]);
    const sha = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    assert.deepEqual(
      validateSourceCheckout({
        repoRoot: source,
        commitSha: sha,
        gitBranch: "main",
        githubRepository: remote,
      }),
      { commitSha: sha, gitBranch: "main" },
    );
    const mismatchedSha = `${sha.startsWith("0") ? "1" : "0"}${sha.slice(1)}`;
    assert.throws(
      () =>
        validateSourceCheckout({
          repoRoot: source,
          commitSha: mismatchedSha,
          gitBranch: "main",
          githubRepository: remote,
        }),
      /HEAD does not match/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("source validation rejects a commit not reachable from the supplied branch", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-source-"));
  const remote = join(directory, "remote.git");
  const source = join(directory, "source");
  try {
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "main", source]);
    execFileSync("git", [
      "-C",
      source,
      "config",
      "user.email",
      "ci@example.com",
    ]);
    execFileSync("git", ["-C", source, "config", "user.name", "CI"]);
    writeFileSync(join(source, "fixture.txt"), "main\n");
    execFileSync("git", ["-C", source, "add", "fixture.txt"]);
    execFileSync("git", ["-C", source, "commit", "-m", "main"]);
    execFileSync("git", ["-C", source, "remote", "add", "origin", remote]);
    execFileSync("git", ["-C", source, "push", "origin", "main"]);
    execFileSync("git", ["-C", source, "switch", "--orphan", "other"]);
    writeFileSync(join(source, "fixture.txt"), "other\n");
    execFileSync("git", ["-C", source, "add", "fixture.txt"]);
    execFileSync("git", ["-C", source, "commit", "-m", "other"]);
    const sha = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    assert.throws(
      () =>
        validateSourceCheckout({
          repoRoot: source,
          commitSha: sha,
          gitBranch: "main",
          githubRepository: remote,
        }),
      /not reachable/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("pinned CLI arguments preserve preview branch and exact commit metadata", () => {
  assert.deepEqual(
    buildVercelPullArguments({
      gitBranch: "feature/ui-pilot",
      projectId: "prj_example",
    }),
    [
      "pull",
      "--yes",
      "--environment",
      "preview",
      "--git-branch",
      "feature/ui-pilot",
      "--project",
      "prj_example",
    ],
  );
  assert.deepEqual(buildVercelBuildArguments({ projectId: "prj_example" }), [
    "build",
    "--yes",
    "--target",
    "preview",
    "--project",
    "prj_example",
  ]);
  const deploy = buildVercelDeployArguments({
    projectId: "prj_example",
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    idempotencyKey: CONTROLLER_KEY,
  });
  assert.deepEqual(deploy, [
    "deploy",
    "--prebuilt",
    "--target",
    "preview",
    "--archive=tgz",
    "--format=json",
    "--yes",
    "--project",
    "prj_example",
    "--meta",
    "githubCommitOrg=mento-protocol",
    "--meta",
    "githubCommitRepo=frontend-monorepo",
    "--meta",
    `githubCommitSha=${SHA}`,
    "--meta",
    "githubCommitRef=feature/ui-pilot",
    "--meta",
    `mentoControllerKey=${CONTROLLER_KEY}`,
  ]);
  assert.doesNotMatch(deploy.join(" "), /githubDeployment=1|--prod|promote/);
  assert.throws(
    () => assertSafeVercelArguments(["deploy", "--meta", "githubDeployment=1"]),
    /Forbidden/,
  );
  assert.throws(
    () => assertSafeVercelArguments(["deploy", "--token=secret"]),
    /environment/,
  );
  assert.doesNotThrow(() =>
    assertSafeVercelArguments([
      "deploy",
      "--meta",
      "githubCommitRef=feature/promote---prod-copy",
    ]),
  );
  assert.deepEqual(
    buildVercelInspectArguments(DEPLOYMENT_URL, "team_example"),
    [
      "inspect",
      DEPLOYMENT_URL,
      "--wait",
      "--timeout",
      "5m",
      "--format=json",
      "--scope",
      "team_example",
    ],
  );
});

test("deploy and inspect JSON retain one immutable URL and Vercel ID", () => {
  const expected = {
    deploymentId: "dpl_Abc123",
    deploymentUrl: DEPLOYMENT_URL,
    readyState: "BUILDING",
    target: "preview",
  };
  assert.deepEqual(
    parseVercelDeploymentJson(
      JSON.stringify({
        status: "ok",
        deployment: {
          id: expected.deploymentId,
          url: expected.deploymentUrl,
          readyState: expected.readyState,
          target: expected.target,
        },
      }),
    ),
    expected,
  );
  assert.deepEqual(
    parseVercelDeploymentJson(
      JSON.stringify({
        id: expected.deploymentId,
        url: expected.deploymentUrl,
        readyState: expected.readyState,
        target: expected.target,
      }),
    ),
    expected,
  );
  assert.equal(
    assertVercelInspection(
      JSON.stringify({
        id: expected.deploymentId,
        url: expected.deploymentUrl,
        readyState: "READY",
        target: "preview",
      }),
      expected,
    ).readyState,
    "READY",
  );
  assert.throws(
    () =>
      assertVercelInspection(
        JSON.stringify({
          id: expected.deploymentId,
          url: expected.deploymentUrl,
          readyState: "ERROR",
          target: "preview",
        }),
        expected,
      ),
    /does not match/,
  );
});

function lookupDeployment(overrides = {}) {
  return {
    uid: "dpl_Abc123",
    url: DEPLOYMENT_URL,
    projectId: "prj_example",
    createdAt: String(LOOKUP_STARTED_AT + 30_000),
    readyState: "BUILDING",
    target: null,
    meta: {
      githubCommitOrg: "mento-protocol",
      githubCommitRepo: "frontend-monorepo",
      githubCommitSha: SHA,
      githubCommitRef: "feature/ui-pilot",
      mentoControllerKey: CONTROLLER_KEY,
    },
    ...overrides,
  };
}

function lookupOptions() {
  return {
    projectId: "prj_example",
    vercelOrgId: "team_example",
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    idempotencyKey: CONTROLLER_KEY,
    startedAtMs: LOOKUP_STARTED_AT,
    nowMs: LOOKUP_NOW,
  };
}

test("ambiguous upload lookup uses supported filters and validates the exact metadata tuple client-side", () => {
  const url = new URL(buildVercelDeploymentLookupUrl(lookupOptions()));
  assert.equal(url.origin, "https://api.vercel.com");
  assert.equal(url.pathname, "/v7/deployments");
  assert.equal(url.searchParams.get("projectId"), "prj_example");
  assert.equal(url.searchParams.get("teamId"), "team_example");
  assert.equal(url.searchParams.get("target"), "preview");
  assert.equal(url.searchParams.get("branch"), "feature/ui-pilot");
  assert.equal(url.searchParams.get("sha"), SHA);
  assert.equal(url.searchParams.get("limit"), "100");
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "branch",
    "limit",
    "projectId",
    "sha",
    "since",
    "target",
    "teamId",
    "until",
  ]);
  assert.deepEqual(
    parseVercelDeploymentLookup(
      JSON.stringify({
        deployments: [
          ...Array.from({ length: 5 }, (_, index) =>
            lookupDeployment({
              uid: `dpl_Other${index}`,
              url: `ui-other-${index}.vercel.app`,
              meta: {
                ...lookupDeployment().meta,
                mentoControllerKey: `${CONTROLLER_KEY}-other-${index}`,
              },
            }),
          ),
          lookupDeployment(),
        ],
      }),
      lookupOptions(),
    ),
    [
      {
        deploymentId: "dpl_Abc123",
        deploymentUrl: DEPLOYMENT_URL,
        readyState: "BUILDING",
        target: "preview",
      },
    ],
  );
  assert.deepEqual(
    parseVercelDeploymentLookup(
      JSON.stringify({
        deployments: [
          {
            ...lookupDeployment(),
            meta: {
              ...lookupDeployment().meta,
              mentoControllerKey: `${CONTROLLER_KEY}-other`,
            },
          },
        ],
      }),
      lookupOptions(),
    ),
    [],
  );
});

test("deployment lookup retries an exact incomplete row until its immutable URL exists", async () => {
  const incomplete = parseVercelDeploymentLookup(
    JSON.stringify({
      deployments: [lookupDeployment({ url: null })],
    }),
    lookupOptions(),
  )[0];
  assert.deepEqual(incomplete, {
    deploymentId: "dpl_Abc123",
    deploymentUrl: null,
    readyState: "BUILDING",
    target: "preview",
    incomplete: true,
  });

  const complete = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  const result = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      uploadCalls += 1;
      return { status: 1, stdout: "" };
    },
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls < 3 ? [incomplete] : [complete];
    },
    waitForRetry: async () => {},
  });
  assert.deepEqual(result, complete);
  assert.equal(uploadCalls, 1);
  assert.equal(lookupCalls, 3);
});

test("a persistently incomplete exact deployment fails closed without another upload", async () => {
  const [incomplete] = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment({ url: null })] }),
    lookupOptions(),
  );
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return { status: 1, stdout: "" };
      },
      lookup: async () => {
        lookupCalls += 1;
        return [incomplete];
      },
      waitForRetry: async () => {},
    }),
    /remained incomplete or disappeared/,
  );
  assert.equal(uploadCalls, 1);
  assert.equal(lookupCalls, 3);
});

test("complete and incomplete rows for one exact tuple fail closed as duplicates", async () => {
  const matches = parseVercelDeploymentLookup(
    JSON.stringify({
      deployments: [lookupDeployment(), lookupDeployment({ url: null })],
    }),
    lookupOptions(),
  );
  let uploadCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return { status: 1, stdout: "" };
      },
      lookup: async () => matches,
      waitForRetry: async () => {},
    }),
    /Multiple Vercel deployments match one controller key/,
  );
  assert.equal(uploadCalls, 1);
});

test("deployment lookup fails closed rather than silently ignoring another result page", () => {
  for (const pagination of [
    { next: String(LOOKUP_NOW - 1) },
    null,
    "malformed",
    [],
  ]) {
    assert.throws(
      () =>
        parseVercelDeploymentLookup(
          JSON.stringify({
            pagination,
            deployments: [lookupDeployment()],
          }),
          lookupOptions(),
        ),
      /response is malformed/,
    );
  }
});

test("deployment lookup accepts Vercel uid and bounded millisecond timestamps only", () => {
  const expected = {
    deploymentId: "dpl_Abc123",
    deploymentUrl: DEPLOYMENT_URL,
    readyState: "BUILDING",
    target: "preview",
  };
  for (const createdAt of [
    String(LOOKUP_STARTED_AT + 30_000),
    LOOKUP_STARTED_AT + 30_000,
  ]) {
    assert.deepEqual(
      parseVercelDeploymentLookup(
        JSON.stringify({ deployments: [lookupDeployment({ createdAt })] }),
        lookupOptions(),
      ),
      [expected],
    );
  }

  for (const createdAt of [
    "",
    `0${LOOKUP_STARTED_AT + 30_000}`,
    ` ${LOOKUP_STARTED_AT + 30_000}`,
    `${LOOKUP_STARTED_AT + 30_000}.0`,
    "1e12",
    "9007199254740992",
    String(LOOKUP_STARTED_AT - 60_001),
    String(LOOKUP_NOW + 60_001),
    Number.MAX_SAFE_INTEGER + 1,
    null,
    true,
    undefined,
  ]) {
    assert.throws(
      () =>
        parseVercelDeploymentLookup(
          JSON.stringify({ deployments: [lookupDeployment({ createdAt })] }),
          lookupOptions(),
        ),
      /exact upload tuple/,
    );
  }

  assert.throws(
    () =>
      parseVercelDeploymentLookup(
        JSON.stringify({
          deployments: [
            {
              ...lookupDeployment({ uid: undefined }),
              id: "dpl_Abc123",
            },
          ],
        }),
        lookupOptions(),
      ),
    /no valid deployment ID/,
  );
  for (const uid of ["", "dpl_bad-id", 123, null]) {
    assert.throws(
      () =>
        parseVercelDeploymentLookup(
          JSON.stringify({ deployments: [lookupDeployment({ uid })] }),
          lookupOptions(),
        ),
      /no valid deployment ID/,
    );
  }
});

test("credentialed lookup keeps its token out of the bounded request URL", async () => {
  let request;
  const matches = await queryVercelDeployments({
    ...lookupOptions(),
    token: "fixture-token",
    fetchImplementation: async (url, options) => {
      request = { url, options };
      return new Response(
        JSON.stringify({ deployments: [lookupDeployment()] }),
      );
    },
  });
  assert.equal(matches.length, 1);
  assert.doesNotMatch(request.url, /fixture-token/);
  assert.equal(request.options.headers.authorization, "Bearer fixture-token");
  assert.ok(request.options.signal instanceof AbortSignal);
});

test("ambiguous upload requery absorbs one delayed eventual match without retrying", async () => {
  const expected = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  const waits = [];
  const result = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      uploadCalls += 1;
      return { status: 1, stdout: "" };
    },
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls === 3 ? [expected] : [];
    },
    waitForRetry: async (milliseconds) => waits.push(milliseconds),
  });
  assert.deepEqual(result, expected);
  assert.equal(uploadCalls, 1);
  assert.equal(lookupCalls, 3);
  assert.deepEqual(waits, [1_000, 1_000]);
});

function successfulUpload(deployment) {
  return {
    status: 0,
    stdout: JSON.stringify({
      id: deployment.deploymentId,
      url: deployment.deploymentUrl,
      readyState: deployment.readyState,
      target: deployment.target,
    }),
  };
}

test("persistent zero-match proof retries once and accepts one stable matching identity", async () => {
  const expected = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  const result = await deployWithAmbiguityRecovery({
    runUpload: async () => {
      uploadCalls += 1;
      return uploadCalls === 1
        ? { status: 1, stdout: "" }
        : successfulUpload(expected);
    },
    lookup: async () => {
      lookupCalls += 1;
      return lookupCalls <= 3 ? [] : [expected];
    },
    waitForRetry: async () => {},
  });
  assert.deepEqual(result, expected);
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("post-retry convergence catches a delayed first-upload identity", async () => {
  const delayedFirst = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  const retry = {
    ...delayedFirst,
    deploymentId: "dpl_Other456",
    deploymentUrl: "https://ui-other-456.vercel.app",
  };
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return uploadCalls === 1
          ? { status: 1, stdout: "" }
          : successfulUpload(retry);
      },
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls <= 3) return [];
        return lookupCalls === 4 ? [retry] : [delayedFirst, retry];
      },
      waitForRetry: async () => {},
    }),
    /multiple deployment identities/,
  );
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("post-retry convergence fails closed on reordered deployment visibility", async () => {
  const first = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  const retry = {
    ...first,
    deploymentId: "dpl_Retry456",
    deploymentUrl: "https://ui-retry-456.vercel.app",
  };
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return uploadCalls === 1
          ? { status: 1, stdout: "" }
          : successfulUpload(retry);
      },
      lookup: async () => {
        lookupCalls += 1;
        if (lookupCalls <= 3) return [];
        return lookupCalls === 5 ? [first] : [retry];
      },
      waitForRetry: async () => {},
    }),
    /multiple deployment identities/,
  );
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("post-retry convergence fails closed when the deployment stays invisible", async () => {
  const retry = parseVercelDeploymentLookup(
    JSON.stringify({ deployments: [lookupDeployment()] }),
    lookupOptions(),
  )[0];
  let uploadCalls = 0;
  let lookupCalls = 0;
  await assert.rejects(
    deployWithAmbiguityRecovery({
      runUpload: async () => {
        uploadCalls += 1;
        return uploadCalls === 1
          ? { status: 1, stdout: "" }
          : successfulUpload(retry);
      },
      lookup: async () => {
        lookupCalls += 1;
        return [];
      },
      waitForRetry: async () => {},
    }),
    /no uniquely matching deployment/,
  );
  assert.equal(uploadCalls, 2);
  assert.equal(lookupCalls, 6);
});

test("Vercel CLI receives the repo link instead of ID variables that override it", () => {
  assert.deepEqual(
    environmentForVercelCli(
      {
        BASH_ENV: "/tmp/candidate-bash-env",
        CI: "1",
        GITHUB_ENV: "/tmp/github-env",
        GITHUB_OUTPUT: "/tmp/github-output",
        GITHUB_PATH: "/tmp/github-path",
        NODE_OPTIONS: "--require=/tmp/candidate.cjs",
        PATH: "/trusted/bin:/usr/bin:/bin",
        RUNNER_TEMP: "/tmp/runner",
        VERCEL_ORG_ID: "team_example",
        VERCEL_PROJECT_ID: "prj_example",
        VERCEL_TOKEN: "fixture-token",
      },
      ["VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "VERCEL_TOKEN"],
    ),
    {
      CI: "1",
      PATH: "/trusted/bin:/usr/bin:/bin",
      VERCEL_TOKEN: "fixture-token",
    },
  );
});

test("Vercel pull staging is a fresh exact runner-temp tree", () => {
  const fixture = pulledStagingFixture();
  try {
    assert.equal(
      assertVercelPullStaging(fixture.options).settings.rootDirectory,
      fixture.expectedRootDirectory,
    );
    assert.equal(lstatSync(fixture.stagingRoot).mode & 0o777, 0o700);
    assert.equal(
      lstatSync(join(fixture.stagingRoot, ".vercel", "repo.json")).mode & 0o777,
      0o600,
    );
    assert.throws(
      () => prepareVercelPullStaging(fixture.options),
      /must be fresh/,
    );
    assert.throws(
      () =>
        prepareVercelPullStaging({
          ...fixture.options,
          stagingRoot: join(fixture.runnerTemp, "candidate-selected"),
        }),
      /expected RUNNER_TEMP child/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("UI preview environment validation reads only trusted pull staging", () => {
  const fixture = pulledStagingFixture();
  try {
    const canonicalProject = join(
      fixture.runnerTemp,
      "source",
      fixture.expectedRootDirectory,
    );
    mkdirSync(canonicalProject, { recursive: true });
    assert.throws(() => checkUiPreviewEnvironment(canonicalProject));

    const stagingProject = join(
      fixture.stagingRoot,
      fixture.expectedRootDirectory,
    );
    const stagingEnvironment = join(
      stagingProject,
      ".vercel",
      ".env.preview.local",
    );
    assert.equal(lstatSync(stagingEnvironment).mode & 0o777, 0o600);
    assert.match(
      checkUiPreviewEnvironment(stagingProject),
      /verified for ui\/preview/,
    );

    const candidateProject = join(
      fixture.candidateRoot,
      fixture.expectedRootDirectory,
    );
    mkdirSync(candidateProject, { recursive: true });
    stageVercelPullForCandidate({
      ...fixture.options,
      candidateRoot: fixture.candidateRoot,
      buildUid: process.getuid(),
      buildGid: process.getgid(),
      runnerUid: process.getuid(),
      runnerGid: process.getgid(),
    });
    const candidateEnvironment = join(
      candidateProject,
      ".vercel",
      ".env.preview.local",
    );
    assert.equal(lstatSync(candidateEnvironment).mode & 0o777, 0o600);
    chmodSync(candidateEnvironment, 0o000);
    if (process.getuid() !== 0) {
      assert.throws(() => checkUiPreviewEnvironment(candidateProject));
    }
  } finally {
    fixture.cleanup();
  }
});

test("Vercel pull staging rejects links, hardlinks, special files, and unsafe state", () => {
  const mutations = [
    {
      name: "repo link symlink",
      mutate: (fixture) => {
        const path = join(fixture.stagingRoot, ".vercel", "repo.json");
        const outside = join(fixture.runnerTemp, "outside-repo.json");
        writeFileSync(outside, "untouched");
        rmSync(path);
        symlinkSync(outside, path);
      },
    },
    {
      name: "app Vercel directory symlink",
      mutate: (fixture) => {
        const outside = join(fixture.runnerTemp, "outside-state");
        mkdirSync(outside);
        rmSync(fixture.appState, { recursive: true });
        symlinkSync(outside, fixture.appState);
      },
    },
    ...["project.json", ".env.preview.local"].map((name) => ({
      name: `${name} symlink`,
      mutate: (fixture) => {
        const path = join(fixture.appState, name);
        const outside = join(fixture.runnerTemp, `outside-${name}`);
        writeFileSync(outside, "untouched");
        rmSync(path);
        symlinkSync(outside, path);
      },
    })),
    {
      name: "hard-linked settings",
      mutate: (fixture) => {
        const environmentPath = join(fixture.appState, ".env.preview.local");
        rmSync(environmentPath);
        linkSync(join(fixture.appState, "project.json"), environmentPath);
      },
    },
    {
      name: "FIFO settings",
      mutate: (fixture) => {
        const environmentPath = join(fixture.appState, ".env.preview.local");
        rmSync(environmentPath);
        execFileSync("mkfifo", [environmentPath]);
      },
    },
    {
      name: "unexpected file",
      mutate: (fixture) =>
        writeFileSync(join(fixture.appState, "candidate.txt"), "unsafe", {
          mode: 0o600,
        }),
    },
    {
      name: "group-writable settings",
      mutate: (fixture) =>
        chmodSync(join(fixture.appState, "project.json"), 0o620),
    },
  ];
  for (const mutation of mutations) {
    const fixture = pulledStagingFixture();
    try {
      mutation.mutate(fixture);
      assert.throws(
        () => assertVercelPullStaging(fixture.options),
        undefined,
        mutation.name,
      );
    } finally {
      fixture.cleanup();
    }
  }

  const ownership = pulledStagingFixture();
  try {
    assert.throws(() =>
      assertVercelPullStaging({
        ...ownership.options,
        expectedUid: process.getuid() + 1,
        expectedGid: process.getgid(),
      }),
    );
  } finally {
    ownership.cleanup();
  }
});

test("candidate Vercel links cannot redirect trusted pulled-state copies", () => {
  const mutations = [
    {
      name: "repo .vercel",
      prepare: ({ candidateRoot, outsideDirectory }) =>
        symlinkSync(outsideDirectory, join(candidateRoot, ".vercel")),
    },
    {
      name: "app .vercel",
      prepare: ({ appRoot, outsideDirectory }) =>
        symlinkSync(outsideDirectory, join(appRoot, ".vercel")),
    },
    ...["project.json", ".env.preview.local"].map((name) => ({
      name,
      prepare: ({ appRoot, sentinelPath }) => {
        const state = join(appRoot, ".vercel");
        mkdirSync(state);
        symlinkSync(sentinelPath, join(state, name));
      },
    })),
  ];
  for (const mutation of mutations) {
    const fixture = pulledStagingFixture();
    try {
      const appRoot = join(
        fixture.candidateRoot,
        fixture.expectedRootDirectory,
      );
      mkdirSync(appRoot, { recursive: true });
      const outsideDirectory = join(fixture.runnerTemp, "trusted-controller");
      const sentinelPath = join(outsideDirectory, "sentinel.txt");
      mkdirSync(outsideDirectory);
      writeFileSync(sentinelPath, "untouched", { mode: 0o600 });
      mutation.prepare({
        candidateRoot: fixture.candidateRoot,
        appRoot,
        outsideDirectory,
        sentinelPath,
      });

      assert.equal(
        stageVercelPullForCandidate({
          ...fixture.options,
          candidateRoot: fixture.candidateRoot,
          buildUid: process.getuid(),
          buildGid: process.getgid(),
          runnerUid: process.getuid(),
          runnerGid: process.getgid(),
        }).settings.rootDirectory,
        fixture.expectedRootDirectory,
        mutation.name,
      );
      assert.equal(readFileSync(sentinelPath, "utf8"), "untouched");
      for (const path of [
        join(fixture.candidateRoot, ".vercel", "repo.json"),
        join(appRoot, ".vercel", "project.json"),
        join(appRoot, ".vercel", ".env.preview.local"),
      ]) {
        assert.equal(lstatSync(path).isFile(), true, mutation.name);
        assert.equal(lstatSync(path).isSymbolicLink(), false, mutation.name);
        assert.equal(lstatSync(path).mode & 0o777, 0o600, mutation.name);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test("candidate staging rejects a source root that escapes RUNNER_TEMP", () => {
  const fixture = pulledStagingFixture();
  const outside = mkdtempSync(join(tmpdir(), "vercel-candidate-outside-"));
  try {
    mkdirSync(join(outside, fixture.expectedRootDirectory), {
      recursive: true,
    });
    symlinkSync(outside, fixture.candidateRoot);
    assert.throws(() =>
      stageVercelPullForCandidate({
        ...fixture.options,
        candidateRoot: fixture.candidateRoot,
        buildUid: process.getuid(),
        buildGid: process.getgid(),
        runnerUid: process.getuid(),
        runnerGid: process.getgid(),
      }),
    );
  } finally {
    rmSync(outside, { force: true, recursive: true });
    fixture.cleanup();
  }
});

test("candidate staging rejects source components with the wrong owner", () => {
  const fixture = pulledStagingFixture();
  try {
    mkdirSync(join(fixture.candidateRoot, fixture.expectedRootDirectory), {
      recursive: true,
    });
    assert.throws(() =>
      stageVercelPullForCandidate({
        ...fixture.options,
        candidateRoot: fixture.candidateRoot,
        buildUid: process.getuid() + 1,
        buildGid: process.getgid(),
        runnerUid: process.getuid(),
        runnerGid: process.getgid(),
      }),
    );
  } finally {
    fixture.cleanup();
  }
});

test("trusted runtime copies writable hosted tools into independent protected files", () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "vercel-runtime-source-"));
  const runnerTemp = mkdtempSync(join(tmpdir(), "vercel-runtime-runner-"));
  const toolsRoot = join(runnerTemp, "mento-vercel-trusted-tools");
  const nodeSource = join(sourceRoot, "node");
  const pnpmSource = join(sourceRoot, "pnpm");
  const nodeContents = "#!/bin/sh\necho node\n";
  const pnpmContents = "#!/bin/sh\necho pnpm\n";
  try {
    chmodSync(sourceRoot, 0o777);
    chmodSync(runnerTemp, 0o711);
    writeFileSync(nodeSource, nodeContents, { mode: 0o777 });
    writeFileSync(pnpmSource, pnpmContents, { mode: 0o777 });

    const staged = stageTrustedRuntime({
      runnerTemp,
      toolsRoot,
      nodeSource,
      pnpmSource,
    });
    const canonicalToolsRoot = join(
      realpathSync(runnerTemp),
      "mento-vercel-trusted-tools",
    );
    assert.deepEqual(staged, {
      binDirectory: join(canonicalToolsRoot, "bin"),
      nodePath: join(canonicalToolsRoot, "bin", "node"),
      pnpmPath: join(canonicalToolsRoot, "bin", "pnpm"),
    });
    for (const path of [canonicalToolsRoot, staged.binDirectory]) {
      const entry = lstatSync(path);
      assert.equal(entry.isDirectory(), true);
      assert.equal(entry.isSymbolicLink(), false);
      assert.equal(entry.uid, process.getuid());
      assert.equal(entry.gid, process.getgid());
      assert.equal(entry.mode & 0o7022, 0);
    }
    for (const path of [staged.nodePath, staged.pnpmPath]) {
      const entry = lstatSync(path);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.isSymbolicLink(), false);
      assert.equal(entry.uid, process.getuid());
      assert.equal(entry.gid, process.getgid());
      assert.equal(entry.mode & 0o7022, 0);
      assert.equal(entry.nlink, 1);
      assert.equal(realpathSync(path), path);
    }

    writeFileSync(nodeSource, "replaced node\n");
    writeFileSync(pnpmSource, "replaced pnpm\n");
    assert.equal(readFileSync(staged.nodePath, "utf8"), nodeContents);
    assert.equal(readFileSync(staged.pnpmPath, "utf8"), pnpmContents);
    assert.throws(
      () =>
        stageTrustedRuntime({
          runnerTemp,
          toolsRoot,
          nodeSource,
          pnpmSource,
        }),
      /destination must be fresh/,
    );

    rmSync(toolsRoot, { force: true, recursive: true });
    symlinkSync(sourceRoot, toolsRoot);
    assert.throws(
      () =>
        stageTrustedRuntime({
          runnerTemp,
          toolsRoot,
          nodeSource,
          pnpmSource,
        }),
      /destination must be fresh/,
    );
    rmSync(toolsRoot, { force: true });
    chmodSync(runnerTemp, 0o777);
    assert.throws(
      () =>
        stageTrustedRuntime({
          runnerTemp,
          toolsRoot,
          nodeSource,
          pnpmSource,
        }),
      /Runner temporary directory is not protected/,
    );
  } finally {
    rmSync(sourceRoot, { force: true, recursive: true });
    rmSync(runnerTemp, { force: true, recursive: true });
  }
});

test("trusted Vercel CLI must be exact-versioned and runner-protected", () => {
  const toolsPath = mkdtempSync(join(tmpdir(), "vercel-tools-"));
  const packagePath = join(toolsPath, "node_modules", "vercel");
  const cliPath = join(packagePath, "dist", "index.js");
  try {
    mkdirSync(join(packagePath, "dist"), { recursive: true });
    writeFileSync(cliPath, "export {};\n");
    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({ version: "56.2.0" }),
    );
    assert.equal(trustedVercelCliPath(toolsPath), realpathSync(cliPath));

    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({ version: "56.2.1" }),
    );
    assert.throws(() => trustedVercelCliPath(toolsPath), /pinned release/);
    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({ version: "56.2.0" }),
    );

    chmodSync(toolsPath, 0o777);
    assert.throws(() => trustedVercelCliPath(toolsPath), /runner-owned/);
  } finally {
    rmSync(toolsPath, { force: true, recursive: true });
  }
});

test(
  "pinned pnpm materializes and executes Vercel 56.2.0 offline in the protected relative layout",
  { timeout: 120_000 },
  () => {
    const fixtureRoot = mkdtempSync(
      join(dirname(REPOSITORY_ROOT), ".vercel-tools-layout-"),
    );
    const controllerRoot = join(fixtureRoot, "controller");
    const toolsRoot = join(fixtureRoot, "trusted-tools");
    const archivePath = join(fixtureRoot, "controller.tar");
    try {
      mkdirSync(controllerRoot, { mode: 0o755 });
      mkdirSync(toolsRoot, { mode: 0o755 });
      execFileSync("git", [
        "-C",
        REPOSITORY_ROOT,
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        "HEAD",
      ]);
      execFileSync("tar", ["-xf", archivePath, "-C", controllerRoot]);

      const layout = trustedPnpmInstallLayout({ controllerRoot, toolsRoot });
      assert.equal(
        resolve(controllerRoot, layout.modulesDir),
        join(toolsRoot, "node_modules"),
      );
      assert.equal(isAbsolute(layout.modulesDir), false);
      assert.equal(layout.virtualStoreDir, join(layout.modulesDir, ".pnpm"));
      assert.equal(
        execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
        "10.24.0",
      );

      execFileSync(
        "pnpm",
        [
          "--dir",
          controllerRoot,
          "--filter",
          "frontend-monorepo",
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          "--modules-dir",
          layout.modulesDir,
          "--package-import-method",
          "copy",
          "--virtual-store-dir",
          layout.virtualStoreDir,
          "--offline",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, CI: "true" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      execFileSync("chmod", ["-R", "a+rX,go-w", toolsRoot]);

      const cliPath = trustedVercelCliPath(toolsRoot);
      const pathFromTools = relative(realpathSync(toolsRoot), cliPath);
      assert.notEqual(pathFromTools, "");
      assert.equal(pathFromTools === "..", false);
      assert.equal(pathFromTools.startsWith(`..${sep}`), false);
      assert.equal(
        execFileSync(process.execPath, [cliPath, "--version"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
        "56.2.0",
      );
      assert.equal(
        JSON.parse(
          readFileSync(resolve(cliPath, "..", "..", "package.json"), "utf8"),
        ).version,
        "56.2.0",
      );
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  },
);

test("raw Git-object materialization bypasses archive and checkout filters", () => {
  const repository = mkdtempSync(join(tmpdir(), "vercel-raw-source-"));
  const runnerTemp = mkdtempSync(join(tmpdir(), "vercel-raw-runner-"));
  const candidate = join(runnerTemp, "mento-vercel-candidate-source");
  const checkoutCandidate = mkdtempSync(
    join(tmpdir(), "vercel-filtered-candidate-"),
  );
  try {
    chmodSync(runnerTemp, 0o700);
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    writeFileSync(
      join(repository, ".gitattributes"),
      [
        "*.txt text eol=crlf ident",
        "ignored.txt export-ignore",
        "substituted.txt export-subst",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repository, "ignored.txt"), "must remain\n");
    writeFileSync(join(repository, "substituted.txt"), "$Format:%H$\n");
    writeFileSync(join(repository, "identity.txt"), "$Id$\n");
    writeFileSync(join(repository, "line-endings.txt"), "one\ntwo\n");
    writeFileSync(join(repository, "executable.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(repository, "executable.sh"), 0o755);
    writeFileSync(join(repository, "plain.txt"), "plain\n");
    chmodSync(join(repository, "plain.txt"), 0o644);
    symlinkSync("ignored.txt", join(repository, "linked.txt"));
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "fixture",
      ],
      { cwd: repository },
    );
    const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();

    const result = materializeExactGitTree({
      runnerTemp,
      sourceRoot: repository,
      candidateRoot: candidate,
      commitSha,
    });
    assert.equal(result.sourceRoot, realpathSync(candidate));
    assert.ok(result.entries >= 8);
    execFileSync(
      "git",
      [
        "checkout-index",
        "--all",
        "--force",
        `--prefix=${checkoutCandidate}${sep}`,
      ],
      { cwd: repository },
    );
    for (const path of [
      "ignored.txt",
      "substituted.txt",
      "identity.txt",
      "line-endings.txt",
    ]) {
      const blob = execFileSync("git", ["cat-file", "blob", `HEAD:${path}`], {
        cwd: repository,
      });
      assert.deepEqual(readFileSync(join(candidate, path)), blob);
    }
    assert.match(
      readFileSync(join(checkoutCandidate, "identity.txt"), "utf8"),
      /^\$Id: [0-9a-f]{40} \$\r\n$/,
    );
    assert.deepEqual(
      readFileSync(join(checkoutCandidate, "line-endings.txt")),
      Buffer.from("one\r\ntwo\r\n"),
    );
    assert.equal(
      lstatSync(join(candidate, "linked.txt")).isSymbolicLink(),
      true,
    );
    assert.equal(readlinkSync(join(candidate, "linked.txt")), "ignored.txt");
    assert.notEqual(
      lstatSync(join(candidate, "executable.sh")).mode & 0o111,
      0,
    );
    assert.equal(lstatSync(join(candidate, "plain.txt")).mode & 0o111, 0);
    assert.throws(
      () => lstatSync(join(candidate, ".git")),
      (error) => error?.code === "ENOENT",
    );
    assert.throws(
      () =>
        materializeExactGitTree({
          runnerTemp,
          sourceRoot: repository,
          candidateRoot: candidate,
          commitSha,
        }),
      /must be fresh/,
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
    rmSync(runnerTemp, { force: true, recursive: true });
    rmSync(checkoutCandidate, { force: true, recursive: true });
  }
});

test("raw Git-object materialization rejects gitlinks before writing", () => {
  const repository = mkdtempSync(join(tmpdir(), "vercel-gitlink-source-"));
  const runnerTemp = mkdtempSync(join(tmpdir(), "vercel-gitlink-runner-"));
  const candidate = join(runnerTemp, "mento-vercel-candidate-source");
  try {
    chmodSync(runnerTemp, 0o700);
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
    writeFileSync(join(repository, "plain.txt"), "plain\n");
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "base",
      ],
      { cwd: repository },
    );
    const baseCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    execFileSync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${baseCommit},vendor`],
      { cwd: repository },
    );
    const tree = execFileSync("git", ["write-tree"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    const gitlinkCommit = execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit-tree",
        tree,
        "-p",
        baseCommit,
        "-m",
        "gitlink",
      ],
      { cwd: repository, encoding: "utf8" },
    ).trim();

    assert.throws(
      () =>
        materializeExactGitTree({
          runnerTemp,
          sourceRoot: repository,
          candidateRoot: candidate,
          commitSha: gitlinkCommit,
        }),
      /unsupported entry/,
    );
    assert.throws(
      () => lstatSync(candidate),
      (error) => error?.code === "ENOENT",
    );
  } finally {
    rmSync(repository, { force: true, recursive: true });
    rmSync(runnerTemp, { force: true, recursive: true });
  }
});

test("candidate execution is UID-isolated and hands upload to runner-owned state", () => {
  const raw = readFileSync(
    new URL("../.github/workflows/_vercel-prebuilt.yml", import.meta.url),
    "utf8",
  );
  assert.match(raw, /\/usr\/bin\/setpriv/g);
  assert.match(raw, /--clear-groups/g);
  assert.match(raw, /--no-new-privs/g);
  assert.match(raw, /\/usr\/bin\/env -i/g);
  assert.match(raw, /\/usr\/bin\/pkill -KILL -u "\$BUILD_UID"/g);
  assert.match(raw, /\/usr\/bin\/pgrep -u "\$BUILD_UID"/g);
  assert.match(raw, /Create immutable runner-owned upload handoff/);
  assert.match(raw, /mento-vercel-upload-source/);
  assert.match(raw, /dest: \$\{\{ runner\.temp \}\}\/mento-pnpm-tools/);
  assert.match(raw, /standalone: true/);
  assert.match(raw, /userdel mento-vercel-build/);
  assert.match(raw, /node_modules\/vercel\/dist\/index\.js/);
  assert.match(raw, /candidate_can_write/);
  for (const protectedPath of [
    "GITHUB_WORKSPACE/controller",
    "RUNNER_TEMP",
    "SOURCE_PATH/.git",
    "SOURCE_PATH/node_modules",
    "SOURCE_PATH/package.json",
    "SOURCE_PATH/pnpm-lock.yaml",
    "PNPM_ACTION_DEST",
    "TRUSTED_VERCEL_TOOLS_PATH",
    "trusted_bin_dir",
    "node_bin",
    "pnpm_bin",
  ]) {
    assert.match(raw, new RegExp(protectedPath.replace("/", "\\/")));
  }
  assert.doesNotMatch(raw, /sudo\s+(?:-[^\s]+\s+)*-u\s+(?:nobody|65534)/);

  const isolationBlock = raw.slice(
    raw.indexOf(
      "- name: Prepare isolated exact-SHA source and protected Vercel CLI",
    ),
    raw.indexOf("- name: Install frozen dependencies"),
  );
  assert.match(
    isolationBlock,
    /"\$pnpm_bin" --dir "\$GITHUB_WORKSPACE\/controller" --filter frontend-monorepo install/,
  );
  assert.match(isolationBlock, /--frozen-lockfile/);
  assert.match(isolationBlock, /--ignore-scripts/);
  assert.match(isolationBlock, /--package-import-method copy/);
  assert.match(
    isolationBlock,
    /\/bin\/chmod -R a\+rX,go-w "\$PNPM_ACTION_DEST"/,
  );
  assert.match(isolationBlock, /NODE_SOURCE_PATH="\$setup_node_bin" \\/);
  assert.match(isolationBlock, /PNPM_SOURCE_PATH="\$setup_pnpm_bin" \\/);
  assert.match(
    isolationBlock,
    /vercel-prebuilt-workflow\.mjs" \\\n\s+stage-runtime/,
  );
  assert.match(
    isolationBlock,
    /Pinned pnpm escaped its action-owned directory/,
  );
  assert.match(
    isolationBlock,
    /Protected pnpm copy does not match the pinned release/,
  );
  assert.match(
    isolationBlock,
    /Protected runtime binary is not an independent runner-owned file/,
  );
  assert.match(
    isolationBlock,
    /Pinned pnpm action directory escaped RUNNER_TEMP/,
  );
  assert.match(isolationBlock, /Protected runtime destination already exists/);
  assert.match(isolationBlock, /trusted-install-modules-dir/);
  assert.match(isolationBlock, /--modules-dir "\$trusted_modules_dir"/);
  const runnerTempHardenIndex = isolationBlock.indexOf(
    '/bin/chmod 0711 "$RUNNER_TEMP"',
  );
  const pnpmActionHardenIndex = isolationBlock.indexOf(
    '/bin/chmod -R a+rX,go-w "$PNPM_ACTION_DEST"',
  );
  const protectedRuntimeCopyIndex = isolationBlock.indexOf("stage-runtime");
  const protectedPathLoopIndex = isolationBlock.indexOf(
    "for protected_path in \\",
  );
  const runnerTempProtectionIndex = isolationBlock.indexOf(
    '"$RUNNER_TEMP" \\',
    protectedPathLoopIndex,
  );
  const trustedPathIndex = isolationBlock.indexOf(
    `printf '%s\\n' "$trusted_bin_dir" >> "$GITHUB_PATH"`,
  );
  const materializeIndex = isolationBlock.indexOf("materialize-source");
  assert.notEqual(runnerTempHardenIndex, -1);
  assert.ok(pnpmActionHardenIndex > runnerTempHardenIndex);
  assert.ok(protectedRuntimeCopyIndex > pnpmActionHardenIndex);
  assert.ok(protectedPathLoopIndex > protectedRuntimeCopyIndex);
  assert.ok(runnerTempProtectionIndex > protectedPathLoopIndex);
  assert.ok(trustedPathIndex > runnerTempProtectionIndex);
  assert.ok(materializeIndex > trustedPathIndex);
  assert.match(
    isolationBlock,
    /--virtual-store-dir "\$trusted_modules_dir\/\.pnpm"/,
  );
  assert.match(isolationBlock, /"\$node_bin" "\$vercel_cli" --version/);
  assert.doesNotMatch(
    isolationBlock,
    /--modules-dir "\$TRUSTED_VERCEL_TOOLS_PATH/,
  );
  assert.doesNotMatch(isolationBlock, /--no-frozen-lockfile/);
  assert.doesNotMatch(isolationBlock, /"dependencies":\{"vercel":"56\.2\.0"\}/);
  const assertExactSourceMaterialization = (block) => {
    const markers = [
      '/usr/bin/git -C "$SOURCE_PATH" write-tree',
      '/usr/bin/git -C "$SOURCE_PATH" rev-parse "$DEPLOY_SHA^{tree}"',
      'if [ "$source_tree" != "$expected_tree" ]; then',
      "materialize-source",
      '-R --no-dereference "$build_uid:$build_gid"',
    ];
    let previous = -1;
    for (const marker of markers) {
      const index = block.indexOf(marker);
      assert.notEqual(index, -1, `missing exact-source marker: ${marker}`);
      assert.ok(
        index > previous,
        `out-of-order exact-source marker: ${marker}`,
      );
      previous = index;
    }
    assert.match(
      block,
      /"\$GITHUB_WORKSPACE\/controller\/scripts\/vercel-prebuilt-workflow\.mjs" \\\n\s+materialize-source/,
    );
    assert.doesNotMatch(block, /git -C "\$SOURCE_PATH" archive/);
    assert.doesNotMatch(block, /git -C "\$SOURCE_PATH" checkout-index/);
    assert.doesNotMatch(block, /get-tar-commit-id/);
  };
  assertExactSourceMaterialization(isolationBlock);
  for (const mutation of [
    isolationBlock.replace("$DEPLOY_SHA^{tree}", "HEAD^{tree}"),
    isolationBlock.replace(
      'if [ "$source_tree" != "$expected_tree" ]; then',
      'if [ "$source_tree" = "$source_tree" ]; then',
    ),
    isolationBlock.replace("materialize-source", "prepare-link"),
    isolationBlock.replace("-R --no-dereference", "-R"),
  ]) {
    assert.notEqual(mutation, isolationBlock);
    assert.throws(() => assertExactSourceMaterialization(mutation));
  }

  const installBlock = raw.slice(
    raw.indexOf("- name: Install frozen dependencies"),
    raw.indexOf("- name: Restore trusted controller after source installation"),
  );
  const buildBlock = raw.slice(
    raw.indexOf("- name: Build the UI prebuilt output"),
    raw.indexOf("- name: Restore trusted controller after source build"),
  );
  const buildValidationBlock = buildBlock.slice(
    0,
    buildBlock.indexOf('started_at_ms="$(date +%s%3N)"'),
  );
  const installCandidateBlock = installBlock.slice(
    installBlock.indexOf("set +e"),
    installBlock.indexOf("candidate_status=$?"),
  );
  const buildCandidateBlock = buildBlock.slice(
    buildBlock.indexOf("set +e"),
    buildBlock.indexOf("candidate_status=$?"),
  );
  const handoffBlock = raw.slice(
    raw.indexOf("- name: Create immutable runner-owned upload handoff"),
    raw.indexOf("- name: Materialize runner-owned upload UI project mapping"),
  );
  const candidateOutputValidationBlock = raw.slice(
    raw.indexOf("- name: Assert the UI prebuilt output"),
    raw.indexOf(
      "- name: Revalidate runner-owned pulled UI settings after the build",
    ),
  );
  const uploadOutputValidationBlock = raw.slice(
    raw.indexOf("- name: Assert immutable runner-owned upload handoff"),
    raw.indexOf("- name: Upload the verified prebuilt output"),
  );
  const pullBlock = raw.slice(
    raw.indexOf("- name: Pull branch-specific UI preview settings"),
    raw.indexOf("- name: Assert isolated runner-owned Vercel pull result"),
  );
  const stagePullBlock = raw.slice(
    raw.indexOf(
      "- name: Stage trusted UI project settings into candidate source",
    ),
    raw.indexOf("- name: Assert isolated UI project mapping"),
  );
  const validateCandidatePullBlock = raw.slice(
    raw.indexOf("- name: Assert isolated UI project mapping"),
    raw.indexOf("- name: Build the UI prebuilt output"),
  );
  const environmentValidationIndex = raw.indexOf(
    "- name: Validate runner-owned UI preview build variables",
  );
  const stagePullIndex = raw.indexOf(
    "- name: Stage trusted UI project settings into candidate source",
  );
  const environmentValidationBlock = raw.slice(
    environmentValidationIndex,
    stagePullIndex,
  );
  const assertSinglePrivilegedControllerInvocation = (block, command) => {
    const controller =
      '"$GITHUB_WORKSPACE/controller/scripts/vercel-prebuilt-workflow.mjs"';
    const lines = block.split("\n");
    const controllerLines = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.includes(controller));
    assert.equal(
      controllerLines.length,
      1,
      `${command} must have exactly one trusted controller invocation`,
    );
    const controllerIndex = controllerLines[0].index;
    assert.equal(lines[controllerIndex + 1]?.trim(), command);
    const privilegedIndex = lines.findIndex(
      (line, index) =>
        index < controllerIndex &&
        line.includes("sudo --non-interactive /usr/bin/env -i"),
    );
    assert.notEqual(
      privilegedIndex,
      -1,
      `${command} must start from a privileged clean environment`,
    );
    for (let index = privilegedIndex; index <= controllerIndex; index += 1) {
      assert.ok(
        lines[index].trimEnd().endsWith("\\"),
        `${command} must remain in one privileged continued command`,
      );
    }
  };
  assert.match(
    pullBlock,
    /SOURCE_PATH: \$\{\{ runner\.temp \}\}\/mento-vercel-pull-staging/,
  );
  assert.doesNotMatch(pullBlock, /github\.workspace.*source/);
  assertSinglePrivilegedControllerInvocation(stagePullBlock, "stage-pull");
  assert.doesNotMatch(stagePullBlock, /\/bin\/cp|canonical_state/);
  assertSinglePrivilegedControllerInvocation(
    validateCandidatePullBlock,
    "validate-candidate-pull",
  );
  assert.match(validateCandidatePullBlock, /BUILD_UID="\$BUILD_UID"/);
  assert.match(validateCandidatePullBlock, /PULL_STAGING_UID="\$\(id -u\)"/);
  assert.doesNotMatch(validateCandidatePullBlock, /\svalidate-pull\s*$/m);
  assertSinglePrivilegedControllerInvocation(buildValidationBlock, "build");
  assert.match(buildValidationBlock, /PULL_STAGING_UID="\$\(id -u\)"/);
  assert.doesNotMatch(
    buildValidationBlock,
    /\n\s+node "\$GITHUB_WORKSPACE\/controller\/scripts\/vercel-prebuilt-workflow\.mjs" build/,
  );
  assertSinglePrivilegedControllerInvocation(
    candidateOutputValidationBlock,
    "assert-output",
  );
  for (const [block, command] of [
    [stagePullBlock, "stage-pull"],
    [validateCandidatePullBlock, "validate-candidate-pull"],
    [buildValidationBlock, "build"],
    [candidateOutputValidationBlock, "assert-output"],
  ]) {
    const withoutPrivilege = block.replace(
      "sudo --non-interactive /usr/bin/env -i",
      "/usr/bin/env -i",
    );
    assert.notEqual(withoutPrivilege, block);
    assert.throws(
      () =>
        assertSinglePrivilegedControllerInvocation(withoutPrivilege, command),
      /privileged clean environment/,
    );
    assert.throws(
      () =>
        assertSinglePrivilegedControllerInvocation(
          `${block}\nnode "$GITHUB_WORKSPACE/controller/scripts/vercel-prebuilt-workflow.mjs" ${command}\n`,
          command,
        ),
      /exactly one trusted controller invocation/,
    );
  }
  assert.match(
    candidateOutputValidationBlock,
    /EXPECTED_PROVENANCE_UID="\$\(id -u\)"/,
  );
  assert.doesNotMatch(
    candidateOutputValidationBlock,
    /run: node .*vercel-prebuilt-workflow\.mjs" assert-output/,
  );
  assert.equal(
    uploadOutputValidationBlock.match(/vercel-prebuilt-workflow\.mjs/g)?.length,
    1,
  );
  assert.match(
    uploadOutputValidationBlock,
    /run: node .*vercel-prebuilt-workflow\.mjs" assert-output/,
  );
  assert.doesNotMatch(
    uploadOutputValidationBlock,
    /sudo --non-interactive \/usr\/bin\/env -i/,
  );
  assert.ok(
    raw.indexOf("- name: Assert isolated runner-owned Vercel pull result") <
      environmentValidationIndex,
  );
  assert.ok(environmentValidationIndex < stagePullIndex);
  assert.equal(raw.match(/vercel-build-environment\.mjs/g)?.length, 1);
  assert.match(
    environmentValidationBlock,
    /PULL_STAGING_PATH: \$\{\{ runner\.temp \}\}\/mento-vercel-pull-staging/,
  );
  assert.match(
    environmentValidationBlock,
    /--project-directory "\$PULL_STAGING_PATH\/apps\/ui\.mento\.org"/,
  );
  assert.doesNotMatch(environmentValidationBlock, /working-directory: source/);
  assert.doesNotMatch(
    environmentValidationBlock,
    /mento-vercel-candidate-source/,
  );
  assert.match(
    handoffBlock,
    /\/bin\/cp -R \\\n\s+--no-dereference \\\n\s+--preserve=mode,timestamps/,
  );
  for (const block of [installBlock, buildBlock]) {
    assert.match(block, /\/usr\/bin\/env -i/);
    assert.match(block, /::stop-commands::\$command_token/);
    assert.match(block, /echo "::\$command_token::"/);
    assert.match(
      block,
      /candidate_status=\$\?\n\s+set -e\n\s+terminate_candidate\n\s+echo "::\$command_token::"/,
    );
    assert.match(block, /--reuid="\$BUILD_UID"/);
    assert.match(block, /--regid="\$BUILD_GID"/);
  }
  for (const block of [installCandidateBlock, buildCandidateBlock]) {
    for (const name of [
      "BASH_ENV",
      "GITHUB_ENV",
      "GITHUB_OUTPUT",
      "GITHUB_PATH",
      "GITHUB_STEP_SUMMARY",
      "NODE_OPTIONS",
      "RUNNER_TEMP",
    ]) {
      assert.doesNotMatch(block, new RegExp(`\\n\\s+${name}=`));
    }
  }
  assert.match(installBlock, /XDG_DATA_HOME="\$CANDIDATE_HOME_PATH\/data"/);
  assert.doesNotMatch(installBlock, /--store-dir|PNPM_STORE/);
  assert.doesNotMatch(buildBlock, /\n\s+VERCEL_TOKEN:/);
  assert.doesNotMatch(buildBlock, /\n\s+VERCEL_TOKEN=/);
  assert.ok(
    buildBlock.indexOf("pkill -KILL -u") <
      buildBlock.indexOf("build_duration_ms="),
  );
  assert.ok(
    raw.indexOf("Assert immutable runner-owned upload handoff") <
      raw.indexOf("Upload the verified prebuilt output"),
  );
});

test("pulled project and prebuilt output bind the configured UI root and build ID", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-project-"));
  const projectDirectory = join(directory, "apps", "ui.mento.org", ".vercel");
  const outputDirectory = join(projectDirectory, "output");
  try {
    mkdirSync(outputDirectory, { recursive: true });
    assert.deepEqual(
      materializeVercelRepoLink({
        repoRoot: directory,
        expectedRootDirectory: "apps/ui.mento.org",
        vercelOrgId: "team_example",
        vercelProjectId: "prj_example",
      }),
      {
        remoteName: "origin",
        projects: [
          {
            id: "prj_example",
            directory: "apps/ui.mento.org",
            orgId: "team_example",
          },
        ],
      },
    );
    writeFileSync(
      join(projectDirectory, "project.json"),
      JSON.stringify({
        orgId: "team_example",
        projectId: "prj_example",
        settings: { rootDirectory: "apps/ui.mento.org" },
      }),
    );
    writeFileSync(
      join(outputDirectory, "config.json"),
      JSON.stringify({ version: 3, deploymentId: DEPLOYMENT_ID }),
    );
    writeFileSync(
      join(outputDirectory, "builds.json"),
      JSON.stringify({ target: "preview", cliVersion: "56.2.0" }),
    );
    assert.equal(
      assertPulledProject({
        repoRoot: directory,
        expectedRootDirectory: "apps/ui.mento.org",
        vercelOrgId: "team_example",
        vercelProjectId: "prj_example",
      }).settings.rootDirectory,
      "apps/ui.mento.org",
    );
    assert.equal(
      assertPrebuiltOutput({
        repoRoot: directory,
        expectedRootDirectory: "apps/ui.mento.org",
        deploymentId: DEPLOYMENT_ID,
      }),
      outputDirectory,
    );
    writeFileSync(
      join(directory, ".vercel", "repo.json"),
      JSON.stringify({
        remoteName: "origin",
        projects: [
          {
            id: "prj_other",
            directory: "apps/ui.mento.org",
            orgId: "team_example",
          },
        ],
      }),
    );
    assert.throws(
      () =>
        assertPulledProject({
          repoRoot: directory,
          expectedRootDirectory: "apps/ui.mento.org",
          vercelOrgId: "team_example",
          vercelProjectId: "prj_example",
        }),
      /does not match/,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("UI upload revalidates exact provenance and project mapping immediately", async () => {
  const mutations = [
    {
      name: "missing repo link",
      mutate: ({ repoRoot }) => rmSync(join(repoRoot, ".vercel", "repo.json")),
    },
    {
      name: "wrong remote",
      mutate: ({ repoRoot, options }) =>
        writeFileSync(
          join(repoRoot, ".vercel", "repo.json"),
          JSON.stringify({
            remoteName: "candidate",
            projects: [
              {
                id: options.vercelProjectId,
                directory: options.expectedRootDirectory,
                orgId: options.vercelOrgId,
              },
            ],
          }),
        ),
    },
    ...[
      ["linked org", "orgId", "team_other"],
      ["linked project", "id", "prj_other"],
      ["linked root", "directory", "apps/wrong"],
    ].map(([name, property, value]) => ({
      name: `wrong ${name}`,
      mutate: ({ repoRoot }) => {
        const path = join(repoRoot, ".vercel", "repo.json");
        const link = JSON.parse(readFileSync(path, "utf8"));
        link.projects[0][property] = value;
        writeFileSync(path, JSON.stringify(link));
      },
    })),
    {
      name: "missing project settings",
      mutate: ({ projectState }) => rmSync(join(projectState, "project.json")),
    },
    ...[
      ["project org", "orgId", "team_other"],
      ["project ID", "projectId", "prj_other"],
    ].map(([name, property, value]) => ({
      name: `wrong ${name}`,
      mutate: ({ projectState }) => {
        const path = join(projectState, "project.json");
        const project = JSON.parse(readFileSync(path, "utf8"));
        project[property] = value;
        writeFileSync(path, JSON.stringify(project));
      },
    })),
    {
      name: "wrong project root",
      mutate: ({ projectState }) => {
        const path = join(projectState, "project.json");
        const project = JSON.parse(readFileSync(path, "utf8"));
        project.settings.rootDirectory = "apps/wrong";
        writeFileSync(path, JSON.stringify(project));
      },
    },
    {
      name: "wrong exact-SHA provenance",
      mutate: ({ repoRoot }) =>
        writeFileSync(
          `${repoRoot}.provenance.json`,
          JSON.stringify({ commitSha: `1${SHA.slice(1)}` }),
        ),
    },
  ];

  const valid = uploadFixture();
  let validUploads = 0;
  try {
    assert.equal(
      assertPrebuiltReadyForUpload(valid.options),
      valid.outputDirectory,
    );
    assert.equal(
      await withValidatedPrebuiltUpload(valid.options, async () => {
        validUploads += 1;
        return "uploaded";
      }),
      "uploaded",
    );
    assert.equal(validUploads, 1);
  } finally {
    valid.cleanup();
  }

  for (const mutation of mutations) {
    const fixture = uploadFixture();
    let uploadCalls = 0;
    try {
      mutation.mutate(fixture);
      await assert.rejects(
        withValidatedPrebuiltUpload(fixture.options, async () => {
          uploadCalls += 1;
        }),
        undefined,
        mutation.name,
      );
      assert.equal(uploadCalls, 0, mutation.name);
    } finally {
      fixture.cleanup();
    }
  }
});

test("UI upload guard rejects links, special nodes, and runner-writable state", () => {
  const mutateCases = [
    {
      name: "symbolic link",
      mutate: ({ outputDirectory }) =>
        symlinkSync("/etc/passwd", join(outputDirectory, "static", "escape")),
    },
    {
      name: "hard link",
      mutate: ({ outputDirectory }) =>
        linkSync(
          join(outputDirectory, "config.json"),
          join(outputDirectory, "static", "hardlink"),
        ),
    },
    {
      name: "FIFO",
      mutate: ({ outputDirectory }) =>
        execFileSync("mkfifo", [join(outputDirectory, "static", "pipe")]),
    },
    {
      name: "world-writable directory",
      mutate: ({ outputDirectory }) =>
        chmodSync(join(outputDirectory, "static"), 0o777),
    },
  ];
  for (const mutation of mutateCases) {
    const fixture = uploadFixture();
    try {
      mutation.mutate(fixture);
      assert.throws(
        () => assertPrebuiltReadyForUpload(fixture.options),
        undefined,
        mutation.name,
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test("direct UI smoke binds URL, custom build ID, navigation, assets, and headers", async () => {
  const requested = [];
  const html = `<!doctype html><html data-dpl-id="${DEPLOYMENT_ID}"><body>
    <h1>Basic Components</h1>
    <script src="/_next/static/chunks/app.js?dpl=${DEPLOYMENT_ID}"></script>
    <link href="/_next/static/css/app.css?dpl=${DEPLOYMENT_ID}" rel="stylesheet">
    <link href="/_next/static/media/inter.woff2" rel="preload">
  </body></html>`;
  const fetchImplementation = async (url, options) => {
    const parsed = new URL(url);
    requested.push({
      url: parsed.toString(),
      headers: options.headers,
      signal: options.signal,
    });
    if (parsed.pathname === "/form-components") {
      return new Response("<h1>Form Components</h1>");
    }
    if (parsed.pathname.startsWith("/_next/static/")) {
      return new Response("asset");
    }
    return new Response(html, {
      headers: {
        "content-security-policy": "frame-ancestors 'none'",
        "content-security-policy-report-only":
          "default-src 'self'; frame-src https://vercel.live",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
    });
  };

  assert.deepEqual(
    await smokeUiPreview({
      deploymentUrl: DEPLOYMENT_URL,
      deploymentId: DEPLOYMENT_ID,
      fetchImplementation,
    }),
    {
      deploymentUrl: DEPLOYMENT_URL,
      deploymentId: DEPLOYMENT_ID,
      checkedAssets: 3,
    },
  );
  assert.equal(requested.length, 5);
  assert.ok(requested.every(({ headers }) => headers === undefined));
  assert.ok(requested.every(({ signal }) => signal instanceof AbortSignal));
});

test("direct UI smoke fails closed on missing build identity or security evidence", async () => {
  const response = new Response("<h1>Basic Components</h1>", {
    headers: {
      "content-security-policy": "frame-ancestors 'none'",
      "content-security-policy-report-only": "frame-src https://vercel.live",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
  await assert.rejects(
    smokeUiPreview({
      deploymentUrl: DEPLOYMENT_URL,
      deploymentId: DEPLOYMENT_ID,
      fetchImplementation: async () => response,
    }),
    /does not carry the expected build deployment ID/,
  );
});

test("direct UI smoke bounds every network request", async () => {
  await assert.rejects(
    smokeUiPreview({
      deploymentUrl: DEPLOYMENT_URL,
      deploymentId: DEPLOYMENT_ID,
      fetchImplementation: async () => new Promise(() => {}),
      requestTimeoutMs: 5,
    }),
    /UI preview timed out/,
  );
});

test("direct UI smoke bounds response body consumption", async () => {
  const stalledBody = new ReadableStream({
    start() {},
  });
  await assert.rejects(
    smokeUiPreview({
      deploymentUrl: DEPLOYMENT_URL,
      deploymentId: DEPLOYMENT_ID,
      fetchImplementation: async () => new Response(stalledBody),
      requestTimeoutMs: 5,
    }),
    /UI preview timed out/,
  );
});
