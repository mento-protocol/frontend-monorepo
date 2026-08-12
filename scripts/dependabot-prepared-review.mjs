import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEAD_REF_PATTERN = /^dependabot\/[A-Za-z0-9._/-]{1,220}$/;
const REPAIR_PATH_PATTERN =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]{1,300}$/;
const GITHUB_ACTIONS_APP_ID = 15368;
const RECEIPT_OUTPUT_LIMIT = 50_000;
const LINEAGE_LIMIT = 24;
const CHECK_PAGE_SIZE = 100;
const MAX_OPERATION_CHECKS_PER_NAME = 500;
const RETRYABLE_REPAIR_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "startup_failure",
  "timed_out",
]);

const REFRESH_REQUEST_KEYS = [
  "baseSha",
  "headRef",
  "headSha",
  "parentHeadSha",
  "prepareAppSlug",
  "prepareBotId",
  "prepareBotLogin",
  "previousBaseSha",
  "pullRequestNumber",
  "repository",
  "schema",
  "state",
  "workflowRunAttempt",
  "workflowRunId",
  "workflowSha",
];

const REFRESH_COMPLETED_KEYS = [
  ...REFRESH_REQUEST_KEYS,
  "requestCheckId",
  "requestDigest",
];

const REPAIR_COMPLETED_KEYS = [
  "attempt",
  "baseSha",
  "headRef",
  "headSha",
  "packetDigest",
  "parentHeadSha",
  "prepareAppSlug",
  "prepareBotId",
  "prepareBotLogin",
  "processorCheckId",
  "pullRequestNumber",
  "repository",
  "schema",
  "state",
  "workflowRunAttempt",
  "workflowRunId",
  "workflowSha",
];

const REPAIR_INTENT_KEYS = [
  "attempt",
  "baseSha",
  "edits",
  "editsDigest",
  "headRef",
  "headSha",
  "packetDigest",
  "parentHeadSha",
  "parentTreeSha",
  "prepareAppSlug",
  "prepareBotId",
  "prepareBotLogin",
  "processorCheckId",
  "pullRequestNumber",
  "repository",
  "retryCount",
  "schema",
  "state",
  "treeDigest",
  "treeSha",
  "validatedPlanDigest",
  "workflowRunAttempt",
  "workflowRunId",
  "workflowSha",
];

const REPAIR_INTENT_EDIT_KEYS = [
  "contentDigest",
  "expectedBlobSha",
  "mode",
  "path",
  "resultBlobSha",
  "type",
];

function invariant(condition, message) {
  if (!condition)
    throw new Error(`Unsafe prepared-head review target: ${message}`);
}

function canonicalizeReceipt(value) {
  if (Array.isArray(value)) return value.map(canonicalizeReceipt);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeReceipt(value[key])]),
    );
  }
  return value;
}

export function canonicalReceiptJson(value) {
  return JSON.stringify(canonicalizeReceipt(value));
}

export function digestReceipt(value) {
  return createHash("sha256").update(canonicalReceiptJson(value)).digest("hex");
}

function exactKeys(value, expected, description) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${description} is not an object`,
  );
  invariant(
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expected].sort()),
    `${description} keys are not exact`,
  );
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateActorBinding(receipt, expected) {
  invariant(
    receipt.prepareAppSlug === expected.prepareAppSlug &&
      receipt.prepareBotId === expected.prepareBotId &&
      receipt.prepareBotLogin === expected.prepareBotLogin &&
      receipt.prepareBotLogin === `${receipt.prepareAppSlug}[bot]`,
    "operation receipt Prepare App identity is not trusted",
  );
}

function parseCanonicalReceipt(check) {
  invariant(
    typeof check.output?.text === "string" &&
      check.output.text.length >= 2 &&
      check.output.text.length <= RECEIPT_OUTPUT_LIMIT,
    `${check.name ?? "operation"} check output is missing or oversized`,
  );
  let receipt;
  try {
    receipt = JSON.parse(check.output.text);
  } catch {
    invariant(false, `${check.name} check output is not JSON`);
  }
  invariant(
    check.output.text === canonicalReceiptJson(receipt),
    `${check.name} check output is not canonical JSON`,
  );
  return receipt;
}

function validateCheckShell(check, { headSha, name }) {
  invariant(
    positiveInteger(check.id) &&
      check.name === name &&
      check.head_sha === headSha &&
      check.status === "completed" &&
      check.conclusion === "success" &&
      check.app?.id === GITHUB_ACTIONS_APP_ID &&
      check.app?.slug === "github-actions",
    `${name} is not an exact successful trusted check`,
  );
}

function validateWorkflowRun({
  check,
  conclusions = new Set(["success"]),
  operation,
  receipt,
  repository,
  requestJson,
}) {
  const actionsUrl = `https://github.com/${repository}/actions/runs/${receipt.workflowRunId}`;
  const selfUrl = `https://github.com/${repository}/runs/${check.id}`;
  invariant(
    check.details_url === actionsUrl || check.details_url === selfUrl,
    "operation check details URL is not the declared run or exact check self URL",
  );
  let run = requestJson(
    `repos/${repository}/actions/runs/${receipt.workflowRunId}`,
  );
  if (run.run_attempt !== receipt.workflowRunAttempt) {
    run = requestJson(
      `repos/${repository}/actions/runs/${receipt.workflowRunId}/attempts/${receipt.workflowRunAttempt}`,
    );
  }
  const expectedPath =
    operation === "refresh"
      ? ".github/workflows/dependabot-process.yml"
      : ".github/workflows/dependabot-prepare-repair.yml";
  const validEvent =
    operation === "refresh"
      ? ["repository_dispatch", "schedule", "workflow_run"].includes(run.event)
      : run.event === "repository_dispatch";
  invariant(
    run.id === receipt.workflowRunId &&
      run.run_attempt === receipt.workflowRunAttempt &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository &&
      run.path === expectedPath &&
      validEvent &&
      run.head_branch === "main" &&
      run.head_sha === receipt.workflowSha &&
      run.status === "completed" &&
      conclusions.has(run.conclusion),
    "operation check workflow provenance is invalid",
  );
  return run;
}

function validateCommonReceipt(receipt, expected, headSha) {
  invariant(
    receipt.repository === expected.repository &&
      receipt.pullRequestNumber === expected.pullRequestNumber &&
      receipt.headRef === expected.headRef &&
      receipt.headSha === headSha &&
      SHA_PATTERN.test(receipt.parentHeadSha ?? "") &&
      SHA_PATTERN.test(receipt.baseSha ?? "") &&
      SHA_PATTERN.test(receipt.workflowSha ?? "") &&
      positiveInteger(receipt.workflowRunId) &&
      positiveInteger(receipt.workflowRunAttempt),
    "operation receipt does not bind the PR, commit, and workflow",
  );
  validateActorBinding(receipt, expected);
}

function validateRefreshRequest({ completed, expected, headSha, requestJson }) {
  const check = requestJson(
    `repos/${expected.repository}/check-runs/${completed.requestCheckId}`,
  );
  validateCheckShell(check, { headSha, name: "Dependabot Refresh" });
  invariant(
    check.id === completed.requestCheckId,
    "refresh request check ID changed",
  );
  const receipt = parseCanonicalReceipt(check);
  exactKeys(receipt, REFRESH_REQUEST_KEYS, "refresh request receipt");
  const digest = digestReceipt(receipt);
  const externalId =
    `dependabot-refresh:v1:pr=${expected.pullRequestNumber}:head=${headSha}:` +
    `state=requested:digest=${digest}:run=${receipt.workflowRunId}:` +
    `attempt=${receipt.workflowRunAttempt}`;
  invariant(
    receipt.schema === "dependabot-refresh:v1" &&
      receipt.state === "requested" &&
      receipt.repository === expected.repository &&
      receipt.pullRequestNumber === expected.pullRequestNumber &&
      receipt.headRef === expected.headRef &&
      receipt.parentHeadSha === headSha &&
      receipt.headSha === null &&
      SHA_PATTERN.test(receipt.previousBaseSha ?? "") &&
      SHA_PATTERN.test(receipt.baseSha ?? "") &&
      receipt.previousBaseSha === completed.previousBaseSha &&
      receipt.previousBaseSha !== receipt.baseSha &&
      check.external_id === externalId &&
      completed.requestDigest === digest,
    "refresh request receipt does not bind the completed refresh",
  );
  validateActorBinding(receipt, expected);
  validateWorkflowRun({
    check,
    operation: "refresh",
    receipt,
    repository: expected.repository,
    requestJson,
  });
}

export function validateAppliedBaseOnCurrentMain({
  appliedBaseSha,
  currentBaseSha,
  repository,
  requestJson,
}) {
  invariant(
    SHA_PATTERN.test(appliedBaseSha ?? "") &&
      SHA_PATTERN.test(currentBaseSha ?? ""),
    "refresh base lineage contains an invalid SHA",
  );
  if (appliedBaseSha === currentBaseSha) return;
  const comparison = requestJson(
    `repos/${repository}/compare/${appliedBaseSha}...${currentBaseSha}`,
  );
  invariant(
    comparison.status === "ahead" &&
      comparison.base_commit?.sha === appliedBaseSha &&
      comparison.merge_base_commit?.sha === appliedBaseSha &&
      positiveInteger(comparison.ahead_by) &&
      comparison.behind_by === 0,
    "refresh base is not on the current main lineage",
  );
}

function validateProcessorPacket({ expected, receipt, requestJson }) {
  const check = requestJson(
    `repos/${expected.repository}/check-runs/${receipt.processorCheckId}`,
  );
  invariant(
    positiveInteger(check.id) &&
      check.id === receipt.processorCheckId &&
      check.name === "Dependabot Processor" &&
      check.head_sha === receipt.parentHeadSha &&
      check.status === "completed" &&
      check.conclusion === "failure" &&
      check.app?.id === GITHUB_ACTIONS_APP_ID &&
      check.app?.slug === "github-actions" &&
      typeof check.output?.text === "string" &&
      check.output.text.length >= 2 &&
      check.output.text.length <= RECEIPT_OUTPUT_LIMIT,
    "repair packet check is not an exact trusted blocking check",
  );
  let packet;
  try {
    packet = JSON.parse(check.output.text);
  } catch {
    invariant(false, "repair packet check output is not JSON");
  }
  invariant(
    check.output.text === canonicalReceiptJson(packet),
    "repair packet check output is not canonical JSON",
  );
  const packetDigest = digestReceipt(packet);
  invariant(
    packetDigest === receipt.packetDigest &&
      packet.schema === "dependabot-repair-packet:v2" &&
      packet.repository === expected.repository &&
      packet.pullRequestNumber === expected.pullRequestNumber &&
      packet.headSha === receipt.parentHeadSha &&
      packet.baseSha === receipt.baseSha &&
      packet.mode === "prepare" &&
      packet.attemptNumber === receipt.attempt,
    "repair receipt does not bind the exact processor packet",
  );
  const externalPattern =
    /^dependabot-processor:v2:pr=([1-9][0-9]*):head=([0-9a-f]{40}):mode=prepare:repair=([1-9][0-9]*):packet=true:digest=([0-9a-f]{64}):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
  const external = externalPattern.exec(check.external_id ?? "");
  invariant(
    external !== null &&
      Number(external[1]) === expected.pullRequestNumber &&
      external[2] === receipt.parentHeadSha &&
      Number(external[3]) === receipt.attempt &&
      external[4] === packetDigest,
    "repair packet Processor external ID is invalid",
  );
  const workflowRunId = Number(external[5]);
  const workflowRunAttempt = Number(external[6]);
  const actionsUrl = `https://github.com/${expected.repository}/actions/runs/${workflowRunId}`;
  const selfUrl = `https://github.com/${expected.repository}/runs/${check.id}`;
  invariant(
    check.details_url === actionsUrl || check.details_url === selfUrl,
    "repair packet check details URL is invalid",
  );
  let run = requestJson(
    `repos/${expected.repository}/actions/runs/${workflowRunId}`,
  );
  if (run.run_attempt !== workflowRunAttempt) {
    run = requestJson(
      `repos/${expected.repository}/actions/runs/${workflowRunId}/attempts/${workflowRunAttempt}`,
    );
  }
  invariant(
    run.id === workflowRunId &&
      run.run_attempt === workflowRunAttempt &&
      run.repository?.full_name === expected.repository &&
      run.head_repository?.full_name === expected.repository &&
      run.path === ".github/workflows/dependabot-process.yml" &&
      ["repository_dispatch", "schedule", "workflow_run"].includes(run.event) &&
      run.head_branch === "main" &&
      SHA_PATTERN.test(run.head_sha ?? "") &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      packet.workflowRunId === workflowRunId &&
      packet.workflowRunAttempt === workflowRunAttempt &&
      packet.workflowSha === run.head_sha,
    "repair packet Processor workflow provenance is invalid",
  );
}

function validateOperationCheck({
  check,
  expected,
  headSha,
  operation,
  requestJson,
  workflowConclusions,
}) {
  const name =
    operation === "refresh" ? "Dependabot Refresh" : "Dependabot Repair";
  validateCheckShell(check, { headSha, name });
  const receipt = parseCanonicalReceipt(check);
  const digest = digestReceipt(receipt);
  if (operation === "refresh") {
    exactKeys(receipt, REFRESH_COMPLETED_KEYS, "completed refresh receipt");
    const externalId =
      `dependabot-refresh:v1:pr=${expected.pullRequestNumber}:head=${headSha}:` +
      `state=completed:digest=${digest}:run=${receipt.workflowRunId}:` +
      `attempt=${receipt.workflowRunAttempt}`;
    invariant(
      receipt.schema === "dependabot-refresh:v1" &&
        receipt.state === "completed" &&
        check.external_id === externalId &&
        positiveInteger(receipt.requestCheckId) &&
        DIGEST_PATTERN.test(receipt.requestDigest ?? "") &&
        SHA_PATTERN.test(receipt.previousBaseSha ?? ""),
      "completed refresh receipt is invalid",
    );
  } else {
    exactKeys(receipt, REPAIR_COMPLETED_KEYS, "completed repair receipt");
    const externalId =
      `dependabot-repair:v1:pr=${expected.pullRequestNumber}:head=${headSha}:` +
      `attempt=${receipt.attempt}:digest=${digest}:run=${receipt.workflowRunId}:` +
      `run_attempt=${receipt.workflowRunAttempt}`;
    invariant(
      receipt.schema === "dependabot-repair:v1" &&
        receipt.state === "completed" &&
        check.external_id === externalId &&
        [1, 2].includes(receipt.attempt) &&
        positiveInteger(receipt.processorCheckId) &&
        DIGEST_PATTERN.test(receipt.packetDigest ?? ""),
      "completed repair receipt is invalid",
    );
    validateProcessorPacket({ expected, receipt, requestJson });
  }
  validateCommonReceipt(receipt, expected, headSha);
  const run = validateWorkflowRun({
    check,
    conclusions: workflowConclusions,
    operation,
    receipt,
    repository: expected.repository,
    requestJson,
  });
  return { check, digest, operation, receipt, run };
}

function validateDependabotSeed(commit) {
  const dependabotCommitter =
    commit.committer?.login === "dependabot[bot]" &&
    commit.committer?.type === "Bot";
  const webFlowCommitter =
    commit.committer?.login === "web-flow" && commit.committer?.type === "User";
  invariant(
    commit.author?.login === "dependabot[bot]" &&
      commit.author?.type === "Bot" &&
      (dependabotCommitter || webFlowCommitter) &&
      commit.commit?.verification?.verified === true &&
      commit.commit?.verification?.reason === "valid",
    "prepared lineage is not rooted in a verified Dependabot seed",
  );
}

function namedOperationChecks({ expected, headSha, name, requestJson }) {
  const checks = [];
  const seen = new Set();
  let totalCount;
  for (
    let page = 1;
    page <= MAX_OPERATION_CHECKS_PER_NAME / CHECK_PAGE_SIZE;
    page += 1
  ) {
    const response = requestJson(
      `repos/${expected.repository}/commits/${headSha}/check-runs?` +
        `check_name=${encodeURIComponent(name)}&filter=all&per_page=${CHECK_PAGE_SIZE}&page=${page}`,
    );
    invariant(
      Number.isSafeInteger(response.total_count) &&
        response.total_count >= 0 &&
        response.total_count <= MAX_OPERATION_CHECKS_PER_NAME &&
        Array.isArray(response.check_runs) &&
        response.check_runs.length <= CHECK_PAGE_SIZE,
      "prepared lineage check collection is incomplete",
    );
    totalCount ??= response.total_count;
    invariant(
      response.total_count === totalCount,
      "prepared lineage check count changed during collection",
    );
    for (const check of response.check_runs) {
      invariant(
        positiveInteger(check.id) && check.name === name && !seen.has(check.id),
        "prepared lineage contains a malformed or duplicate named check",
      );
      seen.add(check.id);
      checks.push(check);
    }
    if (checks.length >= totalCount) break;
    invariant(
      response.check_runs.length === CHECK_PAGE_SIZE,
      "prepared lineage check pagination ended early",
    );
  }
  invariant(
    checks.length === totalCount,
    "prepared lineage check collection exceeded its bound",
  );
  return checks;
}

function exactRepairRunActor(run, expected) {
  invariant(
    run.actor?.id === expected.prepareBotId &&
      run.actor?.login === expected.prepareBotLogin &&
      run.actor?.type === "Bot",
    "superseded repair run actor is not the trusted Prepare App",
  );
}

function parseOriginalRepairRunTitle(run, receipt) {
  const match =
    /^dependabot-repair:v1 \| pr=([1-9][0-9]*) \| head=([0-9a-f]{40}) \| check=([1-9][0-9]*) \| digest=([0-9a-f]{64}) \| retry=([0-2])$/.exec(
      run.display_title ?? "",
    );
  invariant(
    match !== null &&
      Number(match[1]) === receipt.pullRequestNumber &&
      match[2] === receipt.parentHeadSha &&
      Number(match[3]) === receipt.processorCheckId &&
      match[4] === receipt.packetDigest,
    "superseded repair run title does not bind its receipt",
  );
  return { retryCount: Number(match[5]) };
}

function parseRecoveryRepairRunTitle(run, receipt) {
  const match =
    /^dependabot-repair-recover:v1 \| pr=([1-9][0-9]*) \| head=([0-9a-f]{40}) \| check=([1-9][0-9]*) \| digest=([0-9a-f]{64}) \| retry=([0-2])$/.exec(
      run.display_title ?? "",
    );
  invariant(
    match !== null &&
      Number(match[1]) === receipt.pullRequestNumber &&
      match[2] === receipt.headSha,
    "repair recovery run title does not bind its receipt",
  );
  return {
    intentCheckId: Number(match[3]),
    intentDigest: match[4],
    retryCount: Number(match[5]),
  };
}

function validateRepairIntentShape(intent, expected) {
  exactKeys(intent, REPAIR_INTENT_KEYS, "repair recovery intent");
  invariant(
    intent.schema === "dependabot-repair-intent:v1" &&
      intent.state === "staged" &&
      intent.repository === expected.repository &&
      intent.pullRequestNumber === expected.pullRequestNumber &&
      intent.headRef === expected.headRef &&
      SHA_PATTERN.test(intent.parentHeadSha ?? "") &&
      SHA_PATTERN.test(intent.headSha ?? "") &&
      intent.parentHeadSha !== intent.headSha &&
      SHA_PATTERN.test(intent.baseSha ?? "") &&
      SHA_PATTERN.test(intent.parentTreeSha ?? "") &&
      SHA_PATTERN.test(intent.treeSha ?? "") &&
      intent.parentTreeSha !== intent.treeSha &&
      [1, 2].includes(intent.attempt) &&
      positiveInteger(intent.processorCheckId) &&
      Number.isSafeInteger(intent.retryCount) &&
      intent.retryCount >= 0 &&
      intent.retryCount <= 2 &&
      DIGEST_PATTERN.test(intent.packetDigest ?? "") &&
      DIGEST_PATTERN.test(intent.validatedPlanDigest ?? "") &&
      DIGEST_PATTERN.test(intent.editsDigest ?? "") &&
      DIGEST_PATTERN.test(intent.treeDigest ?? "") &&
      SHA_PATTERN.test(intent.workflowSha ?? "") &&
      positiveInteger(intent.workflowRunId) &&
      positiveInteger(intent.workflowRunAttempt),
    "repair recovery intent identity is invalid",
  );
  validateActorBinding(intent, expected);
  invariant(
    Array.isArray(intent.edits) &&
      intent.edits.length >= 1 &&
      intent.edits.length <= 6,
    "repair recovery intent edits are invalid",
  );
  const paths = new Set();
  for (const edit of intent.edits) {
    exactKeys(edit, REPAIR_INTENT_EDIT_KEYS, "repair recovery intent edit");
    invariant(
      REPAIR_PATH_PATTERN.test(edit.path ?? "") &&
        !edit.path.includes("//") &&
        !edit.path.includes("\\") &&
        !paths.has(edit.path) &&
        SHA_PATTERN.test(edit.expectedBlobSha ?? "") &&
        SHA_PATTERN.test(edit.resultBlobSha ?? "") &&
        edit.expectedBlobSha !== edit.resultBlobSha &&
        DIGEST_PATTERN.test(edit.contentDigest ?? "") &&
        edit.type === "blob" &&
        ["100644", "100755"].includes(edit.mode),
      "repair recovery intent edit is invalid",
    );
    paths.add(edit.path);
  }
  invariant(
    intent.editsDigest === digestReceipt(intent.edits) &&
      intent.treeDigest ===
        digestReceipt({
          parentTreeSha: intent.parentTreeSha,
          treeSha: intent.treeSha,
        }),
    "repair recovery intent digest is invalid",
  );
}

function sameRepairOperation(receipt, intent) {
  return (
    intent.repository === receipt.repository &&
    intent.pullRequestNumber === receipt.pullRequestNumber &&
    intent.headRef === receipt.headRef &&
    intent.parentHeadSha === receipt.parentHeadSha &&
    intent.headSha === receipt.headSha &&
    intent.baseSha === receipt.baseSha &&
    intent.attempt === receipt.attempt &&
    intent.packetDigest === receipt.packetDigest &&
    intent.processorCheckId === receipt.processorCheckId &&
    intent.prepareAppSlug === receipt.prepareAppSlug &&
    intent.prepareBotId === receipt.prepareBotId &&
    intent.prepareBotLogin === receipt.prepareBotLogin
  );
}

function validateSupersededRepairChain({
  expected,
  failed,
  recovery,
  requestJson,
}) {
  invariant(
    failed.length >= 1 &&
      failed.length <= 3 &&
      failed.every(
        (candidate) =>
          candidate.operation === "repair" &&
          RETRYABLE_REPAIR_CONCLUSIONS.has(candidate.run.conclusion),
      ) &&
      recovery.operation === "repair" &&
      recovery.run.conclusion === "success",
    "failed repair receipt chain is not bounded and retryable",
  );
  for (const candidate of [...failed, recovery]) {
    exactRepairRunActor(candidate.run, expected);
  }
  const originalCandidates = failed.filter(({ run }) =>
    run.display_title?.startsWith("dependabot-repair:v1 |"),
  );
  const failedRecoveries = failed.filter(({ run }) =>
    run.display_title?.startsWith("dependabot-repair-recover:v1 |"),
  );
  invariant(
    originalCandidates.length === 1 &&
      originalCandidates.length + failedRecoveries.length === failed.length,
    "failed repair receipt chain has missing or duplicate original evidence",
  );
  const original = originalCandidates[0];
  const originalTitle = parseOriginalRepairRunTitle(
    original.run,
    original.receipt,
  );
  const recoveryTitle = parseRecoveryRepairRunTitle(
    recovery.run,
    recovery.receipt,
  );
  const intentCheck = requestJson(
    `repos/${expected.repository}/check-runs/${recoveryTitle.intentCheckId}`,
  );
  invariant(
    intentCheck.id === recoveryTitle.intentCheckId &&
      intentCheck.name === "Dependabot Repair Intent" &&
      intentCheck.head_sha === recovery.receipt.headSha &&
      intentCheck.status === "completed" &&
      intentCheck.conclusion === "success" &&
      intentCheck.app?.id === GITHUB_ACTIONS_APP_ID &&
      intentCheck.app?.slug === "github-actions",
    "repair recovery intent check is not exact and trusted",
  );
  const intent = parseCanonicalReceipt(intentCheck);
  validateRepairIntentShape(intent, expected);
  const intentDigest = digestReceipt(intent);
  const intentExternalId =
    `dependabot-repair-intent:v1:pr=${intent.pullRequestNumber}:head=${intent.headSha}:` +
    `attempt=${intent.attempt}:digest=${intentDigest}:run=${intent.workflowRunId}:` +
    `run_attempt=${intent.workflowRunAttempt}`;
  const intentActionsUrl = `https://github.com/${expected.repository}/actions/runs/${intent.workflowRunId}`;
  const intentSelfUrl = `https://github.com/${expected.repository}/runs/${intentCheck.id}`;
  invariant(
    recoveryTitle.intentDigest === intentDigest &&
      intentCheck.external_id === intentExternalId &&
      (intentCheck.details_url === intentActionsUrl ||
        intentCheck.details_url === intentSelfUrl) &&
      intent.retryCount === originalTitle.retryCount &&
      sameRepairOperation(original.receipt, intent) &&
      intent.workflowRunId === original.receipt.workflowRunId &&
      intent.workflowRunAttempt === original.receipt.workflowRunAttempt &&
      intent.workflowSha === original.receipt.workflowSha &&
      sameRepairOperation(recovery.receipt, intent),
    "repair recovery does not exactly supersede the failed receipt",
  );

  const recoverySteps = failedRecoveries.map((candidate) => ({
    candidate,
    title: parseRecoveryRepairRunTitle(candidate.run, candidate.receipt),
  }));
  recoverySteps.push({ candidate: recovery, title: recoveryTitle });
  for (const step of recoverySteps) {
    invariant(
      step.title.intentCheckId === recoveryTitle.intentCheckId &&
        step.title.intentDigest === recoveryTitle.intentDigest &&
        sameRepairOperation(step.candidate.receipt, intent),
      "repair recovery retry does not bind the canonical intent and operation",
    );
  }
  recoverySteps.sort(
    (left, right) => left.title.retryCount - right.title.retryCount,
  );
  invariant(
    recoverySteps.length <= 3 &&
      recoverySteps.every(({ title }, index) => title.retryCount === index) &&
      recoverySteps.at(-1)?.candidate === recovery,
    "repair recovery retries are missing, duplicated, or out of order",
  );
  const orderedCandidates = [
    original,
    ...recoverySteps.map(({ candidate }) => candidate),
  ];
  invariant(
    intentCheck.id < original.check.id &&
      orderedCandidates.every(
        (candidate, index) =>
          index === 0 ||
          candidate.check.id > orderedCandidates[index - 1].check.id,
      ) &&
      new Set(orderedCandidates.map(({ receipt }) => receipt.workflowRunId))
        .size === orderedCandidates.length,
    "repair recovery evidence is duplicated or not in strict check order",
  );
}

function validateHistoricalRefreshRequest({
  check,
  expected,
  headSha,
  requestJson,
}) {
  validateCheckShell(check, { headSha, name: "Dependabot Refresh" });
  const receipt = parseCanonicalReceipt(check);
  exactKeys(receipt, REFRESH_REQUEST_KEYS, "historical refresh request");
  const digest = digestReceipt(receipt);
  const externalId =
    `dependabot-refresh:v1:pr=${expected.pullRequestNumber}:head=${headSha}:` +
    `state=requested:digest=${digest}:run=${receipt.workflowRunId}:` +
    `attempt=${receipt.workflowRunAttempt}`;
  invariant(
    receipt.schema === "dependabot-refresh:v1" &&
      receipt.state === "requested" &&
      receipt.repository === expected.repository &&
      receipt.pullRequestNumber === expected.pullRequestNumber &&
      receipt.headRef === expected.headRef &&
      receipt.parentHeadSha === headSha &&
      receipt.headSha === null &&
      SHA_PATTERN.test(receipt.previousBaseSha ?? "") &&
      SHA_PATTERN.test(receipt.baseSha ?? "") &&
      receipt.previousBaseSha !== receipt.baseSha &&
      SHA_PATTERN.test(receipt.workflowSha ?? "") &&
      positiveInteger(receipt.workflowRunId) &&
      positiveInteger(receipt.workflowRunAttempt) &&
      check.external_id === externalId,
    "historical refresh request is malformed",
  );
  validateActorBinding(receipt, expected);
  validateWorkflowRun({
    check,
    operation: "refresh",
    receipt,
    repository: expected.repository,
    requestJson,
  });
}

function findPriorOperation({ expected, headSha, requestJson }) {
  const candidates = ["Dependabot Refresh", "Dependabot Repair"].flatMap(
    (name) => namedOperationChecks({ expected, headSha, name, requestJson }),
  );
  const completed = [];
  for (const check of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(check.output?.text ?? "");
    } catch {
      invariant(false, "prepared lineage contains a malformed operation check");
    }
    if (parsed.state === "requested") {
      invariant(
        check.name === "Dependabot Refresh",
        "only an exact Refresh check may have requested state",
      );
      validateHistoricalRefreshRequest({
        check,
        expected,
        headSha,
        requestJson,
      });
      continue;
    }
    invariant(
      parsed.state === "completed",
      "prepared lineage contains an unknown operation state",
    );
    const operation =
      check.name === "Dependabot Refresh" ? "refresh" : "repair";
    completed.push(
      validateOperationCheck({
        check,
        expected,
        headSha,
        operation,
        requestJson,
        workflowConclusions:
          operation === "repair"
            ? new Set(["success", ...RETRYABLE_REPAIR_CONCLUSIONS])
            : undefined,
      }),
    );
  }
  if (completed.length === 0) return null;
  const failed = completed.filter(({ run }) => run.conclusion !== "success");
  let authoritative = completed;
  if (failed.length > 0) {
    const successful = completed.filter(
      ({ run }) => run.conclusion === "success",
    );
    const successfulAuthorities = new Set(
      successful.map(
        ({ operation, receipt }) =>
          `${operation}:${receipt.parentHeadSha}:${digestReceipt(receipt)}`,
      ),
    );
    invariant(
      successful.length === 1 && successfulAuthorities.size === 1,
      "prepared lineage has ambiguous receipts",
    );
    const recovery = successful[0];
    validateSupersededRepairChain({
      expected,
      failed,
      recovery,
      requestJson,
    });
    authoritative = successful;
  }
  const authorities = new Set(
    authoritative.map(
      ({ operation, receipt }) =>
        `${operation}:${receipt.parentHeadSha}:${digestReceipt(receipt)}`,
    ),
  );
  invariant(authorities.size === 1, "prepared lineage has ambiguous receipts");
  return authoritative.sort((left, right) => right.check.id - left.check.id)[0];
}

export function validatePreparedReviewTarget(options, requestJson) {
  const expected = {
    headRef: options.headRef,
    prepareAppSlug: options.prepareAppSlug,
    prepareBotId: Number(options.prepareBotId),
    prepareBotLogin: options.prepareBotLogin,
    pullRequestNumber: Number(options.pullRequestNumber),
    repository: options.repository,
  };
  const expectedHeadSha = options.headSha;
  const expectedOperation = options.operation;
  const expectedCheckId = Number(options.operationCheckId);
  const expectedDigest = options.operationDigest;
  invariant(
    REPOSITORY_PATTERN.test(expected.repository ?? ""),
    "repository is invalid",
  );
  invariant(
    positiveInteger(expected.pullRequestNumber) &&
      expected.pullRequestNumber <= 9_999_999_999,
    "PR number is invalid",
  );
  invariant(
    HEAD_REF_PATTERN.test(expected.headRef ?? ""),
    "head ref is invalid",
  );
  invariant(SHA_PATTERN.test(expectedHeadSha ?? ""), "head SHA is invalid");
  invariant(
    ["refresh", "repair"].includes(expectedOperation),
    "operation is invalid",
  );
  invariant(positiveInteger(expectedCheckId), "operation check ID is invalid");
  invariant(
    DIGEST_PATTERN.test(expectedDigest ?? ""),
    "operation digest is invalid",
  );
  invariant(
    /^[a-z0-9][a-z0-9-]{0,99}$/.test(expected.prepareAppSlug ?? "") &&
      positiveInteger(expected.prepareBotId) &&
      /^[A-Za-z0-9][A-Za-z0-9-]*\[bot\]$/.test(expected.prepareBotLogin ?? ""),
    "Prepare App identity is invalid",
  );

  const pullRequest = requestJson(
    `repos/${expected.repository}/pulls/${expected.pullRequestNumber}`,
  );
  invariant(
    pullRequest.state === "open" &&
      pullRequest.draft === false &&
      pullRequest.user?.login === "dependabot[bot]" &&
      pullRequest.user?.type === "Bot" &&
      pullRequest.head?.repo?.full_name === expected.repository &&
      pullRequest.base?.repo?.full_name === expected.repository &&
      pullRequest.head?.ref === expected.headRef &&
      pullRequest.head?.sha === expectedHeadSha &&
      pullRequest.base?.ref === "main" &&
      SHA_PATTERN.test(pullRequest.base?.sha ?? ""),
    "live PR identity does not match the prepared receipt",
  );

  const currentCheck = requestJson(
    `repos/${expected.repository}/check-runs/${expectedCheckId}`,
  );
  invariant(currentCheck.id === expectedCheckId, "operation check ID changed");
  let current = validateOperationCheck({
    check: currentCheck,
    expected,
    headSha: expectedHeadSha,
    operation: expectedOperation,
    requestJson,
  });
  invariant(
    current.digest === expectedDigest,
    "intake digest does not match check receipt",
  );
  invariant(
    current.receipt.baseSha === pullRequest.base.sha,
    "prepared head is not bound to the current main base",
  );

  let currentHeadSha = expectedHeadSha;
  let repairCount = 0;
  const repairAttempts = [];
  let refreshCount = 0;
  const operationDigests = [];
  for (let depth = 0; depth < LINEAGE_LIMIT; depth += 1) {
    operationDigests.unshift(current.digest);
    const commit = requestJson(
      `repos/${expected.repository}/commits/${currentHeadSha}`,
    );
    invariant(
      commit.sha === currentHeadSha && Array.isArray(commit.parents),
      "prepared commit evidence is malformed",
    );
    const parentHeadSha = current.receipt.parentHeadSha;
    if (current.operation === "refresh") {
      refreshCount += 1;
      validateAppliedBaseOnCurrentMain({
        appliedBaseSha: current.receipt.baseSha,
        currentBaseSha: pullRequest.base.sha,
        repository: expected.repository,
        requestJson,
      });
      const exactPrepareAuthor =
        commit.author?.id === expected.prepareBotId &&
        commit.author?.login === expected.prepareBotLogin &&
        commit.author?.type === "Bot";
      const exactPrepareCommitter =
        commit.committer?.id === expected.prepareBotId &&
        commit.committer?.login === expected.prepareBotLogin &&
        commit.committer?.type === "Bot";
      const verifiedWebFlowCommitter =
        commit.committer?.id === 19864447 &&
        commit.committer?.login === "web-flow" &&
        commit.committer?.type === "User";
      invariant(
        commit.parents.length === 2 &&
          commit.parents[0]?.sha === parentHeadSha &&
          commit.parents[1]?.sha === current.receipt.baseSha &&
          exactPrepareAuthor &&
          (exactPrepareCommitter || verifiedWebFlowCommitter) &&
          commit.commit?.verification?.verified === true &&
          commit.commit?.verification?.reason === "valid",
        "refresh is not the exact append-only two-parent merge",
      );
      validateRefreshRequest({
        completed: current.receipt,
        expected,
        headSha: parentHeadSha,
        requestJson,
      });
    } else {
      repairCount += 1;
      repairAttempts.unshift(current.receipt.attempt);
      invariant(
        repairCount <= 2 &&
          commit.parents.length === 1 &&
          commit.parents[0]?.sha === parentHeadSha &&
          commit.author?.id === expected.prepareBotId &&
          commit.author?.login === expected.prepareBotLogin &&
          commit.author?.type === "Bot" &&
          commit.committer?.id === expected.prepareBotId &&
          commit.committer?.login === expected.prepareBotLogin &&
          commit.committer?.type === "Bot" &&
          commit.commit?.verification?.verified === true &&
          commit.commit?.verification?.reason === "valid",
        "repair commit is not an exact Prepare App append",
      );
    }

    const parentCommit = requestJson(
      `repos/${expected.repository}/commits/${parentHeadSha}`,
    );
    const prior = findPriorOperation({
      expected,
      headSha: parentHeadSha,
      requestJson,
    });
    if (prior === null) {
      validateDependabotSeed(parentCommit);
      invariant(
        JSON.stringify(repairAttempts) ===
          JSON.stringify(
            Array.from({ length: repairCount }, (_, index) => index + 1),
          ),
        "repair attempts are not sequential from the Dependabot seed",
      );
      return {
        headSha: expectedHeadSha,
        operationDigests,
        prepareAppSlug: expected.prepareAppSlug,
        prepareBotId: expected.prepareBotId,
        prepareBotLogin: expected.prepareBotLogin,
        pullRequestNumber: expected.pullRequestNumber,
        refreshCount,
        repairCount,
        repository: expected.repository,
        seedHeadSha: parentHeadSha,
      };
    }
    currentHeadSha = parentHeadSha;
    current = prior;
  }
  invariant(false, "prepared lineage exceeds the bounded operation depth");
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    invariant(
      key?.startsWith("--") && value !== undefined,
      "CLI arguments are malformed",
    );
    invariant(values[key] === undefined, `duplicate CLI argument ${key}`);
    values[key] = value;
  }
  const expected = [
    "--app-slug",
    "--bot-id",
    "--bot-login",
    "--check-id",
    "--digest",
    "--head-ref",
    "--head-sha",
    "--operation",
    "--pr",
    "--repo",
  ];
  invariant(
    JSON.stringify(Object.keys(values).sort()) === JSON.stringify(expected),
    "CLI argument set is not exact",
  );
  return {
    headRef: values["--head-ref"],
    headSha: values["--head-sha"],
    operation: values["--operation"],
    operationCheckId: values["--check-id"],
    operationDigest: values["--digest"],
    prepareAppSlug: values["--app-slug"],
    prepareBotId: values["--bot-id"],
    prepareBotLogin: values["--bot-login"],
    pullRequestNumber: values["--pr"],
    repository: values["--repo"],
  };
}

function ghRequestJson(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 1_048_576,
    }),
  );
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMain) {
  try {
    const result = validatePreparedReviewTarget(
      parseArguments(process.argv.slice(2)),
      ghRequestJson,
    );
    process.stdout.write(`${canonicalReceiptJson(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
