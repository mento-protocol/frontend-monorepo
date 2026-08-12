/* eslint-disable turbo/no-undeclared-env-vars -- The trusted review hook validates exact workflow-only environment identities. */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";

const EXPECTED_REPOSITORY = "mento-protocol/frontend-monorepo";
const ISSUED_SCHEMA = "dependabot-claude-review-tool-issued:v1";
const COMPLETED_SCHEMA = "dependabot-claude-review-tool-completed:v1";
const MAX_BASH_OUTPUT_LENGTH = 150_000;
const MAX_BASH_OUTPUT_BYTES = MAX_BASH_OUTPUT_LENGTH * 4;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_HOOK_INPUT_BYTES = 2_097_152;
const MAX_MARKER_BYTES = 4_096;
const MAX_TIMEOUT_MS = 120_000;
const ALLOWED_INPUT_KEYS = new Set([
  "command",
  "description",
  "run_in_background",
  "timeout",
]);

function block(reason) {
  console.error(`Blocked Dependabot review tool call: ${reason}`);
  process.exit(2);
}

function isCanonicalPositiveSafeInteger(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return false;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && String(number) === value;
}

function isToolUseId(value) {
  return (
    typeof value === "string" && /^toolu_[A-Za-z0-9_-]{1,200}$/.test(value)
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hasExactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function requiredEnvironment() {
  const repository = process.env.DEPENDABOT_REVIEW_REPOSITORY ?? "";
  const pullRequestNumber = process.env.DEPENDABOT_REVIEW_PR_NUMBER ?? "";
  const runnerTemp = process.env.RUNNER_TEMP ?? "";
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";

  if (repository !== EXPECTED_REPOSITORY) {
    block("repository identity is missing or invalid");
  }
  if (!isCanonicalPositiveSafeInteger(pullRequestNumber)) {
    block("pull-request identity is missing or invalid");
  }
  if (!runnerTemp.startsWith("/") || !isCanonicalPositiveSafeInteger(runId)) {
    block("workflow run identity is missing or invalid");
  }
  if (!isCanonicalPositiveSafeInteger(runAttempt)) {
    block("workflow run attempt is missing or invalid");
  }

  return { pullRequestNumber, repository, runAttempt, runId, runnerTemp };
}

async function parseHookInput() {
  let value;
  try {
    value = JSON.parse(await readStdin());
  } catch {
    block("hook input is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    block("hook input is not an object");
  }
  return value;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_HOOK_INPUT_BYTES) {
      block("hook input exceeds the bounded size");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function markerPaths({ runAttempt, runId, runnerTemp }) {
  const prefix = join(
    runnerTemp,
    `dependabot-review-tool-${runId}-${runAttempt}`,
  );
  return {
    completed: `${prefix}.completed.json`,
    issued: `${prefix}.issued.json`,
  };
}

function writeMarker(path, value, duplicateReason) {
  let file;
  try {
    file = openSync(path, "wx", 0o600);
    writeSync(file, `${JSON.stringify(value)}\n`);
    fsyncSync(file);
    closeSync(file);
  } catch {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {
        // The marker remains consumed when it cannot be closed.
      }
    }
    block(duplicateReason);
  }
}

function readMarker(path, description) {
  let file;
  try {
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(file);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size < 2 ||
      stats.size > MAX_MARKER_BYTES
    ) {
      throw new Error("invalid marker metadata");
    }
    const value = JSON.parse(readFileSync(file, "utf8"));
    closeSync(file);
    return value;
  } catch {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {
        // The marker is invalid when it cannot be closed.
      }
    }
    block(`${description} is missing or invalid`);
  }
}

function validateToolInput(toolInput, expectedCommand) {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    block("Bash input is missing or invalid");
  }
  for (const key of Object.keys(toolInput)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      block(`unexpected Bash input field: ${key}`);
    }
  }
  if (toolInput.command !== expectedCommand) {
    block("command does not exactly match the receipt-bound PR diff");
  }
  if (
    toolInput.description !== undefined &&
    (typeof toolInput.description !== "string" ||
      toolInput.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    block("command description is invalid");
  }
  if (
    toolInput.timeout !== undefined &&
    (!Number.isInteger(toolInput.timeout) ||
      toolInput.timeout < 1 ||
      toolInput.timeout > MAX_TIMEOUT_MS)
  ) {
    block("command timeout is invalid");
  }
  if (
    toolInput.run_in_background !== undefined &&
    toolInput.run_in_background !== false
  ) {
    block("background execution is forbidden");
  }
  return {
    command: toolInput.command,
    ...(toolInput.description === undefined
      ? {}
      : { description: toolInput.description }),
    ...(toolInput.run_in_background === undefined
      ? {}
      : { run_in_background: toolInput.run_in_background }),
    ...(toolInput.timeout === undefined ? {} : { timeout: toolInput.timeout }),
  };
}

function validateIssuedMarker(marker, identity) {
  if (
    !hasExactKeys(marker, [
      "pullRequestNumber",
      "repository",
      "runAttempt",
      "runId",
      "schema",
      "toolInputDigest",
      "toolUseId",
    ]) ||
    marker.schema !== ISSUED_SCHEMA ||
    marker.pullRequestNumber !== identity.pullRequestNumber ||
    marker.repository !== identity.repository ||
    marker.runAttempt !== identity.runAttempt ||
    marker.runId !== identity.runId ||
    !/^[0-9a-f]{64}$/.test(marker.toolInputDigest ?? "") ||
    !isToolUseId(marker.toolUseId)
  ) {
    block("issued diff-read marker is not canonically bound");
  }
  return marker;
}

function verifyCompletion(identity, paths) {
  const issued = validateIssuedMarker(
    readMarker(paths.issued, "issued diff-read marker"),
    identity,
  );
  const completed = readMarker(paths.completed, "completed diff-read marker");
  if (
    !hasExactKeys(completed, [
      "outputBytes",
      "outputDigest",
      "pullRequestNumber",
      "repository",
      "runAttempt",
      "runId",
      "schema",
      "toolInputDigest",
      "toolUseId",
    ]) ||
    completed.schema !== COMPLETED_SCHEMA ||
    completed.pullRequestNumber !== identity.pullRequestNumber ||
    completed.repository !== identity.repository ||
    completed.runAttempt !== identity.runAttempt ||
    completed.runId !== identity.runId ||
    completed.toolInputDigest !== issued.toolInputDigest ||
    completed.toolUseId !== issued.toolUseId ||
    !Number.isSafeInteger(completed.outputBytes) ||
    completed.outputBytes < 1 ||
    completed.outputBytes > MAX_BASH_OUTPUT_BYTES ||
    !/^[0-9a-f]{64}$/.test(completed.outputDigest ?? "")
  ) {
    block("completed diff-read marker is not canonically bound");
  }
}

const identity = requiredEnvironment();
const { pullRequestNumber, repository, runAttempt, runId } = identity;
const paths = markerPaths(identity);

if (process.argv.length === 3 && process.argv[2] === "--verify-completion") {
  verifyCompletion(identity, paths);
  process.exit(0);
}
if (process.argv.length !== 2) {
  block("command-line arguments are invalid");
}

const hookInput = await parseHookInput();

if (hookInput.tool_name !== "Bash" || !isToolUseId(hookInput.tool_use_id)) {
  block("only a canonical Bash tool call is accepted");
}

const expectedCommand = `gh pr diff ${pullRequestNumber} --repo ${repository}`;
const canonicalToolInput = validateToolInput(
  hookInput.tool_input,
  expectedCommand,
);
const toolInputDigest = sha256(JSON.stringify(canonicalToolInput));

if (hookInput.hook_event_name === "PreToolUse") {
  writeMarker(
    paths.issued,
    {
      pullRequestNumber,
      repository,
      runAttempt,
      runId,
      schema: ISSUED_SCHEMA,
      toolInputDigest,
      toolUseId: hookInput.tool_use_id,
    },
    "the one permitted diff read was already issued or could not be sealed",
  );
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason:
          "Exact receipt-bound Dependabot PR diff command",
      },
    })}\n`,
  );
  process.exit(0);
}

if (hookInput.hook_event_name !== "PostToolUse") {
  block("only Bash PreToolUse and PostToolUse events are accepted");
}

const issued = validateIssuedMarker(
  readMarker(paths.issued, "issued diff-read marker"),
  identity,
);
if (
  issued.toolUseId !== hookInput.tool_use_id ||
  issued.toolInputDigest !== toolInputDigest
) {
  block("completed tool call does not match the issued diff read");
}

const response = hookInput.tool_response;
if (
  !response ||
  typeof response !== "object" ||
  Array.isArray(response) ||
  typeof response.stdout !== "string" ||
  response.stdout.length < 1 ||
  response.stdout.length > MAX_BASH_OUTPUT_LENGTH ||
  !response.stdout.startsWith("diff --git ") ||
  typeof response.stderr !== "string" ||
  response.interrupted !== false ||
  (response.isImage !== undefined && response.isImage !== false) ||
  response.noOutputExpected === true ||
  response.persistedOutputPath !== undefined ||
  response.persistedOutputSize !== undefined ||
  response.rawOutputPath !== undefined ||
  response.structuredContent !== undefined ||
  response.backgroundTaskId !== undefined ||
  response.backgroundedByUser !== undefined ||
  response.timedOutAfterMs !== undefined
) {
  block("Bash result is not a complete foreground PR diff");
}

writeMarker(
  paths.completed,
  {
    outputBytes: Buffer.byteLength(response.stdout),
    outputDigest: sha256(response.stdout),
    pullRequestNumber,
    repository,
    runAttempt,
    runId,
    schema: COMPLETED_SCHEMA,
    toolInputDigest,
    toolUseId: hookInput.tool_use_id,
  },
  "the diff-read completion was already sealed or could not be recorded",
);
