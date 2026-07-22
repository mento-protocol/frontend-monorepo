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
  CANONICAL_STATE_KEYS,
  VercelStateClient,
  assertCanonicalOutput,
  assertSnapshotSpec,
  canonicalizeAliasMapping,
  canonicalizeAliases,
  canonicalizeDeploymentState,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
  captureProtectedSnapshot,
  compareProtectedSnapshots,
  parseArguments,
  renderCliFailure,
  runCli,
  writeCanonicalJson,
} from "./vercel-deployment-state.mjs";

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

function privateTestDirectory(testContext) {
  const directory = mkdtempSync(join(process.cwd(), ".vercel-state-test-"));
  testContext.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

test("ordinary production fixture emits only canonical allowlisted state", () => {
  const state = canonicalizeFixture(fixture("valid-production.json"));
  assert.deepEqual(Object.keys(state), CANONICAL_STATE_KEYS);
  assert.deepEqual(state, {
    alias: "governance.mento.org",
    deploymentId: "dpl_governance123",
    deploymentUrl: "https://governance-immutable.vercel.app",
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
    aliases: ["governance-immutable.vercel.app", "governance.mento.org"],
  });
});

test("custom v3 fixture proves slug independently from target", () => {
  const state = canonicalizeFixture(fixture("valid-custom-v3.json"));
  assert.equal(state.target, null);
  assert.equal(state.customEnvironmentSlug, "v3");
  assert.equal(state.alias, "app.mento.org");
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
    "governance-immutable.vercel.app",
    "governance.mento.org",
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
  assert.doesNotMatch(output, /test-value-not-printed/);
  assert.doesNotMatch(output, /protectionBypass|buildEnv|creator|env/);
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
    ["compare", "--before", "before.json", "--after", "after.json"],
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
  assert.equal(failed.stderr, "Vercel deployment state command failed\n");
  assert.doesNotMatch(failed.stderr, /private-test-value|\/private\//);
  assert.equal(
    renderCliFailure(new Error(`${sensitivePath}: test-token-never-printed`)),
    "Vercel deployment state command failed\n",
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
