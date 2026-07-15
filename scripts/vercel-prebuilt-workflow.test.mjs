import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertPrebuiltOutput,
  assertPulledProject,
  assertSafeVercelArguments,
  assertVercelInspection,
  buildVercelBuildArguments,
  buildVercelDeploymentLookupUrl,
  buildVercelDeployArguments,
  buildVercelInspectArguments,
  buildVercelPullArguments,
  deployWithAmbiguityRecovery,
  environmentForVercelCli,
  materializeVercelRepoLink,
  parseVercelDeploymentLookup,
  parseVercelDeploymentJson,
  PILOT_TARGET,
  queryVercelDeployments,
  smokeUiPreview,
  validateExactSha,
  validateGitBranch,
  validatePilotContract,
  validateSourceCheckout,
} from "./vercel-prebuilt-workflow.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYMENT_ID = "m-ui-0123456789abcdef012";
const DEPLOYMENT_URL = "https://ui-pilot-abc.vercel.app";
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
    environmentForVercelCli({
      CI: "1",
      VERCEL_ORG_ID: "team_example",
      VERCEL_PROJECT_ID: "prj_example",
      VERCEL_TOKEN: "fixture-token",
    }),
    { CI: "1", VERCEL_TOKEN: "fixture-token" },
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
