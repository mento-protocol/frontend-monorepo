#!/usr/bin/env node

import { Buffer } from "node:buffer";
import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  resolve,
  sep,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  assertMainActiveCommandDescriptor,
  assertMainActiveCommandResult,
  inspectMainActiveMapping,
  resolveMainActiveAppCandidate,
  runMainActiveVercelCommand,
} from "./vercel-main-active.mjs";
import {
  VercelStateClient,
  assertAppTransactionCandidateOutput,
  canonicalizeDeploymentUrl,
  canonicalizeHostname,
} from "./vercel-deployment-state.mjs";

const MAX_PRIVATE_JSON_BYTES = 256 * 1024;
const MAPPING_ATTEMPTS = 3;
const MAPPING_RETRY_DELAY_MS = 250;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const CLI_OPTIONS = Object.freeze({
  execute: Object.freeze(["descriptor", "output"]),
  mapping: Object.freeze(["spec", "output"]),
  "app-candidate": Object.freeze(["expectation", "command-result", "output"]),
});
const MAPPING_SPEC_KEYS = Object.freeze([
  "schema",
  "target",
  "aliases",
  "priorDeployment",
  "candidateDeployment",
]);
const MAPPING_OUTPUT_KEYS = Object.freeze([
  "target",
  "mappingState",
  "mappings",
]);

export const MAIN_ACTIVE_MAPPING_SPEC_SCHEMA =
  "vercel-main-active-mapping-spec:v1";

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, keys, label) {
  if (
    !isPlainObject(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    throw new Error(`${label} contains forbidden or missing fields`);
  }
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function reviewedDirectory(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} is missing or unsafe`);
  }
  const root = parse(path).root;
  let current = root;
  let stats;
  try {
    for (const component of path
      .slice(root.length)
      .split(sep)
      .filter(Boolean)) {
      current = resolve(current, component);
      stats = lstatSync(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error("unsafe");
      }
    }
    stats ??= lstatSync(root);
    if (realpathSync(path) !== path) throw new Error("unsafe");
    return { path, stats };
  } catch {
    throw new Error(`${label} is missing or unsafe`);
  }
}

function reviewedRegularFile(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} is missing or unsafe`);
  }
  if (
    !["linux", "darwin"].includes(process.platform) ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0 ||
    !Number.isInteger(constants.O_DIRECTORY) ||
    constants.O_DIRECTORY === 0
  ) {
    throw new Error(`${label} cannot be opened safely on this platform`);
  }
  const directory = reviewedDirectory(dirname(path), `${label} parent`);
  let directoryDescriptor;
  let descriptor;
  try {
    const before = lstatSync(path);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.nlink !== 1 ||
      realpathSync(path) !== path
    ) {
      throw new Error("unsafe");
    }
    directoryDescriptor = openSync(
      directory.path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const openedDirectory = fstatSync(directoryDescriptor);
    if (
      !openedDirectory.isDirectory() ||
      !sameInode(directory.stats, openedDirectory)
    ) {
      throw new Error("unsafe");
    }
    descriptor = openSync(
      process.platform === "linux"
        ? `/proc/self/fd/${directoryDescriptor}/${basename(path)}`
        : path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const openedFile = fstatSync(descriptor);
    if (
      !openedFile.isFile() ||
      openedFile.nlink !== 1 ||
      !sameInode(before, openedFile)
    ) {
      throw new Error("unsafe");
    }
    return { descriptor, path };
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    throw new Error(`${label} is missing or unsafe`);
  } finally {
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
  }
}

function closeReviewedRegularFile(review) {
  if (review?.descriptor !== undefined) closeSync(review.descriptor);
}

function fsyncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function privateJsonPath(path, runnerTemp, label) {
  const directory = reviewedDirectory(runnerTemp, "Private JSON directory");
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    dirname(path) !== directory.path
  ) {
    throw new Error(`${label} is missing or unsafe`);
  }
  return { directory, path };
}

function assertPrivateFile(stats, pathStats) {
  return (
    stats.isFile() &&
    stats.nlink === 1 &&
    (stats.mode & 0o400) !== 0 &&
    (stats.mode & 0o077) === 0 &&
    !pathStats.isSymbolicLink() &&
    sameInode(stats, pathStats)
  );
}

function readPrivateJson(path, label, runnerTemp) {
  const target = privateJsonPath(path, runnerTemp, label);
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new Error("Private JSON reads are unsupported on this platform");
  }
  let descriptor;
  try {
    descriptor = openSync(
      target.path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const fileBefore = fstatSync(descriptor);
    const pathBefore = lstatSync(target.path);
    const directoryBefore = lstatSync(target.directory.path);
    if (
      !assertPrivateFile(fileBefore, pathBefore) ||
      fileBefore.size > MAX_PRIVATE_JSON_BYTES ||
      directoryBefore.isSymbolicLink() ||
      !directoryBefore.isDirectory() ||
      !sameInode(target.directory.stats, directoryBefore)
    ) {
      throw new Error("unsafe");
    }
    const text = readFileSync(descriptor, "utf8");
    const fileAfter = fstatSync(descriptor);
    const pathAfter = lstatSync(target.path);
    const directoryAfter = lstatSync(target.directory.path);
    if (
      Buffer.byteLength(text, "utf8") !== fileAfter.size ||
      !assertPrivateFile(fileAfter, pathAfter) ||
      !sameInode(fileBefore, fileAfter) ||
      directoryAfter.isSymbolicLink() ||
      !directoryAfter.isDirectory() ||
      !sameInode(target.directory.stats, directoryAfter)
    ) {
      throw new Error("unsafe");
    }
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is missing or malformed`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function reservePrivateJsonOutput(path, runnerTemp) {
  const target = privateJsonPath(path, runnerTemp, "Private JSON output");
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new Error("Private JSON output is unsupported on this platform");
  }
  let descriptor;
  let stageDirectory;
  let stageDirectoryStats;
  let stagePath;
  let fileStats;
  try {
    try {
      lstatSync(target.path);
      throw new Error("unsafe");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    stageDirectory = mkdtempSync(join(target.directory.path, ".main-active-"));
    stageDirectoryStats = lstatSync(stageDirectory);
    if (
      stageDirectoryStats.isSymbolicLink() ||
      !stageDirectoryStats.isDirectory() ||
      (stageDirectoryStats.mode & 0o777) !== 0o700
    ) {
      throw new Error("unsafe");
    }
    stagePath = join(stageDirectory, "result.json");
    descriptor = openSync(
      stagePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    const fileBefore = fstatSync(descriptor);
    fileStats = fileBefore;
    const pathBefore = lstatSync(stagePath);
    const directoryBefore = lstatSync(stageDirectory);
    if (
      !fileBefore.isFile() ||
      fileBefore.nlink !== 1 ||
      pathBefore.isSymbolicLink() ||
      !sameInode(fileBefore, pathBefore) ||
      directoryBefore.isSymbolicLink() ||
      !directoryBefore.isDirectory() ||
      !sameInode(stageDirectoryStats, directoryBefore)
    ) {
      throw new Error("unsafe");
    }
    fchmodSync(descriptor, 0o600);
    return {
      descriptor,
      fileStats,
      stageDirectory,
      stageDirectoryStats,
      stagePath,
      target,
    };
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      const current = stagePath && lstatSync(stagePath);
      if (
        fileStats &&
        !current.isSymbolicLink() &&
        sameInode(fileStats, current)
      ) {
        unlinkSync(stagePath);
      }
    } catch {
      // The staging file is already absent or no longer belongs to this reservation.
    }
    try {
      if (stageDirectory) rmdirSync(stageDirectory);
    } catch {
      // A failed reservation must not remove a directory it no longer owns.
    }
    throw new Error("Private JSON output could not be written safely");
  }
}

function closePrivateJsonOutput(reservation) {
  if (reservation.descriptor !== undefined) {
    closeSync(reservation.descriptor);
    reservation.descriptor = undefined;
  }
}

function abortPrivateJsonOutput(reservation) {
  closePrivateJsonOutput(reservation);
  try {
    const current = lstatSync(reservation.stagePath);
    if (
      !current.isSymbolicLink() &&
      sameInode(reservation.fileStats, current)
    ) {
      unlinkSync(reservation.stagePath);
    }
  } catch {
    // The staging file is already absent or no longer belongs to this reservation.
  }
  try {
    rmdirSync(reservation.stageDirectory);
  } catch {
    // A failed command must not remove a directory it no longer owns.
  }
}

function completePrivateJsonOutput(reservation, value, validate) {
  try {
    const canonical = validate(value);
    writeFileSync(reservation.descriptor, `${JSON.stringify(canonical)}\n`);
    const fileAfter = fstatSync(reservation.descriptor);
    const pathAfter = lstatSync(reservation.stagePath);
    const directoryAfter = lstatSync(reservation.stageDirectory);
    if (
      !assertPrivateFile(fileAfter, pathAfter) ||
      (fileAfter.mode & 0o777) !== 0o600 ||
      directoryAfter.isSymbolicLink() ||
      !directoryAfter.isDirectory() ||
      !sameInode(reservation.stageDirectoryStats, directoryAfter)
    ) {
      throw new Error("unsafe");
    }
    fsyncSync(reservation.descriptor);
    const backupPath = join(reservation.stageDirectory, "published.json");
    linkSync(reservation.stagePath, backupPath);
    fsyncDirectory(reservation.stageDirectory);
    renameSync(reservation.stagePath, reservation.target.path);
    let published = lstatSync(reservation.target.path);
    const targetDirectory = lstatSync(reservation.target.directory.path);
    if (
      !assertPrivateFile(fileAfter, published) ||
      !targetDirectory.isDirectory() ||
      targetDirectory.isSymbolicLink() ||
      !sameInode(reservation.target.directory.stats, targetDirectory)
    ) {
      // Keep a verified link until publication itself has been observed. This
      // restores the required path if it was unlinked in the publish window.
      renameSync(backupPath, reservation.target.path);
      published = lstatSync(reservation.target.path);
      if (!assertPrivateFile(fileAfter, published)) throw new Error("unsafe");
    } else {
      unlinkSync(backupPath);
    }
    const outputAfter = fstatSync(reservation.descriptor);
    published = lstatSync(reservation.target.path);
    if (!assertPrivateFile(outputAfter, published)) throw new Error("unsafe");
    fsyncDirectory(reservation.target.directory.path);
    fsyncDirectory(reservation.stageDirectory);
    rmdirSync(reservation.stageDirectory);
    return canonical;
  } catch {
    throw new Error("Private JSON output could not be written safely");
  } finally {
    closePrivateJsonOutput(reservation);
  }
}

export function parseMainActiveCliArguments(argv) {
  if (!Array.isArray(argv) || !Object.hasOwn(CLI_OPTIONS, argv[0])) {
    throw new Error("Vercel main activation command is missing or unsupported");
  }
  const command = argv[0];
  const allowed = new Set(CLI_OPTIONS[command]);
  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (typeof argument !== "string" || !/^--[a-z][a-z-]*$/.test(argument)) {
      throw new Error("Vercel main activation arguments are malformed");
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) {
      throw new Error("Vercel main activation option is unsupported");
    }
    if (Object.hasOwn(options, name)) {
      throw new Error("Vercel main activation option is duplicated");
    }
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Vercel main activation option value is missing");
    }
    options[name] = value;
  }
  if (
    Object.keys(options).length !== allowed.size ||
    [...allowed].some((name) => !Object.hasOwn(options, name))
  ) {
    throw new Error("Vercel main activation required option is missing");
  }
  return { command, options };
}

function mappingSpec(value) {
  assertExactKeys(value, MAPPING_SPEC_KEYS, "Mapping specification");
  if (value.schema !== MAIN_ACTIVE_MAPPING_SPEC_SCHEMA) {
    throw new Error("Mapping specification schema is malformed");
  }
  return {
    target: value.target,
    aliases: value.aliases,
    priorDeployment: value.priorDeployment,
    candidateDeployment: value.candidateDeployment,
  };
}

function validateCommandExecutionResult(value, descriptor) {
  const canonical = assertMainActiveCommandResult(value);
  const expectsCandidate =
    descriptor.kind === "app-v3-deploy" && canonical.outcome === "success";
  if ((canonical.candidate !== null) !== expectsCandidate) {
    throw new Error("Vercel command result conflicts with its descriptor");
  }
  return canonical;
}

function validateMappingOutput(value, spec) {
  assertExactKeys(value, MAPPING_OUTPUT_KEYS, "Mapping inspection");
  if (
    !["app", "governance", "reserve", "ui"].includes(value.target) ||
    !["prior", "candidate", "partial", "unexpected"].includes(
      value.mappingState,
    ) ||
    !Array.isArray(value.mappings) ||
    value.mappings.length === 0
  ) {
    throw new Error("Mapping inspection is malformed");
  }
  const expectedAliases = [...spec.aliases].sort();
  if (
    value.target !== spec.target ||
    JSON.stringify(value.mappings.map(({ alias }) => alias)) !==
      JSON.stringify(expectedAliases)
  ) {
    throw new Error("Mapping inspection conflicts with its specification");
  }
  const seen = new Set();
  let previous = null;
  for (const mapping of value.mappings) {
    assertExactKeys(
      mapping,
      ["alias", "deploymentId", "deploymentUrl"],
      "Mapping inspection entry",
    );
    const alias = canonicalizeHostname(mapping.alias);
    if (
      alias !== mapping.alias ||
      (previous !== null && alias.localeCompare(previous) <= 0) ||
      seen.has(alias) ||
      typeof mapping.deploymentId !== "string" ||
      !DEPLOYMENT_ID_PATTERN.test(mapping.deploymentId) ||
      canonicalizeDeploymentUrl(mapping.deploymentUrl) !== mapping.deploymentUrl
    ) {
      throw new Error("Mapping inspection entry is malformed");
    }
    seen.add(alias);
    previous = alias;
  }
  return value;
}

function validateAppResolution(value, expectation, commandResult) {
  assertExactKeys(
    value,
    ["commandOutcome", "candidate"],
    "App candidate resolution",
  );
  if (!["success", "unknown"].includes(value.commandOutcome)) {
    throw new Error("App candidate command outcome is malformed");
  }
  const canonicalCommandResult = assertMainActiveCommandResult(commandResult);
  const candidate = assertAppTransactionCandidateOutput(value.candidate);
  if (
    value.commandOutcome !== canonicalCommandResult.outcome ||
    [
      "projectId",
      "projectName",
      "deploySha",
      "runId",
      "runAttempt",
      "transactionId",
      "customEnvironmentSlug",
    ].some((key) => candidate[key] !== expectation[key])
  ) {
    throw new Error("App candidate resolution conflicts with its inputs");
  }
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

async function retryMappingRead(
  operation,
  {
    attempts = MAPPING_ATTEMPTS,
    retryDelayMs = MAPPING_RETRY_DELAY_MS,
    sleepImplementation = sleep,
  } = {},
) {
  if (
    typeof operation !== "function" ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > MAPPING_ATTEMPTS ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 1_000 ||
    typeof sleepImplementation !== "function"
  ) {
    throw new Error("Protected mapping retry contract is malformed");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch {
      if (attempt < attempts) {
        await sleepImplementation(retryDelayMs);
      }
    }
  }
  throw new Error("Protected mapping read failed");
}

export async function captureStableAliasMappings(
  client,
  aliases,
  options = {},
) {
  if (
    !client ||
    typeof client.aliasMapping !== "function" ||
    !Array.isArray(aliases) ||
    aliases.length === 0 ||
    aliases.some(
      (alias) =>
        typeof alias !== "string" || canonicalizeHostname(alias) !== alias,
    ) ||
    new Set(aliases).size !== aliases.length
  ) {
    throw new Error("Protected mapping client is malformed");
  }
  const capture = async () => {
    const mappings = [];
    for (const alias of aliases) {
      mappings.push(
        await retryMappingRead(() => client.aliasMapping(alias), options),
      );
    }
    return mappings;
  };
  const before = await capture();
  const after = await capture();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Protected mapping changed during inspection");
  }
  return before;
}

function createStateClient(env, stateClientFactory) {
  return stateClientFactory({
    token: env.VERCEL_TOKEN,
    teamId: env.VERCEL_ORG_ID,
  });
}

export async function runMainActiveCli({
  argv,
  env = process.env,
  stdout = process.stdout,
  commandExecutor = runMainActiveVercelCommand,
  stateClientFactory = (options) => new VercelStateClient(options),
} = {}) {
  const { command, options } = parseMainActiveCliArguments(argv);
  const runnerTemp = env.RUNNER_TEMP;
  if (command === "execute") {
    const descriptor = readPrivateJson(
      options.descriptor,
      "Vercel command descriptor",
      runnerTemp,
    );
    assertMainActiveCommandDescriptor(descriptor);
    const cli = reviewedRegularFile(
      env.TRUSTED_VERCEL_CLI_PATH,
      "Pinned Vercel CLI",
    );
    const workingDirectory = reviewedDirectory(
      env.SOURCE_PATH,
      "Reviewed Vercel workspace",
    ).path;
    const output = reservePrivateJsonOutput(options.output, runnerTemp);
    let result;
    let commandStarted = false;
    try {
      commandStarted = true;
      try {
        result = commandExecutor({
          command: descriptor,
          cliPath: cli.path,
          cliFileDescriptor: cli.descriptor,
          workingDirectory,
          environment: { ...env },
        });
      } catch {
        result = { outcome: "unknown", reason: "spawn-error", candidate: null };
      }
      try {
        result = validateCommandExecutionResult(result, descriptor);
      } catch {
        result = { outcome: "unknown", reason: "lost-result", candidate: null };
      }
      completePrivateJsonOutput(output, result, (value) =>
        validateCommandExecutionResult(value, descriptor),
      );
    } catch (error) {
      if (!commandStarted) abortPrivateJsonOutput(output);
      throw error;
    } finally {
      closeReviewedRegularFile(cli);
    }
    stdout.write("Canonical Vercel command result written\n");
    return;
  }

  if (command === "mapping") {
    const spec = mappingSpec(
      readPrivateJson(
        options.spec,
        "Protected mapping specification",
        runnerTemp,
      ),
    );
    const output = reservePrivateJsonOutput(options.output, runnerTemp);
    let result;
    try {
      const client = createStateClient(env, stateClientFactory);
      result = await inspectMainActiveMapping({
        ...spec,
        captureMappings: (aliases) =>
          captureStableAliasMappings(client, aliases),
      });
      completePrivateJsonOutput(output, result, (value) =>
        validateMappingOutput(value, spec),
      );
    } catch (error) {
      abortPrivateJsonOutput(output);
      throw error;
    }
    stdout.write("Canonical protected mapping inspection written\n");
  } else {
    const expectation = readPrivateJson(
      options.expectation,
      "App candidate expectation",
      runnerTemp,
    );
    const commandResult = readPrivateJson(
      options["command-result"],
      "Vercel command result",
      runnerTemp,
    );
    const output = reservePrivateJsonOutput(options.output, runnerTemp);
    let result;
    try {
      const client = createStateClient(env, stateClientFactory);
      result = await resolveMainActiveAppCandidate({
        commandResult,
        expectation,
        discoverCandidate: (expected) =>
          client.discoverAppTransactionCandidate(expected),
      });
      completePrivateJsonOutput(output, result, (value) =>
        validateAppResolution(value, expectation, commandResult),
      );
    } catch (error) {
      abortPrivateJsonOutput(output);
      throw error;
    }
    stdout.write("Canonical App candidate resolution written\n");
  }
}

export function renderMainActiveCliFailure() {
  return "Vercel main activation command failed\n";
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  try {
    await runMainActiveCli({ argv: process.argv.slice(2) });
  } catch {
    process.stderr.write(renderMainActiveCliFailure());
    process.exitCode = 1;
  }
}
