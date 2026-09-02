import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  MAIN_ACTIVE_MAPPING_SPEC_SCHEMA,
  captureStableAliasMappings,
  parseMainActiveCliArguments,
  renderMainActiveCliFailure,
  runMainActiveCli,
} from "./vercel-main-active-cli.mjs";
import {
  buildMainActivePromotionCommand,
  runMainActiveVercelCommand,
} from "./vercel-main-active.mjs";
import { MAIN_TARGET_CONTRACTS } from "./vercel-main-plan.mjs";

const APP_REVIEWED_ALIASES = MAIN_TARGET_CONTRACTS.app.aliases;
import { PINNED_VERCEL_CLI_VERSION } from "./vercel-cli-runtime-contract.mjs";

const TOKEN = ["test", "main", "active", "token", "never", "output"].join("-");
const PRIOR = Object.freeze({
  deploymentId: "dpl_Prior123",
  deploymentUrl: "https://prior-main.vercel.app",
});
const CANDIDATE = Object.freeze({
  deploymentId: "dpl_Candidate123",
  deploymentUrl: "https://candidate-main.vercel.app",
});

function privateTestDirectory(testContext) {
  const directory = mkdtempSync(join(process.cwd(), ".main-active-cli-test-"));
  testContext.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function writePrivateJson(directory, name, value, mode = 0o600) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode });
  return path;
}

function executionEnvironment(directory, overrides = {}) {
  const cliPath = join(directory, "vercel-cli.js");
  const sourcePath = join(directory, "workspace");
  if (!existsSync(cliPath)) {
    writeFileSync(cliPath, "#!/usr/bin/env node\n", { mode: 0o500 });
  }
  if (!existsSync(sourcePath)) mkdirSync(sourcePath, { mode: 0o700 });
  return {
    CI: "1",
    GITHUB_WORKSPACE: directory,
    RUNNER_TEMP: directory,
    SENTRY_AUTH_TOKEN: ["filtered", "secret", "never", "output"].join("-"),
    SOURCE_PATH: sourcePath,
    TRUSTED_VERCEL_CLI_PATH: cliPath,
    VERCEL_ORG_ID: "team_mainactive123",
    VERCEL_TOKEN: TOKEN,
    ...overrides,
  };
}

function mapping(alias, deployment) {
  return {
    alias,
    deploymentId: deployment.deploymentId,
    deploymentUrl: deployment.deploymentUrl,
    projectId: "prj_app123",
  };
}

function mappingSpec(overrides = {}) {
  return {
    schema: MAIN_ACTIVE_MAPPING_SPEC_SCHEMA,
    target: "app",
    aliases: [...APP_REVIEWED_ALIASES],
    priorDeployment: PRIOR,
    candidateDeployment: CANDIDATE,
    ...overrides,
  };
}

test("CLI parser accepts only exact command option sets and no credential arguments", () => {
  for (const argv of [
    ["execute", "--descriptor", "descriptor.json", "--output", "result.json"],
    ["mapping", "--spec", "spec.json", "--output", "mapping.json"],
  ]) {
    assert.equal(parseMainActiveCliArguments(argv).command, argv[0]);
  }
  // The retired App candidate discovery verb cannot re-enter the CLI.
  assert.throws(
    () =>
      parseMainActiveCliArguments([
        "app-candidate",
        "--expectation",
        "expectation.json",
        "--command-result",
        "command.json",
        "--output",
        "candidate.json",
      ]),
    /command is missing or unsupported/,
  );

  for (const argv of [
    [],
    ["unknown"],
    ["execute", "--descriptor", "descriptor.json"],
    [
      "execute",
      "--descriptor",
      "descriptor.json",
      "--output",
      "result.json",
      "--token",
      TOKEN,
    ],
    [
      "mapping",
      "--spec",
      "spec.json",
      "--spec",
      "other.json",
      "--output",
      "mapping.json",
    ],
  ]) {
    assert.throws(() => parseMainActiveCliArguments(argv));
  }
});

test("execute validates the descriptor and passes the token only through a filtered environment", async (t) => {
  const directory = privateTestDirectory(t);
  const command = buildMainActivePromotionCommand({
    target: "governance",
    ...CANDIDATE,
  });
  const descriptor = writePrivateJson(directory, "descriptor.json", command);
  const output = join(directory, "result.json");
  const env = executionEnvironment(directory, {
    VERCEL_PROJECT_ID: "prj_untrusted",
  });
  const calls = [];
  let stdout = "";

  await runMainActiveCli({
    argv: ["execute", "--descriptor", descriptor, "--output", output],
    env,
    stdout: { write: (value) => (stdout += value) },
    commandExecutor: (options) =>
      runMainActiveVercelCommand({
        ...options,
        nodeExecutable: "/usr/bin/node",
        spawn: (executable, argumentsList, spawnOptions) => {
          calls.push({ executable, argumentsList, spawnOptions });
          return {
            status: 0,
            signal: null,
            stdout: `${TOKEN}: ignored provider output`,
            stderr: `${TOKEN}: ignored provider error`,
          };
        },
      }),
  });

  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
    outcome: "success",
    reason: null,
    candidate: null,
  });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(stdout, "Canonical Vercel command result written\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "/usr/bin/node");
  assert.equal(calls[0].argumentsList[0], "--experimental-loader");
  assert.match(calls[0].argumentsList[1], /^data:text\/javascript,/);
  assert.equal(calls[0].argumentsList[2], "--eval");
  assert.equal(
    calls[0].argumentsList[3],
    `process.argv.splice(1, 0, ${JSON.stringify(env.TRUSTED_VERCEL_CLI_PATH)}); await import(${JSON.stringify(env.TRUSTED_VERCEL_CLI_PATH)});`,
  );
  assert.equal(calls[0].argumentsList[4], "--");
  assert.deepEqual(calls[0].argumentsList.slice(5), [
    ...command.arguments,
    "--scope",
    env.VERCEL_ORG_ID,
  ]);
  assert.equal(Number.isInteger(calls[0].spawnOptions.stdio[3]), true);
  assert.ok(calls[0].spawnOptions.stdio[3] >= 3);
  assert.equal(calls[0].spawnOptions.cwd, env.SOURCE_PATH);
  assert.equal(calls[0].spawnOptions.env.VERCEL_TOKEN, TOKEN);
  assert.equal(
    Object.hasOwn(calls[0].spawnOptions.env, "VERCEL_ORG_ID"),
    false,
  );
  assert.equal(
    Object.hasOwn(calls[0].spawnOptions.env, "VERCEL_PROJECT_ID"),
    false,
  );
  assert.equal(
    Object.hasOwn(calls[0].spawnOptions.env, "SENTRY_AUTH_TOKEN"),
    false,
  );
  assert.equal(calls[0].argumentsList.includes(TOKEN), false);
  assert.doesNotMatch(
    `${stdout}${readFileSync(output, "utf8")}`,
    new RegExp(TOKEN),
  );
});

test("execute preserves reviewed ESM sibling resolution after its entrypoint pathname is replaced", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  const command = buildMainActivePromotionCommand({
    target: "governance",
    ...CANDIDATE,
  });
  const descriptor = writePrivateJson(directory, "descriptor.json", command);
  const output = join(directory, "result.json");
  const marker = join(directory, "cli-marker.txt");
  const trustedDirectory = join(directory, "trusted-cli");
  const cliPath = join(trustedDirectory, "index.mjs");
  const siblingPath = join(trustedDirectory, "sibling.mjs");
  const attackerCli = join(directory, "attacker-cli.js");
  mkdirSync(trustedDirectory, { mode: 0o700 });
  writeFileSync(
    cliPath,
    `import { writeMarker } from "./sibling.mjs"; writeMarker(process.env.CI, import.meta.url);\n`,
    { mode: 0o500 },
  );
  writeFileSync(
    siblingPath,
    `import { writeFileSync } from "node:fs"; export function writeMarker(path, entryUrl) { writeFileSync(path, entryUrl); }\n`,
    { mode: 0o500 },
  );
  writeFileSync(
    attackerCli,
    `import { writeFileSync } from "node:fs"; writeFileSync(process.env.CI, "attacker"); process.exit(23);\n`,
    { mode: 0o500 },
  );

  await runMainActiveCli({
    argv: ["execute", "--descriptor", descriptor, "--output", output],
    env: { ...env, CI: marker, TRUSTED_VERCEL_CLI_PATH: cliPath },
    stdout: { write: () => {} },
    commandExecutor: (options) =>
      runMainActiveVercelCommand({
        ...options,
        nodeExecutable: process.execPath,
        spawn: (executable, argumentsList, spawnOptions) => {
          unlinkSync(cliPath);
          symlinkSync(attackerCli, cliPath);
          return spawnSync(executable, argumentsList, spawnOptions);
        },
      }),
  });
  assert.equal(readFileSync(marker, "utf8"), pathToFileURL(cliPath).href);
  assert.equal(lstatSync(cliPath).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
    outcome: "success",
    reason: null,
    candidate: null,
  });
});

test("fd loader runs the pinned Vercel ESM entrypoint", () => {
  const cliPath = realpathSync(
    join(process.cwd(), "node_modules", "vercel", "dist", "index.js"),
  );
  const descriptor = openSync(cliPath, "r");
  try {
    const result = runMainActiveVercelCommand({
      command: buildMainActivePromotionCommand({
        target: "ui",
        ...CANDIDATE,
      }),
      cliPath,
      cliFileDescriptor: descriptor,
      workingDirectory: process.cwd(),
      environment: {
        VERCEL_ORG_ID: "team_mainactive123",
        VERCEL_TOKEN: TOKEN,
      },
      nodeExecutable: process.execPath,
      spawn: (executable, argumentsList, spawnOptions) => {
        const child = spawnSync(
          executable,
          [...argumentsList.slice(0, 5), "--version"],
          spawnOptions,
        );
        assert.equal(child.status, 0, child.stderr);
        assert.match(
          `${child.stdout}${child.stderr}`,
          new RegExp(
            PINNED_VERCEL_CLI_VERSION.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
            "u",
          ),
        );
        return child;
      },
    });
    assert.deepEqual(result, {
      outcome: "success",
      reason: null,
      candidate: null,
    });
  } finally {
    closeSync(descriptor);
  }
});

test("execute publishes canonical evidence after a command replaces its output", async (t) => {
  const directory = privateTestDirectory(t);
  const command = buildMainActivePromotionCommand({
    target: "reserve",
    ...CANDIDATE,
  });

  for (const [name, exitCode, expected] of [
    ["success", 0, { outcome: "success", reason: null, candidate: null }],
    ["nonzero", 17, { outcome: "unknown", reason: "nonzero", candidate: null }],
  ]) {
    const descriptor = writePrivateJson(
      directory,
      `${name}-descriptor.json`,
      command,
    );
    const output = join(directory, `${name}-result.json`);
    const env = executionEnvironment(directory, { CI: output });
    unlinkSync(env.TRUSTED_VERCEL_CLI_PATH);
    writeFileSync(
      env.TRUSTED_VERCEL_CLI_PATH,
      `import { rmSync, writeFileSync } from "node:fs"; rmSync(process.env.CI, { force: true }); writeFileSync(process.env.CI, "attacker replacement"); process.exit(${exitCode});\n`,
      { mode: 0o500 },
    );

    const operation = runMainActiveCli({
      argv: ["execute", "--descriptor", descriptor, "--output", output],
      env,
      stdout: { write: () => {} },
    });
    await operation;
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), expected);
    assert.equal(statSync(output).mode & 0o777, 0o600);
  }
});

test("execute writes canonical unknown evidence for nonzero, timeout, and lost results", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  const scenarios = [
    {
      name: "nonzero",
      command: buildMainActivePromotionCommand({
        target: "reserve",
        ...CANDIDATE,
      }),
      result: {
        status: 1,
        signal: null,
        stdout: TOKEN,
        stderr: TOKEN,
      },
      reason: "nonzero",
    },
    {
      name: "timeout",
      command: buildMainActivePromotionCommand({
        target: "ui",
        ...CANDIDATE,
      }),
      result: {
        error: { code: "ETIMEDOUT", message: TOKEN },
        status: null,
        signal: "SIGTERM",
        stdout: TOKEN,
        stderr: TOKEN,
      },
      reason: "timeout",
    },
    {
      name: "lost-result",
      command: buildMainActivePromotionCommand({
        target: "app",
        ...CANDIDATE,
      }),
      result: {
        status: null,
        signal: null,
        stdout: `{"secret":"${TOKEN}"}`,
        stderr: TOKEN,
      },
      reason: "lost-result",
    },
  ];

  for (const scenario of scenarios) {
    const descriptor = writePrivateJson(
      directory,
      `${scenario.name}-descriptor.json`,
      scenario.command,
    );
    const output = join(directory, `${scenario.name}-result.json`);
    await runMainActiveCli({
      argv: ["execute", "--descriptor", descriptor, "--output", output],
      env,
      commandExecutor: (options) =>
        runMainActiveVercelCommand({
          ...options,
          nodeExecutable: "/usr/bin/node",
          spawn: () => scenario.result,
        }),
    });
    const result = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(result, {
      outcome: "unknown",
      reason: scenario.reason,
      candidate: null,
    });
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  }
});

// No activation command creates a deployment, so a reported candidate is
// always lost evidence.
test("execute rejects any command result that reports a candidate", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  for (const [name, descriptor] of [
    [
      "app-promote",
      buildMainActivePromotionCommand({ target: "app", ...CANDIDATE }),
    ],
    [
      "ordinary-promote",
      buildMainActivePromotionCommand({ target: "ui", ...CANDIDATE }),
    ],
  ]) {
    const descriptorPath = writePrivateJson(
      directory,
      `${name}-descriptor.json`,
      descriptor,
    );
    const output = join(directory, `${name}.json`);
    await runMainActiveCli({
      argv: ["execute", "--descriptor", descriptorPath, "--output", output],
      env,
      stdout: { write: () => {} },
      commandExecutor: () => ({
        outcome: "success",
        reason: null,
        candidate: CANDIDATE,
      }),
    });
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      outcome: "unknown",
      reason: "lost-result",
      candidate: null,
    });
  }
});

test("execute rejects forged descriptors, unsafe runtime paths, and expanded results", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...CANDIDATE,
  });
  const forged = writePrivateJson(directory, "forged.json", {
    ...command,
    arguments: [...command.arguments, "--token", TOKEN],
  });
  let executions = 0;
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          forged,
          "--output",
          join(directory, "forged-result.json"),
        ],
        env,
        commandExecutor: () => {
          executions += 1;
        },
      }),
    /descriptor was altered|not allowlisted/,
  );
  assert.equal(executions, 0);

  const descriptor = writePrivateJson(
    directory,
    "valid-descriptor.json",
    command,
  );
  const linkedCli = join(directory, "linked-vercel.js");
  symlinkSync(env.TRUSTED_VERCEL_CLI_PATH, linkedCli);
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          descriptor,
          "--output",
          join(directory, "linked-cli-result.json"),
        ],
        env: { ...env, TRUSTED_VERCEL_CLI_PATH: linkedCli },
      }),
    /Pinned Vercel CLI is missing or unsafe/,
  );

  await runMainActiveCli({
    argv: [
      "execute",
      "--descriptor",
      descriptor,
      "--output",
      join(directory, "expanded-result.json"),
    ],
    env,
    commandExecutor: () => ({
      outcome: "success",
      reason: null,
      candidate: null,
      rawOutput: TOKEN,
    }),
  });
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, "expanded-result.json"), "utf8")),
    { outcome: "unknown", reason: "lost-result", candidate: null },
  );
});

test("stable mapping uses bounded retries, double observation, and canonical private output", async (t) => {
  const directory = privateTestDirectory(t);
  const specPath = writePrivateJson(
    directory,
    "mapping-spec.json",
    mappingSpec(),
  );
  const output = join(directory, "mapping-result.json");
  const env = executionEnvironment(directory);
  const attempts = new Map();
  let stdout = "";

  await runMainActiveCli({
    argv: ["mapping", "--spec", specPath, "--output", output],
    env,
    stdout: { write: (value) => (stdout += value) },
    stateClientFactory: ({ token, teamId }) => {
      assert.equal(token, TOKEN);
      assert.equal(teamId, env.VERCEL_ORG_ID);
      return {
        async aliasMapping(alias) {
          const count = (attempts.get(alias) ?? 0) + 1;
          attempts.set(alias, count);
          if (count < 3) {
            throw new Error(`${TOKEN}: transient API failure`);
          }
          return mapping(alias, CANDIDATE);
        },
      };
    },
  });

  const result = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(result.target, "app");
  assert.equal(result.mappingState, "candidate");
  assert.deepEqual(
    result.mappings.map(({ alias }) => alias),
    APP_REVIEWED_ALIASES,
  );
  assert.equal(attempts.get(APP_REVIEWED_ALIASES[0]), 4);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(stdout, "Canonical protected mapping inspection written\n");
  assert.doesNotMatch(readFileSync(output, "utf8"), new RegExp(TOKEN));
});

test("mapping preserves exact reviewed App alias state", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  const deployments = new Map([[APP_REVIEWED_ALIASES[0], CANDIDATE]]);
  const client = {
    aliasMapping: async (alias) => mapping(alias, deployments.get(alias)),
  };

  const subsetSpec = writePrivateJson(
    directory,
    "subset-spec.json",
    mappingSpec({ aliases: [APP_REVIEWED_ALIASES[0]] }),
  );
  const subsetOutput = join(directory, "subset-result.json");
  await runMainActiveCli({
    argv: ["mapping", "--spec", subsetSpec, "--output", subsetOutput],
    env,
    stdout: { write: () => {} },
    stateClientFactory: () => client,
  });
  const subset = JSON.parse(readFileSync(subsetOutput, "utf8"));
  assert.equal(subset.mappingState, "candidate");
  assert.deepEqual(
    subset.mappings.map(({ alias }) => alias),
    [APP_REVIEWED_ALIASES[0]],
  );
});

test("mapping fails closed on an alias race, exhausted retries, or unreviewed subsets", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  const raceSpec = writePrivateJson(
    directory,
    "race-spec.json",
    mappingSpec({ aliases: [APP_REVIEWED_ALIASES[0]] }),
  );
  let reads = 0;
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "mapping",
          "--spec",
          raceSpec,
          "--output",
          join(directory, "race-result.json"),
        ],
        env,
        stateClientFactory: () => ({
          aliasMapping: async (alias) =>
            mapping(alias, reads++ === 0 ? PRIOR : CANDIDATE),
        }),
      }),
    /failed closed/,
  );
  assert.equal(existsSync(join(directory, "race-result.json")), false);

  let attempts = 0;
  await assert.rejects(
    () =>
      captureStableAliasMappings(
        {
          aliasMapping: async () => {
            attempts += 1;
            throw new Error(`${TOKEN}: raw API error`);
          },
        },
        [APP_REVIEWED_ALIASES[0]],
        { retryDelayMs: 0, sleepImplementation: async () => {} },
      ),
    (error) => {
      assert.equal(error.message, "Protected mapping read failed");
      assert.doesNotMatch(error.message, new RegExp(TOKEN));
      return true;
    },
  );
  assert.equal(attempts, 3);

  const unreviewed = writePrivateJson(
    directory,
    "unreviewed-spec.json",
    mappingSpec({ aliases: ["unreviewed.mento.org"] }),
  );
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "mapping",
          "--spec",
          unreviewed,
          "--output",
          join(directory, "unreviewed-result.json"),
        ],
        env,
        stateClientFactory: () => ({
          aliasMapping: async () => {
            throw new Error("must not run");
          },
        }),
      }),
    /not allowlisted/,
  );
});

test("private JSON boundaries reject permissive modes, symlinks, nesting, and replacement", async (t) => {
  const directory = privateTestDirectory(t);
  const env = executionEnvironment(directory);
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...CANDIDATE,
  });
  const permissive = writePrivateJson(
    directory,
    "permissive.json",
    command,
    0o644,
  );
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          permissive,
          "--output",
          join(directory, "permissive-result.json"),
        ],
        env,
      }),
    /descriptor is missing or malformed/,
  );

  const descriptor = writePrivateJson(
    directory,
    "private-descriptor.json",
    command,
  );
  const linkedInput = join(directory, "linked-input.json");
  symlinkSync(descriptor, linkedInput);
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          linkedInput,
          "--output",
          join(directory, "linked-input-result.json"),
        ],
        env,
      }),
    /descriptor is missing or malformed/,
  );

  const linkedOutput = join(directory, "linked-output.json");
  symlinkSync(descriptor, linkedOutput);
  let unsafeOutputExecutions = 0;
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: ["execute", "--descriptor", descriptor, "--output", linkedOutput],
        env,
        commandExecutor: () => {
          unsafeOutputExecutions += 1;
          return {
            outcome: "success",
            reason: null,
            candidate: null,
          };
        },
      }),
    /could not be written safely/,
  );

  const nested = join(directory, "nested");
  mkdirSync(nested, { mode: 0o700 });
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          descriptor,
          "--output",
          join(nested, "result.json"),
        ],
        env,
        commandExecutor: () => {
          unsafeOutputExecutions += 1;
          return {
            outcome: "success",
            reason: null,
            candidate: null,
          };
        },
      }),
    /output is missing or unsafe/,
  );
  const existingOutput = writePrivateJson(
    directory,
    "existing-output.json",
    {},
  );
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          descriptor,
          "--output",
          existingOutput,
        ],
        env,
        commandExecutor: () => {
          unsafeOutputExecutions += 1;
        },
      }),
    /could not be written safely/,
  );
  assert.equal(unsafeOutputExecutions, 0);

  const linkedWorkspace = join(directory, "linked-workspace");
  symlinkSync(env.SOURCE_PATH, linkedWorkspace);
  await assert.rejects(
    () =>
      runMainActiveCli({
        argv: [
          "execute",
          "--descriptor",
          descriptor,
          "--output",
          join(directory, "linked-workspace-result.json"),
        ],
        env: { ...env, SOURCE_PATH: linkedWorkspace },
      }),
    /Reviewed Vercel workspace is missing or unsafe/,
  );
});

test("CLI entrypoint emits only one redacted failure line", (t) => {
  const directory = privateTestDirectory(t);
  const script = fileURLToPath(
    new URL("./vercel-main-active-cli.mjs", import.meta.url),
  );
  const sensitivePath = join(directory, "private-token-path.json");
  const result = spawnSync(
    process.execPath,
    [
      script,
      "execute",
      "--descriptor",
      sensitivePath,
      "--output",
      join(directory, "result.json"),
    ],
    {
      encoding: "utf8",
      env: {
        RUNNER_TEMP: directory,
        VERCEL_TOKEN: TOKEN,
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Vercel main activation command failed\n");
  assert.doesNotMatch(result.stderr, /private-token-path|test-main-active/);
  assert.equal(
    renderMainActiveCliFailure(new Error(`${TOKEN}: ${sensitivePath}`)),
    "Vercel main activation command failed\n",
  );
});
