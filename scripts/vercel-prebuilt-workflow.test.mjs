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
  buildVercelDeployArguments,
  buildVercelInspectArguments,
  buildVercelPullArguments,
  environmentForVercelCli,
  materializeVercelRepoLink,
  parseVercelDeploymentJson,
  PILOT_TARGET,
  smokeUiPreview,
  validateExactSha,
  validateGitBranch,
  validatePilotContract,
  validateSourceCheckout,
} from "./vercel-prebuilt-workflow.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const DEPLOYMENT_ID = "m-ui-0123456789abcdef012";
const DEPLOYMENT_URL = "https://ui-pilot-abc.vercel.app";

function pilotContract(overrides = {}) {
  return {
    ...PILOT_TARGET,
    deployPermitted: true,
    commitSha: SHA,
    gitBranch: "feature/ui-pilot",
    vercelOrgId: "team_example",
    vercelProjectId: "prj_example",
    idempotencyKey: `vercel-pilot:v1:ui:sha:${SHA}:run:1:attempt:1`,
    workflowRunUrl:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/1",
    githubRepository: "mento-protocol/frontend-monorepo",
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
  ]) {
    assert.throws(() => validatePilotContract(pilotContract(overrides)));
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
