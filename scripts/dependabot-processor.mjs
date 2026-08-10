#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- GitHub Actions and the direct CLI supply controller inputs outside Turbo tasks. */

import { readFileSync } from "node:fs";
import process from "node:process";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const DEPENDABOT_PROCESSOR_SCHEMA = "dependabot-processor:v1";
export const DEPENDABOT_REPAIR_PACKET_SCHEMA = "dependabot-repair-packet:v1";
export const DEPENDABOT_POST_MERGE_SCHEMA = "dependabot-post-merge:v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEPENDABOT_LOGIN = "dependabot[bot]";
const PROCESSOR_MODES = new Set(["observe", "assist", "merge"]);
const PASSING_CONCLUSIONS = new Set(["success"]);
const PENDING_STATUSES = new Set([
  "expected",
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);
const VETO_LABELS = new Set([
  "dependencies:manual",
  "dependabot:manual",
  "do-not-merge",
  "no-auto-merge",
  "processor:veto",
]);
const TRUSTED_HUMAN_ASSOCIATIONS = new Set(["COLLABORATOR", "MEMBER", "OWNER"]);
const ACTIONABLE_REVIEW_BOTS = new Set([
  "chatgpt-codex-connector",
  "claude",
  "cursor",
]);
const FEEDBACK_BLOCKER_LIMIT = 50;
const DURABLE_EVENT_EVIDENCE_LIMIT = 50;
const REVIEW_THREAD_PAGE_LIMIT = 10;
const REVIEW_THREAD_COMMENT_LIMIT = 100;
const REVIEW_ENVELOPE_BODY_LIMIT = 50_000;
const REPAIR_LINEAGE_COMMIT_LIMIT = 100;
const REPAIR_LINEAGE_CHECK_CONCURRENCY = 4;
const PROCESSOR_APPROVAL_PULL_LIMIT = 100;
const PROCESSOR_APPROVAL_REVIEW_LIMIT = 2_000;
const PROCESSOR_APPROVAL_RESULT_LIMIT = 1_000;
const PROCESSOR_APPROVAL_SCAN_CONCURRENCY = 4;
const PULL_REQUEST_REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
  "PENDING",
]);
const PROCESSOR_CHECK_NAME = "Dependabot Processor";
const PROCESSOR_REPAIR_RECEIPT_PATTERN =
  /^dependabot-processor:v1:pr=([1-9][0-9]{0,9}):head=([0-9a-f]{40}):mode=(observe|assist|merge):repair=([1-9][0-9]*):packet=(true|false)$/;
const CLAUDE_REVIEW_RECEIPT_PATTERN =
  /^dependabot-claude-review:v1 \| source=dependabot-intake:v1 \| repository=([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) \| pr=([1-9][0-9]{0,9}) \| sha=([0-9a-f]{40}) \| action=(opened|synchronize|reopened) \| receipt=true$/;
const CLAUDE_REVIEW_EXTERNAL_ID_PATTERN =
  /^dependabot-claude-review:v1:pr=([1-9][0-9]{0,9}):sha=([0-9a-f]{40}):run=([1-9][0-9]*):attempt=([1-9][0-9]*)$/;
const VERCEL_PREVIEW_INTAKE_TITLE_PATTERN =
  /^Vercel preview intake \| pr=([1-9][0-9]{0,9}) \| sha=([0-9a-f]{40}) \| action=(opened|edited|synchronize|reopened|closed)$/;
const CODEX_REVIEW_HEADING = "### 💡 Codex Review";
const SAFE_PROCESSOR_CHECK_DISPOSITIONS = new Set([
  "merge-candidate",
  "ready-for-approval",
  "would-merge",
]);
const SENSITIVE_ACTION_PATTERN =
  /^actions\/create-github-app-token(?:\/|$)|(?:^|\/)(?:dependabot|claude|codex|copilot|codeql|osv|security|scorecard|harden-runner|trivy|snyk|attest|dependency-review)(?:[-/]|$)|(?:reviewer|review-action)/i;

const CHECK_POLICY_DEFINITIONS = [
  {
    id: "ci",
    label: "CI sentinel",
    names: [/^Build and Test$/],
  },
  {
    id: "action-pins",
    label: "GitHub Actions pin policy",
    names: [/^Action Pin Policy$/],
  },
  {
    id: "action-pins-source",
    label: "GitHub Actions pin policy source",
    names: [/^Action Pin Policy Source$/],
  },
  {
    id: "dependency-review",
    label: "Dependency review",
    names: [/^dependency-review$/i],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-root-osv",
    label: "Root OSV scan",
    names: [/^osv-scanner \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-pnpm-runtime-osv",
    label: "Trusted pnpm runtime OSV scan",
    names: [/^osv-scanner \(trusted pnpm runtime\) \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-vercel-runtime-osv",
    label: "Standalone Vercel CLI runtime OSV scan",
    names: [/^osv-scanner \(standalone Vercel CLI runtime\) \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-pnpm-bootstrap-osv",
    label: "Trusted pnpm bootstrap OSV scan",
    names: [/^osv-scanner \(trusted pnpm bootstrap\) \/ osv-scan$/],
    failureAttribution: "external",
  },
  {
    id: "supply-chain-lockfile",
    label: "Lockfile integrity and registry policy",
    names: [/^lockfile integrity \+ registry$/],
  },
  {
    id: "supply-chain-version-skew",
    label: "Catalog version skew",
    names: [/^catalog version-skew$/],
  },
  {
    id: "quality",
    label: "Coverage and production bundle budgets",
    names: [/^coverage and production bundles$/],
  },
  {
    id: "e2e-plan",
    label: "Connected-wallet E2E planner",
    names: [/^E2E Plan$/],
  },
  {
    id: "e2e-seed",
    label: "Fork seed self-test",
    names: [/^fork-seed self-test$/],
  },
  {
    id: "e2e-celo",
    label: "Connected Celo swap",
    names: [/^Connected swap \(anvil fork\)$/],
    failureAttribution: "external",
    skippedBy: "e2e-plan",
    plannerDecision: "e2eApp",
  },
  {
    id: "e2e-governance",
    label: "Connected governance",
    names: [/^Connected governance \(anvil fork\)$/],
    failureAttribution: "external",
    skippedBy: "e2e-plan",
    plannerDecision: "e2eGovernance",
  },
  {
    id: "e2e-monad",
    label: "Connected Monad swap",
    names: [/^Connected swap \(Monad anvil fork\)$/],
    failureAttribution: "external",
    skippedBy: "e2e-plan",
    plannerDecision: "e2eMonad",
  },
  {
    id: "visual-plan",
    label: "Visual regression planner",
    names: [/^Visual Regression Plan$/],
  },
  {
    id: "visual-ui",
    label: "UI visual regression",
    names: [/^Visual Regression \(ui\.mento\.org\)$/],
    failureAttribution: "external",
    skippedBy: "visual-plan",
    plannerDecision: "visualUi",
  },
  {
    id: "visual-app",
    label: "App visual regression",
    names: [/^Visual Regression \(app\.mento\.org\)$/],
    failureAttribution: "external",
    skippedBy: "visual-plan",
    plannerDecision: "visualApp",
  },
  {
    id: "claude-review",
    label: "Claude review",
    names: [/^claude-review$/i],
    failureAttribution: "external",
  },
  {
    id: "vercel-preview",
    label: "Vercel preview",
    names: [/^Vercel Preview$/],
    failureAttribution: "external",
  },
];

const GITHUB_ACTIONS_APP_ID = 15_368;
const CHECK_SOURCE_POLICY = Object.freeze({
  "action-pins": {
    events: ["pull_request_target"],
    workflowPaths: [".github/workflows/action-pins.yml"],
  },
  "action-pins-source": {
    events: ["pull_request"],
    workflowPaths: [".github/workflows/action-pins-source.yml"],
  },
  "claude-review": {
    events: ["workflow_run"],
    workflowPaths: [".github/workflows/dependabot-claude-review.yml"],
  },
  ci: {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/ci.yml"],
  },
  "dependency-review": {
    events: ["pull_request"],
    workflowPaths: [".github/workflows/dependency-review.yml"],
  },
  "e2e-celo": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-governance": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-monad": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-plan": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  "e2e-seed": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/e2e.yml"],
  },
  quality: {
    events: ["pull_request", "push", "workflow_dispatch"],
    workflowPaths: [".github/workflows/quality-budgets.yml"],
  },
  "supply-chain-lockfile": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-pnpm-bootstrap-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-pnpm-runtime-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-root-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-vercel-runtime-osv": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "supply-chain-version-skew": {
    events: ["pull_request", "schedule", "workflow_dispatch"],
    workflowPaths: [".github/workflows/supply-chain.yml"],
  },
  "post-merge-verification": {
    events: ["workflow_run"],
    workflowPaths: [".github/workflows/vercel-main-deployment.yml"],
  },
  "vercel-preview": {
    events: ["pull_request_target"],
    kind: "status",
    workflowPaths: [".github/workflows/vercel-preview-intake.yml"],
  },
  "visual-app": {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/visual.yml"],
  },
  "visual-plan": {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/visual.yml"],
  },
  "visual-ui": {
    events: ["pull_request", "push"],
    workflowPaths: [".github/workflows/visual.yml"],
  },
});

const POST_MERGE_CHECK_DEFINITION = Object.freeze({
  id: "post-merge-verification",
  label: "Dependabot post-merge verification",
  names: [/^Dependabot Post-Merge Verification$/],
});

export const DEPENDABOT_PROCESSOR_HELP = `Usage:
  dependabot-processor.mjs evaluate --live --repo owner/name --pr-numbers all|1,2 [--mode observe|assist|merge]
  dependabot-processor.mjs process --live --repo owner/name --pr-numbers all|1,2 [--mode observe|assist|merge] [--publish-checks]
  dependabot-processor.mjs evaluate --input path|- [--repo owner/name] [--pr-numbers all|1,2] [--mode observe|assist|merge]
  dependabot-processor.mjs process --input path|- [--repo owner/name] [--pr-numbers all|1,2] [--mode observe|assist|merge]

Intake-triggered live runs may pass --expected-head-sha <40-hex-sha> with exactly one PR.
Only exact lowercase observe, assist, and merge modes are accepted; every other value fails safe to observe. Pure process mode never mutates GitHub.`;

export const DEPENDABOT_CHECK_POLICY = Object.freeze(
  CHECK_POLICY_DEFINITIONS.map((definition) =>
    Object.freeze({
      id: definition.id,
      label: definition.label,
      failureAttribution: definition.failureAttribution ?? "deterministic",
      names: Object.freeze(definition.names.map((pattern) => pattern.source)),
      skippedBy: definition.skippedBy ?? null,
      workflowPaths: Object.freeze([
        ...(CHECK_SOURCE_POLICY[definition.id]?.workflowPaths ?? []),
      ]),
    }),
  ),
);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactSha(value, label = "Commit SHA") {
  invariant(
    typeof value === "string" && SHA_PATTERN.test(value),
    `${label} must be an immutable lowercase 40-character SHA`,
  );
  return value;
}

function repositoryName(value) {
  invariant(
    typeof value === "string" && REPOSITORY_PATTERN.test(value),
    "Repository must use the owner/name form",
  );
  return value;
}

function pullRequestNumber(value) {
  const text = String(value ?? "");
  invariant(/^[1-9][0-9]{0,9}$/.test(text), "PR number must be positive");
  return Number(text);
}

function normalizeLogin(value) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "app/dependabot" || normalized === "dependabot") {
    return DEPENDABOT_LOGIN;
  }
  return normalized;
}

function normalizeFeedbackLogin(value) {
  return normalizeLogin(value).replace(/\[bot\]$/, "");
}

function feedbackBodyDigest(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : "")
    .digest("hex");
}

function feedbackActor({ association, login, type } = {}) {
  return {
    association: String(association ?? "").toUpperCase(),
    login: normalizeFeedbackLogin(login),
    type: String(type ?? ""),
  };
}

function trustedHuman(actor) {
  return (
    actor.type === "User" &&
    actor.login.length > 0 &&
    TRUSTED_HUMAN_ASSOCIATIONS.has(actor.association)
  );
}

function malformedFeedbackActor(actor) {
  return (
    actor.login.length === 0 ||
    !["Bot", "User"].includes(actor.type) ||
    (actor.type === "Bot" && actor.association !== "NONE")
  );
}

function directMaintainerReply(body, headSha) {
  const fixed = /^Fixed in ([0-9a-f]{7,40}) — .+/s.exec(body);
  if (fixed) return headSha.startsWith(fixed[1]);
  return /^Won't fix: .+/s.test(body);
}

function boundedFeedbackBlocker(blocker) {
  return {
    bodyDigest: blocker.bodyDigest,
    id: String(blocker.id).slice(0, 100),
    reason: blocker.reason,
    surface: blocker.surface,
  };
}

function trustedDependabotCommit(commit) {
  const author = normalizeLogin(commit?.author?.login);
  const committer = normalizeLogin(commit?.committer?.login);
  return (
    author === DEPENDABOT_LOGIN &&
    (committer === DEPENDABOT_LOGIN || committer === "web-flow") &&
    commit?.commit?.verification?.verified === true
  );
}

function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => (typeof label === "string" ? label : (label?.name ?? "")))
    .filter(Boolean)
    .map((label) => label.toLowerCase())
    .sort();
}

export function normalizeProcessorMode(value) {
  return typeof value === "string" && PROCESSOR_MODES.has(value)
    ? value
    : "observe";
}

function severityRank(updateType) {
  return { patch: 1, minor: 2, major: 3 }[updateType] ?? 4;
}

function normalizeUpdateType(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("patch")) return "patch";
  if (normalized.includes("minor")) return "minor";
  if (normalized.includes("major")) return "major";
  return "unknown";
}

function semverUpdateType(from, to) {
  const parse = (value) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(
      String(value).trim(),
    );
    return match ? match.slice(1).map(Number) : null;
  };
  const before = parse(from);
  const after = parse(to);
  if (!before || !after) return "unknown";
  if (after[0] !== before[0]) return "major";
  if (after[1] !== before[1]) return "minor";
  return "patch";
}

function dependencyRowsFromBody(body) {
  const rows = [];
  const pattern = /^\| \[([^\]]+)\]\([^\n)]+\) \| `([^`]+)` \| `([^`]+)` \|$/gm;
  for (const match of String(body ?? "").matchAll(pattern)) {
    rows.push({
      name: match[1].replaceAll("@\u200b", "@"),
      from: match[2],
      to: match[3],
      updateType: semverUpdateType(match[2], match[3]),
    });
  }
  if (rows.length === 0) {
    const singleUpdatePattern =
      /^Updates `([^`]+)` from ([^\s]+) to ([^\s]+)$/gm;
    for (const match of String(body ?? "").matchAll(singleUpdatePattern)) {
      rows.push({
        name: match[1].replaceAll("@\u200b", "@"),
        from: match[2],
        to: match[3],
        updateType: semverUpdateType(match[2], match[3]),
      });
    }
  }
  if (rows.length === 0) {
    const directBumpPattern =
      /^Bumps \[([^\]]+)\]\([^\n]+\) from (\S+) to (\S+)\.$/gm;
    for (const match of String(body ?? "").matchAll(directBumpPattern)) {
      rows.push({
        name: match[1].replaceAll("@\u200b", "@"),
        from: match[2],
        to: match[3],
        updateType: semverUpdateType(match[2], match[3]),
      });
    }
  }
  return rows;
}

export function parseDependabotMetadata({
  body = "",
  files = [],
  headRef = "",
} = {}) {
  const normalizedFiles = files.map((file) =>
    typeof file === "string" ? file : file?.filename,
  );
  let packageEcosystem = "unknown";
  if (headRef.startsWith("dependabot/github_actions/")) {
    packageEcosystem = "github-actions";
  } else if (headRef.startsWith("dependabot/npm_and_yarn/")) {
    packageEcosystem = "npm";
  } else if (
    normalizedFiles.length > 0 &&
    normalizedFiles.every((file) =>
      /^\.github\/(?:workflows\/[^/]+\.ya?ml|actions\/)/.test(file ?? ""),
    )
  ) {
    packageEcosystem = "github-actions";
  } else if (
    normalizedFiles.some((file) =>
      /(?:^|\/)(?:package\.json|pnpm-lock\.yaml)$/.test(file ?? ""),
    )
  ) {
    packageEcosystem = "npm";
  }

  const dependencies = dependencyRowsFromBody(body);
  const normalizedBody = String(body ?? "");
  const declaredGroup =
    /^Bumps the ([A-Za-z0-9_.-]+) group with ([1-9][0-9]*) updates?\b/m.exec(
      normalizedBody,
    );
  const dependencyGroup =
    declaredGroup?.[1] ??
    /^Bumps the ([A-Za-z0-9_.-]+) group\b/m.exec(normalizedBody)?.[1] ??
    null;
  const declaredUpdateCount = declaredGroup ? Number(declaredGroup[2]) : null;
  const uniqueDependencyNames = [
    ...new Set(dependencies.map(({ name }) => name)),
  ].sort();
  const duplicateDependencyRows =
    uniqueDependencyNames.length !== dependencies.length;
  const groupedUpdateIntegrity = {
    declaredUpdateCount,
    duplicateDependencyRows,
    parsedUpdateCount: dependencies.length,
    valid:
      dependencyGroup === null
        ? dependencies.length > 0 && !duplicateDependencyRows
        : Number.isSafeInteger(declaredUpdateCount) &&
          declaredUpdateCount > 0 &&
          declaredUpdateCount === dependencies.length &&
          !duplicateDependencyRows,
  };
  const updateType = dependencies.reduce(
    (highest, dependency) =>
      severityRank(dependency.updateType) > severityRank(highest)
        ? dependency.updateType
        : highest,
    dependencies.length > 0 ? "patch" : "unknown",
  );

  return {
    dependencies,
    dependencyGroup,
    dependencyNames: uniqueDependencyNames,
    groupedUpdateIntegrity,
    packageEcosystem,
    updateType,
  };
}

export function deriveImmutableDependabotMetadata({
  commits = [],
  files = [],
  headRef = "",
  headSha = null,
} = {}) {
  const immutableCommit = commits[0] ?? null;
  const currentCommit = commits.at(-1) ?? null;
  const metadata = parseDependabotMetadata({
    body: immutableCommit?.commit?.message ?? "",
    files,
    headRef,
  });
  const exactRoutineGroup =
    /^dependabot\/github_actions\/github-actions-routine(?:-[a-z0-9._-]+)?$/.test(
      headRef,
    );
  const expectedActionFiles =
    files.length > 0 &&
    files.every((file) => {
      const filename = typeof file === "string" ? file : file?.filename;
      const status = typeof file === "string" ? "modified" : file?.status;
      const expectedPath =
        /^\.github\/workflows\/[^/]+\.ya?ml$/.test(filename ?? "") ||
        /^\.github\/actions\/[^/]+\/action\.ya?ml$/.test(filename ?? "");
      return expectedPath && status !== "removed" && status !== "renamed";
    });
  metadata.immutableEvidence = {
    commitCount: commits.length,
    exactRoutineGroup,
    expectedActionFiles,
    repairCommitCount: Math.max(0, commits.length - 1),
    seedCommitSha: immutableCommit?.sha ?? null,
    source: "dependabot-commit-message",
    valid:
      immutableCommit !== null &&
      currentCommit !== null &&
      SHA_PATTERN.test(headSha ?? "") &&
      currentCommit.sha === headSha &&
      exactRoutineGroup &&
      expectedActionFiles &&
      trustedDependabotCommit(immutableCommit) &&
      metadata.dependencyGroup === "github-actions-routine" &&
      metadata.dependencyNames.length > 0 &&
      metadata.groupedUpdateIntegrity?.valid === true &&
      metadata.updateType !== "unknown",
  };
  metadata.maintainerChanges = commits.some(
    (commit) => !trustedDependabotCommit(commit),
  );
  metadata.repairChanges = commits
    .slice(1)
    .some((commit) => !trustedDependabotCommit(commit));
  return metadata;
}

export function derivePlannerDecisions(files = []) {
  const decisions = {
    e2eApp: false,
    e2eGovernance: false,
    e2eMonad: false,
    visualApp: false,
    visualUi: false,
  };
  for (const entry of files) {
    const path = typeof entry === "string" ? entry : entry?.filename;
    if (!path) continue;
    const globalInputs =
      path === ".npmrc" ||
      path === "package.json" ||
      path === "pnpm-lock.yaml" ||
      path === "pnpm-workspace.yaml" ||
      path === "turbo.json" ||
      path === "scripts/security-headers.mjs" ||
      path.startsWith(".github/actions/pnpm-install/") ||
      path.startsWith("patches/");
    if (globalInputs || path === ".github/workflows/e2e.yml") {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
      decisions.e2eMonad = true;
    }
    if (globalInputs || path === ".github/workflows/visual.yml") {
      decisions.visualApp = true;
      decisions.visualUi = true;
    }
    if (
      path === "scripts/fork-seed.mjs" ||
      path === "scripts/fork-seed.test.mjs"
    ) {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
    }
    if (
      path === "scripts/fork-seed-monad.mjs" ||
      path === "scripts/fork-seed-monad.test.mjs"
    ) {
      decisions.e2eMonad = true;
    }
    if (path.startsWith("apps/app.mento.org/")) {
      decisions.e2eApp = true;
      decisions.e2eMonad = true;
      decisions.visualApp = true;
    }
    if (path.startsWith("apps/governance.mento.org/")) {
      decisions.e2eGovernance = true;
    }
    if (path.startsWith("apps/ui.mento.org/")) decisions.visualUi = true;
    if (path.startsWith("packages/web3/")) {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
      decisions.e2eMonad = true;
      decisions.visualApp = true;
    }
    if (path.startsWith("packages/ui/")) {
      decisions.e2eApp = true;
      decisions.e2eGovernance = true;
      decisions.e2eMonad = true;
      decisions.visualApp = true;
      decisions.visualUi = true;
    }
  }
  return decisions;
}

export function classifyDependabotRisk(metadata = {}) {
  const packageEcosystem = String(
    metadata.packageEcosystem ?? metadata.packageManager ?? "unknown",
  ).toLowerCase();
  const updateType = normalizeUpdateType(
    metadata.updateType ?? metadata.update_type,
  );
  const dependencyNames = [
    ...(metadata.dependencyNames ?? metadata.dependencyNamesList ?? []),
    ...(metadata.dependencies ?? []).map((dependency) =>
      typeof dependency === "string" ? dependency : dependency?.name,
    ),
  ]
    .filter(Boolean)
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort();
  const sensitiveDependencies = dependencyNames.filter((name) =>
    SENSITIVE_ACTION_PATTERN.test(name),
  );

  if (packageEcosystem === "npm" || packageEcosystem === "npm_and_yarn") {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "npm",
      reason: "npm-updates-require-human-approval",
      sensitiveDependencies: [],
      tier: "manual-npm",
      updateType,
    };
  }
  if (
    packageEcosystem !== "github-actions" &&
    packageEcosystem !== "github_actions"
  ) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem,
      reason: "unknown-package-ecosystem",
      sensitiveDependencies,
      tier: "manual-unknown",
      updateType,
    };
  }
  if (metadata.immutableEvidence?.valid !== true) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      reason: "action-metadata-is-not-immutable-and-verified",
      sensitiveDependencies,
      tier: "manual-unverified-action-metadata",
      updateType,
    };
  }
  if (dependencyNames.length === 0) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      reason: "missing-dependency-metadata",
      sensitiveDependencies,
      tier: "manual-unknown-action",
      updateType,
    };
  }
  if (sensitiveDependencies.length > 0) {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      reason: "self-reviewer-or-security-action",
      sensitiveDependencies,
      tier: "manual-sensitive-action",
      updateType,
    };
  }
  if (updateType !== "patch" && updateType !== "minor") {
    return {
      autoApprovable: false,
      dependencyNames,
      packageEcosystem: "github-actions",
      reason: "only-action-patch-and-minor-updates-are-automatic",
      sensitiveDependencies,
      tier: "manual-action-major-or-unknown",
      updateType,
    };
  }
  return {
    autoApprovable: true,
    dependencyNames,
    packageEcosystem: "github-actions",
    reason: "safe-action-patch-or-minor",
    sensitiveDependencies,
    tier: "safe-actions-patch-minor",
    updateType,
  };
}

function normalizePullRequest(pullRequest) {
  const authorLogin = normalizeLogin(
    pullRequest?.author?.login ??
      pullRequest?.user?.login ??
      pullRequest?.author,
  );
  const headRepository =
    pullRequest?.head?.repo?.fullName ??
    pullRequest?.head?.repo?.full_name ??
    pullRequest?.headRepository?.nameWithOwner ??
    pullRequest?.headRepository ??
    pullRequest?.headRepo;
  const baseRepository =
    pullRequest?.base?.repo?.fullName ??
    pullRequest?.base?.repo?.full_name ??
    pullRequest?.baseRepository?.nameWithOwner ??
    pullRequest?.baseRepository ??
    pullRequest?.baseRepo;
  return {
    authorLogin,
    baseRef: pullRequest?.base?.ref ?? pullRequest?.baseRef ?? "",
    baseRepository,
    baseSha: pullRequest?.base?.sha ?? pullRequest?.baseSha ?? null,
    body: pullRequest?.body ?? "",
    files: pullRequest?.files ?? [],
    headRef: pullRequest?.head?.ref ?? pullRequest?.headRef ?? "",
    headRepository,
    headSha: pullRequest?.head?.sha ?? pullRequest?.headSha ?? null,
    isCrossRepository:
      pullRequest?.isCrossRepository ??
      (headRepository !== undefined && baseRepository !== undefined
        ? headRepository !== baseRepository
        : null),
    isDraft: Boolean(pullRequest?.draft ?? pullRequest?.isDraft),
    labels: normalizeLabels(pullRequest?.labels),
    mergeCommitSha:
      pullRequest?.merge_commit_sha ?? pullRequest?.mergeCommitSha ?? null,
    merged: Boolean(pullRequest?.merged ?? pullRequest?.mergedAt),
    nodeId: pullRequest?.node_id ?? pullRequest?.nodeId ?? pullRequest?.id,
    number: pullRequestNumber(pullRequest?.number),
    state: String(pullRequest?.state ?? "").toLowerCase(),
    title: pullRequest?.title ?? "",
  };
}

function evaluateCurrentBaseGate({ ancestry = {}, baselineSha, pullRequest }) {
  const reasons = [];
  const behindBy = Number(ancestry.behindBy);
  const aheadBy = Number(ancestry.aheadBy);
  const status = String(ancestry.status ?? "").toLowerCase();
  const currentBaseSha = ancestry.currentBaseSha ?? null;
  const baseCommitSha = ancestry.baseCommitSha ?? null;
  const mergeBaseSha = ancestry.mergeBaseSha ?? null;
  const comparedHeadSha = ancestry.headSha ?? null;
  const validCounts =
    Number.isSafeInteger(behindBy) &&
    behindBy >= 0 &&
    Number.isSafeInteger(aheadBy) &&
    aheadBy >= 0;
  if (!validCounts) reasons.push("invalid-base-compare-counts");
  if (!SHA_PATTERN.test(currentBaseSha ?? "")) {
    reasons.push("invalid-current-base-sha");
  }
  if (
    currentBaseSha !== baselineSha ||
    currentBaseSha !== pullRequest.baseSha
  ) {
    reasons.push("current-base-sha-mismatch");
  }
  if (baseCommitSha !== currentBaseSha) {
    reasons.push("compare-base-sha-mismatch");
  }
  if (comparedHeadSha !== pullRequest.headSha) {
    reasons.push("compare-head-sha-mismatch");
  }
  if (mergeBaseSha !== currentBaseSha) {
    reasons.push("current-base-is-not-head-ancestor");
  }
  if (behindBy !== 0) reasons.push("head-is-behind-current-base");
  if (!new Set(["ahead", "identical"]).has(status)) {
    reasons.push("unexpected-base-compare-status");
  }
  if (ancestry.currentBaseIsAncestor !== true) {
    reasons.push("current-base-ancestry-not-proven");
  }
  return {
    aheadBy: validCounts ? aheadBy : null,
    baseCommitSha,
    behindBy: validCounts ? behindBy : null,
    current: reasons.length === 0,
    currentBaseIsAncestor: ancestry.currentBaseIsAncestor === true,
    currentBaseSha,
    headSha: comparedHeadSha,
    mergeBaseSha,
    reasons: [...new Set(reasons)],
    status: status || null,
  };
}

export function validateDependabotPullRequestIdentity({
  commits = [],
  expectedHeadSha,
  metadata = {},
  pullRequest,
  repairAttempts = null,
  repository,
}) {
  const normalized = normalizePullRequest(pullRequest);
  const reasons = [];
  const commitList = Array.isArray(commits) ? commits : [];
  repositoryName(repository);

  if (normalized.authorLogin !== DEPENDABOT_LOGIN) {
    reasons.push("author-is-not-dependabot");
  }
  if (!normalized.headRef.startsWith("dependabot/")) {
    reasons.push("head-ref-is-not-dependabot");
  }
  if (normalized.headRepository !== repository) {
    reasons.push("head-repository-mismatch");
  }
  if (normalized.baseRepository !== repository) {
    reasons.push("base-repository-mismatch");
  }
  if (normalized.baseRef !== "main") reasons.push("unexpected-base-ref");
  if (normalized.isCrossRepository === true) {
    reasons.push("cross-repository-pull-request");
  }
  if (normalized.state !== "open") reasons.push("pull-request-is-not-open");
  if (normalized.isDraft) reasons.push("pull-request-is-draft");

  if (!SHA_PATTERN.test(normalized.headSha ?? "")) {
    reasons.push("invalid-head-sha");
  }
  if (!SHA_PATTERN.test(expectedHeadSha ?? "")) {
    reasons.push("invalid-expected-head-sha");
  } else if (normalized.headSha !== expectedHeadSha) {
    reasons.push("head-sha-changed");
  }

  const seedCommit = commitList[0] ?? null;
  const currentCommit = commitList.at(-1) ?? null;
  const seedAuthorLogin = normalizeLogin(
    seedCommit?.authorLogin ?? seedCommit?.author?.login ?? seedCommit?.author,
  );
  const repairCommitCount = Math.max(0, commitList.length - 1);
  const hasNonDependabotRepairCommit = commitList.slice(1).some((commit) => {
    const login = normalizeLogin(
      commit?.authorLogin ?? commit?.author?.login ?? commit?.author,
    );
    return login !== DEPENDABOT_LOGIN;
  });
  const computedMaintainerChanges =
    seedAuthorLogin !== DEPENDABOT_LOGIN || hasNonDependabotRepairCommit;
  const repairLineageValid =
    repairCommitCount === 0 || repairAttempts?.repairLineageValid === true;
  if (seedAuthorLogin !== DEPENDABOT_LOGIN) {
    reasons.push("maintainer-changes-present");
  }
  if (
    (metadata.maintainerChanges !== undefined &&
      (typeof metadata.maintainerChanges !== "boolean" ||
        metadata.maintainerChanges !== computedMaintainerChanges)) ||
    (metadata.repairChanges !== undefined &&
      (typeof metadata.repairChanges !== "boolean" ||
        metadata.repairChanges !== hasNonDependabotRepairCommit))
  ) {
    reasons.push("maintainer-change-evidence-mismatch");
  }
  if (!repairLineageValid) reasons.push("untrusted-repair-lineage");

  if (
    metadata.packageEcosystem === "github-actions" ||
    metadata.packageEcosystem === "github_actions"
  ) {
    if (commitList.length === 0) {
      reasons.push("unexpected-dependabot-commit-count");
    } else if (currentCommit?.sha !== normalized.headSha) {
      reasons.push("immutable-commit-head-mismatch");
    }
  }

  return {
    automaticAuthority:
      reasons.length === 0 && repairCommitCount === 0 && seedCommit !== null,
    automaticSeedHeadSha: seedCommit?.sha ?? null,
    headSha: normalized.headSha,
    number: normalized.number,
    repairCommitCount,
    repairLineageValid,
    reasons,
    valid: reasons.length === 0,
  };
}

function normalizeCheck(check, assumedHeadSha) {
  const name = check?.name ?? check?.context ?? "";
  const rawStatus = String(check?.status ?? "").toLowerCase();
  const rawConclusion = String(
    check?.conclusion ?? check?.state ?? "",
  ).toLowerCase();
  const status =
    rawStatus === "completed" ||
    (rawStatus === "" && !PENDING_STATUSES.has(rawConclusion))
      ? "completed"
      : rawStatus || rawConclusion;
  const conclusion =
    rawConclusion === "success" || rawConclusion === "failure"
      ? rawConclusion
      : rawConclusion || (status === "completed" ? "unknown" : null);
  const timestamp =
    check?.completedAt ??
    check?.completed_at ??
    check?.startedAt ??
    check?.started_at ??
    check?.updatedAt ??
    check?.updated_at ??
    check?.createdAt ??
    check?.created_at ??
    "";
  return {
    appId: Number(check?.appId ?? check?.app?.id ?? check?.source?.appId ?? 0),
    conclusion,
    description: check?.description ?? null,
    detailsUrl:
      check?.detailsUrl ?? check?.details_url ?? check?.target_url ?? null,
    externalId:
      check?.externalId ??
      check?.external_id ??
      check?.source?.externalId ??
      null,
    headSha: check?.headSha ?? check?.head_sha ?? assumedHeadSha ?? null,
    id: Number(check?.id ?? 0),
    name,
    creatorLogin: normalizeLogin(
      check?.creatorLogin ??
        check?.creator?.login ??
        check?.source?.creatorLogin,
    ),
    kind: check?.kind ?? check?.source?.kind ?? "check",
    runAttempt: Number(
      check?.runAttempt ?? check?.run_attempt ?? check?.source?.runAttempt ?? 0,
    ),
    runHeadSha:
      check?.runHeadSha ?? check?.source?.runHeadSha ?? check?.headSha ?? null,
    runHeadBranch: check?.runHeadBranch ?? check?.source?.runHeadBranch ?? null,
    runDisplayTitle:
      check?.runDisplayTitle ?? check?.source?.runDisplayTitle ?? null,
    runId: Number(check?.runId ?? check?.source?.runId ?? 0),
    sourceRepository:
      check?.sourceRepository ?? check?.source?.repository ?? null,
    status,
    timestamp,
    workflowEvent: check?.workflowEvent ?? check?.source?.workflowEvent ?? null,
    workflowPath: String(
      check?.workflowPath ?? check?.source?.workflowPath ?? "",
    ).replace(/@.*$/, ""),
  };
}

function compareChecks(left, right) {
  if (left.kind === "status" && right.kind === "status") {
    const timestampComparison = String(left.timestamp).localeCompare(
      String(right.timestamp),
    );
    if (timestampComparison !== 0) return timestampComparison;
    const idComparison = left.id - right.id;
    if (idComparison !== 0) return idComparison;
  }
  const runComparison = left.runId - right.runId;
  if (runComparison !== 0) return runComparison;
  const attemptComparison = left.runAttempt - right.runAttempt;
  if (attemptComparison !== 0) return attemptComparison;
  const timestampComparison = String(left.timestamp).localeCompare(
    String(right.timestamp),
  );
  return timestampComparison || left.id - right.id;
}

function trustedCheckSource(
  check,
  headSha,
  definition,
  repository,
  pullRequestNumberValue = null,
) {
  if (!check) return { reason: "missing", trusted: false };
  const policy = CHECK_SOURCE_POLICY[definition.id];
  if (!policy) return { reason: "missing-source-policy", trusted: false };
  if (check.headSha !== headSha) {
    return { reason: "check-head-sha-mismatch", trusted: false };
  }
  if (check.sourceRepository !== repository) {
    return { reason: "unexpected-source-repository", trusted: false };
  }
  if (check.kind !== "status" && check.appId !== GITHUB_ACTIONS_APP_ID) {
    return { reason: "unexpected-check-app", trusted: false };
  }
  if ((policy.kind ?? "check") !== check.kind) {
    return { reason: "unexpected-check-kind", trusted: false };
  }
  if (check.kind === "status" && check.creatorLogin !== "github-actions[bot]") {
    return { reason: "unexpected-status-creator", trusted: false };
  }
  if (!policy.workflowPaths.includes(check.workflowPath)) {
    return { reason: "unexpected-workflow-path", trusted: false };
  }
  if (!policy.events.includes(check.workflowEvent)) {
    return { reason: "unexpected-workflow-event", trusted: false };
  }
  if (definition.id === "vercel-preview") {
    const title = VERCEL_PREVIEW_INTAKE_TITLE_PATTERN.exec(
      String(check.runDisplayTitle ?? ""),
    );
    if (
      check.description !== "Preview disabled for Dependabot PR" ||
      !title ||
      (pullRequestNumberValue !== null &&
        Number(title[1]) !== pullRequestNumberValue) ||
      title[2] !== headSha
    ) {
      return {
        reason: "invalid-vercel-preview-intake-receipt",
        trusted: false,
      };
    }
    if (
      check.detailsUrl !==
      `https://github.com/${repository}/actions/runs/${check.runId}`
    ) {
      return { reason: "vercel-preview-run-url-mismatch", trusted: false };
    }
  } else if (definition.id === "claude-review") {
    const displayReceipt = CLAUDE_REVIEW_RECEIPT_PATTERN.exec(
      String(check.runDisplayTitle ?? ""),
    );
    const externalReceipt = CLAUDE_REVIEW_EXTERNAL_ID_PATTERN.exec(
      String(check.externalId ?? ""),
    );
    if (!displayReceipt || !externalReceipt) {
      return { reason: "invalid-claude-review-receipt", trusted: false };
    }
    const displayPullRequestNumber = Number(displayReceipt[2]);
    const externalPullRequestNumber = Number(externalReceipt[1]);
    if (
      displayReceipt[1] !== repository ||
      displayReceipt[3] !== headSha ||
      externalReceipt[2] !== headSha ||
      displayPullRequestNumber !== externalPullRequestNumber ||
      (pullRequestNumberValue !== null &&
        displayPullRequestNumber !== pullRequestNumberValue)
    ) {
      return { reason: "claude-review-receipt-mismatch", trusted: false };
    }
    if (
      check.runHeadBranch !== "main" ||
      !SHA_PATTERN.test(check.runHeadSha ?? "") ||
      check.runHeadSha === headSha
    ) {
      return { reason: "untrusted-claude-review-source-ref", trusted: false };
    }
    if (
      Number(externalReceipt[3]) !== check.runId ||
      Number(externalReceipt[4]) !== check.runAttempt
    ) {
      return { reason: "claude-review-run-identity-mismatch", trusted: false };
    }
    if (
      check.detailsUrl !==
      `https://github.com/${repository}/actions/runs/${check.runId}`
    ) {
      return { reason: "claude-review-run-url-mismatch", trusted: false };
    }
  } else if (check.runHeadSha !== headSha) {
    return { reason: "workflow-run-head-sha-mismatch", trusted: false };
  }
  if (!Number.isInteger(check.runAttempt) || check.runAttempt < 1) {
    return { reason: "invalid-workflow-run-attempt", trusted: false };
  }
  if (!Number.isSafeInteger(check.runId) || check.runId < 1) {
    return { reason: "invalid-workflow-run-id", trusted: false };
  }
  if (
    check.detailsUrl &&
    !check.detailsUrl.includes(`/actions/runs/${check.runId}`)
  ) {
    return { reason: "workflow-run-url-mismatch", trusted: false };
  }
  return { reason: "trusted-source", trusted: true };
}

export function selectLatestExactHeadCheck(checks, headSha, definition) {
  exactSha(headSha, "Expected check head SHA");
  const candidates = checks
    .map((check) => normalizeCheck(check))
    .filter(
      (check) =>
        check.headSha === headSha &&
        definition.names.some((pattern) => pattern.test(check.name)),
    )
    .sort(compareChecks);
  return candidates.at(-1) ?? null;
}

function resultState(check) {
  if (!check) return "missing";
  if (
    check.status !== "completed" ||
    PENDING_STATUSES.has(check.status) ||
    PENDING_STATUSES.has(check.conclusion)
  ) {
    return "pending";
  }
  if (PASSING_CONCLUSIONS.has(check.conclusion)) return "passing";
  if (check.conclusion === "skipped") return "skipped";
  return "failing";
}

function evaluateChecksForSha(
  checks,
  headSha,
  plannerDecisions = {},
  repository,
  pullRequestNumberValue = null,
) {
  const results = [];
  const byId = new Map();
  for (const definition of CHECK_POLICY_DEFINITIONS) {
    const check = selectLatestExactHeadCheck(checks, headSha, definition);
    let state = resultState(check);
    let reason = state;
    const source = trustedCheckSource(
      check,
      headSha,
      definition,
      repository,
      pullRequestNumberValue,
    );
    if (check && !source.trusted) {
      state = "failing";
      reason = source.reason;
    }
    if (state === "skipped") {
      const planner = byId.get(definition.skippedBy);
      if (
        definition.skippedBy &&
        planner?.state === "passing" &&
        definition.plannerDecision &&
        plannerDecisions[definition.plannerDecision] === false
      ) {
        state = "passing";
        reason = "planner-backed-skip";
      } else {
        state = "failing";
        reason = "unjustified-skip";
      }
    }
    const result = {
      check: check
        ? {
            conclusion: check.conclusion,
            detailsUrl: check.detailsUrl,
            headSha: check.headSha,
            id: check.id,
            runAttempt: check.runAttempt,
            runId: check.runId,
            name: check.name,
            status: check.status,
            workflowEvent: check.workflowEvent,
            workflowPath: check.workflowPath,
          }
        : null,
      id: definition.id,
      label: definition.label,
      failureAttribution: definition.failureAttribution ?? "deterministic",
      reason,
      source: source.reason,
      skippedBy: definition.skippedBy ?? null,
      state,
    };
    results.push(result);
    byId.set(definition.id, result);
  }
  return results;
}

export function evaluateDependabotChecks({
  baselineChecks = [],
  baselineSha = null,
  checks = [],
  headSha,
  plannerDecisions = {},
  pullRequestNumber: pullRequestNumberValue = null,
  repository,
}) {
  exactSha(headSha, "PR head SHA");
  repositoryName(repository);
  const policy = evaluateChecksForSha(
    checks,
    headSha,
    plannerDecisions,
    repository,
    pullRequestNumberValue,
  );
  const baselinePolicy = baselineSha
    ? evaluateChecksForSha(
        baselineChecks,
        exactSha(baselineSha, "Baseline SHA"),
        plannerDecisions,
        repository,
        null,
      )
    : [];
  const baselineById = new Map(
    baselinePolicy.map((result) => [result.id, result]),
  );
  const failures = [];
  for (const result of policy) {
    if (result.state !== "failing") continue;
    const baselineResult = baselineById.get(result.id);
    failures.push({
      attribution:
        baselineResult?.state === "failing"
          ? "baseline"
          : baselineResult?.state === "passing"
            ? result.failureAttribution === "external"
              ? "non-deterministic"
              : "branch"
            : "unknown",
      id: result.id,
      name: result.check?.name ?? null,
      reason: result.reason,
    });
  }
  const missing = policy
    .filter((result) => result.state === "missing")
    .map(({ id }) => id);
  const pending = policy
    .filter((result) => result.state === "pending")
    .map(({ id }) => id);
  const state =
    failures.length > 0
      ? "failing"
      : missing.length > 0 || pending.length > 0
        ? "pending"
        : "passing";
  return {
    baselineSha,
    failures,
    headSha,
    missing,
    pending,
    policy,
    state,
  };
}

function processorApprovalBinding(review) {
  const body = String(review?.body ?? "");
  const match = new RegExp(
    `^Approved by ${DEPENDABOT_PROCESSOR_SCHEMA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} for exact head ([0-9a-f]{40})\\.$`,
  ).exec(body);
  const commitSha = review?.commitSha;
  return match && SHA_PATTERN.test(commitSha ?? "") && match[1] === commitSha
    ? commitSha
    : null;
}

function reviewEnvelopeMatches({
  actor,
  body,
  headSha,
  inlineRootCount,
  reviewCommitSha,
}) {
  if (
    typeof body !== "string" ||
    body.length === 0 ||
    body.length > REVIEW_ENVELOPE_BODY_LIMIT
  ) {
    return false;
  }
  if (actor.login === "cursor") {
    if (!body.startsWith("<!-- BUGBOT_REVIEW -->")) return false;
    const stated = /found ([0-9]+) potential issues?\./.exec(body);
    return Boolean(stated) && Number(stated[1]) === inlineRootCount;
  }
  if (actor.login === "chatgpt-codex-connector") {
    if (body.startsWith("Codex Review: Didn't find any major issues.")) {
      return inlineRootCount === 0;
    }
    if (body.startsWith(`\n${CODEX_REVIEW_HEADING}\n`)) {
      const reviewedCommit =
        /^\n### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request\.\n\n\*\*Reviewed commit:\*\* `([0-9a-f]{10})`\n/.exec(
          body,
        );
      return (
        inlineRootCount > 0 &&
        reviewCommitSha === headSha &&
        reviewedCommit?.[1] === headSha.slice(0, 10)
      );
    }
    return /^Codex Review:(?: |\n)/.test(body) && inlineRootCount > 0;
  }
  if (actor.login === "claude") {
    return (
      /^(?:## |### )?(?:Claude )?Code Review\b/.test(body) &&
      inlineRootCount > 0
    );
  }
  return false;
}

export function classifyDependabotFeedback({
  headSha,
  issueComments = [],
  reviews = [],
  threadPagesTruncated = false,
  threads = [],
} = {}) {
  exactSha(headSha, "Feedback head SHA");
  const blockers = [];
  const addBlocker = ({ body = "", id, reason, surface }) => {
    blockers.push(
      boundedFeedbackBlocker({
        bodyDigest: feedbackBodyDigest(body),
        id,
        reason,
        surface,
      }),
    );
  };
  let actionableThreadCount = 0;
  let unresolvedThreads = 0;
  let unrepliedThreads = 0;
  let currentProcessorApprovalCount = 0;
  let historicalProcessorApprovalCount = 0;
  let dismissedProcessorApprovalCount = 0;
  const currentProcessorApprovalIds = [];

  const reviewsById = new Map();
  for (const review of reviews) {
    const key = String(review?.id ?? "");
    if (!reviewsById.has(key)) reviewsById.set(key, []);
    reviewsById.get(key).push(review);
  }
  const botInlineRootCounts = new Map();
  for (const thread of threads) {
    for (const comment of thread?.comments ?? []) {
      const actor = feedbackActor(comment?.actor);
      if (
        comment?.replyToId == null &&
        actor.type === "Bot" &&
        ACTIONABLE_REVIEW_BOTS.has(actor.login)
      ) {
        const key = String(comment?.reviewId ?? "");
        botInlineRootCounts.set(key, (botInlineRootCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const acceptedReviewEnvelopes = new Set();

  if (threadPagesTruncated) {
    addBlocker({
      id: "review-thread-pagination",
      reason: "feedback-thread-pagination-cap-exceeded",
      surface: "thread",
    });
  }

  for (const review of reviews) {
    const actor = feedbackActor(review?.actor);
    if (malformedFeedbackActor(actor)) {
      addBlocker({
        body: review?.body,
        id: review?.id ?? "unknown-review",
        reason: "malformed-feedback-actor",
        surface: "review",
      });
      continue;
    }
    if (actor.type === "User") {
      if (
        trustedHuman(actor) &&
        review?.commitSha === headSha &&
        String(review?.state ?? "").toUpperCase() === "COMMENTED" &&
        String(review?.body ?? "").trim().length > 0
      ) {
        addBlocker({
          body: review.body,
          id: review.id,
          reason: "maintainer-top-level-review-feedback",
          surface: "review",
        });
      }
      continue;
    }
    const body = String(review?.body ?? "");
    const state = String(review?.state ?? "").toUpperCase();
    if (
      actor.login === "github-actions" &&
      (state === "APPROVED" || state === "DISMISSED")
    ) {
      const approvalCommitSha = processorApprovalBinding(review);
      if (approvalCommitSha) {
        if (state === "DISMISSED") {
          dismissedProcessorApprovalCount += 1;
        } else if (approvalCommitSha === headSha) {
          currentProcessorApprovalCount += 1;
          if (
            Number.isSafeInteger(review.id) &&
            review.id > 0 &&
            currentProcessorApprovalIds.length < FEEDBACK_BLOCKER_LIMIT
          ) {
            currentProcessorApprovalIds.push(review.id);
          }
        } else {
          historicalProcessorApprovalCount += 1;
        }
        continue;
      }
    }
    const reviewId = String(review?.id ?? "");
    const inlineRootCount = botInlineRootCounts.get(reviewId) ?? 0;
    if (
      state === "COMMENTED" &&
      SHA_PATTERN.test(review?.commitSha ?? "") &&
      ACTIONABLE_REVIEW_BOTS.has(actor.login) &&
      reviewEnvelopeMatches({
        actor,
        body,
        headSha,
        inlineRootCount,
        reviewCommitSha: review?.commitSha,
      })
    ) {
      acceptedReviewEnvelopes.add(reviewId);
      continue;
    }
    addBlocker({
      body,
      id: review?.id ?? "unknown-review",
      reason: "unknown-review-bot-feedback",
      surface: "review",
    });
  }

  for (const thread of threads) {
    const threadId = thread?.id ?? "unknown-thread";
    if (thread?.commentsTruncated === true) {
      addBlocker({
        id: threadId,
        reason: "feedback-thread-comments-cap-exceeded",
        surface: "thread",
      });
      continue;
    }
    const comments = Array.isArray(thread?.comments) ? thread.comments : [];
    for (const comment of comments) {
      const actor = feedbackActor(comment?.actor);
      if (malformedFeedbackActor(actor)) {
        addBlocker({
          body: comment?.body,
          id: comment?.id ?? threadId,
          reason: "malformed-feedback-actor",
          surface: "thread-comment",
        });
      } else if (
        actor.type === "Bot" &&
        !ACTIONABLE_REVIEW_BOTS.has(actor.login)
      ) {
        addBlocker({
          body: comment?.body,
          id: comment?.id ?? threadId,
          reason: "unknown-review-bot-feedback",
          surface: "thread-comment",
        });
      }
    }
    const roots = comments.filter((comment) => comment?.replyToId == null);
    if (roots.length !== 1) {
      addBlocker({
        id: threadId,
        reason: "malformed-review-thread",
        surface: "thread",
      });
      continue;
    }
    const root = roots[0];
    const rootActor = feedbackActor(root.actor);
    const actionable =
      trustedHuman(rootActor) ||
      (rootActor.type === "Bot" && ACTIONABLE_REVIEW_BOTS.has(rootActor.login));
    if (!actionable) continue;
    actionableThreadCount += 1;
    if (rootActor.type === "Bot") {
      const reviewId = String(root.reviewId ?? "");
      const parentReviews = reviewsById.get(reviewId) ?? [];
      const parent = parentReviews[0];
      const parentActor = feedbackActor(parent?.actor);
      if (
        parentReviews.length !== 1 ||
        !acceptedReviewEnvelopes.has(reviewId) ||
        parentActor.type !== "Bot" ||
        parentActor.login !== rootActor.login ||
        parent?.commitSha !== root.reviewCommitSha ||
        !SHA_PATTERN.test(root.reviewCommitSha ?? "")
      ) {
        addBlocker({
          body: root.body,
          id: threadId,
          reason: "invalid-actionable-review-envelope",
          surface: "thread",
        });
      }
    }
    const unresolved = thread?.resolved !== true;
    if (unresolved) {
      unresolvedThreads += 1;
      addBlocker({
        body: root.body,
        id: threadId,
        reason: "unresolved-review-feedback",
        surface: "thread",
      });
    }
    if (!SHA_PATTERN.test(root.reviewCommitSha ?? "")) {
      addBlocker({
        body: root.body,
        id: threadId,
        reason: "missing-review-head-binding",
        surface: "thread",
      });
      continue;
    }
    if (thread?.resolved === true && root.reviewCommitSha !== headSha) continue;
    const hasRequiredReply = comments.some((reply) => {
      const actor = feedbackActor(reply?.actor);
      return (
        String(reply?.replyToId ?? "") === String(root.id) &&
        String(reply?.createdAt ?? "") > String(root.createdAt ?? "") &&
        trustedHuman(actor) &&
        directMaintainerReply(String(reply?.body ?? ""), headSha)
      );
    });
    if (!hasRequiredReply) {
      unrepliedThreads += 1;
      addBlocker({
        body: root.body,
        id: threadId,
        reason: "unreplied-review-feedback",
        surface: "thread",
      });
    }
  }

  for (const comment of issueComments) {
    const actor = feedbackActor(comment?.actor);
    if (malformedFeedbackActor(actor)) {
      addBlocker({
        body: comment?.body,
        id: comment?.id ?? "unknown-issue-comment",
        reason: "malformed-feedback-actor",
        surface: "issue-comment",
      });
      continue;
    }
    if (actor.type === "User") {
      if (trustedHuman(actor)) {
        addBlocker({
          body: comment?.body,
          id: comment.id,
          reason: "maintainer-issue-comment",
          surface: "issue-comment",
        });
      }
      continue;
    }
    const body = String(comment?.body ?? "");
    const informational =
      body.length <= REVIEW_ENVELOPE_BODY_LIMIT &&
      ((actor.login === "github-actions" &&
        body.startsWith("<!-- vercel-preview-journal:v2 -->") &&
        body.includes("**No reviewer action is required.**")) ||
        (actor.login === "argos-ci" &&
          body.startsWith(
            "**The latest updates on your projects.** Learn more about [Argos notifications ↗︎](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments)",
          )) ||
        (actor.login === "vercel" && body.startsWith("[vc]: ")) ||
        (actor.login === "chatgpt-codex-connector" &&
          body.startsWith("Codex Review: Didn't find any major issues.")));
    if (!informational) {
      addBlocker({
        body,
        id: comment?.id ?? "unknown-issue-comment",
        reason: "unknown-issue-comment-bot-feedback",
        surface: "issue-comment",
      });
    }
  }

  const reasons = [...new Set(blockers.map(({ reason }) => reason))];
  return {
    actionableThreadCount,
    blockerCount: blockers.length,
    blockers: blockers.slice(0, FEEDBACK_BLOCKER_LIMIT),
    complete: !reasons.some((reason) =>
      [
        "feedback-thread-comments-cap-exceeded",
        "feedback-thread-pagination-cap-exceeded",
        "malformed-feedback-actor",
        "malformed-review-thread",
        "missing-review-head-binding",
        "invalid-actionable-review-envelope",
      ].includes(reason),
    ),
    currentProcessorApprovalCount,
    currentProcessorApprovalIds,
    dismissedProcessorApprovalCount,
    historicalProcessorApprovalCount,
    issueCommentCount: issueComments.length,
    reasons,
    reviewCount: reviews.length,
    threadCount: threads.length,
    unresolvedThreads,
    unrepliedThreads,
  };
}

export function evaluateFeedbackGate({ feedback = {}, pullRequest = {} } = {}) {
  const labels = normalizeLabels([
    ...(pullRequest.labels ?? []),
    ...(feedback.labels ?? []),
  ]);
  const vetoLabels = labels.filter((label) => VETO_LABELS.has(label));
  const unresolvedThreads = Number(feedback.unresolvedThreads ?? 0);
  const unrepliedThreads = Number(feedback.unrepliedThreads ?? 0);
  const reviewDecision = String(
    feedback.reviewDecision ?? pullRequest.reviewDecision ?? "",
  ).toUpperCase();
  const forcePushActors = [
    ...new Set(
      (Array.isArray(feedback.forcePushActors)
        ? feedback.forcePushActors
        : []
      ).map((login) =>
        (normalizeLogin(login) || "unknown-actor").slice(0, 100),
      ),
    ),
  ]
    .sort()
    .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
  const forcePushCommitIds = [
    ...new Set(
      (Array.isArray(feedback.forcePushCommitIds)
        ? feedback.forcePushCommitIds
        : []
      ).filter((commitId) => SHA_PATTERN.test(commitId ?? "")),
    ),
  ]
    .sort()
    .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
  const reasons = [
    ...(Array.isArray(feedback.reasons) ? feedback.reasons : []),
  ];
  if (feedback.complete === false) reasons.unshift("feedback-incomplete");
  if (!Number.isInteger(unresolvedThreads) || unresolvedThreads < 0) {
    reasons.push("invalid-unresolved-thread-count");
  } else if (unresolvedThreads > 0) {
    reasons.push("unresolved-review-feedback");
  }
  if (!Number.isInteger(unrepliedThreads) || unrepliedThreads < 0) {
    reasons.push("invalid-unreplied-thread-count");
  } else if (unrepliedThreads > 0) {
    reasons.push("unreplied-review-feedback");
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    reasons.push("changes-requested");
  }
  if (
    feedback.veto === true ||
    (feedback.maintainerVeto === true &&
      feedback.humanClosed !== true &&
      feedback.humanReopened !== true &&
      feedback.forcePushed !== true)
  ) {
    reasons.push("explicit-maintainer-veto");
  }
  if (feedback.humanClosed === true) {
    reasons.push("human-closed-pull-request");
  }
  if (feedback.humanReopened === true) {
    reasons.push("human-reopened-pull-request");
  }
  if (feedback.forcePushed === true) {
    reasons.push("pull-request-history-force-pushed");
  }
  if (vetoLabels.length > 0) reasons.push("veto-label-present");
  const uniqueReasons = [...new Set(reasons)];
  return {
    autoMergeEnabled: feedback.autoMergeEnabled === true,
    blockers: Array.isArray(feedback.blockers) ? feedback.blockers : [],
    clear: uniqueReasons.length === 0,
    forcePushActors,
    forcePushCommitIds,
    forcePushEventCount:
      Number.isSafeInteger(feedback.forcePushEventCount) &&
      feedback.forcePushEventCount >= 0
        ? feedback.forcePushEventCount
        : null,
    forcePushed: feedback.forcePushed === true,
    humanClosed: feedback.humanClosed === true,
    humanReopened: feedback.humanReopened === true,
    reasons: uniqueReasons,
    reviewDecision: reviewDecision || null,
    unresolvedThreads,
    unrepliedThreads,
    vetoLabels,
  };
}

function evaluateRepairAttemptGate({
  checks = [],
  commits = [],
  explicitRepairAttempt,
  headSha,
  pullRequestNumber: pullRequestNumberValue,
  repairHistoryChecks,
}) {
  const hasLineageHistory = repairHistoryChecks !== undefined;
  const reasons = [];
  const rawLineageHeadShas = (Array.isArray(commits) ? commits : []).map(
    (commit) => commit?.sha,
  );
  const lineageHeadShas = [
    ...new Set(rawLineageHeadShas.filter((sha) => SHA_PATTERN.test(sha ?? ""))),
  ];
  if (
    lineageHeadShas.length !== rawLineageHeadShas.length ||
    rawLineageHeadShas.some((sha) => !SHA_PATTERN.test(sha ?? ""))
  ) {
    reasons.push("repair-lineage-commit-shas-malformed");
  }
  const lineageHeadShaSet = new Set(lineageHeadShas);
  if (hasLineageHistory && !Array.isArray(repairHistoryChecks)) {
    reasons.push("repair-attempt-history-malformed");
  }
  if (hasLineageHistory && !lineageHeadShaSet.has(headSha)) {
    reasons.push("repair-history-current-head-not-in-lineage");
  }
  const normalizedProcessorChecks = (
    hasLineageHistory
      ? Array.isArray(repairHistoryChecks)
        ? repairHistoryChecks
        : []
      : checks
  )
    .map((check) => ({
      ...normalizeCheck(check, hasLineageHistory ? null : headSha),
      receiptKindDeclared: check?.kind ?? check?.source?.kind ?? null,
      receiptStatusDeclared: check?.status ?? null,
    }))
    .filter((check) => {
      if (check.name === PROCESSOR_CHECK_NAME) return true;
      if (hasLineageHistory) {
        reasons.push("unexpected-repair-history-check-name");
      }
      return false;
    });
  const receiptsByHead = new Map(
    lineageHeadShas.map((lineageHeadSha) => [lineageHeadSha, []]),
  );
  const seenReceipts = new Set();
  for (const check of normalizedProcessorChecks) {
    if (!SHA_PATTERN.test(check.headSha ?? "")) {
      reasons.push("malformed-repair-attempt-receipt");
      continue;
    }
    if (
      (hasLineageHistory && !lineageHeadShaSet.has(check.headSha)) ||
      (!hasLineageHistory && check.headSha !== headSha)
    ) {
      reasons.push("repair-attempt-receipt-outside-lineage");
      continue;
    }
    if (
      check.appId !== GITHUB_ACTIONS_APP_ID ||
      check.kind !== "check" ||
      check.receiptKindDeclared !== "check"
    ) {
      reasons.push("untrusted-repair-attempt-receipt");
      continue;
    }
    if (
      check.status !== "completed" ||
      String(check.receiptStatusDeclared).toLowerCase() !== "completed"
    ) {
      reasons.push("incomplete-repair-attempt-receipt");
      continue;
    }
    const receipt = PROCESSOR_REPAIR_RECEIPT_PATTERN.exec(
      String(check.externalId ?? ""),
    );
    if (
      !receipt ||
      Number(receipt[1]) !== pullRequestNumberValue ||
      receipt[2] !== check.headSha
    ) {
      reasons.push("malformed-repair-attempt-receipt");
      continue;
    }
    const receiptMode = receipt[3];
    const attempt = Number(receipt[4]);
    const packetIssued = receipt[5] === "true";
    if (!Number.isSafeInteger(attempt) || attempt < 1) {
      reasons.push("malformed-repair-attempt-receipt");
      continue;
    }
    if (!["failure", "neutral", "success"].includes(check.conclusion)) {
      reasons.push("invalid-repair-attempt-receipt-conclusion");
      continue;
    }
    if (packetIssued && receiptMode === "observe") {
      reasons.push("observe-repair-attempt-receipt-issued-packet");
      continue;
    }
    const receiptKey = `${check.headSha}:${receiptMode}:${attempt}:${packetIssued}`;
    if (seenReceipts.has(receiptKey)) continue;
    seenReceipts.add(receiptKey);
    receiptsByHead.get(check.headSha)?.push({
      attempt,
      packetIssued,
      receiptMode,
    });
  }
  let consumedAttempts = 0;
  let currentHeadPacketIssued = false;
  let issuedAttemptCount = 0;
  for (const [index, lineageHeadSha] of lineageHeadShas.entries()) {
    const receipts = receiptsByHead.get(lineageHeadSha) ?? [];
    const expectedAttempt = consumedAttempts + 1;
    const statedAttempts = new Set(receipts.map(({ attempt }) => attempt));
    if (
      statedAttempts.size > 1 ||
      (statedAttempts.size === 1 && !statedAttempts.has(expectedAttempt))
    ) {
      reasons.push("ambiguous-repair-attempt-history");
    }
    const packetAttempts = new Set(
      receipts
        .filter(({ packetIssued }) => packetIssued)
        .map(({ attempt }) => attempt),
    );
    if (packetAttempts.size > 1) {
      reasons.push("ambiguous-repair-attempt-history");
    }
    const packetIssued = packetAttempts.size === 1;
    const isCurrentHead = index === lineageHeadShas.length - 1;
    if (!isCurrentHead && !packetIssued) {
      reasons.push("repair-lineage-commit-without-parent-packet");
    }
    if (packetIssued) {
      issuedAttemptCount += 1;
      if (isCurrentHead) currentHeadPacketIssued = true;
      else consumedAttempts += 1;
    }
  }
  if (!hasLineageHistory && lineageHeadShas.length > 1) {
    reasons.push("repair-lineage-history-required");
  }
  const derivedRepairAttempt = consumedAttempts + 1;
  let repairAttempt = derivedRepairAttempt;
  if (explicitRepairAttempt !== undefined) {
    invariant(
      Number.isSafeInteger(explicitRepairAttempt) && explicitRepairAttempt >= 1,
      "Explicit repairAttempt must be a positive safe integer",
    );
    invariant(
      explicitRepairAttempt === derivedRepairAttempt,
      "Explicit repairAttempt does not match reachable-lineage processor receipts",
    );
    repairAttempt = explicitRepairAttempt;
  }
  return {
    attemptLimit: 2,
    consumedAttempts,
    currentAttempt: repairAttempt,
    currentHeadPacketIssued,
    historySource: hasLineageHistory
      ? "lineage-checks"
      : "current-checks-fallback",
    issuedAttemptCount,
    lineageCommitCount: lineageHeadShas.length,
    reasons: [...new Set(reasons)],
    receiptCheckCount: seenReceipts.size,
    repairCommitCount: Math.max(0, lineageHeadShas.length - 1),
    repairLineageValid: reasons.length === 0,
    valid: reasons.length === 0,
  };
}

function recommendedDisposition({
  base,
  checks,
  feedback,
  identity,
  mode,
  repairAttempts,
  risk,
}) {
  if (!identity.valid) return "rejected-identity";
  if (!feedback.clear) return "manual-veto-or-feedback";
  if (!base.current) return "waiting-base-update";
  if (!risk.autoApprovable) return "manual-review";
  if (checks.missing.length > 0 || checks.pending.length > 0) {
    return "waiting-checks";
  }
  if (checks.state === "pending") return "waiting-checks";
  if (checks.state === "failing") {
    const retryFailures = checks.failures.filter(
      ({ attribution }) =>
        attribution === "unknown" || attribution === "non-deterministic",
    );
    if (retryFailures.length > 0) return "waiting-retry";
    const branchFailures = checks.failures.filter(
      ({ attribution }) => attribution === "branch",
    );
    if (branchFailures.length === 0) return "waiting-baseline";
    if (!repairAttempts.valid || repairAttempts.currentAttempt > 2) {
      return "manual-repair-escalated";
    }
    return "repair-required";
  }
  if (!identity.automaticAuthority) return "manual-review";
  if (mode === "merge") return "merge-candidate";
  if (mode === "assist") return "ready-for-approval";
  return "would-merge";
}

export function createDependabotRepairPacket(evaluation) {
  if (evaluation.mode === "observe") return null;
  if (
    evaluation.identity?.valid !== true ||
    evaluation.feedback?.clear !== true ||
    evaluation.feedback?.unrepliedThreads > 0 ||
    evaluation.base?.current !== true ||
    evaluation.repairAttempts?.valid !== true ||
    evaluation.repairAttempt > 2 ||
    evaluation.checks.missing.length > 0 ||
    evaluation.checks.pending.length > 0 ||
    evaluation.checks.failures.some(
      ({ attribution }) =>
        attribution === "unknown" || attribution === "non-deterministic",
    )
  ) {
    return null;
  }
  const branchFailures = evaluation.checks.failures
    .filter(({ attribution }) => attribution === "branch")
    .map(({ attribution, id, name }) => {
      const result = evaluation.checks.policy.find(
        (policyResult) => policyResult.id === id,
      );
      return {
        attribution,
        detailsUrl: result?.check?.detailsUrl ?? null,
        id,
        name,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (branchFailures.length === 0) return null;
  const isAction = evaluation.risk.packageEcosystem === "github-actions";
  return {
    attemptLimit: 2,
    attemptNumber: evaluation.repairAttempt,
    automatic:
      evaluation.risk.autoApprovable &&
      evaluation.identity?.automaticAuthority === true,
    baseRef: evaluation.baseRef,
    baseSha: evaluation.baseSha,
    changedPaths: evaluation.changedPaths,
    dependencyGroup: evaluation.dependencyGroup,
    dependencyNames: evaluation.risk.dependencyNames,
    escalation: "manual-review",
    failures: branchFailures,
    forbiddenPaths: isAction
      ? [
          ".github/dependabot.yml",
          ".github/CODEOWNERS",
          "docs/vercel-deployments.md",
          "scripts/vercel-main-*.mjs",
        ]
      : [
          ".github/workflows/**",
          ".github/actions/**",
          ".github/dependabot.yml",
          ".github/CODEOWNERS",
          "docs/vercel-deployments.md",
          "scripts/vercel-main-*.mjs",
        ],
    headSha: evaluation.headSha,
    mode: evaluation.mode,
    packageEcosystem: evaluation.risk.packageEcosystem,
    permittedPaths: isAction
      ? [
          ".github/workflows/**",
          ".github/actions/**",
          "scripts/check-github-action-pins.test.mjs",
          "scripts/fixtures/action-pins/**",
        ]
      : [
          "package.json",
          "pnpm-lock.yaml",
          "pnpm-workspace.yaml",
          "apps/**",
          "packages/**",
          "patches/**",
        ],
    pullRequestNumber: evaluation.pullRequestNumber,
    repository: evaluation.repository,
    requiredGateIds: CHECK_POLICY_DEFINITIONS.map(({ id }) => id),
    requireExactHead: true,
    requireHumanApproval:
      !evaluation.risk.autoApprovable ||
      evaluation.identity?.automaticAuthority !== true,
    riskTier: evaluation.risk.tier,
    schema: DEPENDABOT_REPAIR_PACKET_SCHEMA,
    updateType: evaluation.risk.updateType,
    validationCommands: isAction
      ? ["pnpm ci:action-pins:test", "pnpm quality:budgets:test"]
      : [
          "pnpm install --frozen-lockfile",
          "pnpm quality:budgets:test",
          "pnpm quality:coverage",
          "pnpm build",
          "pnpm quality:bundle:check",
        ],
  };
}

export function evaluateDependabotPullRequest(snapshot, options = {}) {
  const repository = repositoryName(options.repository ?? snapshot.repository);
  const mode = normalizeProcessorMode(options.mode ?? snapshot.mode);
  const pullRequest = normalizePullRequest(snapshot.pullRequest ?? snapshot);
  const expectedHeadSha =
    snapshot.expectedHeadSha ?? snapshot.headSha ?? pullRequest.headSha;
  const parsedMetadata = parseDependabotMetadata({
    body: pullRequest.body,
    files: pullRequest.files,
    headRef: pullRequest.headRef,
  });
  const metadata = snapshot.metadata?.immutableEvidence
    ? { ...snapshot.metadata }
    : {
        ...parsedMetadata,
        ...(snapshot.metadata ?? {}),
      };
  if (metadata.dependencyNames === undefined) {
    metadata.dependencyNames = parsedMetadata.dependencyNames;
  }
  const repairAttempts = evaluateRepairAttemptGate({
    checks: snapshot.checks ?? [],
    commits: snapshot.commits ?? [],
    explicitRepairAttempt: snapshot.repairAttempt,
    headSha: pullRequest.headSha,
    pullRequestNumber: pullRequest.number,
    repairHistoryChecks: snapshot.repairHistoryChecks,
  });
  const structuralIdentity = validateDependabotPullRequestIdentity({
    commits: snapshot.commits ?? [],
    expectedHeadSha,
    metadata,
    pullRequest: snapshot.pullRequest ?? snapshot,
    repairAttempts,
    repository,
  });
  const risk = classifyDependabotRisk(metadata);
  const base = evaluateCurrentBaseGate({
    ancestry: snapshot.baseAncestry,
    baselineSha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
    pullRequest,
  });
  const checks = SHA_PATTERN.test(pullRequest.headSha ?? "")
    ? evaluateDependabotChecks({
        baselineChecks:
          snapshot.baseline?.checks ?? snapshot.baselineChecks ?? [],
        baselineSha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
        checks: snapshot.checks ?? [],
        headSha: pullRequest.headSha,
        plannerDecisions:
          snapshot.plannerDecisions ??
          derivePlannerDecisions(pullRequest.files),
        pullRequestNumber: pullRequest.number,
        repository,
      })
    : {
        baselineSha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
        failures: [],
        headSha: pullRequest.headSha,
        missing: CHECK_POLICY_DEFINITIONS.map(({ id }) => id),
        pending: [],
        policy: [],
        state: "pending",
      };
  const feedback = evaluateFeedbackGate({
    feedback: snapshot.feedback,
    pullRequest: snapshot.pullRequest ?? snapshot,
  });
  const identity = feedback.forcePushed
    ? {
        ...structuralIdentity,
        automaticAuthority: false,
        automaticAuthorityReasons: ["pull-request-history-force-pushed"],
      }
    : structuralIdentity;
  const disposition = recommendedDisposition({
    base,
    checks,
    feedback,
    identity,
    mode,
    repairAttempts,
    risk,
  });
  const evaluation = {
    base,
    baseRef: pullRequest.baseRef,
    baseSha: pullRequest.baseSha,
    changedPaths: pullRequest.files
      .map((file) => (typeof file === "string" ? file : file?.filename))
      .filter(Boolean)
      .sort(),
    checks,
    disposition,
    feedback,
    headSha: pullRequest.headSha,
    identity,
    dependencyGroup: metadata.dependencyGroup ?? null,
    mode,
    pullRequestNumber: pullRequest.number,
    repository,
    repairAttempt: repairAttempts.currentAttempt,
    repairAttempts,
    risk,
    schema: DEPENDABOT_PROCESSOR_SCHEMA,
  };
  return {
    ...evaluation,
    repairPacket: createDependabotRepairPacket(evaluation),
  };
}

function summarizeEvaluations(evaluations) {
  const byDisposition = {};
  for (const evaluation of evaluations) {
    byDisposition[evaluation.disposition] =
      (byDisposition[evaluation.disposition] ?? 0) + 1;
  }
  return {
    byDisposition,
    mergeCandidates: evaluations.filter(
      ({ disposition }) => disposition === "merge-candidate",
    ).length,
    total: evaluations.length,
  };
}

function outstandingAutoMergeState(input, evaluations) {
  const explicit = input.outstandingAutoMergeRequests;
  const requests = Array.isArray(explicit)
    ? explicit
    : evaluations
        .filter(({ feedback }) => feedback.autoMergeEnabled)
        .map(({ headSha, pullRequestNumber: number }) => ({
          headSha,
          nodeId: null,
          pullRequestNumber: number,
        }));
  const normalized = [];
  const reasons = [];
  if (explicit !== undefined && !Array.isArray(explicit)) {
    reasons.push("outstanding-auto-merge-list-malformed");
  }
  for (const request of requests) {
    const number = Number(request?.pullRequestNumber ?? request?.number);
    const headSha = request?.headSha;
    const nodeId = request?.nodeId ?? request?.pullRequestNodeId ?? null;
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !SHA_PATTERN.test(headSha ?? "") ||
      (Array.isArray(explicit) &&
        (typeof nodeId !== "string" ||
          nodeId.length === 0 ||
          nodeId.length > 512 ||
          /\s/.test(nodeId)))
    ) {
      reasons.push("outstanding-auto-merge-request-malformed");
      continue;
    }
    normalized.push({ headSha, nodeId, pullRequestNumber: number });
  }
  const unique = new Set(
    normalized.map(
      ({ headSha, pullRequestNumber: number }) => `${number}:${headSha}`,
    ),
  );
  if (normalized.length > 1 || unique.size !== normalized.length) {
    reasons.push("multiple-outstanding-auto-merge-requests");
  }
  return {
    ambiguous: reasons.length > 0,
    reasons: [...new Set(reasons)],
    requests: normalized,
  };
}

export function evaluateDependabotSweep(input) {
  const repository = repositoryName(input.repository);
  const mode = normalizeProcessorMode(input.mode);
  const evaluations = (input.pullRequests ?? [])
    .map((snapshot) =>
      evaluateDependabotPullRequest(snapshot, { mode, repository }),
    )
    .sort((left, right) => left.pullRequestNumber - right.pullRequestNumber);
  const eligible = evaluations.filter(
    ({ disposition }) => disposition === "merge-candidate",
  );
  const baselineSnapshots = (input.pullRequests ?? []).map((snapshot) => ({
    checks: snapshot.baseline?.checks ?? snapshot.baselineChecks ?? [],
    sha: snapshot.baseline?.sha ?? snapshot.baselineSha ?? null,
  }));
  const outstandingAutoMerge = outstandingAutoMergeState(input, evaluations);
  const baselineShas = [
    ...new Set(baselineSnapshots.map(({ sha }) => sha).filter(Boolean)),
  ];
  let serialization = {
    check: null,
    currentMainSha: baselineShas[0] ?? null,
    outstandingAutoMerge,
    ready: false,
    reason:
      baselineShas.length === 1
        ? "post-merge-receipt-missing"
        : "current-main-baseline-ambiguous",
  };
  if (baselineShas.length === 1) {
    const currentMainSha = baselineShas[0];
    const matchingSnapshots = baselineSnapshots.filter(
      ({ sha }) => sha === currentMainSha,
    );
    const receipt = selectLatestExactHeadCheck(
      matchingSnapshots.flatMap(({ checks }) => checks),
      currentMainSha,
      POST_MERGE_CHECK_DEFINITION,
    );
    const source = trustedCheckSource(
      receipt,
      currentMainSha,
      POST_MERGE_CHECK_DEFINITION,
      repository,
    );
    const ready = source.trusted && resultState(receipt) === "passing";
    serialization = {
      check: receipt
        ? {
            conclusion: receipt.conclusion,
            headSha: receipt.headSha,
            name: receipt.name,
            runAttempt: receipt.runAttempt,
            runId: receipt.runId,
          }
        : null,
      currentMainSha,
      outstandingAutoMerge,
      ready,
      reason: ready
        ? "exact-main-post-merge-receipt-passed"
        : source.trusted
          ? "post-merge-receipt-not-passing"
          : source.reason,
    };
  }
  let eligibleForLane = eligible;
  let outstandingLaneBlocked = false;
  if (outstandingAutoMerge.ambiguous) {
    serialization = {
      ...serialization,
      outstandingAutoMerge,
      ready: false,
      reason: "outstanding-auto-merge-ambiguous",
    };
    eligibleForLane = [];
    outstandingLaneBlocked = true;
  } else if (outstandingAutoMerge.requests.length === 1) {
    const [request] = outstandingAutoMerge.requests;
    const matching = eligible.find(
      ({ headSha, pullRequestNumber: number }) =>
        number === request.pullRequestNumber && headSha === request.headSha,
    );
    serialization = {
      ...serialization,
      outstandingAutoMerge,
      outstandingPullRequestNumber: request.pullRequestNumber,
    };
    if (matching) {
      eligibleForLane = [matching];
      if (serialization.ready) {
        serialization.reason = "exact-candidate-auto-merge-reentry";
      }
    } else {
      eligibleForLane = [];
      serialization.ready = false;
      serialization.reason = "outstanding-auto-merge-request";
      outstandingLaneBlocked = true;
    }
  }
  const mergeCandidate =
    serialization.ready && eligibleForLane[0]
      ? {
          headSha: eligibleForLane[0].headSha,
          pullRequestNumber: eligibleForLane[0].pullRequestNumber,
        }
      : null;
  if (!serialization.ready) {
    for (const evaluation of eligible) {
      evaluation.disposition = outstandingLaneBlocked
        ? "waiting-merge-serialization"
        : "waiting-post-merge-verification";
    }
  } else {
    for (const evaluation of eligible.filter(
      ({ headSha, pullRequestNumber: number }) =>
        number !== mergeCandidate?.pullRequestNumber ||
        headSha !== mergeCandidate?.headSha,
    )) {
      evaluation.disposition = "waiting-merge-serialization";
    }
  }
  return {
    evaluations,
    mergeCandidate,
    mode,
    repository,
    schema: DEPENDABOT_PROCESSOR_SCHEMA,
    serialization,
    summary: summarizeEvaluations(evaluations),
  };
}

function vercelOutcomeFromEvidence(vercel) {
  return (
    vercel?.outcome ??
    vercel?.terminalOutcome ??
    vercel?.terminalReceipt?.outcome ??
    vercel?.receipt?.outcome ??
    null
  );
}

function vercelShaFromEvidence(vercel) {
  return (
    vercel?.deploySha ??
    vercel?.sha ??
    vercel?.terminalReceipt?.deploySha ??
    vercel?.terminalReceipt?.release?.sha ??
    vercel?.receipt?.deploySha ??
    null
  );
}

function noAffectedTargets(vercel) {
  const targets =
    vercel?.affectedTargets ??
    vercel?.plan?.affectedTargets ??
    vercel?.terminalReceipt?.affectedTargets;
  return (
    vercel?.affected === false ||
    vercel?.affectedTargetCount === 0 ||
    (Array.isArray(targets) && targets.length === 0)
  );
}

export function verifyPostMergeOutcome({
  expectedMergeSha,
  mainChecks = [],
  mergeSha,
  repository,
  vercel,
}) {
  const reasons = [];
  let verifiedRepository = repository;
  try {
    verifiedRepository = repositoryName(repository);
  } catch {
    reasons.push("invalid-repository");
  }
  let expectedSha;
  try {
    expectedSha = exactSha(expectedMergeSha, "Expected merge SHA");
  } catch {
    expectedSha = expectedMergeSha;
    reasons.push("invalid-expected-merge-sha");
  }
  if (!SHA_PATTERN.test(mergeSha ?? "")) {
    reasons.push("invalid-observed-merge-sha");
  } else if (mergeSha !== expectedSha) {
    reasons.push("merge-sha-mismatch");
  }

  let ciCheck = null;
  if (SHA_PATTERN.test(expectedSha ?? "")) {
    ciCheck = selectLatestExactHeadCheck(
      mainChecks,
      expectedSha,
      CHECK_POLICY_DEFINITIONS.find(({ id }) => id === "ci"),
    );
  }
  if (resultState(ciCheck) !== "passing") {
    reasons.push("main-ci-not-successful-for-exact-merge-sha");
  } else if (
    !trustedCheckSource(
      ciCheck,
      expectedSha,
      CHECK_POLICY_DEFINITIONS.find(({ id }) => id === "ci"),
      verifiedRepository,
    ).trusted
  ) {
    reasons.push("main-ci-source-not-trusted");
  }

  const vercelOutcome = vercelOutcomeFromEvidence(vercel);
  const vercelSha = vercelShaFromEvidence(vercel);
  if (vercelSha !== expectedSha) reasons.push("vercel-deploy-sha-mismatch");
  if (vercel?.terminal !== true || vercel?.status === "in_progress") {
    reasons.push("vercel-outcome-is-not-terminal");
  }
  if (vercelOutcome === "recovered") {
    reasons.push("vercel-release-was-recovered");
  } else if (String(vercelOutcome).includes("superseded")) {
    reasons.push("vercel-release-was-superseded");
  } else if (
    vercelOutcome === "active-committed" ||
    vercelOutcome === "current-release-verified"
  ) {
    // These are the only affected-release success outcomes.
  } else if (vercelOutcome === "no-target" && noAffectedTargets(vercel)) {
    // An exact no-target plan is a terminal success without a deployment.
  } else {
    reasons.push("vercel-terminal-outcome-not-accepted");
  }

  return {
    ci: {
      conclusion: ciCheck?.conclusion ?? null,
      name: ciCheck?.name ?? null,
      sha: ciCheck?.headSha ?? null,
    },
    expectedMergeSha,
    mergeSha,
    reasons,
    repository: verifiedRepository,
    schema: DEPENDABOT_POST_MERGE_SCHEMA,
    vercel: {
      outcome: vercelOutcome,
      sha: vercelSha,
    },
    verified: reasons.length === 0,
  };
}

function splitRepository(repository) {
  const [owner, name] = repositoryName(repository).split("/");
  return { name, owner };
}

export function requireStablePullRequestSnapshot(initial, final, number) {
  const identity = (pullRequest) => {
    const normalized = normalizePullRequest(pullRequest);
    const draft = pullRequest?.draft ?? pullRequest?.isDraft;
    return {
      authorLogin: normalized.authorLogin,
      baseRef: normalized.baseRef,
      baseRepository: normalized.baseRepository,
      baseSha: normalized.baseSha,
      headRef: normalized.headRef,
      headRepository: normalized.headRepository,
      headSha: normalized.headSha,
      isCrossRepository: normalized.isCrossRepository,
      isDraft: typeof draft === "boolean" ? draft : null,
      nodeId: normalized.nodeId,
      number: normalized.number,
      state: normalized.state,
      updatedAt: pullRequest?.updated_at ?? pullRequest?.updatedAt ?? null,
    };
  };
  const initialIdentity = identity(initial);
  const finalIdentity = identity(final);
  const complete =
    Number.isSafeInteger(initialIdentity.number) &&
    initialIdentity.number > 0 &&
    typeof initialIdentity.nodeId === "string" &&
    initialIdentity.nodeId.length > 0 &&
    initialIdentity.state.length > 0 &&
    initialIdentity.authorLogin.length > 0 &&
    initialIdentity.isDraft !== null &&
    typeof initialIdentity.isCrossRepository === "boolean" &&
    typeof initialIdentity.updatedAt === "string" &&
    initialIdentity.updatedAt.length > 0 &&
    typeof initialIdentity.baseRef === "string" &&
    initialIdentity.baseRef.length > 0 &&
    typeof initialIdentity.baseRepository === "string" &&
    initialIdentity.baseRepository.length > 0 &&
    SHA_PATTERN.test(initialIdentity.baseSha ?? "") &&
    typeof initialIdentity.headRef === "string" &&
    initialIdentity.headRef.length > 0 &&
    typeof initialIdentity.headRepository === "string" &&
    initialIdentity.headRepository.length > 0 &&
    SHA_PATTERN.test(initialIdentity.headSha ?? "");
  const stable =
    complete && stableJson(initialIdentity) === stableJson(finalIdentity);
  invariant(
    stable,
    `PR #${number} changed while its exact-head snapshot was collected`,
  );
}

function requirePostApprovalPullRequestSnapshot(initial, final, number) {
  const initialUpdatedAt = initial?.updated_at ?? initial?.updatedAt;
  const finalUpdatedAt = final?.updated_at ?? final?.updatedAt;
  const initialTimestamp = Date.parse(initialUpdatedAt ?? "");
  const finalTimestamp = Date.parse(finalUpdatedAt ?? "");
  invariant(
    Number.isFinite(initialTimestamp) &&
      Number.isFinite(finalTimestamp) &&
      finalTimestamp >= initialTimestamp,
    `PR #${number} update token regressed after approval`,
  );
  requireStablePullRequestSnapshot(
    { ...initial, updatedAt: finalUpdatedAt, updated_at: finalUpdatedAt },
    final,
    number,
  );
}

export function requireStableFeedbackSnapshot(initial, final, number) {
  const stable =
    typeof initial?.digest === "string" &&
    initial.digest.length === 64 &&
    initial.digest === final?.digest &&
    typeof initial?.updatedAt === "string" &&
    initial.updatedAt === final?.updatedAt &&
    initial.headSha === final?.headSha;
  invariant(
    stable,
    `PR #${number} feedback changed while its exact-head snapshot was collected`,
  );
}

function linkHasNext(link) {
  return /<[^>]+>;\s*rel="next"/.test(link ?? "");
}

export function createLiveGitHubAdapter({
  apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com",
  fetchImpl = globalThis.fetch,
  graphqlUrl = process.env.GITHUB_GRAPHQL_URL ??
    "https://api.github.com/graphql",
  token = process.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN,
  mergeToken = process.env.DEPENDABOT_PROCESSOR_MERGE_TOKEN,
  execFileImpl = promisify(execFileCallback),
} = {}) {
  invariant(
    typeof fetchImpl === "function",
    "A fetch implementation is required",
  );
  invariant(
    typeof token === "string" && token.length > 0,
    "GitHub token is required",
  );

  const requireMergeCredential = () => {
    invariant(
      typeof mergeToken === "string" && mergeToken.length > 0,
      "A dedicated Dependabot processor merge token is required for merge mode",
    );
    invariant(
      mergeToken !== token,
      "The Dependabot processor merge token must be distinct from the workflow GitHub token",
    );
    return mergeToken;
  };

  const request = async (method, path, { body, accept } = {}) => {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: accept ?? "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "mento-dependabot-processor",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      method,
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(
        `GitHub ${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
      );
      error.status = response.status;
      throw error;
    }
    return {
      data: response.status === 204 ? null : await response.json(),
      link: response.headers.get("link"),
    };
  };

  const paginate = async (path) => {
    const items = [];
    let page = 1;
    while (page <= 20) {
      const separator = path.includes("?") ? "&" : "?";
      const response = await request(
        "GET",
        `${path}${separator}per_page=100&page=${page}`,
      );
      invariant(Array.isArray(response.data), `Expected a list from ${path}`);
      items.push(...response.data);
      if (response.data.length < 100 && !linkHasNext(response.link)) break;
      page += 1;
    }
    invariant(page <= 20, `GitHub pagination limit exceeded for ${path}`);
    return items;
  };

  const graphql = async (query, variables) => {
    const response = await fetchImpl(graphqlUrl, {
      body: JSON.stringify({ query, variables }),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "mento-dependabot-processor",
      },
      method: "POST",
    });
    const payload = await response.json();
    if (!response.ok || payload.errors) {
      throw new Error(
        `GitHub GraphQL request failed: ${JSON.stringify(payload.errors ?? payload).slice(0, 1_000)}`,
      );
    }
    return payload.data;
  };

  const workflowRunCache = new Map();
  const workflowRunSource = async (repository, url) => {
    const match = /\/actions\/runs\/([1-9][0-9]*)/.exec(String(url ?? ""));
    if (!match) return null;
    const runId = Number(match[1]);
    const key = `${repository}:${runId}`;
    if (!workflowRunCache.has(key)) {
      workflowRunCache.set(
        key,
        request("GET", `/repos/${repository}/actions/runs/${runId}`).then(
          ({ data }) => ({
            runDisplayTitle: data.display_title,
            runHeadBranch: data.head_branch,
            sourceRepository: data.repository?.full_name,
            runAttempt: data.run_attempt,
            runHeadSha: data.head_sha,
            runId: data.id,
            workflowEvent: data.event,
            workflowPath: String(data.path ?? "").replace(/@.*$/, ""),
          }),
        ),
      );
    }
    return workflowRunCache.get(key);
  };

  const getChecks = async (repository, sha) => {
    exactSha(sha);
    const checkRuns = [];
    let page = 1;
    while (page <= 20) {
      const response = await request(
        "GET",
        `/repos/${repository}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`,
      );
      const runs = response.data?.check_runs;
      invariant(Array.isArray(runs), "GitHub check-runs response is invalid");
      checkRuns.push(
        ...(await Promise.all(
          runs.map(async (run) => ({
            ...(await workflowRunSource(repository, run.details_url)),
            appId: run.app?.id,
            completedAt: run.completed_at,
            conclusion: run.conclusion,
            detailsUrl: run.details_url,
            externalId: run.external_id,
            headSha: run.head_sha,
            id: run.id,
            name: run.name,
            startedAt: run.started_at,
            status: run.status,
            kind: "check",
          })),
        )),
      );
      if (runs.length < 100) break;
      page += 1;
    }
    invariant(page <= 20, "GitHub check-run pagination limit exceeded");
    const statuses = await paginate(
      `/repos/${repository}/commits/${sha}/statuses`,
    );
    return [
      ...checkRuns,
      ...(await Promise.all(
        statuses.map(async (status) => ({
          ...(await workflowRunSource(repository, status.target_url)),
          creatorLogin: status.creator?.login,
          conclusion: status.state,
          description: status.description,
          detailsUrl: status.target_url,
          headSha: sha,
          id: status.id,
          name: status.context,
          kind: "status",
          status: PENDING_STATUSES.has(status.state)
            ? status.state
            : "completed",
          updatedAt: status.updated_at,
        })),
      )),
    ];
  };

  const getProcessorChecks = async (repository, sha) => {
    exactSha(sha);
    const checkRuns = [];
    let page = 1;
    while (page <= 20) {
      const response = await request(
        "GET",
        `/repos/${repository}/commits/${sha}/check-runs?check_name=${encodeURIComponent(PROCESSOR_CHECK_NAME)}&filter=all&per_page=100&page=${page}`,
      );
      const runs = response.data?.check_runs;
      invariant(
        Array.isArray(runs),
        "GitHub processor check-runs response is invalid",
      );
      checkRuns.push(
        ...runs.map((run) => ({
          appId: run.app?.id,
          completedAt: run.completed_at,
          conclusion: run.conclusion,
          externalId: run.external_id,
          headSha: run.head_sha,
          id: run.id,
          kind: "check",
          name: run.name,
          startedAt: run.started_at,
          status: run.status,
        })),
      );
      if (runs.length < 100) break;
      page += 1;
    }
    invariant(
      page <= 20,
      "GitHub processor check-run pagination limit exceeded",
    );
    return checkRuns;
  };

  const getFeedback = async (repository, number) => {
    const { name, owner } = splitRepository(repository);
    const query = `
      query DependabotProcessorFeedback($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            id
            headRefOid
            updatedAt
            isDraft
            mergeStateStatus
            reviewDecision
            autoMergeRequest { enabledAt }
            reviewThreads(first: 100, after: $after) {
              nodes {
                id
                isResolved
                isOutdated
                comments(first: 100) {
                  totalCount
                  nodes {
                    databaseId
                    author { __typename login }
                    authorAssociation
                    body
                    createdAt
                    replyTo { databaseId }
                    pullRequestReview {
                      databaseId
                      commit { oid }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `;
    let after = null;
    let pullRequest = null;
    const threads = [];
    let threadPagesTruncated = false;
    let threadQueryHead = null;
    let threadQueryUpdatedAt = null;
    for (let page = 0; page < REVIEW_THREAD_PAGE_LIMIT; page += 1) {
      const data = await graphql(query, { after, name, number, owner });
      pullRequest = data.repository?.pullRequest;
      invariant(pullRequest, `PR #${number} was not found`);
      if (threadQueryHead === null) {
        threadQueryHead = pullRequest.headRefOid;
        threadQueryUpdatedAt = pullRequest.updatedAt;
      } else {
        invariant(
          pullRequest.headRefOid === threadQueryHead &&
            pullRequest.updatedAt === threadQueryUpdatedAt,
          `PR #${number} feedback changed during thread pagination`,
        );
      }
      invariant(
        Array.isArray(pullRequest.reviewThreads?.nodes),
        "GitHub review thread response is invalid",
      );
      threads.push(
        ...pullRequest.reviewThreads.nodes.map((thread) => {
          const comments = thread?.comments?.nodes;
          invariant(
            Array.isArray(comments),
            "GitHub review thread comments response is invalid",
          );
          const totalCount = Number(thread.comments.totalCount);
          const commentsTruncated =
            !Number.isInteger(totalCount) ||
            totalCount < 0 ||
            totalCount > REVIEW_THREAD_COMMENT_LIMIT ||
            totalCount !== comments.length ||
            thread.comments.pageInfo?.hasNextPage === true;
          return {
            comments: comments.map((comment) => ({
              actor: {
                association: comment.authorAssociation,
                login: comment.author?.login,
                type: comment.author?.__typename,
              },
              body: comment.body,
              createdAt: comment.createdAt,
              id: comment.databaseId,
              replyToId: comment.replyTo?.databaseId ?? null,
              reviewCommitSha: comment.pullRequestReview?.commit?.oid ?? null,
              reviewId: comment.pullRequestReview?.databaseId ?? null,
            })),
            commentsTruncated,
            id: thread.id,
            outdated: thread.isOutdated === true,
            resolved: thread.isResolved === true,
          };
        }),
      );
      if (!pullRequest.reviewThreads.pageInfo.hasNextPage) break;
      if (page === REVIEW_THREAD_PAGE_LIMIT - 1) {
        threadPagesTruncated = true;
        break;
      }
      after = pullRequest.reviewThreads.pageInfo.endCursor;
    }
    const [rawReviews, rawIssueComments] = await Promise.all([
      paginate(`/repos/${repository}/pulls/${number}/reviews`),
      paginate(`/repos/${repository}/issues/${number}/comments`),
    ]);
    const reviews = rawReviews.map((review) => ({
      actor: {
        association: review.author_association,
        login: review.user?.login,
        type: review.user?.type,
      },
      body: review.body,
      commitSha: review.commit_id,
      id: review.id,
      state: review.state,
    }));
    const issueComments = rawIssueComments.map((comment) => ({
      actor: {
        association: comment.author_association,
        login: comment.user?.login,
        type: comment.user?.type,
      },
      body: comment.body,
      createdAt: comment.created_at,
      id: comment.id,
      updatedAt: comment.updated_at,
    }));
    const classification = classifyDependabotFeedback({
      headSha: pullRequest.headRefOid,
      issueComments,
      reviews,
      threadPagesTruncated,
      threads,
    });
    const digest = feedbackBodyDigest(
      stableJson({
        autoMergeEnabled: Boolean(pullRequest.autoMergeRequest),
        headSha: pullRequest.headRefOid,
        issueComments: issueComments.map((comment) => ({
          ...comment,
          body: feedbackBodyDigest(comment.body),
        })),
        reviewDecision: pullRequest.reviewDecision,
        reviews: reviews.map((review) => ({
          ...review,
          body: feedbackBodyDigest(review.body),
        })),
        threadPagesTruncated,
        threads: threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((comment) => ({
            ...comment,
            body: feedbackBodyDigest(comment.body),
          })),
        })),
        updatedAt: pullRequest.updatedAt,
      }),
    );
    return {
      ...classification,
      autoMergeEnabled: Boolean(pullRequest.autoMergeRequest),
      digest,
      headSha: pullRequest.headRefOid,
      isDraft: pullRequest.isDraft,
      mergeStateStatus: pullRequest.mergeStateStatus,
      nodeId: pullRequest.id,
      reviewDecision: pullRequest.reviewDecision,
      updatedAt: pullRequest.updatedAt,
    };
  };

  const getPullRequest = async (repository, number) => {
    const response = await request(
      "GET",
      `/repos/${repository}/pulls/${number}`,
    );
    return response.data;
  };

  const getCurrentBaseAncestry = async ({ baseRef, headSha, repository }) => {
    const currentBase = await request(
      "GET",
      `/repos/${repository}/commits/${encodeURIComponent(baseRef)}`,
    );
    const currentBaseSha = exactSha(currentBase.data.sha, "Current base SHA");
    const comparison = await request(
      "GET",
      `/repos/${repository}/compare/${currentBaseSha}...${exactSha(headSha, "Compared head SHA")}`,
    );
    const aheadBy = Number(comparison.data?.ahead_by);
    const behindBy = Number(comparison.data?.behind_by);
    const baseCommitSha = comparison.data?.base_commit?.sha ?? null;
    const mergeBaseSha = comparison.data?.merge_base_commit?.sha ?? null;
    const status = String(comparison.data?.status ?? "").toLowerCase();
    invariant(
      Number.isSafeInteger(aheadBy) &&
        aheadBy >= 0 &&
        Number.isSafeInteger(behindBy) &&
        behindBy >= 0 &&
        SHA_PATTERN.test(baseCommitSha ?? "") &&
        SHA_PATTERN.test(mergeBaseSha ?? "") &&
        new Set(["ahead", "behind", "diverged", "identical"]).has(status),
      "GitHub base comparison response is invalid",
    );
    return {
      aheadBy,
      baseCommitSha,
      behindBy,
      currentBaseIsAncestor:
        baseCommitSha === currentBaseSha &&
        mergeBaseSha === currentBaseSha &&
        behindBy === 0 &&
        new Set(["ahead", "identical"]).has(status),
      currentBaseSha,
      headSha,
      mergeBaseSha,
      status,
    };
  };

  const getHumanCloseEvidence = async (repository, number) => {
    const events = await paginate(
      `/repos/${repository}/issues/${number}/events`,
    );
    const actorsForEvent = (eventName) =>
      events
        .filter(
          (event) =>
            event?.event === eventName &&
            normalizeLogin(event?.actor?.login) !== DEPENDABOT_LOGIN,
        )
        .map((event) => normalizeLogin(event?.actor?.login) || "unknown-actor")
        .filter((login, index, logins) => logins.indexOf(login) === index)
        .sort();
    const humanCloseActors = actorsForEvent("closed");
    const humanReopenActors = actorsForEvent("reopened");
    const forcePushEvents = events.filter(
      (event) => event?.event === "head_ref_force_pushed",
    );
    const forcePushActors = [
      ...new Set(
        forcePushEvents.map((event) =>
          (normalizeLogin(event?.actor?.login) || "unknown-actor").slice(
            0,
            100,
          ),
        ),
      ),
    ]
      .sort()
      .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
    const forcePushCommitIds = [
      ...new Set(
        forcePushEvents
          .map((event) => event?.commit_id)
          .filter((commitId) => SHA_PATTERN.test(commitId ?? "")),
      ),
    ]
      .sort()
      .slice(0, DURABLE_EVENT_EVIDENCE_LIMIT);
    return {
      forcePushActors,
      forcePushCommitIds,
      forcePushEventCount: forcePushEvents.length,
      forcePushed: forcePushEvents.length > 0,
      humanCloseActors,
      humanClosed: humanCloseActors.length > 0,
      humanIntervened:
        humanCloseActors.length > 0 || humanReopenActors.length > 0,
      humanReopenActors,
      humanReopened: humanReopenActors.length > 0,
    };
  };

  const listOpenDependabotPullRequests = async (repository) => {
    const pulls = (
      await paginate(`/repos/${repository}/pulls?state=open`)
    ).filter(
      (pullRequest) =>
        normalizeLogin(pullRequest.user?.login) === DEPENDABOT_LOGIN,
    );
    invariant(
      pulls.length <= PROCESSOR_APPROVAL_PULL_LIMIT,
      "Repository-wide processor approval PR limit exceeded",
    );
    const normalized = pulls
      .map((pullRequest) => ({
        headSha: exactSha(
          pullRequest.head?.sha,
          "Repository-wide approval PR head SHA",
        ),
        nodeId: pullRequest.node_id,
        pullRequestNumber: pullRequestNumber(pullRequest.number),
        updatedAt: pullRequest.updated_at,
      }))
      .sort((left, right) => left.pullRequestNumber - right.pullRequestNumber);
    invariant(
      normalized.every(
        ({ nodeId, updatedAt }) =>
          typeof nodeId === "string" &&
          nodeId.length > 0 &&
          typeof updatedAt === "string" &&
          updatedAt.length > 0,
      ) &&
        new Set(normalized.map(({ pullRequestNumber: number }) => number))
          .size === normalized.length,
      "Repository-wide processor approval PR evidence is invalid",
    );
    return normalized;
  };

  const getOutstandingDependabotProcessorApprovals = async (repository) => {
    const initialPullRequests =
      await listOpenDependabotPullRequests(repository);
    const approvals = [];
    const seenReviewIds = new Set();
    for (
      let index = 0;
      index < initialPullRequests.length;
      index += PROCESSOR_APPROVAL_SCAN_CONCURRENCY
    ) {
      const scans = await Promise.all(
        initialPullRequests
          .slice(index, index + PROCESSOR_APPROVAL_SCAN_CONCURRENCY)
          .map(async (summary) => {
            const number = summary.pullRequestNumber;
            const initial = await getPullRequest(repository, number);
            invariant(
              normalizeLogin(initial.user?.login) === DEPENDABOT_LOGIN &&
                initial.state === "open" &&
                initial.node_id === summary.nodeId &&
                initial.head?.sha === summary.headSha &&
                initial.updated_at === summary.updatedAt,
              `PR #${number} changed before repository-wide approval collection`,
            );
            const reviews = await paginate(
              `/repos/${repository}/pulls/${number}/reviews`,
            );
            invariant(
              reviews.length < PROCESSOR_APPROVAL_REVIEW_LIMIT,
              `PR #${number} processor approval review limit exceeded`,
            );
            const final = await getPullRequest(repository, number);
            requireStablePullRequestSnapshot(initial, final, number);
            return { headSha: final.head.sha, number, reviews };
          }),
      );
      for (const { headSha, number, reviews } of scans) {
        for (const review of reviews) {
          const reviewId = review?.id;
          const state = String(review?.state ?? "").toUpperCase();
          const actorLogin = normalizeFeedbackLogin(review?.user?.login);
          const actorType = review?.user?.type;
          invariant(
            Number.isSafeInteger(reviewId) &&
              reviewId > 0 &&
              !seenReviewIds.has(reviewId) &&
              actorLogin.length > 0 &&
              actorLogin.length <= 100 &&
              (actorType === "Bot" || actorType === "User") &&
              SHA_PATTERN.test(review?.commit_id ?? "") &&
              PULL_REQUEST_REVIEW_STATES.has(state) &&
              (review?.body === null || typeof review?.body === "string"),
            `PR #${number} review evidence is malformed`,
          );
          seenReviewIds.add(reviewId);
          const body = review.body ?? "";
          const approved = state === "APPROVED";
          const claimsProcessor = body.includes(DEPENDABOT_PROCESSOR_SCHEMA);
          if (!approved && !claimsProcessor) continue;
          if (approved) {
            invariant(
              actorLogin !== "github-actions" || actorType === "Bot",
              `PR #${number} approved review evidence is malformed`,
            );
          }
          const actionsApproval =
            approved &&
            actorLogin === "github-actions" &&
            review.commit_id === headSha;
          if (!actionsApproval && !claimsProcessor) continue;
          const binding = processorApprovalBinding({
            body,
            commitSha: review?.commit_id,
          });
          invariant(
            body.length <= REVIEW_ENVELOPE_BODY_LIMIT &&
              actorLogin === "github-actions" &&
              actorType === "Bot" &&
              binding !== null &&
              (state === "APPROVED" || state === "DISMISSED"),
            `PR #${number} processor approval evidence is malformed`,
          );
          if (state === "APPROVED" && binding === headSha) {
            approvals.push({
              approvalId: reviewId,
              headSha,
              pullRequestNumber: number,
            });
            invariant(
              approvals.length <= PROCESSOR_APPROVAL_RESULT_LIMIT,
              "Repository-wide processor approval result limit exceeded",
            );
          }
        }
      }
    }
    const finalPullRequests = await listOpenDependabotPullRequests(repository);
    invariant(
      stableJson(initialPullRequests) === stableJson(finalPullRequests),
      "Repository-wide processor approval PR set changed during collection",
    );
    return approvals.sort(
      (left, right) =>
        left.pullRequestNumber - right.pullRequestNumber ||
        left.approvalId - right.approvalId,
    );
  };

  const getOutstandingDependabotAutoMergeRequests = async (repository) => {
    const { name, owner } = splitRepository(repository);
    const query = `
      query DependabotProcessorAutoMergeRequests($owner: String!, $name: String!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequests(states: OPEN, first: 100, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
            nodes {
              id
              number
              headRefOid
              author { login }
              autoMergeRequest {
                enabledAt
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;
    const requests = [];
    let after = null;
    for (let page = 0; page < 20; page += 1) {
      const data = await graphql(query, { after, name, owner });
      const connection = data.repository?.pullRequests;
      invariant(
        Array.isArray(connection?.nodes),
        "GitHub auto-merge request response is invalid",
      );
      for (const pullRequest of connection.nodes) {
        if (
          normalizeLogin(pullRequest.author?.login) === DEPENDABOT_LOGIN &&
          pullRequest.autoMergeRequest
        ) {
          requests.push({
            enabledAt: pullRequest.autoMergeRequest.enabledAt,
            headSha: pullRequest.headRefOid,
            nodeId: pullRequest.id,
            pullRequestNumber: pullRequest.number,
          });
        }
      }
      if (!connection.pageInfo?.hasNextPage) return requests;
      after = connection.pageInfo.endCursor;
      invariant(
        typeof after === "string" && after.length > 0,
        "GitHub auto-merge pagination cursor is invalid",
      );
    }
    throw new Error("GitHub auto-merge request pagination limit exceeded");
  };

  const collectPullRequestSnapshot = async (repository, number) => {
    const raw = await getPullRequest(repository, number);
    const [files, commits, initialFeedback] = await Promise.all([
      paginate(`/repos/${repository}/pulls/${number}/files`),
      paginate(`/repos/${repository}/pulls/${number}/commits`),
      getFeedback(repository, number),
    ]);
    const headSha = exactSha(raw.head.sha, "PR head SHA");
    invariant(
      initialFeedback.headSha === headSha,
      `PR #${number} changed while feedback was collected`,
    );
    const baseAncestry = await getCurrentBaseAncestry({
      baseRef: raw.base.ref,
      headSha,
      repository,
    });
    const baselineSha = baseAncestry.currentBaseSha;
    const commitHeadShas = [
      ...new Set(
        commits.map((commit) => exactSha(commit?.sha, "PR lineage commit SHA")),
      ),
    ];
    const commitsByHeadSha = new Map(
      commits.map((commit) => [commit.sha, commit]),
    );
    const lineageCommits = commitHeadShas.map((commitHeadSha) =>
      commitsByHeadSha.get(commitHeadSha),
    );
    invariant(
      commitHeadShas.length <= REPAIR_LINEAGE_COMMIT_LIMIT,
      "Dependabot repair lineage commit limit exceeded",
    );
    const repairHistoryCheckPages = [];
    const collectRepairHistory = async () => {
      for (
        let index = 0;
        index < commitHeadShas.length;
        index += REPAIR_LINEAGE_CHECK_CONCURRENCY
      ) {
        repairHistoryCheckPages.push(
          ...(await Promise.all(
            commitHeadShas
              .slice(index, index + REPAIR_LINEAGE_CHECK_CONCURRENCY)
              .map((commitHeadSha) =>
                getProcessorChecks(repository, commitHeadSha),
              ),
          )),
        );
      }
    };
    const [checks, baselineChecks] = await Promise.all([
      getChecks(repository, headSha),
      getChecks(repository, baselineSha),
      collectRepairHistory(),
    ]);
    const humanCloseEvidence = await getHumanCloseEvidence(repository, number);
    const feedback = await getFeedback(repository, number);
    requireStableFeedbackSnapshot(initialFeedback, feedback, number);
    const finalRaw = await getPullRequest(repository, number);
    requireStablePullRequestSnapshot(raw, finalRaw, number);
    const pullRequest = {
      author: { login: finalRaw.user?.login },
      base: {
        ref: finalRaw.base.ref,
        repo: { fullName: finalRaw.base.repo?.full_name },
        sha: finalRaw.base.sha,
      },
      body: finalRaw.body ?? "",
      draft: finalRaw.draft,
      files: files.map(({ filename }) => filename),
      head: {
        ref: finalRaw.head.ref,
        repo: { fullName: finalRaw.head.repo?.full_name },
        sha: headSha,
      },
      isCrossRepository:
        finalRaw.head.repo?.full_name !== finalRaw.base.repo?.full_name,
      labels: finalRaw.labels,
      merge_commit_sha: finalRaw.merge_commit_sha,
      merged: finalRaw.merged,
      node_id: feedback.nodeId ?? finalRaw.node_id,
      number: finalRaw.number,
      state: finalRaw.state,
      title: finalRaw.title,
      updated_at: finalRaw.updated_at,
    };
    const metadata = deriveImmutableDependabotMetadata({
      commits: lineageCommits,
      files,
      headRef: pullRequest.head.ref,
      headSha,
    });
    return {
      baseAncestry,
      baseline: { checks: baselineChecks, sha: baselineSha },
      checks,
      commits: lineageCommits.map((commit) => ({
        authorLogin: commit.author?.login,
        committerLogin: commit.committer?.login,
        message: commit.commit?.message,
        sha: commit.sha,
        verified: commit.commit?.verification?.verified === true,
      })),
      expectedHeadSha: headSha,
      feedback: {
        actionableThreadCount: feedback.actionableThreadCount,
        autoMergeEnabled: feedback.autoMergeEnabled,
        blockerCount: feedback.blockerCount,
        blockers: feedback.blockers,
        complete: feedback.complete,
        currentProcessorApprovalCount: feedback.currentProcessorApprovalCount,
        currentProcessorApprovalIds: feedback.currentProcessorApprovalIds,
        digest: feedback.digest,
        dismissedProcessorApprovalCount:
          feedback.dismissedProcessorApprovalCount,
        forcePushActors: humanCloseEvidence.forcePushActors,
        forcePushCommitIds: humanCloseEvidence.forcePushCommitIds,
        forcePushEventCount: humanCloseEvidence.forcePushEventCount,
        forcePushed: humanCloseEvidence.forcePushed,
        humanCloseActors: humanCloseEvidence.humanCloseActors,
        humanClosed: humanCloseEvidence.humanClosed,
        humanIntervened: humanCloseEvidence.humanIntervened,
        humanReopenActors: humanCloseEvidence.humanReopenActors,
        humanReopened: humanCloseEvidence.humanReopened,
        historicalProcessorApprovalCount:
          feedback.historicalProcessorApprovalCount,
        issueCommentCount: feedback.issueCommentCount,
        labels: normalizeLabels(finalRaw.labels),
        maintainerVeto:
          humanCloseEvidence.humanIntervened || humanCloseEvidence.forcePushed,
        reasons: feedback.reasons,
        reviewDecision: feedback.reviewDecision,
        reviewCount: feedback.reviewCount,
        threadCount: feedback.threadCount,
        unresolvedThreads: feedback.unresolvedThreads,
        unrepliedThreads: feedback.unrepliedThreads,
        updatedAt: feedback.updatedAt,
      },
      metadata,
      pullRequest,
      repairHistoryChecks: repairHistoryCheckPages.flat(),
      repository,
    };
  };

  const disablePullRequestAutoMerge = async ({
    headSha,
    nodeId,
    pullRequestNumber: number,
    repository,
  }) => {
    exactSha(headSha);
    pullRequestNumber(number);
    invariant(
      typeof nodeId === "string" &&
        nodeId.length > 0 &&
        nodeId.length <= 512 &&
        !/\s/.test(nodeId),
      "Pull request node ID is required to disable auto-merge",
    );
    const current = await getPullRequest(repository, number);
    invariant(current.state === "open", `PR #${number} is no longer open`);
    invariant(
      current.head?.sha === headSha,
      `PR #${number} head changed before auto-merge disable`,
    );
    invariant(
      current.node_id === nodeId,
      `PR #${number} node changed before auto-merge disable`,
    );
    const globalRequests =
      await getOutstandingDependabotAutoMergeRequests(repository);
    const globalState = outstandingAutoMergeState(
      { outstandingAutoMergeRequests: globalRequests },
      [],
    );
    invariant(
      !globalState.ambiguous &&
        globalState.requests.length === 1 &&
        globalState.requests[0].pullRequestNumber === number &&
        globalState.requests[0].headSha === headSha &&
        globalState.requests[0].nodeId === nodeId,
      `PR #${number} is not the current single repository auto-merge request`,
    );
    const mutation = `
      mutation DependabotProcessorDisableAutoMerge($pullRequestId: ID!) {
        disablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) {
          pullRequest {
            id
            number
            state
            headRefOid
            autoMergeRequest { enabledAt }
          }
        }
      }
    `;
    const data = await graphql(mutation, { pullRequestId: nodeId });
    const disabled = data.disablePullRequestAutoMerge?.pullRequest;
    invariant(
      disabled?.id === nodeId &&
        disabled.number === number &&
        disabled.state === "OPEN" &&
        disabled.headRefOid === headSha &&
        disabled.autoMergeRequest == null,
      `PR #${number} changed while auto-merge was disabled`,
    );
    return { headSha, nodeId, pullRequestNumber: number };
  };

  const dismissPullRequestApproval = async ({
    approvalId,
    pullRequestNumber: number,
    repository,
  }) => {
    pullRequestNumber(number);
    invariant(
      Number.isSafeInteger(approvalId) && approvalId > 0,
      "Processor approval review ID must be a positive safe integer",
    );
    const current = await getPullRequest(repository, number);
    if (String(current.state ?? "").toLowerCase() !== "open") {
      return { dismissed: false, id: approvalId, state: current.state ?? null };
    }
    const reviewPath = `/repos/${repository}/pulls/${number}/reviews/${approvalId}`;
    const requireProcessorReview = (review) => {
      const state = String(review?.state ?? "").toUpperCase();
      const binding = processorApprovalBinding({
        body: review?.body,
        commitSha: review?.commit_id,
      });
      invariant(
        review?.id === approvalId &&
          normalizeFeedbackLogin(review?.user?.login) === "github-actions" &&
          review?.user?.type === "Bot" &&
          binding !== null &&
          (state === "APPROVED" || state === "DISMISSED"),
        `PR #${number} processor approval review is invalid`,
      );
      return state;
    };
    const initialReview = await request("GET", reviewPath);
    if (requireProcessorReview(initialReview.data) === "DISMISSED") {
      return { dismissed: true, id: approvalId, state: "DISMISSED" };
    }
    let response;
    try {
      response = await request("PUT", `${reviewPath}/dismissals`, {
        body: {
          event: "DISMISS",
          message:
            "Dependabot processor withdrew this approval after exact-snapshot revalidation failed.",
        },
      });
    } catch (error) {
      if (error?.status !== 404 && error?.status !== 422) throw error;
      const finalReview = await request("GET", reviewPath);
      invariant(
        requireProcessorReview(finalReview.data) === "DISMISSED",
        `PR #${number} processor approval remained active after dismissal conflict`,
      );
      return { dismissed: true, id: approvalId, state: "DISMISSED" };
    }
    invariant(
      requireProcessorReview(response.data) === "DISMISSED",
      `PR #${number} processor approval dismissal response is invalid`,
    );
    return { dismissed: true, id: approvalId, state: "DISMISSED" };
  };

  return {
    approvePullRequest: async ({
      approvalSnapshot,
      headSha,
      pullRequestNumber: number,
      repository,
    }) => {
      const expected = approvalSnapshot?.pullRequest;
      invariant(expected, `PR #${number} approval snapshot is required`);
      invariant(
        expected.number === number && expected.head?.sha === headSha,
        `PR #${number} approval snapshot does not match the candidate`,
      );
      invariant(
        approvalSnapshot.feedback?.currentProcessorApprovalCount === 0 &&
          Array.isArray(
            approvalSnapshot.feedback?.currentProcessorApprovalIds,
          ) &&
          approvalSnapshot.feedback.currentProcessorApprovalIds.length === 0,
        `PR #${number} already has a current processor approval`,
      );
      const current = await getPullRequest(repository, number);
      requireStablePullRequestSnapshot(expected, current, number);
      invariant(current.state === "open", `PR #${number} is no longer open`);
      const response = await request(
        "POST",
        `/repos/${repository}/pulls/${number}/reviews`,
        {
          body: {
            body: `Approved by ${DEPENDABOT_PROCESSOR_SCHEMA} for exact head ${headSha}.`,
            commit_id: headSha,
            event: "APPROVE",
          },
        },
      );
      const approvalId = response.data?.id;
      invariant(
        Number.isSafeInteger(approvalId) && approvalId > 0,
        `PR #${number} approval response is missing a valid review ID`,
      );
      try {
        invariant(
          String(response.data?.state ?? "").toUpperCase() === "APPROVED" &&
            response.data?.commit_id === headSha,
          `PR #${number} approval response is invalid`,
        );
        const postflight = await getPullRequest(repository, number);
        requirePostApprovalPullRequestSnapshot(expected, postflight, number);
        return {
          id: approvalId,
          state: "APPROVED",
          updatedAt: postflight.updated_at ?? postflight.updatedAt,
        };
      } catch (error) {
        try {
          await dismissPullRequestApproval({
            approvalId,
            pullRequestNumber: number,
            repository,
          });
        } catch (dismissalError) {
          throw new AggregateError(
            [error, dismissalError],
            `PR #${number} approval revalidation and dismissal both failed`,
          );
        }
        throw error;
      }
    },
    collectPullRequestSnapshot,
    disablePullRequestAutoMerge,
    dismissPullRequestApproval,
    mergePullRequest: async ({
      headSha,
      pullRequestNumber: number,
      repository,
    }) => {
      const mergeCredential = requireMergeCredential();
      const initial = await getPullRequest(repository, number);
      invariant(initial.state === "open", `PR #${number} is no longer open`);
      invariant(
        initial.head.sha === headSha,
        `PR #${number} head changed before merge`,
      );
      const [feedback, humanCloseEvidence, baseAncestry] = await Promise.all([
        getFeedback(repository, number),
        getHumanCloseEvidence(repository, number),
        getCurrentBaseAncestry({
          baseRef: initial.base.ref,
          headSha,
          repository,
        }),
      ]);
      const current = await getPullRequest(repository, number);
      requireStablePullRequestSnapshot(initial, current, number);
      invariant(current.state === "open", `PR #${number} is no longer open`);
      invariant(current.head.sha === headSha, `PR #${number} head changed`);
      invariant(
        feedback.headSha === headSha,
        `PR #${number} head changed during merge admission`,
      );
      invariant(
        feedback.complete === true,
        `PR #${number} feedback is incomplete during merge admission`,
      );
      const finalFeedback = {
        ...feedback,
        forcePushActors: humanCloseEvidence.forcePushActors,
        forcePushCommitIds: humanCloseEvidence.forcePushCommitIds,
        forcePushEventCount: humanCloseEvidence.forcePushEventCount,
        forcePushed: humanCloseEvidence.forcePushed,
        humanCloseActors: humanCloseEvidence.humanCloseActors,
        humanClosed: humanCloseEvidence.humanClosed,
        humanIntervened: humanCloseEvidence.humanIntervened,
        humanReopenActors: humanCloseEvidence.humanReopenActors,
        humanReopened: humanCloseEvidence.humanReopened,
        labels: normalizeLabels(current.labels),
        maintainerVeto:
          humanCloseEvidence.humanIntervened || humanCloseEvidence.forcePushed,
      };
      invariant(
        evaluateFeedbackGate({
          feedback: finalFeedback,
          pullRequest: current,
        }).clear,
        `PR #${number} feedback changed during merge admission`,
      );
      const base = evaluateCurrentBaseGate({
        ancestry: baseAncestry,
        baselineSha: baseAncestry.currentBaseSha,
        pullRequest: normalizePullRequest(current),
      });
      invariant(
        base.current,
        `PR #${number} is not based on the current main head`,
      );
      const globalRequests =
        await getOutstandingDependabotAutoMergeRequests(repository);
      const globalState = outstandingAutoMergeState(
        { outstandingAutoMergeRequests: globalRequests },
        [],
      );
      invariant(
        !globalState.ambiguous && globalState.requests.length === 0,
        `Repository auto-merge lane changed during merge admission`,
      );
      const mergeEnvironment = {
        ...process.env,
        GH_TOKEN: mergeCredential,
      };
      delete mergeEnvironment.DEPENDABOT_PROCESSOR_GITHUB_TOKEN;
      delete mergeEnvironment.DEPENDABOT_PROCESSOR_MERGE_TOKEN;
      delete mergeEnvironment.GITHUB_TOKEN;
      const { stdout = "" } = await execFileImpl(
        "gh",
        [
          "pr",
          "merge",
          String(number),
          "--repo",
          repository,
          "--squash",
          "--match-head-commit",
          headSha,
        ],
        {
          env: mergeEnvironment,
          maxBuffer: 1_048_576,
        },
      );
      return { output: stdout.trim() };
    },
    getChecks,
    getFeedback,
    getHumanCloseEvidence,
    getCurrentBaseAncestry,
    getOutstandingDependabotAutoMergeRequests,
    getOutstandingDependabotProcessorApprovals,
    getProcessorChecks,
    getOpenDependabotPullRequestNumbers: async (repository) => {
      const pulls = await paginate(`/repos/${repository}/pulls?state=open`);
      return pulls
        .filter(
          (pullRequest) =>
            normalizeLogin(pullRequest.user?.login) === DEPENDABOT_LOGIN,
        )
        .map(({ number }) => number)
        .sort((left, right) => left - right);
    },
    getPullRequest,
    publishProcessorCheck: async ({
      conclusion,
      headSha,
      mode,
      output,
      pullRequestNumber: number,
      repairAttempt,
      repairPacketIssued,
      repository,
    }) => {
      exactSha(headSha);
      pullRequestNumber(number);
      invariant(
        PROCESSOR_MODES.has(mode),
        "Processor check mode must be explicit",
      );
      invariant(
        Number.isSafeInteger(repairAttempt) && repairAttempt >= 1,
        "Processor check repair attempt must be a positive safe integer",
      );
      invariant(
        mode !== "observe" || repairPacketIssued !== true,
        "Observe processor checks cannot issue repair packets",
      );
      const response = await request(
        "POST",
        `/repos/${repository}/check-runs`,
        {
          body: {
            conclusion,
            external_id: `${DEPENDABOT_PROCESSOR_SCHEMA}:pr=${number}:head=${headSha}:mode=${mode}:repair=${repairAttempt}:packet=${repairPacketIssued === true}`,
            head_sha: headSha,
            name: PROCESSOR_CHECK_NAME,
            output,
            status: "completed",
          },
        },
      );
      return { id: response.data.id, url: response.data.html_url };
    },
    requireMergeCredential,
  };
}

async function collectSweepInput({
  adapter,
  expectedHeadSha = null,
  mode,
  pullRequestNumbers,
  repository,
}) {
  const numbers =
    pullRequestNumbers === "all"
      ? await adapter.getOpenDependabotPullRequestNumbers(repository)
      : pullRequestNumbers;
  invariant(
    typeof adapter.getOutstandingDependabotAutoMergeRequests === "function",
    "Live sweeps require repository-wide auto-merge visibility",
  );
  const outstandingAutoMergeRequests =
    await adapter.getOutstandingDependabotAutoMergeRequests(repository);
  const pullRequests = [];
  if (expectedHeadSha !== null) {
    exactSha(expectedHeadSha, "Expected intake head SHA");
    invariant(
      numbers.length === 1,
      "--expected-head-sha requires exactly one pull request",
    );
  }
  for (const number of numbers) {
    const snapshot = await adapter.collectPullRequestSnapshot(
      repository,
      pullRequestNumber(number),
    );
    if (expectedHeadSha !== null) snapshot.expectedHeadSha = expectedHeadSha;
    pullRequests.push(snapshot);
  }
  return {
    mode,
    outstandingAutoMergeRequests,
    pullRequests,
    repository,
  };
}

async function requireGlobalAutoMergeAdmission({
  adapter,
  allowMatchingCandidate = false,
  candidate,
  repository,
}) {
  invariant(
    typeof adapter.getOutstandingDependabotAutoMergeRequests === "function",
    "Merge mutations require repository-wide auto-merge visibility",
  );
  const requests =
    await adapter.getOutstandingDependabotAutoMergeRequests(repository);
  const state = outstandingAutoMergeState(
    { outstandingAutoMergeRequests: requests },
    [],
  );
  invariant(
    !state.ambiguous,
    `Repository auto-merge state is ambiguous: ${state.reasons.join(",")}`,
  );
  invariant(
    state.requests.length === 0 ||
      (allowMatchingCandidate &&
        state.requests.length === 1 &&
        state.requests[0].pullRequestNumber === candidate.pullRequestNumber &&
        state.requests[0].headSha === candidate.headSha),
    allowMatchingCandidate
      ? `Another Dependabot auto-merge request occupies the repository lane`
      : `The repository auto-merge lane must be empty before mutation`,
  );
  return state.requests;
}

export async function processDependabotSweep({
  adapter,
  input,
  expectedHeadSha = null,
  mode,
  pullRequestNumbers = "all",
  publishChecks = false,
  repository,
}) {
  invariant(adapter, "A GitHub adapter is required for processing");
  let collected =
    input ??
    (await collectSweepInput({
      adapter,
      expectedHeadSha,
      mode: normalizeProcessorMode(mode),
      pullRequestNumbers,
      repository: repositoryName(repository),
    }));
  const mutations = [];
  let evaluation = evaluateDependabotSweep(collected);
  if (
    evaluation.mode === "merge" &&
    evaluation.mergeCandidate &&
    typeof adapter.requireMergeCredential === "function"
  ) {
    adapter.requireMergeCredential();
  }
  const authorityAddingMutationPossible =
    (publishChecks && typeof adapter.publishProcessorCheck === "function") ||
    (evaluation.mode === "merge" && evaluation.mergeCandidate !== null);
  if (authorityAddingMutationPossible) {
    invariant(
      typeof adapter.getOutstandingDependabotProcessorApprovals ===
        "function" &&
        typeof adapter.collectPullRequestSnapshot === "function" &&
        typeof adapter.getOutstandingDependabotAutoMergeRequests === "function",
      "Authority-adding mutations require complete trusted live revalidation adapters",
    );
    const normalizeApprovalInventory = (inventory) => {
      invariant(
        Array.isArray(inventory) &&
          inventory.length <= PROCESSOR_APPROVAL_RESULT_LIMIT,
        "Repository-wide processor approval inventory is incomplete",
      );
      const normalized = inventory.map((approval) => ({
        approvalId: approval?.approvalId,
        headSha: approval?.headSha,
        pullRequestNumber: approval?.pullRequestNumber,
      }));
      invariant(
        normalized.every(
          ({ approvalId, headSha, pullRequestNumber: number }) =>
            Number.isSafeInteger(approvalId) &&
            approvalId > 0 &&
            SHA_PATTERN.test(headSha ?? "") &&
            Number.isSafeInteger(number) &&
            number > 0,
        ) &&
          new Set(normalized.map(({ approvalId }) => approvalId)).size ===
            normalized.length,
        "Repository-wide processor approval inventory is malformed",
      );
      return normalized.sort(
        (left, right) =>
          left.pullRequestNumber - right.pullRequestNumber ||
          left.approvalId - right.approvalId,
      );
    };
    const staleApprovals = normalizeApprovalInventory(
      await adapter.getOutstandingDependabotProcessorApprovals(
        collected.repository,
      ),
    );
    const dismissalErrors = [];
    if (staleApprovals.length > 0) {
      invariant(
        typeof adapter.dismissPullRequestApproval === "function",
        "Stale processor approval reconciliation requires a trusted dismissal adapter",
      );
      for (const stale of staleApprovals) {
        try {
          const dismissal = await adapter.dismissPullRequestApproval({
            approvalId: stale.approvalId,
            pullRequestNumber: stale.pullRequestNumber,
            repository: collected.repository,
          });
          invariant(
            dismissal?.dismissed === true ||
              String(dismissal?.state ?? "").toLowerCase() !== "open",
            `PR #${stale.pullRequestNumber} stale processor approval remained active`,
          );
          mutations.push({
            headSha: stale.headSha,
            kind: "approval-dismissed",
            pullRequestNumber: stale.pullRequestNumber,
          });
        } catch (error) {
          dismissalErrors.push(error);
        }
      }
    }
    const remainingApprovals = normalizeApprovalInventory(
      await adapter.getOutstandingDependabotProcessorApprovals(
        collected.repository,
      ),
    );
    if (remainingApprovals.length > 0) {
      const incomplete = new Error(
        "Repository-wide processor approval inventory is not empty after reconciliation",
      );
      if (dismissalErrors.length > 0) {
        throw new AggregateError(
          [...dismissalErrors, incomplete],
          "Repository-wide processor approval reconciliation failed",
        );
      }
      throw incomplete;
    }
    const selectedTargets = new Map(
      (collected.pullRequests ?? []).map((snapshot) => {
        const pullRequest = normalizePullRequest(
          snapshot.pullRequest ?? snapshot,
        );
        return [
          pullRequest.number,
          snapshot.expectedHeadSha ?? pullRequest.headSha,
        ];
      }),
    );
    invariant(
      selectedTargets.size === (collected.pullRequests ?? []).length,
      "Selected Dependabot PR evidence is ambiguous",
    );
    const refreshedPullRequests = [];
    for (const [number, selectedExpectedHeadSha] of selectedTargets) {
      const refreshed = await adapter.collectPullRequestSnapshot(
        collected.repository,
        number,
      );
      refreshed.expectedHeadSha = selectedExpectedHeadSha;
      refreshedPullRequests.push(refreshed);
    }
    collected = {
      ...collected,
      outstandingAutoMergeRequests:
        await adapter.getOutstandingDependabotAutoMergeRequests(
          collected.repository,
        ),
      pullRequests: refreshedPullRequests,
    };
    evaluation = evaluateDependabotSweep(collected);
  }

  let processorCheckPublicationAllowed = publishChecks;
  if (publishChecks) {
    invariant(
      typeof adapter.getOutstandingDependabotAutoMergeRequests === "function",
      "Processor check publication requires repository-wide auto-merge visibility",
    );
    const publicationRequests =
      await adapter.getOutstandingDependabotAutoMergeRequests(
        evaluation.repository,
      );
    const publicationState = outstandingAutoMergeState(
      { outstandingAutoMergeRequests: publicationRequests },
      [],
    );
    processorCheckPublicationAllowed =
      !publicationState.ambiguous &&
      publicationState.requests.length === 0 &&
      !evaluation.serialization.outstandingAutoMerge.ambiguous &&
      evaluation.serialization.outstandingAutoMerge.requests.length === 0 &&
      evaluation.evaluations.every(
        ({ feedback }) => feedback.autoMergeEnabled !== true,
      );
  }

  if (
    processorCheckPublicationAllowed &&
    typeof adapter.publishProcessorCheck === "function"
  ) {
    for (const result of evaluation.evaluations) {
      await adapter.publishProcessorCheck({
        conclusion: SAFE_PROCESSOR_CHECK_DISPOSITIONS.has(result.disposition)
          ? "neutral"
          : "failure",
        headSha: result.headSha,
        output: {
          summary: `Disposition: ${result.disposition}`,
          title: `Dependabot processor: ${result.disposition}`,
        },
        mode: evaluation.mode,
        pullRequestNumber: result.pullRequestNumber,
        repairAttempt: result.repairAttempt,
        repairPacketIssued: result.repairPacket !== null,
        repository: evaluation.repository,
      });
      mutations.push({
        headSha: result.headSha,
        kind: "published-check",
        pullRequestNumber: result.pullRequestNumber,
      });
    }
  }

  if (evaluation.mode === "merge" && evaluation.mergeCandidate) {
    const candidate = evaluation.mergeCandidate;
    let approvalSnapshot = await adapter.collectPullRequestSnapshot(
      evaluation.repository,
      candidate.pullRequestNumber,
    );
    approvalSnapshot.expectedHeadSha = candidate.headSha;
    let preApprovalAutoMergeRequests = await requireGlobalAutoMergeAdmission({
      adapter,
      allowMatchingCandidate: true,
      candidate,
      repository: evaluation.repository,
    });
    let fresh = evaluateDependabotSweep({
      mode: "merge",
      outstandingAutoMergeRequests: preApprovalAutoMergeRequests,
      pullRequests: [approvalSnapshot],
      repository: evaluation.repository,
    });
    invariant(
      fresh.mergeCandidate?.pullRequestNumber === candidate.pullRequestNumber &&
        fresh.mergeCandidate?.headSha === candidate.headSha,
      `PR #${candidate.pullRequestNumber} no longer satisfies merge policy`,
    );
    if (preApprovalAutoMergeRequests.length === 1) {
      invariant(
        typeof adapter.disablePullRequestAutoMerge === "function",
        "Existing auto-merge requests require a trusted disable adapter",
      );
      const [request] = preApprovalAutoMergeRequests;
      await adapter.disablePullRequestAutoMerge({
        headSha: candidate.headSha,
        nodeId: request.nodeId,
        pullRequestNumber: candidate.pullRequestNumber,
        repository: evaluation.repository,
      });
      mutations.push({
        headSha: candidate.headSha,
        kind: "auto-merge-disabled",
        pullRequestNumber: candidate.pullRequestNumber,
      });
      approvalSnapshot = await adapter.collectPullRequestSnapshot(
        evaluation.repository,
        candidate.pullRequestNumber,
      );
      approvalSnapshot.expectedHeadSha = candidate.headSha;
      invariant(
        approvalSnapshot.feedback?.autoMergeEnabled === false,
        `PR #${candidate.pullRequestNumber} still reports an active auto-merge request`,
      );
      preApprovalAutoMergeRequests = await requireGlobalAutoMergeAdmission({
        adapter,
        candidate,
        repository: evaluation.repository,
      });
      fresh = evaluateDependabotSweep({
        mode: "merge",
        outstandingAutoMergeRequests: preApprovalAutoMergeRequests,
        pullRequests: [approvalSnapshot],
        repository: evaluation.repository,
      });
      invariant(
        fresh.mergeCandidate?.pullRequestNumber ===
          candidate.pullRequestNumber &&
          fresh.mergeCandidate?.headSha === candidate.headSha,
        `PR #${candidate.pullRequestNumber} no longer satisfies merge policy after auto-merge disable`,
      );
    } else {
      invariant(
        approvalSnapshot.feedback?.autoMergeEnabled !== true,
        `PR #${candidate.pullRequestNumber} has inconsistent auto-merge evidence`,
      );
    }
    await requireGlobalAutoMergeAdmission({
      adapter,
      candidate,
      repository: evaluation.repository,
    });
    invariant(
      approvalSnapshot.feedback?.currentProcessorApprovalCount === 0 &&
        Array.isArray(approvalSnapshot.feedback?.currentProcessorApprovalIds) &&
        approvalSnapshot.feedback.currentProcessorApprovalIds.length === 0,
      `PR #${candidate.pullRequestNumber} already has a current processor approval`,
    );
    invariant(
      typeof adapter.dismissPullRequestApproval === "function",
      "Approval mutation requires a trusted approval-dismissal adapter",
    );
    let approval = null;
    try {
      approval = await adapter.approvePullRequest({
        approvalSnapshot,
        headSha: candidate.headSha,
        pullRequestNumber: candidate.pullRequestNumber,
        repository: evaluation.repository,
      });
      invariant(
        Number.isSafeInteger(approval?.id) &&
          approval.id > 0 &&
          String(approval.state ?? "").toUpperCase() === "APPROVED" &&
          typeof approval.updatedAt === "string" &&
          approval.updatedAt.length > 0,
        `PR #${candidate.pullRequestNumber} approval response is invalid`,
      );
      mutations.push({
        headSha: candidate.headSha,
        kind: "approved",
        pullRequestNumber: candidate.pullRequestNumber,
      });
      const afterApproval = await adapter.collectPullRequestSnapshot(
        evaluation.repository,
        candidate.pullRequestNumber,
      );
      afterApproval.expectedHeadSha = candidate.headSha;
      invariant(
        afterApproval.pullRequest?.updated_at === approval.updatedAt,
        `PR #${candidate.pullRequestNumber} changed after approval postflight`,
      );
      invariant(
        afterApproval.feedback?.autoMergeEnabled !== true,
        `PR #${candidate.pullRequestNumber} regained auto-merge before direct merge`,
      );
      invariant(
        afterApproval.feedback?.currentProcessorApprovalCount === 1 &&
          Array.isArray(afterApproval.feedback?.currentProcessorApprovalIds) &&
          afterApproval.feedback.currentProcessorApprovalIds.length === 1 &&
          afterApproval.feedback.currentProcessorApprovalIds[0] === approval.id,
        `PR #${candidate.pullRequestNumber} processor approval postcondition failed`,
      );
      const preMergeAutoMergeRequests = await requireGlobalAutoMergeAdmission({
        adapter,
        candidate,
        repository: evaluation.repository,
      });
      const admitted = evaluateDependabotSweep({
        mode: "merge",
        outstandingAutoMergeRequests: preMergeAutoMergeRequests,
        pullRequests: [afterApproval],
        repository: evaluation.repository,
      });
      invariant(
        admitted.mergeCandidate?.pullRequestNumber ===
          candidate.pullRequestNumber &&
          admitted.mergeCandidate?.headSha === candidate.headSha,
        `PR #${candidate.pullRequestNumber} changed after approval`,
      );
      await adapter.mergePullRequest({
        headSha: candidate.headSha,
        pullRequestNumber: candidate.pullRequestNumber,
        repository: evaluation.repository,
      });
      mutations.push({
        headSha: candidate.headSha,
        kind: "merged",
        pullRequestNumber: candidate.pullRequestNumber,
      });
    } catch (error) {
      if (Number.isSafeInteger(approval?.id) && approval.id > 0) {
        try {
          const dismissal = await adapter.dismissPullRequestApproval({
            approvalId: approval.id,
            pullRequestNumber: candidate.pullRequestNumber,
            repository: evaluation.repository,
          });
          invariant(
            dismissal?.dismissed === true ||
              String(dismissal?.state ?? "").toLowerCase() !== "open",
            `PR #${candidate.pullRequestNumber} processor approval remained active`,
          );
        } catch (dismissalError) {
          throw new AggregateError(
            [error, dismissalError],
            `PR #${candidate.pullRequestNumber} processing and approval dismissal both failed`,
          );
        }
      }
      throw error;
    }
  }

  return { ...evaluation, mutations };
}

function parsePullRequestNumbers(value) {
  if (value === undefined || value === null || value === "all") return "all";
  const values = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(pullRequestNumber);
  invariant(values.length > 0, "PR number list cannot be empty");
  return [...new Set(values)].sort((left, right) => left - right);
}

function parseCliArguments(rawArguments) {
  const arguments_ = [...rawArguments];
  if (arguments_[0] === "--") arguments_.shift();
  const command = arguments_.shift();
  if (command === "help" || command === "--help" || command === "-h") {
    return { command: "help", options: {} };
  }
  invariant(
    command === "evaluate" || command === "process",
    "Command must be evaluate or process",
  );
  const options = {};
  const allowedOptions = new Set([
    "expected-head-sha",
    "input",
    "live",
    "mode",
    "pr-numbers",
    "publish-checks",
    "repo",
  ]);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      return { command: "help", options: {} };
    }
    if (argument === "--live" || argument === "--publish-checks") {
      options[argument.slice(2)] = true;
      continue;
    }
    invariant(argument.startsWith("--"), `Unexpected argument: ${argument}`);
    invariant(
      allowedOptions.has(argument.slice(2)),
      `Unsupported option: ${argument}`,
    );
    const value = arguments_[index + 1];
    invariant(
      value !== undefined && value !== "--",
      `${argument} requires a value`,
    );
    options[argument.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function loadInput(path) {
  const text = readFileSync(path === "-" ? 0 : path, "utf8");
  return JSON.parse(text);
}

function filterInputPullRequests(input, pullRequestNumbers) {
  if (pullRequestNumbers === "all") return input;
  const selected = new Set(pullRequestNumbers);
  return {
    ...input,
    pullRequests: (input.pullRequests ?? []).filter((snapshot) =>
      selected.has(
        pullRequestNumber((snapshot.pullRequest ?? snapshot).number),
      ),
    ),
  };
}

async function runCli() {
  const { command, options } = parseCliArguments(process.argv.slice(2));
  if (command === "help") {
    process.stdout.write(`${DEPENDABOT_PROCESSOR_HELP}\n`);
    return;
  }
  const requestedMode = options.mode ?? process.env.DEPENDABOT_PROCESSOR_MODE;
  const repository =
    options.repo ??
    process.env.GITHUB_REPOSITORY ??
    process.env.DEPENDABOT_REPOSITORY;
  const pullRequestNumbers = parsePullRequestNumbers(
    options["pr-numbers"] ?? process.env.DEPENDABOT_PR_NUMBERS,
  );
  const expectedHeadSha =
    options["expected-head-sha"] ??
    process.env.DEPENDABOT_EXPECTED_HEAD_SHA ??
    null;

  let result;
  if (options.live) {
    const mode = normalizeProcessorMode(requestedMode);
    const adapter = createLiveGitHubAdapter();
    const input = await collectSweepInput({
      adapter,
      expectedHeadSha,
      mode,
      pullRequestNumbers,
      repository: repositoryName(repository),
    });
    result =
      command === "process"
        ? await processDependabotSweep({
            adapter,
            input,
            publishChecks: Boolean(options["publish-checks"]),
          })
        : evaluateDependabotSweep(input);
  } else {
    invariant(options.input, "Pure JSON mode requires --input <path|->");
    let input = loadInput(options.input);
    if (repository) input = { ...input, repository };
    input = {
      ...input,
      mode: normalizeProcessorMode(requestedMode ?? input.mode),
    };
    input = filterInputPullRequests(input, pullRequestNumbers);
    if (expectedHeadSha !== null) {
      exactSha(expectedHeadSha, "Expected intake head SHA");
      invariant(
        input.pullRequests?.length === 1,
        "--expected-head-sha requires exactly one pull request",
      );
      input.pullRequests[0] = {
        ...input.pullRequests[0],
        expectedHeadSha,
      };
    }
    result = evaluateDependabotSweep(input);
    if (command === "process") {
      result = {
        ...result,
        mutations: [],
        processing: {
          enabled: false,
          reason: "live-or-injected-adapter-required",
        },
      };
    }
  }
  process.stdout.write(`${stableJson(result)}\n`);
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  runCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
