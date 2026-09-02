import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAIN_ACTIVE_APP_BRIDGE_ALIASES,
  MAIN_ACTIVE_COMMAND_TIMEOUT_MS,
  MAIN_ACTIVE_PROMOTABLE_TARGETS,
  MainActiveAdapterError,
  assertMainActiveCommandDescriptor,
  buildMainActiveAppAliasRestoreCommand,
  buildMainActiveAppAliasRestoreSequence,
  buildMainActiveAppAliasSetCommand,
  buildMainActiveAppAliasSetSequence,
  buildMainActivePromotionCommand,
  buildMainActivePromotionSequence,
  buildMainActiveRollbackCommand,
  inspectMainActiveMapping,
  runMainActiveVercelCommand,
  verifyMainActiveMapping,
} from "./vercel-main-active.mjs";
import { MAIN_TARGET_CONTRACTS } from "./vercel-main-plan.mjs";
import { classifyMainTransactionMapping } from "./vercel-main-transaction.mjs";

const TOKEN = ["test", "redaction", "sentinel"].join("-");
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
  assert.deepEqual(MAIN_ACTIVE_PROMOTABLE_TARGETS, [
    "governance",
    "reserve",
    "ui",
    "app",
  ]);
  // TRANSITION-V3-PRIOR: exactly one bridge alias.
  assert.deepEqual(MAIN_ACTIVE_APP_BRIDGE_ALIASES, ["app.mento.org"]);
  assert.deepEqual(
    MAIN_ACTIVE_APP_BRIDGE_ALIASES,
    MAIN_TARGET_CONTRACTS.app.aliases,
  );
  assert.equal(MAIN_ACTIVE_COMMAND_TIMEOUT_MS, 120_000);
  assert.equal(Object.isFrozen(MAIN_ACTIVE_PROMOTABLE_TARGETS), true);
  assert.equal(Object.isFrozen(MAIN_ACTIVE_APP_BRIDGE_ALIASES), true);
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
  // App promotes through the same builder as every other main target.
  const appPromote = buildMainActivePromotionCommand({
    target: "app",
    ...APP_CANDIDATE,
  });
  assert.deepEqual(appPromote.arguments, [
    "promote",
    APP_CANDIDATE.deploymentId,
    "--yes",
  ]);
  assert.deepEqual(assertMainActiveCommandDescriptor(appPromote), appPromote);
  assert.throws(
    () =>
      buildMainActivePromotionCommand({
        target: "legacy-app",
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

test("App bridge alias commands cover exactly the reviewed App domain", () => {
  const sequence = buildMainActiveAppAliasSetSequence(APP_CANDIDATE);
  assert.deepEqual(
    sequence.map(({ alias }) => alias),
    MAIN_ACTIVE_APP_BRIDGE_ALIASES,
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
    MAIN_ACTIVE_APP_BRIDGE_ALIASES.map((alias) => [
      "alias",
      "set",
      APP_PRIOR.deploymentUrl,
      alias,
    ]),
  );
  assert.equal(
    assertMainActiveCommandDescriptor(
      buildMainActiveAppAliasRestoreCommand({
        alias: MAIN_ACTIVE_APP_BRIDGE_ALIASES[0],
        ...APP_PRIOR,
      }),
    ).kind,
    "app-alias-restore",
  );
});

// The retired legacy App deployment was the only alias topology a restore
// command could bind outside the reviewed App v3 aliases. Nothing may
// re-admit it as a target, an alias, or a command kind.
test("the retired legacy App target cannot re-enter any command builder", () => {
  const prior = {
    deploymentId: "dpl_LegacyPrior123",
    deploymentUrl: "https://legacy-prior.vercel.app",
  };
  for (const builder of [
    buildMainActivePromotionCommand,
    buildMainActiveRollbackCommand,
  ]) {
    assert.throws(
      () => builder({ target: "legacy-app", ...prior }),
      /Promotable target is not allowlisted/,
    );
  }
  for (const alias of [
    "v2-app.mento.org",
    "appmentoorg-env-v3-mentolabs.vercel.app",
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
  ]) {
    assert.equal(MAIN_ACTIVE_APP_BRIDGE_ALIASES.includes(alias), false);
    assert.throws(
      () => buildMainActiveAppAliasRestoreCommand({ alias, ...prior }),
      /not allowlisted/,
    );
    assert.throws(
      () => buildMainActiveAppAliasSetCommand({ alias, ...prior }),
      /not allowlisted/,
    );
  }
  assert.throws(
    () =>
      assertMainActiveCommandDescriptor({
        kind: "legacy-alias-restore",
        target: "legacy-app",
        alias: "v2-app.mento.org",
        aliases: ["v2-app.mento.org"],
        projectId: "prj_app123",
        ...prior,
        arguments: ["alias", "set", prior.deploymentUrl, "v2-app.mento.org"],
      }),
    /Vercel command kind is not allowlisted/,
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
  const result = runCommand(
    command,
    (executable, argumentsList, options) => {
      calls.push({ executable, argumentsList, options });
      return {
        status: 0,
        signal: null,
        stdout: "promotion complete",
        stderr: "",
      };
    },
    { VERCEL_PROJECT_ID: "prj_untrusted" },
  );
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
  assert.equal(Object.hasOwn(calls[0].options.env, "VERCEL_ORG_ID"), false);
  assert.equal(Object.hasOwn(calls[0].options.env, "VERCEL_PROJECT_ID"), false);
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

// TRANSITION-V3-PRIOR: the bridge alias is the App target's only reviewed
// alias, so a per-alias inspection covers exactly it.
test("the reviewed App alias is inspected on its own", async () => {
  const captureMappings = async (aliases) =>
    aliases.map((alias) => mapping(alias, APP_CANDIDATE));
  const inspection = await inspectMainActiveMapping({
    target: "app",
    aliases: [MAIN_ACTIVE_APP_BRIDGE_ALIASES[0]],
    priorDeployment: APP_PRIOR,
    candidateDeployment: APP_CANDIDATE,
    captureMappings,
  });
  assert.equal(inspection.mappingState, "candidate");
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

test("protected mapping inspection rejects the retired legacy target and project bindings", async () => {
  const prior = {
    deploymentId: "dpl_LegacyPrior123",
    deploymentUrl: "https://legacy-prior.vercel.app",
  };
  const captureMappings = async (aliases) =>
    aliases.map((alias) => mapping(alias, prior));
  await assert.rejects(
    inspectMainActiveMapping({
      target: "legacy-app",
      priorDeployment: prior,
      candidateDeployment: APP_CANDIDATE,
      captureMappings,
    }),
    /target is not allowlisted/,
  );
  await assert.rejects(
    inspectMainActiveMapping({
      target: "app",
      projectId: "prj_app123",
      priorDeployment: prior,
      candidateDeployment: APP_CANDIDATE,
      captureMappings,
    }),
    /does not accept a project binding/,
  );
  for (const alias of [
    "v2-app.mento.org",
    "appmentoorg-env-v3-mentolabs.vercel.app",
    "appmentoorg-git-v2-mentolabs.vercel.app",
    "appmentoorg-mentolabs.vercel.app",
    "appmentoorg.vercel.app",
  ]) {
    await assert.rejects(
      inspectMainActiveMapping({
        target: "app",
        aliases: [alias],
        priorDeployment: prior,
        candidateDeployment: APP_CANDIDATE,
        captureMappings,
      }),
      /Mapping alias is not allowlisted/,
    );
  }
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
  assert.deepEqual(calls, [MAIN_ACTIVE_APP_BRIDGE_ALIASES]);
  assert.equal(inspection.mappingState, "candidate");
  assert.deepEqual(inspection.mappings, [
    {
      alias: "app.mento.org",
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
    ["prior", [APP_PRIOR]],
    ["candidate", [APP_CANDIDATE]],
    [
      "unexpected",
      [
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
  // Every reviewed target now maps exactly one alias, so `partial` is only
  // reachable through the classifier itself.
  assert.equal(
    classifyMainTransactionMapping({
      aliases: ["app.mento.org", "second.mento.org"],
      currentMappings: [
        { alias: "app.mento.org", ...APP_PRIOR },
        { alias: "second.mento.org", ...APP_CANDIDATE },
      ],
      prior: {
        ...APP_PRIOR,
        aliases: ["app.mento.org", "second.mento.org"],
      },
      candidate: {
        ...APP_CANDIDATE,
        aliases: ["app.mento.org", "second.mento.org"],
      },
    }),
    "partial",
  );
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
      captureMappings: async (aliases) => [mapping(aliases[0], APP_PRIOR)],
    }),
    /verification failed \(prior\)/,
  );
  await assert.rejects(
    verifyMainActiveMapping({
      target: "app",
      priorDeployment: APP_PRIOR,
      candidateDeployment: APP_CANDIDATE,
      expectedMappingState: "candidate",
      captureMappings: async (aliases) => [
        mapping(aliases[0], {
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
    async () => [],
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
