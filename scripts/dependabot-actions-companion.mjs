#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const ACTIONS_COMPANION_INPUT_SCHEMA =
  "dependabot-actions-companion-input:v1";
export const ACTIONS_COMPANION_EVALUATION_SCHEMA =
  "dependabot-actions-companion-evaluation:v1";
export const ACTIONS_COMPANION_PLAN_SCHEMA =
  "dependabot-actions-companion-plan:v1";
export const ACTIONS_COMPANION_VERIFICATION_SCHEMA =
  "dependabot-actions-companion-verification:v1";
export const ACTIONS_COMPANION_STAGED_SCHEMA =
  "dependabot-actions-companion-staged:v1";

export const OSV_WORKFLOW_PATH = ".github/workflows/_osv-scanner-readonly.yml";
export const OSV_MIRROR_TEST_PATH = "scripts/dependabot-workflows.test.mjs";
export const OSV_SCANNER_ACTION =
  "google/osv-scanner-action/osv-scanner-action";
export const OSV_REPORTER_ACTION =
  "google/osv-scanner-action/osv-reporter-action";

const REPOSITORY = "mento-protocol/frontend-monorepo";
const DEPENDABOT_ID = 49_699_333;
const GITHUB_WEB_FLOW_ID = 19_864_447;
const HEX_SHA = /^[0-9a-f]{40}$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const SOURCE_HEAD_REF =
  /^dependabot\/github_actions\/github-actions-manual(?:-[a-z0-9._-]+)?$/u;
const MAX_CONTENT_BYTES = 1024 * 1024;
const VETO_LABELS = new Set([
  "dependencies:manual",
  "dependabot:manual",
  "do-not-merge",
  "no-auto-merge",
  "processor:veto",
]);
const ACTION_NAMES = Object.freeze([OSV_SCANNER_ACTION, OSV_REPORTER_ACTION]);

class CompanionRejection extends Error {
  constructor(reason) {
    super(`OSV actions companion rejected: ${reason}`);
    this.name = "CompanionRejection";
    this.reason = reason;
  }
}

function reject(reason) {
  throw new CompanionRejection(reason);
}

function plainObject(value, reason) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(reason);
  }
  return value;
}

function exactKeys(value, expected, reason) {
  plainObject(value, reason);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) reject(reason);
}

function exactActor(value, expected, reason) {
  exactKeys(value, ["id", "login", "type"], reason);
  if (
    value.id !== expected.id ||
    value.login !== expected.login ||
    value.type !== expected.type
  ) {
    reject(reason);
  }
}

function exactString(value, expected, reason) {
  if (value !== expected) reject(reason);
}

function sha(value, reason) {
  if (!HEX_SHA.test(value ?? "")) reject(reason);
  return value;
}

function positiveInteger(value, reason) {
  if (!Number.isSafeInteger(value) || value <= 0) reject(reason);
  return value;
}

function strictText(value, reason) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_CONTENT_BYTES ||
    Buffer.from(value, "utf8").toString("utf8") !== value ||
    value.includes("\0") ||
    value.includes("\r")
  ) {
    reject(reason);
  }
  return value;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function literalCount(content, value) {
  return content.split(value).length - 1;
}

function replaceExactlyOnce(content, from, to, reason) {
  if (literalCount(content, from) !== 1) reject(reason);
  return content.replace(from, to);
}

function actionReference(action, revision) {
  return `${action}@${revision}`;
}

function validateSourceCommit({ commit, baseSha, headSha, fromSha, toSha }) {
  exactKeys(
    commit,
    [
      "author",
      "committer",
      "message",
      "parentShas",
      "sha",
      "verificationReason",
      "verified",
    ],
    "source-commit-shape-invalid",
  );
  exactString(commit.sha, headSha, "source-commit-head-mismatch");
  if (
    !Array.isArray(commit.parentShas) ||
    commit.parentShas.length !== 1 ||
    commit.parentShas[0] !== baseSha
  ) {
    reject("source-commit-parent-mismatch");
  }
  exactActor(
    commit.author,
    { id: DEPENDABOT_ID, login: "dependabot[bot]", type: "Bot" },
    "source-commit-author-invalid",
  );
  const dependabotCommitter =
    commit.committer?.id === DEPENDABOT_ID &&
    commit.committer?.login === "dependabot[bot]" &&
    commit.committer?.type === "Bot";
  const webFlowCommitter =
    commit.committer?.id === GITHUB_WEB_FLOW_ID &&
    commit.committer?.login === "web-flow" &&
    commit.committer?.type === "User";
  exactKeys(
    commit.committer,
    ["id", "login", "type"],
    "source-commit-committer-invalid",
  );
  if (!dependabotCommitter && !webFlowCommitter) {
    reject("source-commit-committer-invalid");
  }
  if (commit.verified !== true || commit.verificationReason !== "valid") {
    reject("source-commit-signature-invalid");
  }
  const message = strictText(commit.message, "source-commit-message-invalid");
  if (
    !/^chore\(ci\): bump the github-actions-manual group\b/mu.test(message) ||
    !/^Bumps the github-actions-manual group with 2 updates\b/mu.test(message)
  ) {
    reject("source-commit-group-message-invalid");
  }
  const updateRows = [
    ...message.matchAll(
      /^Updates `([^`]+)` from ([0-9a-f]{40}) to ([0-9a-f]{40})$/gmu,
    ),
  ];
  if (updateRows.length !== 2) reject("source-commit-update-rows-invalid");
  for (const action of ACTION_NAMES) {
    const matches = updateRows.filter(
      ([, name, from, to]) =>
        name === action && from === fromSha && to === toSha,
    );
    if (matches.length !== 1) reject("source-commit-update-rows-invalid");
  }
}

function validateMetadata(metadata, fromSha, toSha) {
  exactKeys(
    metadata,
    ["dependencies", "dependencyGroup", "packageEcosystem"],
    "source-metadata-shape-invalid",
  );
  exactString(
    metadata.packageEcosystem,
    "github-actions",
    "source-ecosystem-invalid",
  );
  exactString(
    metadata.dependencyGroup,
    "github-actions-manual",
    "source-group-invalid",
  );
  if (
    !Array.isArray(metadata.dependencies) ||
    metadata.dependencies.length !== 2
  ) {
    reject("source-dependencies-invalid");
  }
  const seen = new Set();
  for (const dependency of metadata.dependencies) {
    exactKeys(
      dependency,
      ["from", "name", "to"],
      "source-dependency-shape-invalid",
    );
    if (
      !ACTION_NAMES.includes(dependency.name) ||
      dependency.from !== fromSha ||
      dependency.to !== toSha ||
      seen.has(dependency.name)
    ) {
      reject("source-dependencies-invalid");
    }
    seen.add(dependency.name);
  }
}

function deriveTransition(baseContent, sourceContent) {
  strictText(baseContent, "source-base-content-invalid");
  strictText(sourceContent, "source-result-content-invalid");
  const revisions = new Map();
  for (const action of ACTION_NAMES) {
    const pattern = new RegExp(
      `uses:[ \\t]+${action.replaceAll("/", "\\/")}@([0-9a-f]{40})(?=[ \\t]*(?:#|$))`,
      "gu",
    );
    const baseMatches = [...baseContent.matchAll(pattern)];
    const sourceMatches = [...sourceContent.matchAll(pattern)];
    if (baseMatches.length !== 1 || sourceMatches.length !== 1) {
      reject("osv-action-reference-count-invalid");
    }
    revisions.set(action, {
      from: baseMatches[0][1],
      to: sourceMatches[0][1],
    });
  }
  const [scanner, reporter] = ACTION_NAMES.map((action) =>
    revisions.get(action),
  );
  if (
    scanner.from !== reporter.from ||
    scanner.to !== reporter.to ||
    scanner.from === scanner.to
  ) {
    reject("osv-action-transition-invalid");
  }
  let expectedSource = baseContent;
  for (const action of ACTION_NAMES) {
    expectedSource = replaceExactlyOnce(
      expectedSource,
      actionReference(action, scanner.from),
      actionReference(action, scanner.to),
      "osv-source-replacement-count-invalid",
    );
  }
  if (sourceContent !== expectedSource) {
    reject("osv-source-has-unsupported-changes");
  }
  return { fromSha: scanner.from, toSha: scanner.to };
}

function deriveMirrorResult(baseContent, fromSha, toSha) {
  strictText(baseContent, "mirror-base-content-invalid");
  let result = baseContent;
  for (const action of ACTION_NAMES) {
    result = replaceExactlyOnce(
      result,
      actionReference(action, fromSha),
      actionReference(action, toSha),
      "mirror-reference-count-invalid",
    );
  }
  return result;
}

function editRecord({
  baseContent,
  origin,
  path,
  resultContent,
  sourceContent,
}) {
  return {
    baseBlobSha: gitBlobSha(baseContent),
    baseContentSha256: sha256(baseContent),
    mode: "100644",
    origin,
    path,
    resultBlobSha: gitBlobSha(resultContent),
    resultContentBase64: Buffer.from(resultContent, "utf8").toString("base64"),
    resultContentSha256: sha256(resultContent),
    sourceBlobSha: gitBlobSha(sourceContent),
    sourceContentSha256: sha256(sourceContent),
  };
}

function validateOldReferenceCensus({
  baseWorkflowContent,
  fromSha,
  mirrorContent,
  oldReferenceFiles,
}) {
  if (!Array.isArray(oldReferenceFiles) || oldReferenceFiles.length !== 2) {
    reject("old-reference-census-invalid");
  }
  const expected = new Map([
    [OSV_WORKFLOW_PATH, baseWorkflowContent],
    [OSV_MIRROR_TEST_PATH, mirrorContent],
  ]);
  const seen = new Set();
  for (const record of oldReferenceFiles) {
    exactKeys(
      record,
      ["contentSha256", "oldShaOccurrences", "path"],
      "old-reference-census-shape-invalid",
    );
    const content = expected.get(record.path);
    if (
      content === undefined ||
      seen.has(record.path) ||
      record.contentSha256 !== sha256(content) ||
      record.oldShaOccurrences !== literalCount(content, fromSha) ||
      record.oldShaOccurrences !== 2
    ) {
      reject("old-reference-census-invalid");
    }
    seen.add(record.path);
  }
  return sha256(
    canonicalJson(
      [...oldReferenceFiles].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    ),
  );
}

function pullRequestBody({
  baseSha,
  planDigest,
  pullRequestNumber,
  sourceHeadSha,
}) {
  return [
    "## The Problem",
    "",
    `- Dependabot PR #${pullRequestNumber} updates the two internal OSV actions.`,
    "- The source PR cannot update the workflow test mirror on its protected Dependabot branch.",
    "",
    "## The Solution",
    "",
    "- Apply the exact OSV action references from the verified Dependabot head.",
    `- Update the matching constants in \`${OSV_MIRROR_TEST_PATH}\`.`,
    "- Keep review and merge decisions with a human.",
    "",
    "## Validation",
    "",
    `- Source PR: #${pullRequestNumber}`,
    `- Source head: \`${sourceHeadSha}\``,
    `- Base: \`${baseSha}\``,
    `- Plan digest: \`${planDigest}\``,
    "- The normal PR checks must pass before a human merges this PR.",
    "",
    "## Ship Checklist",
    "",
    "- [x] PR title follows the conventions",
    "- [ ] Performed a self-review of my own changes",
    "- [ ] Relevant automated checks and smoke tests pass",
    "- [x] Architecture decision? Not applicable — this PR synchronizes existing action pins and their test mirror.",
    "",
  ].join("\n");
}

function buildPlan(input) {
  exactKeys(
    input,
    [
      "currentBase",
      "mirror",
      "mode",
      "oldReferenceFiles",
      "processor",
      "repository",
      "schema",
      "sourcePullRequest",
    ],
    "input-shape-invalid",
  );
  exactString(
    input.schema,
    ACTIONS_COMPANION_INPUT_SCHEMA,
    "input-schema-invalid",
  );
  exactString(input.repository, REPOSITORY, "repository-invalid");
  exactString(input.mode, "prepare", "processor-mode-invalid");

  exactKeys(
    input.currentBase,
    ["commitSha", "ref", "treeSha"],
    "current-base-shape-invalid",
  );
  exactString(input.currentBase.ref, "main", "current-base-ref-invalid");
  const currentBaseSha = sha(
    input.currentBase.commitSha,
    "current-base-sha-invalid",
  );
  const currentBaseTreeSha = sha(
    input.currentBase.treeSha,
    "current-base-tree-invalid",
  );

  exactKeys(
    input.processor,
    ["approved", "autoMergeEnabled", "disposition"],
    "processor-state-shape-invalid",
  );
  if (
    input.processor.disposition !== "manual-review" ||
    input.processor.approved !== false ||
    input.processor.autoMergeEnabled !== false
  ) {
    reject("processor-state-invalid");
  }

  const pull = plainObject(input.sourcePullRequest, "source-pr-shape-invalid");
  exactKeys(
    pull,
    [
      "author",
      "base",
      "commits",
      "draft",
      "files",
      "head",
      "labels",
      "metadata",
      "number",
      "state",
    ],
    "source-pr-shape-invalid",
  );
  const pullRequestNumber = positiveInteger(
    pull.number,
    "source-pr-number-invalid",
  );
  if (pull.number > 9_999_999_999) reject("source-pr-number-invalid");
  exactString(pull.state, "open", "source-pr-not-open");
  if (pull.draft !== false) reject("source-pr-is-draft");
  exactActor(
    pull.author,
    { id: DEPENDABOT_ID, login: "dependabot[bot]", type: "Bot" },
    "source-pr-author-invalid",
  );
  if (
    !Array.isArray(pull.labels) ||
    pull.labels.some((label) => typeof label !== "string" || label.length > 100)
  ) {
    reject("source-pr-labels-invalid");
  }
  if (pull.labels.some((label) => VETO_LABELS.has(label.toLowerCase()))) {
    reject("source-pr-has-veto-label");
  }

  exactKeys(
    pull.head,
    ["ref", "repository", "sha"],
    "source-head-shape-invalid",
  );
  exactString(
    pull.head.repository,
    REPOSITORY,
    "source-head-repository-invalid",
  );
  if (!SOURCE_HEAD_REF.test(pull.head.ref ?? "")) {
    reject("source-head-ref-invalid");
  }
  const sourceHeadSha = sha(pull.head.sha, "source-head-sha-invalid");
  exactKeys(
    pull.base,
    ["ref", "repository", "sha"],
    "source-base-shape-invalid",
  );
  exactString(
    pull.base.repository,
    REPOSITORY,
    "source-base-repository-invalid",
  );
  exactString(pull.base.ref, "main", "source-base-ref-invalid");
  exactString(pull.base.sha, currentBaseSha, "source-base-is-stale");

  if (!Array.isArray(pull.files) || pull.files.length !== 1) {
    reject("source-files-invalid");
  }
  const sourceFile = pull.files[0];
  exactKeys(
    sourceFile,
    ["baseContent", "path", "previousPath", "sourceContent", "status"],
    "source-file-shape-invalid",
  );
  exactString(sourceFile.path, OSV_WORKFLOW_PATH, "source-file-path-invalid");
  exactString(sourceFile.status, "modified", "source-file-status-invalid");
  if (sourceFile.previousPath !== null) reject("source-file-rename-invalid");
  const transition = deriveTransition(
    sourceFile.baseContent,
    sourceFile.sourceContent,
  );

  if (!Array.isArray(pull.commits) || pull.commits.length !== 1) {
    reject("source-commit-count-invalid");
  }
  validateSourceCommit({
    baseSha: currentBaseSha,
    commit: pull.commits[0],
    fromSha: transition.fromSha,
    headSha: sourceHeadSha,
    toSha: transition.toSha,
  });
  validateMetadata(pull.metadata, transition.fromSha, transition.toSha);

  exactKeys(input.mirror, ["baseContent", "path"], "mirror-shape-invalid");
  exactString(input.mirror.path, OSV_MIRROR_TEST_PATH, "mirror-path-invalid");
  const mirrorResult = deriveMirrorResult(
    input.mirror.baseContent,
    transition.fromSha,
    transition.toSha,
  );
  const referenceAuditDigest = validateOldReferenceCensus({
    baseWorkflowContent: sourceFile.baseContent,
    fromSha: transition.fromSha,
    mirrorContent: input.mirror.baseContent,
    oldReferenceFiles: input.oldReferenceFiles,
  });

  const edits = [
    editRecord({
      baseContent: sourceFile.baseContent,
      origin: "verified-dependabot-head",
      path: OSV_WORKFLOW_PATH,
      resultContent: sourceFile.sourceContent,
      sourceContent: sourceFile.sourceContent,
    }),
    editRecord({
      baseContent: input.mirror.baseContent,
      origin: "deterministic-osv-test-mirror",
      path: OSV_MIRROR_TEST_PATH,
      resultContent: mirrorResult,
      sourceContent: input.mirror.baseContent,
    }),
  ];
  const branchRef =
    `dependabot-companion/osv-pr-${pullRequestNumber}-` +
    sourceHeadSha.slice(0, 12);
  const title = `chore(ci): apply OSV action update from Dependabot #${pullRequestNumber}`;
  const treeDigest = sha256(
    canonicalJson({
      edits: edits.map((edit) => ({
        baseBlobSha: edit.baseBlobSha,
        mode: edit.mode,
        path: edit.path,
        resultBlobSha: edit.resultBlobSha,
        resultContentSha256: edit.resultContentSha256,
      })),
      parentCommitSha: currentBaseSha,
      parentTreeSha: currentBaseTreeSha,
      schema: "dependabot-actions-companion-tree:v1",
    }),
  );
  const planCore = {
    adapter: "osv-internal-pair:v1",
    branchRef,
    edits,
    eligible: true,
    fromRevision: transition.fromSha,
    parentCommitSha: currentBaseSha,
    parentTreeSha: currentBaseTreeSha,
    pullRequestTitle: title,
    readyForReview: true,
    reason: null,
    referenceAuditDigest,
    repository: REPOSITORY,
    result: "create",
    schema: ACTIONS_COMPANION_PLAN_SCHEMA,
    source: {
      baseRef: "main",
      baseSha: currentBaseSha,
      commitSha: sourceHeadSha,
      headRef: pull.head.ref,
      headSha: sourceHeadSha,
      pullRequestNumber,
      repository: REPOSITORY,
    },
    toRevision: transition.toSha,
    treeDigest,
  };
  const planDigest = sha256(canonicalJson(planCore));
  const commitMessage = [
    title,
    "",
    `Source-PR: ${pullRequestNumber}`,
    `Source-Head: ${sourceHeadSha}`,
    `Tree-Digest: ${treeDigest}`,
    `Plan-Digest: ${planDigest}`,
  ].join("\n");
  return {
    ...planCore,
    commitMessage,
    planDigest,
    pullRequestBody: pullRequestBody({
      baseSha: currentBaseSha,
      planDigest,
      pullRequestNumber,
      sourceHeadSha,
    }),
  };
}

export function createOsvActionsCompanionPlan(input) {
  return buildPlan(input);
}

export function evaluateOsvActionsCompanion(input) {
  try {
    return {
      eligible: true,
      plan: buildPlan(input),
      reason: null,
      result: "create",
      schema: ACTIONS_COMPANION_EVALUATION_SCHEMA,
    };
  } catch (error) {
    if (!(error instanceof CompanionRejection)) throw error;
    return {
      eligible: false,
      plan: null,
      reason: error.reason,
      result: "manual-review",
      schema: ACTIONS_COMPANION_EVALUATION_SCHEMA,
    };
  }
}

export function verifyOsvActionsCompanionPlan(input, plan) {
  const evaluation = evaluateOsvActionsCompanion(input);
  if (!evaluation.eligible) {
    return {
      eligible: false,
      planDigest: null,
      reason: evaluation.reason,
      result: "manual-review",
      schema: ACTIONS_COMPANION_VERIFICATION_SCHEMA,
    };
  }
  if (canonicalJson(evaluation.plan) !== canonicalJson(plan)) {
    return {
      eligible: false,
      planDigest: null,
      reason: "plan-mismatch",
      result: "manual-review",
      schema: ACTIONS_COMPANION_VERIFICATION_SCHEMA,
    };
  }
  return {
    eligible: true,
    planDigest: evaluation.plan.planDigest,
    reason: null,
    result: "verified",
    schema: ACTIONS_COMPANION_VERIFICATION_SCHEMA,
  };
}

export function verifyStagedOsvActionsCompanion(input, plan, staged) {
  const planVerification = verifyOsvActionsCompanionPlan(input, plan);
  if (!planVerification.eligible || !HEX_DIGEST.test(plan.planDigest ?? "")) {
    return {
      eligible: false,
      planDigest: null,
      reason: planVerification.reason ?? "plan-invalid",
      result: "manual-review",
      schema: ACTIONS_COMPANION_VERIFICATION_SCHEMA,
    };
  }
  try {
    exactKeys(
      staged,
      [
        "branchRef",
        "commitMessage",
        "commitSha",
        "edits",
        "parentCommitSha",
        "parentTreeSha",
        "planDigest",
        "repository",
        "schema",
        "treeDigest",
        "treeSha",
      ],
      "staged-shape-invalid",
    );
    exactString(
      staged.schema,
      ACTIONS_COMPANION_STAGED_SCHEMA,
      "staged-schema-invalid",
    );
    exactString(
      staged.repository,
      plan.repository,
      "staged-repository-mismatch",
    );
    exactString(staged.branchRef, plan.branchRef, "staged-branch-mismatch");
    sha(staged.commitSha, "staged-commit-sha-invalid");
    sha(staged.treeSha, "staged-tree-sha-invalid");
    exactString(
      staged.parentCommitSha,
      plan.parentCommitSha,
      "staged-parent-commit-mismatch",
    );
    exactString(
      staged.parentTreeSha,
      plan.parentTreeSha,
      "staged-parent-tree-mismatch",
    );
    exactString(
      staged.treeDigest,
      plan.treeDigest,
      "staged-tree-digest-mismatch",
    );
    exactString(
      staged.planDigest,
      plan.planDigest,
      "staged-plan-digest-mismatch",
    );
    exactString(
      staged.commitMessage,
      plan.commitMessage,
      "staged-commit-message-mismatch",
    );
    const expectedEdits = plan.edits.map((edit) => ({
      blobSha: edit.resultBlobSha,
      contentSha256: edit.resultContentSha256,
      mode: edit.mode,
      path: edit.path,
    }));
    if (canonicalJson(staged.edits) !== canonicalJson(expectedEdits)) {
      reject("staged-edits-mismatch");
    }
  } catch (error) {
    if (!(error instanceof CompanionRejection)) throw error;
    return {
      eligible: false,
      planDigest: null,
      reason: error.reason,
      result: "manual-review",
      schema: ACTIONS_COMPANION_VERIFICATION_SCHEMA,
    };
  }
  return {
    eligible: true,
    planDigest: plan.planDigest,
    reason: null,
    result: "verified-staged-head",
    schema: ACTIONS_COMPANION_VERIFICATION_SCHEMA,
  };
}

function argsMap(args) {
  if (args.length % 2 !== 0)
    throw new Error("arguments must be name/value pairs");
  const result = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name.startsWith("--") || result.has(name)) {
      throw new Error(`invalid argument: ${name}`);
    }
    result.set(name, args[index + 1]);
  }
  return result;
}

function exactArgs(args, expected) {
  const actual = [...args.keys()].sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`expected arguments: ${wanted.join(", ")}`);
  }
}

function readJson(path, label) {
  const bytes = readFileSync(resolve(path));
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error(`${label} is not strict UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not JSON`);
  }
}

function writeJson(path, value) {
  writeFileSync(resolve(path), `${canonicalJson(value)}\n`, { flag: "wx" });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = argsMap(rest);
  if (command === "plan") {
    exactArgs(args, ["--input", "--output"]);
    return writeJson(
      args.get("--output"),
      evaluateOsvActionsCompanion(readJson(args.get("--input"), "input")),
    );
  }
  if (command === "verify") {
    exactArgs(args, ["--input", "--output", "--plan"]);
    return writeJson(
      args.get("--output"),
      verifyOsvActionsCompanionPlan(
        readJson(args.get("--input"), "input"),
        readJson(args.get("--plan"), "plan"),
      ),
    );
  }
  if (command === "verify-staged") {
    exactArgs(args, ["--input", "--output", "--plan", "--staged"]);
    return writeJson(
      args.get("--output"),
      verifyStagedOsvActionsCompanion(
        readJson(args.get("--input"), "input"),
        readJson(args.get("--plan"), "plan"),
        readJson(args.get("--staged"), "staged head"),
      ),
    );
  }
  throw new Error(`unknown command: ${command ?? ""}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
