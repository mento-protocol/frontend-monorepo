import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAIN_ACTIVE_APP_ALIASES,
  MAIN_ACTIVE_COMMAND_TIMEOUT_MS,
  MAIN_ACTIVE_LEGACY_ALIAS,
  MAIN_ACTIVE_LEGACY_ALIASES,
  MAIN_ACTIVE_ORDINARY_TARGETS,
  MainActiveAdapterError,
  assertMainActiveCommandDescriptor,
  buildMainActiveAppAliasRestoreCommand,
  buildMainActiveAppAliasRestoreSequence,
  buildMainActiveAppAliasSetCommand,
  buildMainActiveAppAliasSetSequence,
  buildMainActiveAppDeployCommand,
  buildMainActiveLegacyAliasRestoreCommand,
  buildMainActiveLegacyAliasRestoreSequence,
  buildMainActivePromotionCommand,
  buildMainActivePromotionSequence,
  buildMainActiveRollbackCommand,
  inspectMainActiveMapping,
  resolveMainActiveAppCandidate,
  runMainActiveVercelCommand,
  verifyMainActiveMapping,
} from "./vercel-main-active.mjs";
import { MAIN_TARGET_CONTRACTS } from "./vercel-main-plan.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import {
  createMainCandidateIntent,
  createMainCandidateVercelMetadata,
} from "./vercel-main-candidate.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const TRANSACTION_ID = "main-0123456789abcdef0123456789abcdef";
const TOKEN = ["test", "redaction", "sentinel"].join("-");
const APP_PROJECT_ID = "prj_app123";
const LEGACY_PROJECT_ID = "prj_app123";
const LEGACY_PRIOR = Object.freeze({
  deploymentId: "dpl_LegacyPrior123",
  deploymentUrl: "https://legacy-prior.vercel.app",
});
const APP_CANDIDATE = Object.freeze({
  deploymentId: "dpl_AppCandidate123",
  deploymentUrl: "https://app-candidate.vercel.app",
});
const APP_PRIOR = Object.freeze({
  deploymentId: "dpl_AppPrior123",
  deploymentUrl: "https://app-prior.vercel.app",
});
const ORDINARY_CANDIDATE = Object.freeze({
  deploymentId: "dpl_UiCandidate123",
  deploymentUrl: "https://ui-candidate.vercel.app",
});
const ORDINARY_PRIOR = Object.freeze({
  deploymentId: "dpl_UiPrior123",
  deploymentUrl: "https://ui-prior.vercel.app",
});

function appCandidateMetadata(overrides = {}) {
  const {
    originRunId = "7654321",
    originAttempt = "2",
    originTransactionId = TRANSACTION_ID,
  } = overrides;
  const targets = ["app", "governance", "reserve", "ui"];
  const priorSha = "1111111111111111111111111111111111111111";
  const plan = {
    schema: "vercel-main-plan:v2",
    mode: "active",
    deploySha: SHA,
    mainOwnershipMode: Object.fromEntries(
      targets.map((target) => [target, "github"]),
    ),
    stagedTargets: ["app"],
    activeTargets: ["app"],
    shadowTargets: [],
    plan: ["app"],
    priors: targets.map((target) => ({
      target,
      deploymentId: `dpl_${target}Prior123`,
      deploymentUrl: `https://${target}-prior.vercel.app`,
      aliases: [...MAIN_TARGET_CONTRACTS[target].aliases],
      servedSha: priorSha,
    })),
    ranges: [
      {
        base: priorSha,
        head: SHA,
        kind: "served",
        reason: "global-build-input",
        targets,
        deployments: ["app"],
      },
    ],
    reasons: [{ target: "app", base: priorSha, reason: "global-build-input" }],
  };
  const releaseManifest = createMainReleaseManifest({
    upstreamRunId: "700",
    plan,
    originalPriors: Object.fromEntries(
      ["governance", "reserve", "ui", "app"].map((target) => {
        const contract = MAIN_TARGET_CONTRACTS[target];
        const aliases = [...contract.aliases].sort();
        const prior = {
          deploymentId: `dpl_${target}Prior123`,
          deploymentUrl: `https://${target}-prior.vercel.app`,
          aliases,
          projectId: target === "app" ? APP_PROJECT_ID : `prj_${target}123`,
          projectName: contract.projectName,
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
    ),
  });
  const intent = createMainCandidateIntent({
    target: "app",
    deploySha: SHA,
    upstreamRunId: "700",
    originRunId,
    originAttempt,
    originTransactionId,
    projectId: APP_PROJECT_ID,
    releaseManifest,
  });
  return createMainCandidateVercelMetadata({ intent });
}

function appExpectation(overrides = {}) {
  const metadata = appCandidateMetadata();
  return {
    projectId: APP_PROJECT_ID,
    projectName: "app.mento.org",
    deploySha: SHA,
    runId: "7654321",
    runAttempt: "2",
    transactionId: TRANSACTION_ID,
    customEnvironmentSlug: "v3",
    nextDeploymentId: metadata.mentoNextDeploymentId,
    candidateMetadata: metadata,
    ...overrides,
  };
}

function appDeployCommand(overrides = {}) {
  const expectation = appExpectation(overrides);
  return buildMainActiveAppDeployCommand({
    projectId: expectation.projectId,
    deploySha: expectation.deploySha,
    runId: expectation.runId,
    runAttempt: expectation.runAttempt,
    transactionId: expectation.transactionId,
    nextDeploymentId: expectation.nextDeploymentId,
    candidateMetadata: expectation.candidateMetadata,
  });
}

function canonicalAppCandidate(overrides = {}) {
  return {
    ...APP_CANDIDATE,
    projectId: APP_PROJECT_ID,
    projectName: "app.mento.org",
    deploySha: SHA,
    runId: "7654321",
    runAttempt: "2",
    transactionId: TRANSACTION_ID,
    customEnvironmentSlug: "v3",
    ...overrides,
  };
}

function commandResult(overrides = {}) {
  return {
    outcome: "unknown",
    reason: "lost-output",
    candidate: null,
    ...overrides,
  };
}

function runCommand(command, spawn, environment = {}) {
  return runMainActiveVercelCommand({
    command,
    cliPath: "/trusted/vercel/dist/vc.js",
    cliFileDescriptor: 3,
    workingDirectory: "/workspace/app",
    environment: {
      CI: "true",
      PATH: "/usr/bin:/bin",
      SENTRY_AUTH_TOKEN: "test-placeholder",
      VERCEL_ORG_ID: "team_mento",
      VERCEL_TOKEN: TOKEN,
      ...environment,
    },
    nodeExecutable: "/usr/bin/node",
    spawn,
  });
}

function mapping(alias, deployment, projectId = "prj_app123") {
  return {
    alias,
    deploymentId: deployment.deploymentId,
    deploymentUrl: deployment.deploymentUrl,
    projectId,
  };
}

test("reviewed target and alias order is literal and immutable", () => {
  assert.deepEqual(MAIN_ACTIVE_ORDINARY_TARGETS, [
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(MAIN_ACTIVE_APP_ALIASES, [
    "app.mento.org",
    "appmentoorg-env-v3-mentolabs.vercel.app",
  ]);
  assert.equal(MAIN_ACTIVE_LEGACY_ALIAS, "v2-app.mento.org");
  assert.deepEqual(MAIN_ACTIVE_LEGACY_ALIASES, [
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
    "v2-app.mento.org",
  ]);
  assert.equal(MAIN_ACTIVE_COMMAND_TIMEOUT_MS, 120_000);
  assert.equal(Object.isFrozen(MAIN_ACTIVE_ORDINARY_TARGETS), true);
  assert.equal(Object.isFrozen(MAIN_ACTIVE_APP_ALIASES), true);
  assert.equal(Object.isFrozen(MAIN_ACTIVE_LEGACY_ALIASES), true);
});

test("ordinary promotion sequence is always governance, reserve, ui", () => {
  const sequence = buildMainActivePromotionSequence([
    {
      target: "ui",
      deploymentId: "dpl_UiCandidate123",
      deploymentUrl: "https://ui-candidate.vercel.app",
    },
    {
      target: "governance",
      deploymentId: "dpl_GovernanceCandidate123",
      deploymentUrl: "https://governance-candidate.vercel.app",
    },
    {
      target: "reserve",
      deploymentId: "dpl_ReserveCandidate123",
      deploymentUrl: "https://reserve-candidate.vercel.app",
    },
  ]);
  assert.deepEqual(
    sequence.map(({ target }) => target),
    ["governance", "reserve", "ui"],
  );
  assert.deepEqual(
    sequence.map(({ arguments: argumentsList }) => argumentsList),
    [
      ["promote", "dpl_GovernanceCandidate123", "--yes"],
      ["promote", "dpl_ReserveCandidate123", "--yes"],
      ["promote", "dpl_UiCandidate123", "--yes"],
    ],
  );
  assert.throws(
    () =>
      buildMainActivePromotionSequence([
        {
          target: "ui",
          ...ORDINARY_CANDIDATE,
        },
        {
          target: "ui",
          ...ORDINARY_CANDIDATE,
        },
      ]),
    /duplicated/,
  );
});

test("promotion builder accepts only an exact ordinary deployment identity", () => {
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...ORDINARY_CANDIDATE,
  });
  assert.deepEqual(command.arguments, [
    "promote",
    ORDINARY_CANDIDATE.deploymentId,
    "--yes",
  ]);
  assert.deepEqual(assertMainActiveCommandDescriptor(command), command);
  assert.throws(
    () =>
      buildMainActivePromotionCommand({
        target: "app",
        ...ORDINARY_CANDIDATE,
      }),
    /not allowlisted/,
  );
  assert.throws(
    () =>
      buildMainActivePromotionCommand({
        target: "ui",
        deploymentId: "latest",
        deploymentUrl: ORDINARY_CANDIDATE.deploymentUrl,
      }),
    /deployment ID is malformed/i,
  );
  assert.throws(
    () =>
      buildMainActivePromotionCommand({
        target: "ui",
        deploymentId: ORDINARY_CANDIDATE.deploymentId,
        deploymentUrl: "https://ui-candidate.vercel.app/path",
      }),
    /deployment URL is malformed/i,
  );
  assert.throws(
    () =>
      buildMainActivePromotionCommand({
        target: "ui",
        ...ORDINARY_CANDIDATE,
        token: TOKEN,
      }),
    /forbidden or missing fields/,
  );
});

test("App command is the exact custom-v3 prebuilt deploy with reviewed metadata", () => {
  const command = appDeployCommand();
  const metadata = appCandidateMetadata();
  assert.deepEqual(command.arguments, [
    "deploy",
    "--prebuilt",
    "--target=v3",
    "--archive=tgz",
    "--format=json",
    "--yes",
    "--project",
    APP_PROJECT_ID,
    "--meta",
    "githubCommitOrg=mento-protocol",
    "--meta",
    "githubCommitRepo=frontend-monorepo",
    "--meta",
    "githubCommitRef=main",
    "--meta",
    `githubCommitSha=${SHA}`,
    ...Object.entries(metadata)
      .map(([key, value]) => ["--meta", `${key}=${value}`])
      .flat(),
  ]);
  assert.equal(command.target, "app");
  assert.equal(command.arguments.length, 16 + Object.keys(metadata).length * 2);
  assert.equal(
    command.arguments.filter((argument) => argument === "--meta").length,
    4 + Object.keys(metadata).length,
  );
  assert.equal(command.arguments.includes(`mentoRunId=7654321`), false);
  assert.equal(command.arguments.includes(`mentoRunAttempt=2`), false);
  assert.equal(
    command.arguments.includes(`mentoTransactionId=${TRANSACTION_ID}`),
    false,
  );
  assert.equal(command.arguments.includes("--prod"), false);
  assert.equal(command.arguments.includes("--skip-domain"), false);
  assert.equal(command.arguments.includes("promote"), false);
  assert.equal(
    command.arguments.some((argument) => argument.startsWith("--token")),
    false,
  );
  assert.deepEqual(assertMainActiveCommandDescriptor(command), command);
});

test("App deploy rejects malformed or non-reviewed transaction identity", () => {
  assert.throws(
    () => appDeployCommand({ deploySha: "main" }),
    /deploy SHA is malformed/,
  );
  assert.throws(() => appDeployCommand({ runId: "0" }), /run ID is malformed/);
  assert.throws(
    () => appDeployCommand({ transactionId: "main-latest" }),
    /transaction ID is malformed/,
  );
  assert.throws(
    () => appDeployCommand({ nextDeploymentId: "dpl_forbidden" }),
    /custom Next deployment ID is malformed/,
  );
  const valid = appDeployCommand();
  const altered = {
    ...valid,
    arguments: [...valid.arguments, "--prod"],
  };
  assert.throws(
    () => assertMainActiveCommandDescriptor(altered),
    /descriptor was altered/,
  );
});

test("App deploy requires one bounded canonical stable metadata fixture", () => {
  const metadata = appCandidateMetadata();
  assert.throws(
    () =>
      appDeployCommand({
        candidateMetadata: {
          ...metadata,
          mentoNextDeploymentId: "mr-app-forged",
        },
      }),
    /stable fields conflict/,
  );
  const missing = { ...metadata };
  delete missing.mentoReleaseManifestChunk0;
  assert.throws(
    () => appDeployCommand({ candidateMetadata: missing }),
    /manifest chunk|incomplete/,
  );
  assert.throws(
    () =>
      appDeployCommand({
        candidateMetadata: { ...metadata, mentoUnsupported: "forged" },
      }),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      appDeployCommand({
        candidateMetadata: { ...metadata, githubDeployment: "forbidden" },
      }),
    /GitHub-owned/,
  );
  assert.throws(
    () =>
      appDeployCommand({
        candidateMetadata: {
          ...metadata,
          mentoReleaseManifestChunk0: "x".repeat(8_193),
        },
      }),
    /bounded size/,
  );
});

test("App reruns retain stable candidate metadata and change only audit origin", () => {
  const first = appCandidateMetadata();
  const second = appCandidateMetadata({
    originRunId: "7654322",
    originAttempt: "3",
    originTransactionId: "main-abcdefabcdefabcdefabcdefabcdefab",
  });
  const auditKeys = new Set([
    "mentoOriginRunId",
    "mentoOriginRunAttempt",
    "mentoOriginTransactionId",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(first).filter(([key]) => !auditKeys.has(key)),
    ),
    Object.fromEntries(
      Object.entries(second).filter(([key]) => !auditKeys.has(key)),
    ),
  );
  assert.notDeepEqual(
    Object.fromEntries(
      Object.entries(first).filter(([key]) => auditKeys.has(key)),
    ),
    Object.fromEntries(
      Object.entries(second).filter(([key]) => auditKeys.has(key)),
    ),
  );
});

test("App alias commands cover exactly both reviewed v3 aliases", () => {
  const sequence = buildMainActiveAppAliasSetSequence(APP_CANDIDATE);
  assert.deepEqual(
    sequence.map(({ alias }) => alias),
    MAIN_ACTIVE_APP_ALIASES,
  );
  for (const command of sequence) {
    assert.deepEqual(command.arguments, [
      "alias",
      "set",
      APP_CANDIDATE.deploymentUrl,
      command.alias,
    ]);
    assert.deepEqual(assertMainActiveCommandDescriptor(command), command);
  }
  assert.throws(
    () =>
      buildMainActiveAppAliasSetCommand({
        alias: "v2-app.mento.org",
        ...APP_CANDIDATE,
      }),
    /not allowlisted/,
  );
});

test("recovery builders use only captured exact prior identities", () => {
  const rollback = buildMainActiveRollbackCommand({
    target: "ui",
    ...ORDINARY_PRIOR,
  });
  assert.deepEqual(rollback.arguments, [
    "rollback",
    ORDINARY_PRIOR.deploymentId,
    "--yes",
  ]);

  const appRestores = buildMainActiveAppAliasRestoreSequence(APP_PRIOR);
  assert.deepEqual(
    appRestores.map(({ arguments: argumentsList }) => argumentsList),
    MAIN_ACTIVE_APP_ALIASES.map((alias) => [
      "alias",
      "set",
      APP_PRIOR.deploymentUrl,
      alias,
    ]),
  );
  assert.equal(
    assertMainActiveCommandDescriptor(
      buildMainActiveAppAliasRestoreCommand({
        alias: MAIN_ACTIVE_APP_ALIASES[0],
        ...APP_PRIOR,
      }),
    ).kind,
    "app-alias-restore",
  );

  const legacyRestores = buildMainActiveLegacyAliasRestoreSequence({
    aliases: [...MAIN_ACTIVE_LEGACY_ALIASES],
    projectId: LEGACY_PROJECT_ID,
    ...LEGACY_PRIOR,
  });
  assert.deepEqual(
    legacyRestores.map(({ alias }) => alias),
    MAIN_ACTIVE_LEGACY_ALIASES,
  );
  for (const legacy of legacyRestores) {
    assert.deepEqual(legacy.arguments, [
      "alias",
      "set",
      LEGACY_PRIOR.deploymentUrl,
      legacy.alias,
    ]);
    assert.deepEqual(legacy.aliases, MAIN_ACTIVE_LEGACY_ALIASES);
    assert.equal(legacy.projectId, LEGACY_PROJECT_ID);
    assert.equal(Object.isFrozen(legacy.aliases), true);
    assert.deepEqual(assertMainActiveCommandDescriptor(legacy), legacy);
  }
  assert.throws(
    () =>
      buildMainActiveLegacyAliasRestoreCommand({
        alias: "app.mento.org",
        aliases: [...MAIN_ACTIVE_LEGACY_ALIASES],
        projectId: LEGACY_PROJECT_ID,
        ...LEGACY_PRIOR,
      }),
    /not allowlisted/,
  );
});

test("legacy compensation requires the complete reviewed topology and cannot become a cutover mutation", () => {
  const exact = {
    aliases: [...MAIN_ACTIVE_LEGACY_ALIASES],
    projectId: LEGACY_PROJECT_ID,
    ...LEGACY_PRIOR,
  };
  for (const aliases of [
    MAIN_ACTIVE_LEGACY_ALIASES.slice(1),
    [...MAIN_ACTIVE_LEGACY_ALIASES, "unexpected.mento.org"],
    [...MAIN_ACTIVE_LEGACY_ALIASES, MAIN_ACTIVE_LEGACY_ALIAS],
    [...MAIN_ACTIVE_LEGACY_ALIASES].reverse(),
  ]) {
    assert.throws(
      () =>
        buildMainActiveLegacyAliasRestoreSequence({
          ...exact,
          aliases,
        }),
      /exactly match the reviewed v2 topology/,
    );
  }
  assert.throws(
    () =>
      buildMainActiveLegacyAliasRestoreSequence({
        ...exact,
        projectId: "not a project id",
      }),
    /project ID is malformed/,
  );

  for (const builder of [
    buildMainActivePromotionCommand,
    buildMainActiveRollbackCommand,
  ]) {
    assert.throws(
      () =>
        builder({
          target: "legacy-app",
          ...LEGACY_PRIOR,
        }),
      /Ordinary target is not allowlisted/,
    );
  }

  const restore = buildMainActiveLegacyAliasRestoreCommand({
    alias: MAIN_ACTIVE_LEGACY_ALIASES[0],
    ...exact,
  });
  for (const forbidden of ["deploy", "promote", "rollback", "--prod"]) {
    assert.equal(restore.arguments.includes(forbidden), false);
  }
  assert.throws(
    () =>
      assertMainActiveCommandDescriptor({
        ...restore,
        arguments: ["promote", LEGACY_PRIOR.deploymentId, "--yes"],
      }),
    /descriptor was altered/,
  );
});

test("descriptor allowlist rejects token arguments and forged commands", () => {
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...ORDINARY_CANDIDATE,
  });
  assert.throws(
    () =>
      assertMainActiveCommandDescriptor({
        ...command,
        arguments: [...command.arguments, "--token", TOKEN],
      }),
    /not allowlisted/,
  );
  assert.throws(
    () =>
      assertMainActiveCommandDescriptor({
        ...command,
        arguments: [...command.arguments, "--scope", "team_attacker"],
      }),
    /descriptor was altered/,
  );
  assert.throws(
    () =>
      assertMainActiveCommandDescriptor({
        ...command,
        kind: "project-remove",
      }),
    /kind is not allowlisted/,
  );
  assert.throws(
    () =>
      assertMainActiveCommandDescriptor({
        ...command,
        rawOutput: TOKEN,
      }),
    /forbidden or missing fields/,
  );
});

test("runner sends the token only through a filtered process environment", () => {
  const calls = [];
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...ORDINARY_CANDIDATE,
  });
  const result = runCommand(command, (executable, argumentsList, options) => {
    calls.push({ executable, argumentsList, options });
    return {
      status: 0,
      signal: null,
      stdout: "promotion complete",
      stderr: "",
    };
  });
  assert.deepEqual(result, {
    outcome: "success",
    reason: null,
    candidate: null,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "/usr/bin/node");
  assert.equal(calls[0].argumentsList[0], "--experimental-loader");
  assert.match(calls[0].argumentsList[1], /^data:text\/javascript,/);
  assert.equal(calls[0].argumentsList[2], "--eval");
  assert.equal(
    calls[0].argumentsList[3],
    'process.argv.splice(1, 0, "/trusted/vercel/dist/vc.js"); await import("/trusted/vercel/dist/vc.js");',
  );
  assert.equal(calls[0].argumentsList[4], "--");
  assert.deepEqual(calls[0].argumentsList.slice(5), [
    ...command.arguments,
    "--scope",
    "team_mento",
  ]);
  assert.equal(calls[0].argumentsList.includes(TOKEN), false);
  assert.equal(
    calls[0].argumentsList.some((argument) => argument.startsWith("--token")),
    false,
  );
  assert.equal(calls[0].options.env.VERCEL_TOKEN, TOKEN);
  assert.equal(Object.hasOwn(calls[0].options.env, "SENTRY_AUTH_TOKEN"), false);
  assert.equal(calls[0].options.timeout, MAIN_ACTIVE_COMMAND_TIMEOUT_MS);
});

test("runner requires a canonical Vercel team ID before binding command scope", () => {
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...ORDINARY_CANDIDATE,
  });
  let calls = 0;
  for (const VERCEL_ORG_ID of [
    undefined,
    "mento",
    "team_bad-id",
    "team_bad\n",
  ]) {
    assert.throws(
      () =>
        runCommand(
          command,
          () => {
            calls += 1;
          },
          { VERCEL_ORG_ID },
        ),
      /VERCEL_ORG_ID is missing or malformed/,
    );
  }
  assert.equal(calls, 0);
});

test("nonzero, timeout, and thrown execution outcomes stay unknown and redacted", () => {
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...ORDINARY_CANDIDATE,
  });
  const rawFailure = `${TOKEN}: raw provider response`;
  const nonzero = runCommand(command, () => ({
    status: 1,
    signal: null,
    stdout: rawFailure,
    stderr: rawFailure,
  }));
  const timeout = runCommand(command, () => ({
    error: { code: "ETIMEDOUT", message: rawFailure },
    status: null,
    signal: "SIGTERM",
    stdout: rawFailure,
    stderr: rawFailure,
  }));
  const thrown = runCommand(command, () => {
    throw new Error(rawFailure);
  });
  assert.deepEqual(nonzero, {
    outcome: "unknown",
    reason: "nonzero",
    candidate: null,
  });
  assert.deepEqual(timeout, {
    outcome: "unknown",
    reason: "timeout",
    candidate: null,
  });
  assert.deepEqual(thrown, {
    outcome: "unknown",
    reason: "spawn-error",
    candidate: null,
  });
  const rendered = JSON.stringify({ nonzero, timeout, thrown });
  assert.doesNotMatch(rendered, /raw provider response/);
  assert.equal(rendered.includes(TOKEN), false);
});

test("App deploy output is allowlisted; lost or malformed output stays unknown", () => {
  const command = appDeployCommand();
  const success = runCommand(command, () => ({
    status: 0,
    signal: null,
    stdout: JSON.stringify({
      status: "ok",
      deployment: {
        id: APP_CANDIDATE.deploymentId,
        url: "app-candidate.vercel.app",
        inspectorUrl: "https://vercel.com/secret-provider-path",
        readyState: "READY",
        target: null,
      },
    }),
    stderr: "",
  }));
  assert.deepEqual(success, {
    outcome: "success",
    reason: null,
    candidate: APP_CANDIDATE,
  });

  for (const stdout of [
    "",
    "not json",
    JSON.stringify({
      id: "latest",
      url: APP_CANDIDATE.deploymentUrl,
      readyState: "READY",
      target: null,
    }),
    JSON.stringify({
      id: APP_CANDIDATE.deploymentId,
      url: "https://app-candidate.vercel.app/path",
      readyState: "READY",
      target: null,
      secret: TOKEN,
    }),
    JSON.stringify({
      id: APP_CANDIDATE.deploymentId,
      url: APP_CANDIDATE.deploymentUrl,
      readyState: "BUILDING",
      target: null,
    }),
    JSON.stringify({
      status: "error",
      deployment: {
        id: APP_CANDIDATE.deploymentId,
        url: APP_CANDIDATE.deploymentUrl,
        readyState: "READY",
        target: null,
      },
    }),
  ]) {
    const result = runCommand(command, () => ({
      status: 0,
      signal: null,
      stdout,
      stderr: TOKEN,
    }));
    assert.deepEqual(result, {
      outcome: "unknown",
      reason: "lost-output",
      candidate: null,
    });
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});

test("missing token and malformed execution paths fail before spawning", () => {
  let calls = 0;
  const command = buildMainActivePromotionCommand({
    target: "ui",
    ...ORDINARY_CANDIDATE,
  });
  assert.throws(
    () =>
      runMainActiveVercelCommand({
        command,
        cliPath: "/trusted/vercel/dist/vc.js",
        cliFileDescriptor: 3,
        workingDirectory: "/workspace/app",
        environment: {},
        nodeExecutable: "/usr/bin/node",
        spawn: () => {
          calls += 1;
        },
      }),
    /VERCEL_TOKEN is missing or malformed/,
  );
  assert.throws(
    () =>
      runMainActiveVercelCommand({
        command,
        cliPath: "node_modules/vercel/dist/vc.js",
        cliFileDescriptor: 3,
        workingDirectory: "/workspace/app",
        environment: { VERCEL_TOKEN: TOKEN },
        nodeExecutable: "/usr/bin/node",
        spawn: () => {
          calls += 1;
        },
      }),
    /execution contract is malformed/,
  );
  assert.equal(calls, 0);
});

test("exact READY App candidate discovery resolves an unknown command outcome", async () => {
  const seen = [];
  const resolved = await resolveMainActiveAppCandidate({
    commandResult: commandResult(),
    expectation: appExpectation(),
    discoverCandidate: async (expectation) => {
      seen.push(expectation);
      return canonicalAppCandidate();
    },
  });
  const expectation = { ...appExpectation() };
  delete expectation.candidateMetadata;
  assert.deepEqual(seen, [expectation]);
  assert.deepEqual(resolved, {
    commandOutcome: "unknown",
    candidate: canonicalAppCandidate(),
  });
});

test("candidate discovery fails closed on zero, multiple, malformed, or conflicting identity", async () => {
  const secretFailure = `${TOKEN}: zero or multiple provider matches`;
  await assert.rejects(
    resolveMainActiveAppCandidate({
      commandResult: commandResult(),
      expectation: appExpectation(),
      discoverCandidate: async () => {
        throw new Error(secretFailure);
      },
    }),
    (error) => {
      assert.equal(error instanceof MainActiveAdapterError, true);
      assert.equal(error.code, "MAIN_ACTIVE_DISCOVERY_FAILED");
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    },
  );
  await assert.rejects(
    resolveMainActiveAppCandidate({
      commandResult: commandResult(),
      expectation: appExpectation(),
      discoverCandidate: async () =>
        canonicalAppCandidate({ transactionId: "main-latest" }),
    }),
    /malformed canonical state/,
  );
  await assert.rejects(
    resolveMainActiveAppCandidate({
      commandResult: commandResult({
        outcome: "success",
        reason: null,
        candidate: APP_CANDIDATE,
      }),
      expectation: appExpectation(),
      discoverCandidate: async () =>
        canonicalAppCandidate({
          deploymentId: "dpl_DifferentCandidate123",
          deploymentUrl: "https://different-candidate.vercel.app",
        }),
    }),
    /conflicts with discovered candidate/,
  );
});

test("App candidate READY verification is independent of partial alias topology", async () => {
  const candidate = await resolveMainActiveAppCandidate({
    commandResult: commandResult(),
    expectation: appExpectation(),
    discoverCandidate: async () => canonicalAppCandidate(),
  });
  const inspection = await inspectMainActiveMapping({
    target: "app",
    priorDeployment: APP_PRIOR,
    candidateDeployment: APP_CANDIDATE,
    captureMappings: async (aliases) => [
      mapping(aliases[0], APP_CANDIDATE),
      mapping(aliases[1], APP_PRIOR),
    ],
  });
  assert.equal(candidate.candidate.deploymentId, APP_CANDIDATE.deploymentId);
  assert.equal(inspection.mappingState, "partial");
  assert.deepEqual(
    inspection.mappings.map(({ alias }) => alias),
    MAIN_ACTIVE_APP_ALIASES,
  );
});

test("partial App aliases can be inspected independently for per-alias decisions", async () => {
  const deployments = new Map([
    [MAIN_ACTIVE_APP_ALIASES[0], APP_CANDIDATE],
    [MAIN_ACTIVE_APP_ALIASES[1], APP_PRIOR],
  ]);
  const captureMappings = async (aliases) =>
    aliases.map((alias) => mapping(alias, deployments.get(alias)));
  const candidateAlias = await inspectMainActiveMapping({
    target: "app",
    aliases: [MAIN_ACTIVE_APP_ALIASES[0]],
    priorDeployment: APP_PRIOR,
    candidateDeployment: APP_CANDIDATE,
    captureMappings,
  });
  const priorAlias = await inspectMainActiveMapping({
    target: "app",
    aliases: [MAIN_ACTIVE_APP_ALIASES[1]],
    priorDeployment: APP_PRIOR,
    candidateDeployment: APP_CANDIDATE,
    captureMappings,
  });
  assert.equal(candidateAlias.mappingState, "candidate");
  assert.equal(priorAlias.mappingState, "prior");
  await assert.rejects(
    inspectMainActiveMapping({
      target: "app",
      aliases: [MAIN_ACTIVE_APP_ALIASES[1], MAIN_ACTIVE_APP_ALIASES[0]],
      priorDeployment: APP_PRIOR,
      candidateDeployment: APP_CANDIDATE,
      captureMappings,
    }),
    /reviewed-order subset/,
  );
  await assert.rejects(
    inspectMainActiveMapping({
      target: "app",
      aliases: ["unreviewed.mento.org"],
      priorDeployment: APP_PRIOR,
      candidateDeployment: APP_CANDIDATE,
      captureMappings,
    }),
    /not allowlisted/,
  );
});

test("legacy verification binds every reviewed alias to the exact App project", async () => {
  const input = {
    target: "legacy-app",
    aliases: [...MAIN_ACTIVE_LEGACY_ALIASES],
    projectId: LEGACY_PROJECT_ID,
    priorDeployment: LEGACY_PRIOR,
    candidateDeployment: APP_CANDIDATE,
  };
  const capturePrior = async (aliases) =>
    aliases.map((alias) => mapping(alias, LEGACY_PRIOR, LEGACY_PROJECT_ID));
  const inspection = await inspectMainActiveMapping({
    ...input,
    captureMappings: capturePrior,
  });
  assert.equal(inspection.mappingState, "prior");
  assert.deepEqual(
    inspection.mappings,
    MAIN_ACTIVE_LEGACY_ALIASES.map((alias) => ({
      alias,
      ...LEGACY_PRIOR,
      projectId: LEGACY_PROJECT_ID,
    })),
  );
  const verified = await verifyMainActiveMapping({
    ...input,
    expectedMappingState: "prior",
    captureMappings: capturePrior,
  });
  assert.equal(verified.mappingState, "prior");

  for (const aliases of [
    MAIN_ACTIVE_LEGACY_ALIASES.slice(1),
    [...MAIN_ACTIVE_LEGACY_ALIASES, "unexpected.mento.org"],
    [...MAIN_ACTIVE_LEGACY_ALIASES, MAIN_ACTIVE_LEGACY_ALIAS],
  ]) {
    await assert.rejects(
      inspectMainActiveMapping({
        ...input,
        aliases,
        captureMappings: capturePrior,
      }),
      /exactly match the reviewed v2 topology/,
    );
  }
  await assert.rejects(
    inspectMainActiveMapping({
      ...input,
      captureMappings: async (aliases) =>
        aliases.map((alias) => mapping(alias, LEGACY_PRIOR, "prj_foreign123")),
    }),
    /Protected mapping inspection failed closed/,
  );
  await assert.rejects(
    inspectMainActiveMapping({
      ...input,
      captureMappings: async (aliases) =>
        aliases
          .slice(1)
          .map((alias) => mapping(alias, LEGACY_PRIOR, LEGACY_PROJECT_ID)),
    }),
    /Protected mapping inspection failed closed/,
  );

  const foreign = {
    deploymentId: "dpl_ForeignLegacy123",
    deploymentUrl: "https://foreign-legacy.vercel.app",
  };
  await assert.rejects(
    verifyMainActiveMapping({
      ...input,
      expectedMappingState: "prior",
      captureMappings: async (aliases) =>
        aliases.map((alias) => mapping(alias, foreign, LEGACY_PROJECT_ID)),
    }),
    /verification failed \(unexpected\)/,
  );
});

test("mapping inspection captures only exact reviewed aliases and canonical fields", async () => {
  const calls = [];
  const inspection = await inspectMainActiveMapping({
    target: "app",
    priorDeployment: APP_PRIOR,
    candidateDeployment: APP_CANDIDATE,
    captureMappings: async (aliases) => {
      calls.push(aliases);
      assert.equal(Object.isFrozen(aliases), true);
      return aliases.map((alias) => mapping(alias, APP_CANDIDATE));
    },
  });
  assert.deepEqual(calls, [MAIN_ACTIVE_APP_ALIASES]);
  assert.equal(inspection.mappingState, "candidate");
  assert.deepEqual(inspection.mappings, [
    {
      alias: "app.mento.org",
      ...APP_CANDIDATE,
    },
    {
      alias: "appmentoorg-env-v3-mentolabs.vercel.app",
      ...APP_CANDIDATE,
    },
  ]);
  assert.equal(
    inspection.mappings.some((entry) => Object.hasOwn(entry, "projectId")),
    false,
  );
});

test("mapping classifier preserves prior, candidate, partial, and unexpected states", async () => {
  const scenarios = [
    ["prior", [APP_PRIOR, APP_PRIOR]],
    ["candidate", [APP_CANDIDATE, APP_CANDIDATE]],
    ["partial", [APP_PRIOR, APP_CANDIDATE]],
    [
      "unexpected",
      [
        APP_PRIOR,
        {
          deploymentId: "dpl_OperatorDeployment123",
          deploymentUrl: "https://operator-deployment.vercel.app",
        },
      ],
    ],
  ];
  for (const [expected, deployments] of scenarios) {
    const inspection = await inspectMainActiveMapping({
      target: "app",
      priorDeployment: APP_PRIOR,
      candidateDeployment: APP_CANDIDATE,
      captureMappings: async (aliases) =>
        aliases.map((alias, index) => mapping(alias, deployments[index])),
    });
    assert.equal(inspection.mappingState, expected);
  }
});

test("mapping verification accepts exact expected state and rejects partial or unexpected", async () => {
  const verified = await verifyMainActiveMapping({
    target: "ui",
    priorDeployment: ORDINARY_PRIOR,
    candidateDeployment: ORDINARY_CANDIDATE,
    expectedMappingState: "candidate",
    captureMappings: async ([alias]) => [
      mapping(alias, ORDINARY_CANDIDATE, "prj_ui123"),
    ],
  });
  assert.equal(verified.mappingState, "candidate");

  await assert.rejects(
    verifyMainActiveMapping({
      target: "app",
      priorDeployment: APP_PRIOR,
      candidateDeployment: APP_CANDIDATE,
      expectedMappingState: "candidate",
      captureMappings: async (aliases) => [
        mapping(aliases[0], APP_PRIOR),
        mapping(aliases[1], APP_CANDIDATE),
      ],
    }),
    /verification failed \(partial\)/,
  );
  await assert.rejects(
    verifyMainActiveMapping({
      target: "app",
      priorDeployment: APP_PRIOR,
      candidateDeployment: APP_CANDIDATE,
      expectedMappingState: "candidate",
      captureMappings: async (aliases) => [
        mapping(aliases[0], APP_CANDIDATE),
        mapping(aliases[1], {
          deploymentId: "dpl_OperatorDeployment123",
          deploymentUrl: "https://operator-deployment.vercel.app",
        }),
      ],
    }),
    /verification failed \(unexpected\)/,
  );
});

test("mapping inspection rejects missing, duplicated, and raw extra state without leaking it", async () => {
  const rawSecret = `${TOKEN}: protection bypass`;
  for (const captureMappings of [
    async ([alias]) => [mapping(alias, APP_PRIOR)],
    async ([first]) => [mapping(first, APP_PRIOR), mapping(first, APP_PRIOR)],
    async (aliases) =>
      aliases.map((alias) => ({
        ...mapping(alias, APP_PRIOR),
        protectionBypass: rawSecret,
      })),
    async () => {
      throw new Error(rawSecret);
    },
  ]) {
    await assert.rejects(
      inspectMainActiveMapping({
        target: "app",
        priorDeployment: APP_PRIOR,
        candidateDeployment: APP_CANDIDATE,
        captureMappings,
      }),
      (error) => {
        assert.equal(error instanceof MainActiveAdapterError, true);
        assert.equal(error.code, "MAIN_ACTIVE_MAPPING_FAILED");
        assert.equal(error.message.includes(TOKEN), false);
        assert.equal(error.message.includes("protection bypass"), false);
        return true;
      },
    );
  }
});
