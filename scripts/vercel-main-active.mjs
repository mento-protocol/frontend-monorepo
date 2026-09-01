#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
  assertAppTransactionCandidateOutput,
} from "./vercel-deployment-state.mjs";
import { classifyMainTransactionMapping } from "./vercel-main-transaction.mjs";
import { canonicalizeMainCandidateVercelMetadata } from "./vercel-main-candidate.mjs";

const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const NEXT_DEPLOYMENT_ID_PATTERN = /^(?!dpl_)[A-Za-z0-9_-]{1,32}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const TEAM_ID_PATTERN = /^team_[A-Za-z0-9]+$/;
const TRANSACTION_ID_PATTERN = /^main-[a-f0-9]{32}$/;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 180_000;
const MIN_COMMAND_TIMEOUT_MS = 1_000;
const INHERITED_CLI_LOADER_SUPPORTED = ["linux", "darwin"].includes(
  process.platform,
);

export const MAIN_ACTIVE_ORDINARY_TARGETS = Object.freeze([
  "governance",
  "reserve",
  "ui",
]);
export const MAIN_ACTIVE_APP_ALIASES = Object.freeze([
  "app.mento.org",
  "appmentoorg-env-v3-mentolabs.vercel.app",
]);
export const MAIN_ACTIVE_COMMAND_TIMEOUT_MS = 120_000;

const TARGET_ALIASES = Object.freeze({
  app: MAIN_ACTIVE_APP_ALIASES,
  governance: Object.freeze(["governance.mento.org"]),
  reserve: Object.freeze(["reserve.mento.org"]),
  ui: Object.freeze(["ui.mento.org"]),
});

const COMMAND_ENVIRONMENT_NAMES = Object.freeze([
  "CI",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_FILE",
  "VERCEL_ORG_ID",
  "VERCEL_TOKEN",
]);

const PROMOTION_KEYS = Object.freeze([
  "kind",
  "target",
  "deploymentId",
  "deploymentUrl",
  "arguments",
]);
const APP_DEPLOY_KEYS = Object.freeze([
  "kind",
  "target",
  "projectId",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "nextDeploymentId",
  "candidateMetadata",
  "arguments",
]);
const ALIAS_KEYS = Object.freeze([
  "kind",
  "target",
  "alias",
  "deploymentId",
  "deploymentUrl",
  "arguments",
]);
const COMMAND_RESULT_KEYS = Object.freeze(["outcome", "reason", "candidate"]);
const COMMAND_CANDIDATE_KEYS = Object.freeze(["deploymentId", "deploymentUrl"]);
const APP_EXPECTATION_KEYS = Object.freeze([
  "projectId",
  "projectName",
  "deploySha",
  "runId",
  "runAttempt",
  "transactionId",
  "customEnvironmentSlug",
  "nextDeploymentId",
]);
const MAPPING_KEYS = Object.freeze(["alias", "deploymentId", "deploymentUrl"]);
const MAPPING_WITH_PROJECT_KEYS = Object.freeze([...MAPPING_KEYS, "projectId"]);

export class MainActiveAdapterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MainActiveAdapterError";
    this.code = code;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value, expectedKeys) {
  return (
    isPlainObject(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expectedKeys].sort())
  );
}

function assertExactKeys(value, expectedKeys, label) {
  if (!hasExactKeys(value, expectedKeys)) {
    throw new MainActiveAdapterError(
      `${label} contains forbidden or missing fields`,
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
}

function requireString(value, label, pattern) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (pattern && !pattern.test(value))
  ) {
    throw new MainActiveAdapterError(
      `${label} is malformed`,
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  return value;
}

function requireDeploymentId(value, label = "Deployment ID") {
  return requireString(value, label, DEPLOYMENT_ID_PATTERN);
}

function requireDeploymentUrl(value, label = "Deployment URL") {
  try {
    const canonical = canonicalizeDeploymentUrl(value);
    if (canonical !== value) throw new Error("not canonical");
    return canonical;
  } catch {
    throw new MainActiveAdapterError(
      `${label} is malformed`,
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
}

function requirePositiveId(value, label) {
  const normalized =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  return requireString(normalized, label, POSITIVE_ID_PATTERN);
}

function requireOrdinaryTarget(value) {
  if (!MAIN_ACTIVE_ORDINARY_TARGETS.includes(value)) {
    throw new MainActiveAdapterError(
      "Ordinary target is not allowlisted",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  return value;
}

function requireKnownTarget(value) {
  if (!Object.hasOwn(TARGET_ALIASES, value)) {
    throw new MainActiveAdapterError(
      "Mapping target is not allowlisted",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  return value;
}

function requireAlias(value, allowed, label) {
  let canonical;
  try {
    canonical = canonicalizeHostname(value);
  } catch {
    throw new MainActiveAdapterError(
      `${label} is malformed`,
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  if (canonical !== value || !allowed.includes(canonical)) {
    throw new MainActiveAdapterError(
      `${label} is not allowlisted`,
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  return canonical;
}

function freezeCommand(command) {
  if (Array.isArray(command.aliases)) Object.freeze(command.aliases);
  Object.freeze(command.arguments);
  return Object.freeze(command);
}

function canonicalDeploymentIdentity(value, label) {
  assertExactKeys(value, ["deploymentId", "deploymentUrl"], label);
  return {
    deploymentId: requireDeploymentId(
      value.deploymentId,
      `${label} deployment ID`,
    ),
    deploymentUrl: requireDeploymentUrl(
      value.deploymentUrl,
      `${label} deployment URL`,
    ),
  };
}

function buildPromotionCommand(options) {
  assertExactKeys(
    options,
    ["target", "deploymentId", "deploymentUrl"],
    "Promotion input",
  );
  const target = requireOrdinaryTarget(options.target);
  const candidate = canonicalDeploymentIdentity(
    {
      deploymentId: options.deploymentId,
      deploymentUrl: options.deploymentUrl,
    },
    "Promotion candidate",
  );
  return freezeCommand({
    kind: "ordinary-promote",
    target,
    ...candidate,
    arguments: ["promote", candidate.deploymentId, "--yes"],
  });
}

export function buildMainActivePromotionCommand(options) {
  return buildPromotionCommand(options);
}

export function buildMainActivePromotionSequence(entries) {
  if (!Array.isArray(entries)) {
    throw new MainActiveAdapterError(
      "Promotion entries must be an array",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  const byTarget = new Map();
  for (const entry of entries) {
    assertExactKeys(
      entry,
      ["target", "deploymentId", "deploymentUrl"],
      "Promotion entry",
    );
    const command = buildPromotionCommand(entry);
    if (byTarget.has(command.target)) {
      throw new MainActiveAdapterError(
        "Promotion target is duplicated",
        "MAIN_ACTIVE_INPUT_REJECTED",
      );
    }
    byTarget.set(command.target, command);
  }
  return Object.freeze(
    MAIN_ACTIVE_ORDINARY_TARGETS.filter((target) => byTarget.has(target)).map(
      (target) => byTarget.get(target),
    ),
  );
}

function canonicalAppExpectation(value) {
  const expectation = { ...value };
  delete expectation.candidateMetadata;
  assertExactKeys(
    expectation,
    APP_EXPECTATION_KEYS,
    "App candidate expectation",
  );
  const canonical = {
    projectId: requireString(
      expectation.projectId,
      "App project ID",
      IDENTIFIER_PATTERN,
    ),
    projectName: expectation.projectName,
    deploySha: requireString(
      expectation.deploySha,
      "App deploy SHA",
      SHA_PATTERN,
    ),
    runId: requirePositiveId(expectation.runId, "App run ID"),
    runAttempt: requirePositiveId(expectation.runAttempt, "App run attempt"),
    transactionId: requireString(
      expectation.transactionId,
      "App transaction ID",
      TRANSACTION_ID_PATTERN,
    ),
    customEnvironmentSlug: expectation.customEnvironmentSlug,
    nextDeploymentId: requireString(
      expectation.nextDeploymentId,
      "App custom Next deployment ID",
      NEXT_DEPLOYMENT_ID_PATTERN,
    ),
  };
  if (
    canonical.projectName !== "app.mento.org" ||
    canonical.customEnvironmentSlug !== "v3"
  ) {
    throw new MainActiveAdapterError(
      "App candidate expectation is not the reviewed v3 contract",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  return canonical;
}

export function buildMainActiveAppDeployCommand(options) {
  assertExactKeys(
    options,
    [
      "projectId",
      "deploySha",
      "runId",
      "runAttempt",
      "transactionId",
      "nextDeploymentId",
      "candidateMetadata",
    ],
    "App deploy input",
  );
  const { candidateMetadata: rawCandidateMetadata, ...expectationInput } =
    options;
  const expectation = canonicalAppExpectation({
    ...expectationInput,
    projectName: "app.mento.org",
    customEnvironmentSlug: "v3",
  });
  const canonicalCandidateMetadata = canonicalizeMainCandidateVercelMetadata(
    rawCandidateMetadata,
    {
      target: "app",
      projectId: expectation.projectId,
      projectName: "app.mento.org",
      deploySha: expectation.deploySha,
    },
  );
  if (canonicalCandidateMetadata.candidateId !== expectation.nextDeploymentId) {
    throw new MainActiveAdapterError(
      "App stable candidate ID differs from the custom deployment ID",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  const metadata = Object.entries(rawCandidateMetadata)
    .filter(([key]) => key.startsWith("mento"))
    .map(([key, value]) => `${key}=${value}`);
  const gitMetadata = [
    "githubCommitOrg=mento-protocol",
    "githubCommitRepo=frontend-monorepo",
    "githubCommitRef=main",
    `githubCommitSha=${expectation.deploySha}`,
  ];
  const argumentsList = [
    "deploy",
    "--prebuilt",
    "--target=v3",
    "--archive=tgz",
    "--format=json",
    "--yes",
    "--project",
    expectation.projectId,
    ...gitMetadata.flatMap((entry) => ["--meta", entry]),
    ...metadata.flatMap((entry) => ["--meta", entry]),
  ];
  return freezeCommand({
    kind: "app-v3-deploy",
    target: "app",
    projectId: expectation.projectId,
    deploySha: expectation.deploySha,
    runId: expectation.runId,
    runAttempt: expectation.runAttempt,
    transactionId: expectation.transactionId,
    nextDeploymentId: expectation.nextDeploymentId,
    candidateMetadata: Object.freeze({ ...rawCandidateMetadata }),
    arguments: argumentsList,
  });
}

function buildAliasCommand({
  kind,
  target,
  alias,
  aliases,
  projectId,
  deploymentId,
  deploymentUrl,
}) {
  const identity = canonicalDeploymentIdentity(
    { deploymentId, deploymentUrl },
    "Alias deployment",
  );
  const binding =
    aliases === undefined
      ? {}
      : {
          aliases: [...aliases],
          projectId,
        };
  return freezeCommand({
    kind,
    target,
    alias,
    ...binding,
    ...identity,
    arguments: ["alias", "set", identity.deploymentUrl, alias],
  });
}

export function buildMainActiveAppAliasSetCommand(options) {
  assertExactKeys(
    options,
    ["alias", "deploymentId", "deploymentUrl"],
    "App alias input",
  );
  return buildAliasCommand({
    kind: "app-alias-set",
    target: "app",
    alias: requireAlias(options.alias, MAIN_ACTIVE_APP_ALIASES, "App v3 alias"),
    deploymentId: options.deploymentId,
    deploymentUrl: options.deploymentUrl,
  });
}

export function buildMainActiveAppAliasSetSequence(options) {
  assertExactKeys(
    options,
    ["deploymentId", "deploymentUrl"],
    "App alias sequence input",
  );
  return Object.freeze(
    MAIN_ACTIVE_APP_ALIASES.map((alias) =>
      buildMainActiveAppAliasSetCommand({ alias, ...options }),
    ),
  );
}

export function buildMainActiveRollbackCommand(options) {
  assertExactKeys(
    options,
    ["target", "deploymentId", "deploymentUrl"],
    "Rollback input",
  );
  const target = requireOrdinaryTarget(options.target);
  const prior = canonicalDeploymentIdentity(
    {
      deploymentId: options.deploymentId,
      deploymentUrl: options.deploymentUrl,
    },
    "Rollback prior",
  );
  return freezeCommand({
    kind: "ordinary-rollback",
    target,
    ...prior,
    arguments: ["rollback", prior.deploymentId, "--yes"],
  });
}

export function buildMainActiveAppAliasRestoreCommand(options) {
  assertExactKeys(
    options,
    ["alias", "deploymentId", "deploymentUrl"],
    "App alias restore input",
  );
  return buildAliasCommand({
    kind: "app-alias-restore",
    target: "app",
    alias: requireAlias(options.alias, MAIN_ACTIVE_APP_ALIASES, "App v3 alias"),
    deploymentId: options.deploymentId,
    deploymentUrl: options.deploymentUrl,
  });
}

export function buildMainActiveAppAliasRestoreSequence(options) {
  assertExactKeys(
    options,
    ["deploymentId", "deploymentUrl"],
    "App alias restore sequence input",
  );
  return Object.freeze(
    MAIN_ACTIVE_APP_ALIASES.map((alias) =>
      buildMainActiveAppAliasRestoreCommand({ alias, ...options }),
    ),
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCommandArguments(argumentsList) {
  if (
    !Array.isArray(argumentsList) ||
    argumentsList.length === 0 ||
    argumentsList.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        value.includes("\0") ||
        value === "--token" ||
        value.startsWith("--token="),
    )
  ) {
    throw new MainActiveAdapterError(
      "Vercel command arguments are not allowlisted",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
}

export function assertMainActiveCommandDescriptor(value) {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    throw new MainActiveAdapterError(
      "Vercel command descriptor is malformed",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  let expected;
  if (value.kind === "ordinary-promote") {
    assertExactKeys(value, PROMOTION_KEYS, "Promotion command");
    expected = buildMainActivePromotionCommand({
      target: value.target,
      deploymentId: value.deploymentId,
      deploymentUrl: value.deploymentUrl,
    });
  } else if (value.kind === "app-v3-deploy") {
    assertExactKeys(value, APP_DEPLOY_KEYS, "App deploy command");
    if (value.target !== "app") {
      throw new MainActiveAdapterError(
        "App deploy target is not allowlisted",
        "MAIN_ACTIVE_COMMAND_REJECTED",
      );
    }
    expected = buildMainActiveAppDeployCommand({
      projectId: value.projectId,
      deploySha: value.deploySha,
      runId: value.runId,
      runAttempt: value.runAttempt,
      transactionId: value.transactionId,
      nextDeploymentId: value.nextDeploymentId,
      candidateMetadata: value.candidateMetadata,
    });
  } else if (value.kind === "ordinary-rollback") {
    assertExactKeys(value, PROMOTION_KEYS, "Rollback command");
    expected = buildMainActiveRollbackCommand({
      target: value.target,
      deploymentId: value.deploymentId,
      deploymentUrl: value.deploymentUrl,
    });
  } else if (["app-alias-set", "app-alias-restore"].includes(value.kind)) {
    assertExactKeys(value, ALIAS_KEYS, "Alias command");
    const input = {
      alias: value.alias,
      deploymentId: value.deploymentId,
      deploymentUrl: value.deploymentUrl,
    };
    expected =
      value.kind === "app-alias-set"
        ? buildMainActiveAppAliasSetCommand(input)
        : buildMainActiveAppAliasRestoreCommand(input);
  } else {
    throw new MainActiveAdapterError(
      "Vercel command kind is not allowlisted",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  assertCommandArguments(value.arguments);
  if (!sameJson(value, expected)) {
    throw new MainActiveAdapterError(
      "Vercel command descriptor was altered",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  if (
    value.kind === "app-v3-deploy" &&
    value.arguments.some((argument) =>
      ["--prod", "--skip-domain", "promote"].includes(argument),
    )
  ) {
    throw new MainActiveAdapterError(
      "App v3 deploy contains a forbidden mutation mode",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  return expected;
}

function environmentForCommand(environment) {
  if (!isPlainObject(environment)) {
    throw new MainActiveAdapterError(
      "Vercel command environment is malformed",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  const token = environment.VERCEL_TOKEN;
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.includes("\0") ||
    token.includes("\n")
  ) {
    throw new MainActiveAdapterError(
      "VERCEL_TOKEN is missing or malformed",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  const filtered = {};
  for (const name of COMMAND_ENVIRONMENT_NAMES) {
    const value = environment[name];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || value.includes("\0")) {
      throw new MainActiveAdapterError(
        `${name} is malformed`,
        "MAIN_ACTIVE_COMMAND_REJECTED",
      );
    }
    filtered[name] = value;
  }
  if (!TEAM_ID_PATTERN.test(filtered.VERCEL_ORG_ID ?? "")) {
    throw new MainActiveAdapterError(
      "VERCEL_ORG_ID is missing or malformed",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  return filtered;
}

function safeCommandResult(outcome, reason, candidate = null) {
  return Object.freeze({
    outcome,
    reason,
    candidate:
      candidate === null
        ? null
        : Object.freeze({
            deploymentId: candidate.deploymentId,
            deploymentUrl: candidate.deploymentUrl,
          }),
  });
}

function parseAppDeployOutput(stdout) {
  if (
    typeof stdout !== "string" ||
    stdout.length === 0 ||
    Buffer.byteLength(stdout, "utf8") > MAX_COMMAND_OUTPUT_BYTES
  ) {
    throw new Error("missing output");
  }
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("invalid output");
  }
  if (!isPlainObject(value)) throw new Error("invalid output");
  if (value.status !== undefined && value.status !== "ok") {
    throw new Error("invalid output");
  }
  const deployment = value.deployment ?? value;
  if (
    !isPlainObject(deployment) ||
    deployment.readyState !== "READY" ||
    deployment.target !== null
  ) {
    throw new Error("invalid output");
  }
  let deploymentUrl;
  try {
    deploymentUrl = canonicalizeDeploymentUrl(deployment.url);
  } catch {
    throw new Error("invalid output");
  }
  return {
    deploymentId: requireDeploymentId(
      deployment.id,
      "App deployment output ID",
    ),
    deploymentUrl,
  };
}

function inheritedCliLoader(cliPath) {
  const entryUrl = pathToFileURL(cliPath).href;
  const source = [
    'import { readFileSync } from "node:fs";',
    `const entryPath = ${JSON.stringify(cliPath)};`,
    `const entryUrl = ${JSON.stringify(entryUrl)};`,
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === entryPath || specifier === entryUrl) {",
    "    return { url: entryUrl, shortCircuit: true };",
    "  }",
    "  return nextResolve(specifier, context);",
    "}",
    "export async function load(url, context, nextLoad) {",
    "  if (url === entryUrl) {",
    '    return { format: "module", source: readFileSync(3, "utf8"), shortCircuit: true };',
    "  }",
    "  return nextLoad(url, context);",
    "}",
  ].join("\n");
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function inheritedCliEvaluation(cliPath) {
  return `process.argv.splice(1, 0, ${JSON.stringify(cliPath)}); await import(${JSON.stringify(cliPath)});`;
}

export function runMainActiveVercelCommand({
  command,
  cliPath,
  cliFileDescriptor,
  workingDirectory,
  environment,
  nodeExecutable = process.execPath,
  timeoutMs = MAIN_ACTIVE_COMMAND_TIMEOUT_MS,
  spawn = spawnSync,
}) {
  const canonicalCommand = assertMainActiveCommandDescriptor(command);
  if (
    typeof cliPath !== "string" ||
    !isAbsolute(cliPath) ||
    cliPath.includes("\0") ||
    !INHERITED_CLI_LOADER_SUPPORTED ||
    !Number.isSafeInteger(cliFileDescriptor) ||
    cliFileDescriptor < 3 ||
    typeof workingDirectory !== "string" ||
    !isAbsolute(workingDirectory) ||
    workingDirectory.includes("\0") ||
    typeof nodeExecutable !== "string" ||
    !isAbsolute(nodeExecutable) ||
    nodeExecutable.includes("\0") ||
    typeof spawn !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_COMMAND_TIMEOUT_MS ||
    timeoutMs > MAX_COMMAND_TIMEOUT_MS
  ) {
    throw new MainActiveAdapterError(
      "Vercel command execution contract is malformed",
      "MAIN_ACTIVE_COMMAND_REJECTED",
    );
  }
  const commandEnvironment = environmentForCommand(environment);
  const teamId = commandEnvironment.VERCEL_ORG_ID;
  // Scope is explicit. A lone VERCEL_ORG_ID makes the Vercel CLI treat the
  // environment as an incomplete project link instead of using the reviewed
  // repo mapping for this target's nested prebuilt output.
  delete commandEnvironment.VERCEL_ORG_ID;
  const loader = inheritedCliLoader(cliPath);
  let result;
  try {
    result = spawn(
      nodeExecutable,
      [
        "--experimental-loader",
        loader,
        "--eval",
        inheritedCliEvaluation(cliPath),
        "--",
        ...canonicalCommand.arguments,
        "--scope",
        teamId,
      ],
      {
        cwd: workingDirectory,
        encoding: "utf8",
        env: commandEnvironment,
        input: "",
        killSignal: "SIGTERM",
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        // The eval bootstrap imports the reviewed entrypoint through the
        // loader, which reads fd 3 while preserving the original URL for ESM
        // sibling resolution.
        stdio: ["ignore", "pipe", "pipe", cliFileDescriptor],
        timeout: timeoutMs,
        windowsHide: true,
      },
    );
  } catch {
    return safeCommandResult("unknown", "spawn-error");
  }
  if (!isPlainObject(result)) {
    return safeCommandResult("unknown", "lost-result");
  }
  if (
    result.error?.code === "ETIMEDOUT" ||
    (result.status === null && typeof result.signal === "string")
  ) {
    return safeCommandResult("unknown", "timeout");
  }
  if (result.error) return safeCommandResult("unknown", "spawn-error");
  if (!Number.isInteger(result.status)) {
    return safeCommandResult("unknown", "lost-result");
  }
  if (result.status !== 0) {
    return safeCommandResult("unknown", "nonzero");
  }
  if (canonicalCommand.kind === "app-v3-deploy") {
    try {
      return safeCommandResult(
        "success",
        null,
        parseAppDeployOutput(result.stdout),
      );
    } catch {
      return safeCommandResult("unknown", "lost-output");
    }
  }
  return safeCommandResult("success", null);
}

export function assertMainActiveCommandResult(value) {
  assertExactKeys(value, COMMAND_RESULT_KEYS, "Vercel command result");
  if (
    !["success", "unknown"].includes(value.outcome) ||
    ![
      null,
      "lost-output",
      "lost-result",
      "nonzero",
      "spawn-error",
      "timeout",
    ].includes(value.reason) ||
    (value.outcome === "success" && value.reason !== null) ||
    (value.outcome === "unknown" && value.reason === null)
  ) {
    throw new MainActiveAdapterError(
      "Vercel command result is malformed",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  let candidate = null;
  if (value.candidate !== null) {
    assertExactKeys(
      value.candidate,
      COMMAND_CANDIDATE_KEYS,
      "Vercel command candidate",
    );
    candidate = canonicalDeploymentIdentity(
      value.candidate,
      "Vercel command candidate",
    );
    if (value.outcome !== "success") {
      throw new MainActiveAdapterError(
        "Unknown command outcome cannot assert a candidate",
        "MAIN_ACTIVE_INPUT_REJECTED",
      );
    }
  }
  return safeCommandResult(value.outcome, value.reason, candidate);
}

function assertCandidateMatchesExpectation(candidate, expectation) {
  let canonical;
  try {
    canonical = assertAppTransactionCandidateOutput(candidate);
  } catch {
    throw new MainActiveAdapterError(
      "App candidate discovery returned malformed canonical state",
      "MAIN_ACTIVE_DISCOVERY_FAILED",
    );
  }
  for (const key of [
    "projectId",
    "projectName",
    "deploySha",
    "runId",
    "runAttempt",
    "transactionId",
    "customEnvironmentSlug",
  ]) {
    if (canonical[key] !== expectation[key]) {
      throw new MainActiveAdapterError(
        "App candidate discovery returned a different transaction",
        "MAIN_ACTIVE_DISCOVERY_FAILED",
      );
    }
  }
  return Object.freeze({ ...canonical });
}

export async function resolveMainActiveAppCandidate({
  commandResult,
  expectation,
  discoverCandidate,
}) {
  const canonicalResult = assertMainActiveCommandResult(commandResult);
  const canonicalExpectation = canonicalAppExpectation(expectation);
  if (typeof discoverCandidate !== "function") {
    throw new MainActiveAdapterError(
      "App candidate discovery implementation is missing",
      "MAIN_ACTIVE_DISCOVERY_FAILED",
    );
  }
  let discovered;
  try {
    discovered = await discoverCandidate(canonicalExpectation);
  } catch {
    throw new MainActiveAdapterError(
      "App candidate discovery failed closed",
      "MAIN_ACTIVE_DISCOVERY_FAILED",
    );
  }
  const candidate = assertCandidateMatchesExpectation(
    discovered,
    canonicalExpectation,
  );
  if (
    canonicalResult.candidate !== null &&
    (candidate.deploymentId !== canonicalResult.candidate.deploymentId ||
      candidate.deploymentUrl !== canonicalResult.candidate.deploymentUrl)
  ) {
    throw new MainActiveAdapterError(
      "App command output conflicts with discovered candidate",
      "MAIN_ACTIVE_DISCOVERY_FAILED",
    );
  }
  return Object.freeze({
    commandOutcome: canonicalResult.outcome,
    candidate,
  });
}

function canonicalMapping(value) {
  const keys = Object.keys(value ?? {});
  if (
    !hasExactKeys(value, MAPPING_KEYS) &&
    !hasExactKeys(value, MAPPING_WITH_PROJECT_KEYS)
  ) {
    throw new Error("mapping keys");
  }
  if (
    keys.includes("projectId") &&
    (typeof value.projectId !== "string" ||
      !IDENTIFIER_PATTERN.test(value.projectId))
  ) {
    throw new Error("project ID");
  }
  return {
    alias: canonicalizeHostname(value.alias),
    deploymentId: requireDeploymentId(value.deploymentId),
    deploymentUrl: requireDeploymentUrl(value.deploymentUrl),
  };
}

function reviewedMappingAliases(target, aliases) {
  const reviewed = TARGET_ALIASES[target];
  if (aliases === undefined) return [...reviewed];
  if (!Array.isArray(aliases) || aliases.length === 0) {
    throw new MainActiveAdapterError(
      "Mapping alias subset must be a non-empty array",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  const canonical = aliases.map((alias) =>
    requireAlias(alias, reviewed, "Mapping alias"),
  );
  if (
    new Set(canonical).size !== canonical.length ||
    JSON.stringify(canonical) !==
      JSON.stringify(reviewed.filter((alias) => canonical.includes(alias)))
  ) {
    throw new MainActiveAdapterError(
      "Mapping aliases must be a unique reviewed-order subset",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  return canonical;
}

export async function inspectMainActiveMapping({
  target,
  aliases: requestedAliases,
  projectId,
  priorDeployment,
  candidateDeployment,
  captureMappings,
}) {
  const canonicalTarget = requireKnownTarget(target);
  const prior = canonicalDeploymentIdentity(priorDeployment, "Mapping prior");
  const candidate = canonicalDeploymentIdentity(
    candidateDeployment,
    "Mapping candidate",
  );
  if (typeof captureMappings !== "function") {
    throw new MainActiveAdapterError(
      "Mapping inspection implementation is missing",
      "MAIN_ACTIVE_MAPPING_FAILED",
    );
  }
  if (projectId !== undefined) {
    throw new MainActiveAdapterError(
      "Protected mapping inspection does not accept a project binding",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  const aliases = reviewedMappingAliases(canonicalTarget, requestedAliases);
  let mappings;
  try {
    const captured = await captureMappings(Object.freeze([...aliases]));
    if (!Array.isArray(captured)) throw new Error("mapping array");
    mappings = captured
      .map((mapping) => canonicalMapping(mapping))
      .sort((left, right) => left.alias.localeCompare(right.alias));
    const mappingState = classifyMainTransactionMapping({
      aliases,
      currentMappings: mappings.map(
        ({ alias, deploymentId, deploymentUrl }) => ({
          alias,
          deploymentId,
          deploymentUrl,
        }),
      ),
      prior: { ...prior, aliases },
      candidate: { ...candidate, aliases },
    });
    return Object.freeze({
      target: canonicalTarget,
      mappingState,
      mappings: Object.freeze(
        mappings.map((mapping) => Object.freeze(mapping)),
      ),
    });
  } catch {
    throw new MainActiveAdapterError(
      "Protected mapping inspection failed closed",
      "MAIN_ACTIVE_MAPPING_FAILED",
    );
  }
}

export async function verifyMainActiveMapping({
  target,
  aliases,
  projectId,
  priorDeployment,
  candidateDeployment,
  expectedMappingState,
  captureMappings,
}) {
  if (!["prior", "candidate"].includes(expectedMappingState)) {
    throw new MainActiveAdapterError(
      "Expected mapping state must be prior or candidate",
      "MAIN_ACTIVE_INPUT_REJECTED",
    );
  }
  const inspection = await inspectMainActiveMapping({
    target,
    aliases,
    projectId,
    priorDeployment,
    candidateDeployment,
    captureMappings,
  });
  if (inspection.mappingState !== expectedMappingState) {
    throw new MainActiveAdapterError(
      `Protected mapping verification failed (${inspection.mappingState})`,
      "MAIN_ACTIVE_MAPPING_FAILED",
    );
  }
  return inspection;
}
