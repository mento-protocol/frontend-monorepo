/* eslint-disable turbo/no-undeclared-env-vars -- The trusted repair hook validates workflow-only evidence paths. */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";

const MANIFEST_SCHEMA = "dependabot-repair-evidence:v1";
const MAX_EVIDENCE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_HOOK_INPUT_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MANIFEST_FILES = 150;
const MAX_PATTERN_LENGTH = 500;
const MAX_TOOL_RESPONSE_BYTES = 32 * 1024;
const MAX_RECEIPT_FILES = 400;
const MAX_UNPAGED_READ_BYTES = 16 * 1024;
const MAX_READ_LINES = 2_000;
const MAX_PAGED_READ_LINES = 4;
const MAX_GREP_HEAD_LIMIT = 5;
const MAX_GREP_CONTEXT = 1;
const MAX_EVIDENCE_LINE_BYTES = 4 * 1024;
const READ_INPUT_KEYS = new Set(["file_path", "limit", "offset"]);
const GREP_INPUT_KEYS = new Set([
  "-A",
  "-B",
  "-C",
  "context",
  "glob",
  "head_limit",
  "multiline",
  "offset",
  "output_mode",
  "path",
  "pattern",
]);

function block(reason) {
  console.error(`Blocked Dependabot repair evidence tool call: ${reason}`);
  process.exit(2);
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(sorted(value));
}

function prettyJson(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isBoundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function hasBoundedLines(bytes) {
  let lineStart = 0;
  for (let index = 0; index <= bytes.byteLength; index += 1) {
    if (index !== bytes.byteLength && bytes[index] !== 0x0a) continue;
    if (index - lineStart > MAX_EVIDENCE_LINE_BYTES) return false;
    lineStart = index + 1;
  }
  return true;
}

function textLineCount(value) {
  if (value.length === 0) return 0;
  const newlineCount = [...value].filter(
    (character) => character === "\n",
  ).length;
  return newlineCount + (value.endsWith("\n") ? 0 : 1);
}

function requiredEnvironment() {
  const root = process.env.DEPENDABOT_REPAIR_EVIDENCE_ROOT ?? "";
  const manifestPath = process.env.DEPENDABOT_REPAIR_EVIDENCE_MANIFEST ?? "";
  const manifestDigest =
    process.env.DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST ?? "";
  const runnerTemp = process.env.RUNNER_TEMP ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  const expectedRoot = join(
    runnerTemp,
    `dependabot-repair-evidence-${runId}-${runAttempt}`,
  );
  if (
    !isAbsolute(root) ||
    resolve(root) !== root ||
    root === "/" ||
    !isAbsolute(manifestPath) ||
    resolve(manifestPath) !== manifestPath ||
    manifestPath !== join(root, "manifest.json") ||
    !/^[0-9a-f]{64}$/.test(manifestDigest) ||
    !isAbsolute(runnerTemp) ||
    resolve(runnerTemp) !== runnerTemp ||
    !/^[1-9][0-9]*$/.test(runId) ||
    !/^[1-9][0-9]*$/.test(runAttempt) ||
    root !== expectedRoot
  ) {
    block("evidence environment paths are missing or invalid");
  }
  let rootStats;
  try {
    rootStats = lstatSync(root);
  } catch {
    block("evidence root is missing");
  }
  if (
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink() ||
    (rootStats.mode & 0o777) !== 0o700 ||
    !new Set([root, `/private${root}`]).has(realpathSync(root))
  ) {
    block("evidence root is not a sealed directory");
  }
  const receiptRoot = join(
    runnerTemp,
    `dependabot-repair-evidence-use-${runId}-${runAttempt}`,
  );
  try {
    mkdirSync(receiptRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST")
      block("evidence receipt root cannot be sealed");
  }
  const receiptStats = lstatSync(receiptRoot);
  if (
    !receiptStats.isDirectory() ||
    receiptStats.isSymbolicLink() ||
    (receiptStats.mode & 0o777) !== 0o700 ||
    !new Set([receiptRoot, `/private${receiptRoot}`]).has(
      realpathSync(receiptRoot),
    )
  ) {
    block("evidence receipt root is invalid");
  }
  return {
    manifestDigest,
    manifestPath,
    receiptRoot,
    root,
    runAttempt,
    runId,
  };
}

function readSealedFile(path, maximumBytes, label) {
  let file;
  try {
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(file);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o400 ||
      stats.size < 1 ||
      stats.size > maximumBytes
    ) {
      throw new Error("invalid sealed file metadata");
    }
    const bytes = readFileSync(file);
    closeSync(file);
    return bytes;
  } catch {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {
        // The evidence remains invalid when the descriptor cannot close.
      }
    }
    block(`${label} is missing, mutable, linked, or oversized`);
  }
}

function loadManifest({ manifestDigest, manifestPath, root }) {
  const bytes = readSealedFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    "evidence manifest",
  );
  if (digest(bytes) !== manifestDigest) {
    block("evidence manifest digest changed after materialization");
  }
  if (!hasBoundedLines(bytes)) {
    block("evidence manifest contains an oversized line");
  }
  let manifest;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    manifest = JSON.parse(text);
    if (prettyJson(manifest) !== text) throw new Error("not canonical");
  } catch {
    block("evidence manifest is not canonical UTF-8 JSON");
  }
  if (
    !exactKeys(manifest, [
      "baseSha",
      "evidenceRoot",
      "files",
      "headSha",
      "packetDigest",
      "processorCheckId",
      "pullRequestNumber",
      "repository",
      "schema",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ]) ||
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.repository !== "mento-protocol/frontend-monorepo" ||
    manifest.evidenceRoot !== root ||
    !/^[0-9a-f]{40}$/.test(manifest.baseSha ?? "") ||
    !/^[0-9a-f]{40}$/.test(manifest.headSha ?? "") ||
    !/^[0-9a-f]{40}$/.test(manifest.workflowSha ?? "") ||
    !/^[0-9a-f]{64}$/.test(manifest.packetDigest ?? "") ||
    !isBoundedInteger(manifest.processorCheckId, 1, Number.MAX_SAFE_INTEGER) ||
    !isBoundedInteger(manifest.pullRequestNumber, 1, Number.MAX_SAFE_INTEGER) ||
    !isBoundedInteger(
      manifest.workflowRunAttempt,
      1,
      Number.MAX_SAFE_INTEGER,
    ) ||
    !isBoundedInteger(manifest.workflowRunId, 1, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length < 6 ||
    manifest.files.length > MAX_MANIFEST_FILES
  ) {
    block("evidence manifest identity or shape is invalid");
  }
  const paths = new Map();
  const names = new Set();
  let totalBytes = 0;
  for (const [index, entry] of manifest.files.entries()) {
    if (
      !exactKeys(entry, [
        "bytes",
        "digest",
        "kind",
        "mediaType",
        "name",
        "source",
      ]) ||
      !/^[a-z][a-z0-9-]{0,60}\.(?:json|patch|txt)$/.test(entry.name ?? "") ||
      !/^[a-z][a-z0-9-]{0,60}$/.test(entry.kind ?? "") ||
      !new Set(["application/json", "text/plain"]).has(entry.mediaType) ||
      entry.name.endsWith(".json") !==
        (entry.mediaType === "application/json") ||
      !/^[0-9a-f]{64}$/.test(entry.digest ?? "") ||
      !isBoundedInteger(entry.bytes, 1, MAX_EVIDENCE_FILE_BYTES) ||
      entry.source === null ||
      typeof entry.source !== "object" ||
      Array.isArray(entry.source) ||
      canonicalJson(entry.source).length > 16 * 1024
    ) {
      block(`evidence manifest file ${index} is invalid`);
    }
    const path = join(root, entry.name);
    if (
      resolve(path) !== path ||
      dirname(path) !== root ||
      path === manifestPath ||
      paths.has(path)
    ) {
      block("evidence manifest contains a duplicate or unsafe path");
    }
    totalBytes += entry.bytes;
    if (totalBytes > MAX_EVIDENCE_TOTAL_BYTES) {
      block("evidence manifest exceeds its aggregate size cap");
    }
    paths.set(path, entry);
    names.add(entry.name);
  }
  for (const required of [
    "failure-index.json",
    "feedback-index.json",
    "findings.json",
    "packet.json",
    "pull-file-inventory.json",
    "pull-request-diff.patch",
  ]) {
    if (!names.has(required))
      block(`required evidence file ${required} is missing`);
  }
  let directoryEntries;
  try {
    directoryEntries = new Set(readdirSync(root));
  } catch {
    block("evidence root inventory cannot be read");
  }
  const expectedDirectoryEntries = new Set(["manifest.json", ...names]);
  if (
    directoryEntries.size !== expectedDirectoryEntries.size ||
    [...directoryEntries].some((name) => !expectedDirectoryEntries.has(name))
  ) {
    block("evidence root contains an unlisted file");
  }
  return { manifest, manifestBytes: bytes.byteLength, paths };
}

function verifyEntry(path, entry) {
  const bytes = readSealedFile(
    path,
    MAX_EVIDENCE_FILE_BYTES,
    `evidence file ${entry.name}`,
  );
  if (
    bytes.byteLength !== entry.bytes ||
    digest(bytes) !== entry.digest ||
    !hasBoundedLines(bytes)
  ) {
    block(`evidence file ${entry.name} changed after materialization`);
  }
}

function validateReadInput(input, readableEntries) {
  if (!exactKeysSubset(input, READ_INPUT_KEYS)) {
    block("Read input contains an unexpected field");
  }
  if (typeof input.file_path !== "string") {
    block("Read path is not an exact manifest-listed evidence file");
  }
  const entry = readableEntries.get(input.file_path);
  if (entry === undefined) {
    block("Read path is not an exact manifest-listed evidence file");
  }
  if (
    input.offset !== undefined &&
    !isBoundedInteger(input.offset, 1, 1_000_000)
  ) {
    block("Read offset is invalid");
  }
  if (
    input.limit !== undefined &&
    !isBoundedInteger(input.limit, 1, MAX_READ_LINES)
  ) {
    block("Read limit is invalid");
  }
  if (
    entry.bytes > MAX_UNPAGED_READ_BYTES &&
    (input.offset === undefined || input.limit === undefined)
  ) {
    block("large Read requires an explicit bounded line page");
  }
  if (
    entry.bytes > MAX_UNPAGED_READ_BYTES &&
    input.limit > MAX_PAGED_READ_LINES
  ) {
    block("large Read page exceeds its line cap");
  }
}

function exactKeysSubset(value, allowed) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function validateGrepInput(input, root, allowedPaths) {
  if (!exactKeysSubset(input, GREP_INPUT_KEYS)) {
    block("Grep input contains an unexpected field");
  }
  if (
    typeof input.pattern !== "string" ||
    input.pattern.length < 1 ||
    input.pattern.length > MAX_PATTERN_LENGTH ||
    /[\0\r\n]/.test(input.pattern)
  ) {
    block("Grep pattern is invalid");
  }
  if (
    typeof input.path !== "string" ||
    (input.path !== root && !allowedPaths.has(input.path))
  ) {
    block("Grep path is outside the exact evidence root");
  }
  if (
    input.glob !== undefined &&
    (typeof input.glob !== "string" ||
      input.glob.length < 1 ||
      input.glob.length > 200 ||
      !/^[A-Za-z0-9*?.,_-]+$/.test(input.glob))
  ) {
    block("Grep glob is invalid");
  }
  if (
    !new Set(["content", "count", "files_with_matches"]).has(input.output_mode)
  ) {
    block("Grep output mode is invalid");
  }
  for (const key of ["-A", "-B", "-C", "context"]) {
    if (
      input[key] !== undefined &&
      !isBoundedInteger(input[key], 0, MAX_GREP_CONTEXT)
    ) {
      block(`Grep ${key} is invalid`);
    }
  }
  if (!isBoundedInteger(input.head_limit, 1, MAX_GREP_HEAD_LIMIT)) {
    block("Grep head limit is invalid");
  }
  if (
    input.offset !== undefined &&
    !isBoundedInteger(input.offset, 0, 10_000)
  ) {
    block("Grep offset is invalid");
  }
  if (input.multiline !== false) {
    block("multiline Grep is forbidden");
  }
}

function isToolUseId(value) {
  return (
    typeof value === "string" && /^toolu_[A-Za-z0-9_-]{1,200}$/.test(value)
  );
}

function canonicalToolInput(
  toolName,
  toolInput,
  root,
  allowedPaths,
  readableEntries,
) {
  if (toolName === "Read") {
    validateReadInput(toolInput, readableEntries);
  } else if (toolName === "Grep") {
    validateGrepInput(toolInput, root, allowedPaths);
  } else {
    block("only Read and Grep tools are accepted");
  }
  return canonicalJson(toolInput);
}

function receiptPaths(environment, toolUseId) {
  return {
    completed: join(environment.receiptRoot, `${toolUseId}.completed.json`),
    issued: join(environment.receiptRoot, `${toolUseId}.issued.json`),
  };
}

function writeReceipt(path, receipt, label) {
  let file;
  try {
    file = openSync(path, "wx", 0o600);
    writeSync(file, `${canonicalJson(receipt)}\n`);
    fsyncSync(file);
    closeSync(file);
  } catch {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {
        // A partial receipt stays consumed and invalid.
      }
    }
    block(`${label} already exists or could not be sealed`);
  }
}

function readReceipt(path, label) {
  let file;
  try {
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(file);
    if (
      !stats.isFile() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size < 2 ||
      stats.size > 4_096
    ) {
      throw new Error("invalid receipt metadata");
    }
    const text = readFileSync(file, "utf8");
    closeSync(file);
    const receipt = JSON.parse(text);
    if (`${canonicalJson(receipt)}\n` !== text)
      throw new Error("not canonical");
    return receipt;
  } catch {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {
        // The receipt remains invalid.
      }
    }
    block(`${label} is missing or invalid`);
  }
}

function validateIssuedReceipt(receipt, environment, toolUseId, inputDigest) {
  if (
    !exactKeys(receipt, [
      "manifestDigest",
      "runAttempt",
      "runId",
      "schema",
      "toolInputDigest",
      "toolUseId",
    ]) ||
    receipt.schema !== "dependabot-repair-evidence-tool-issued:v1" ||
    receipt.manifestDigest !== environment.manifestDigest ||
    receipt.runId !== environment.runId ||
    receipt.runAttempt !== environment.runAttempt ||
    receipt.toolUseId !== toolUseId ||
    receipt.toolInputDigest !== inputDigest
  ) {
    block("issued evidence-read receipt is not canonically bound");
  }
}

function validateSuccessfulToolResponse(
  toolName,
  toolInput,
  response,
  root,
  allowedPaths,
  readableEntries,
) {
  if (
    response === null ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    block("evidence tool response is malformed");
  }
  let text;
  if (
    toolName === "Read" &&
    response.type === "text" &&
    response.file !== null &&
    typeof response.file === "object" &&
    !Array.isArray(response.file) &&
    typeof response.file.content === "string" &&
    typeof response.file.filePath === "string" &&
    response.file.filePath === toolInput.file_path &&
    isBoundedInteger(response.file.numLines, 0, 1_000_000) &&
    textLineCount(response.file.content) === response.file.numLines &&
    response.file.startLine === (toolInput.offset ?? 1) &&
    isBoundedInteger(response.file.totalLines, 0, 1_000_000) &&
    response.file.numLines <= (toolInput.limit ?? response.file.totalLines) &&
    response.file.numLines <=
      Math.max(0, response.file.totalLines - response.file.startLine + 1) &&
    (response.file.truncatedByTokenCap === undefined ||
      response.file.truncatedByTokenCap === false) &&
    allowedPaths.has(response.file.filePath) &&
    hasBoundedLines(Buffer.from(response.file.content)) &&
    Buffer.byteLength(response.file.content) <=
      readableEntries.get(response.file.filePath).bytes
  ) {
    text = response.file.content;
  } else if (
    toolName === "Grep" &&
    Array.isArray(response.filenames) &&
    response.filenames.length <= toolInput.head_limit &&
    response.filenames.every(
      (path) =>
        typeof path === "string" &&
        allowedPaths.has(path) &&
        (toolInput.path === root || path === toolInput.path),
    ) &&
    isBoundedInteger(response.numFiles, 0, toolInput.head_limit) &&
    (response.content === undefined || typeof response.content === "string")
  ) {
    text = canonicalJson(response);
  }
  if (
    typeof text !== "string" ||
    text.length < 1 ||
    Buffer.byteLength(text) > MAX_TOOL_RESPONSE_BYTES
  ) {
    block("evidence tool response is empty, malformed, or oversized");
  }
  return text;
}

function verifyCompletion(environment) {
  const entries = readdirSync(environment.receiptRoot);
  if (
    entries.length < 2 ||
    entries.length > MAX_RECEIPT_FILES ||
    entries.some(
      (name) =>
        !/^toolu_[A-Za-z0-9_-]{1,200}\.(?:issued|completed)\.json$/.test(name),
    )
  ) {
    block("evidence receipt inventory is malformed or capped");
  }
  const completedNames = entries.filter((name) =>
    /^toolu_[A-Za-z0-9_-]{1,200}\.completed\.json$/.test(name),
  );
  if (completedNames.length < 1 || completedNames.length > 200) {
    block("no bounded successful evidence access was completed");
  }
  for (const name of completedNames) {
    const receipt = readReceipt(
      join(environment.receiptRoot, name),
      "completed evidence-read receipt",
    );
    if (
      !exactKeys(receipt, [
        "manifestDigest",
        "responseBytes",
        "responseDigest",
        "runAttempt",
        "runId",
        "schema",
        "toolInputDigest",
        "toolUseId",
      ]) ||
      receipt.schema !== "dependabot-repair-evidence-tool-completed:v1" ||
      receipt.manifestDigest !== environment.manifestDigest ||
      receipt.runId !== environment.runId ||
      receipt.runAttempt !== environment.runAttempt ||
      !isToolUseId(receipt.toolUseId) ||
      name !== `${receipt.toolUseId}.completed.json` ||
      !/^[0-9a-f]{64}$/.test(receipt.toolInputDigest ?? "") ||
      !/^[0-9a-f]{64}$/.test(receipt.responseDigest ?? "") ||
      !isBoundedInteger(receipt.responseBytes, 1, MAX_TOOL_RESPONSE_BYTES)
    ) {
      block("completed evidence-read receipt is not canonically bound");
    }
    const issued = readReceipt(
      receiptPaths(environment, receipt.toolUseId).issued,
      "issued evidence-read receipt",
    );
    validateIssuedReceipt(
      issued,
      environment,
      receipt.toolUseId,
      receipt.toolInputDigest,
    );
  }
  if (
    entries.some(
      (name) =>
        name.endsWith(".issued.json") &&
        !entries.includes(name.replace(".issued.json", ".completed.json")),
    )
  ) {
    block("an issued evidence read did not complete successfully");
  }
}

async function readHookInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_HOOK_INPUT_BYTES) block("hook input exceeds its size cap");
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    block("hook input is not valid JSON");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    block("hook input is not an object");
  }
  return input;
}

const environment = requiredEnvironment();
const { manifestBytes, paths } = loadManifest(environment);
if (process.argv.length === 3 && process.argv[2] === "--verify-completion") {
  verifyCompletion(environment);
  process.exit(0);
}
if (process.argv.length !== 2) block("command-line arguments are forbidden");
const allowedPaths = new Set([environment.manifestPath, ...paths.keys()]);
const readableEntries = new Map([
  [environment.manifestPath, { bytes: manifestBytes }],
  ...paths,
]);
const hookInput = await readHookInput();
if (!isToolUseId(hookInput.tool_use_id)) block("tool-use ID is invalid");
const toolInputText = canonicalToolInput(
  hookInput.tool_name,
  hookInput.tool_input,
  environment.root,
  allowedPaths,
  readableEntries,
);
const toolInputDigest = digest(toolInputText);
if (hookInput.tool_name === "Read") {
  const entry = paths.get(hookInput.tool_input.file_path);
  if (entry !== undefined) verifyEntry(hookInput.tool_input.file_path, entry);
} else {
  if (hookInput.tool_input.path === environment.root) {
    for (const [path, entry] of paths) verifyEntry(path, entry);
  } else {
    const entry = paths.get(hookInput.tool_input.path);
    if (entry !== undefined) verifyEntry(hookInput.tool_input.path, entry);
  }
}

const toolReceiptPaths = receiptPaths(environment, hookInput.tool_use_id);
if (hookInput.hook_event_name === "PostToolUse") {
  validateIssuedReceipt(
    readReceipt(toolReceiptPaths.issued, "issued evidence-read receipt"),
    environment,
    hookInput.tool_use_id,
    toolInputDigest,
  );
  const response = validateSuccessfulToolResponse(
    hookInput.tool_name,
    hookInput.tool_input,
    hookInput.tool_response,
    environment.root,
    allowedPaths,
    readableEntries,
  );
  writeReceipt(
    toolReceiptPaths.completed,
    {
      manifestDigest: environment.manifestDigest,
      responseBytes: Buffer.byteLength(response),
      responseDigest: digest(response),
      runAttempt: environment.runAttempt,
      runId: environment.runId,
      schema: "dependabot-repair-evidence-tool-completed:v1",
      toolInputDigest,
      toolUseId: hookInput.tool_use_id,
    },
    "completed evidence-read receipt",
  );
  process.exit(0);
}
if (hookInput.hook_event_name !== "PreToolUse") {
  block("only PreToolUse and PostToolUse events are accepted");
}
writeReceipt(
  toolReceiptPaths.issued,
  {
    manifestDigest: environment.manifestDigest,
    runAttempt: environment.runAttempt,
    runId: environment.runId,
    schema: "dependabot-repair-evidence-tool-issued:v1",
    toolInputDigest,
    toolUseId: hookInput.tool_use_id,
  },
  "issued evidence-read receipt",
);

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Exact sealed Dependabot repair evidence read",
    },
  })}\n`,
);
