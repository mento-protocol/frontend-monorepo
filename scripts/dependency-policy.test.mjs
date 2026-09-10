import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function yaml(relativePath) {
  return parse(read(relativePath), { uniqueKeys: true });
}

function authorityJson(source) {
  const strictJson = JSON.parse(source);
  const duplicateFree = parse(source, { uniqueKeys: true });
  assert.deepEqual(duplicateFree, strictJson);
  return strictJson;
}

function nestedStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(nestedStrings);
  }
  return [];
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function dependabotPatternMatches(pattern, dependency) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`).test(dependency);
}

function dependabotGroupMatches(
  group,
  dependency,
  dependencyType,
  updateType,
  appliesTo = "version-updates",
) {
  if ((group["applies-to"] ?? "version-updates") !== appliesTo) {
    return false;
  }
  if (group["dependency-type"] && group["dependency-type"] !== dependencyType) {
    return false;
  }
  if (group["update-types"] && !group["update-types"].includes(updateType)) {
    return false;
  }
  const patterns = group.patterns ?? ["*"];
  const exclusions = group["exclude-patterns"] ?? [];
  return (
    patterns.some((pattern) => dependabotPatternMatches(pattern, dependency)) &&
    !exclusions.some((pattern) => dependabotPatternMatches(pattern, dependency))
  );
}

function matchingDependabotGroups(
  groups,
  dependency,
  dependencyType,
  updateType,
  appliesTo = "version-updates",
) {
  return Object.entries(groups)
    .filter(([, group]) =>
      dependabotGroupMatches(
        group,
        dependency,
        dependencyType,
        updateType,
        appliesTo,
      ),
    )
    .map(([name]) => name);
}

function firstDependabotGroup(groups, dependency, dependencyType, updateType) {
  return Object.entries(groups).find(([, group]) =>
    dependabotGroupMatches(group, dependency, dependencyType, updateType),
  )?.[0];
}

const CLAUDE_ACTION =
  "anthropics/claude-code-action@fa2b2666b747000bf42767d1f332065b375e3c8f";
const CLAUDE_PLUGIN_MARKETPLACE = "./.claude-code-plugin-marketplace";
const CLAUDE_CODE_REVIEW_PLUGIN = `${CLAUDE_PLUGIN_MARKETPLACE}/plugins/code-review`;
const CLAUDE_PLUGIN_MARKETPLACE_REF =
  "2bb60696142b493eafaeacfe00eac51d16c50c4f";
function osvReusableRevision(value) {
  return /^google\/osv-scanner-action\/\.github\/workflows\/osv-scanner-reusable\.yml@([0-9a-f]{40})$/u.exec(
    String(value ?? ""),
  )?.[1];
}

function workspacePackagePaths() {
  const paths = ["package.json"];
  for (const directory of ["apps", "packages"]) {
    const root = fileURLToPath(new URL(`../${directory}/`, import.meta.url));
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${directory}/${entry.name}/package.json`;
      if (existsSync(new URL(`../${relativePath}`, import.meta.url))) {
        paths.push(relativePath);
      }
    }
  }
  return paths;
}

const CLAIM_WRAPPER = "scripts/dependabot-claim.mjs";
const CLAIM_POLICY = ".github/dependabot-prep-policy.json";
const HOST_LOCK_PATH_TEMPLATE =
  "${XDG_STATE_HOME:-$HOME/.local/state}/dependabot-prep/<host>__<owner>__<repo>/active";
const HOST_LOCK_PATH_MACOS =
  "$HOME/Library/Application Support/dependabot-prep/<host>__<owner>__<repo>/active";

function claimPolicyPath() {
  return fileURLToPath(new URL(`../${CLAIM_POLICY}`, import.meta.url));
}

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function git(argv, input) {
  const result = spawnSync("git", argv, {
    cwd: repositoryRoot,
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git ${argv.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

// The wrapper reads its policy from the default branch's revision, not from the
// working tree, so a test that wants the wrapper to see a particular policy has
// to put that policy in the object store. `hash-object -w` and `mktree` write
// loose objects only: no ref moves, no index writes and no working-tree change,
// and an unreferenced object is collected by the next `git gc`.
//
// This also supplies a v4 revision while this change is still on a candidate
// branch, because `origin/main` still carries v3 until it merges.
function policyRevision(policyText = read(CLAIM_POLICY)) {
  const blob = git(["hash-object", "-w", "--stdin"], policyText);
  const directory = git(
    ["mktree"],
    `100644 blob ${blob}\t${basename(CLAIM_POLICY)}\n`,
  );
  return git(
    ["mktree"],
    `040000 tree ${directory}\t${dirname(CLAIM_POLICY)}\n`,
  );
}

// Puts a stub `pnpm` first on PATH. The stub prints one argument per line, or
// appends them to `argvFile` when the caller cannot read the child's stdout,
// and exits with the requested code. A test therefore observes the exact
// `pnpm dlx` argv the wrapper builds without touching the network. With
// `configCopy` it also copies the policy file the wrapper injected, which the
// wrapper deletes as it exits.
function withStubPnpm(exitCode, run, { argvFile, configCopy, policyRef } = {}) {
  const stubDirectory = mkdtempSync(join(tmpdir(), "dependabot-claim-"));
  try {
    const sink = argvFile ? ` >> '${argvFile}'` : "";
    const capture = configCopy
      ? `\n  case "$argument" in */dependabot-prep-policy.json) cp "$argument" '${configCopy}' ;; esac`
      : "";
    writeFileSync(
      join(stubDirectory, "pnpm"),
      `#!/bin/sh\nfor argument in "$@"; do printf '%s\\n' "$argument"${sink}${capture}\ndone\nexit ${exitCode}\n`,
      { mode: 0o755 },
    );
    const environment = { ...process.env };
    environment.PATH = `${stubDirectory}${delimiter}${environment.PATH}`;
    environment.DEPENDABOT_CLAIM_POLICY_REF = policyRef ?? policyRevision();
    return run(environment);
  } finally {
    rmSync(stubDirectory, { recursive: true, force: true });
  }
}

// The wrapper writes the resolved policy to a private temporary file and passes
// that path, so a test asserts the shape of the path rather than a fixed value.
function assertInjectedConfig(argv, { after }) {
  const flag = argv.indexOf("--config");
  assert.ok(flag !== -1, "the wrapper must inject --config");
  assert.deepEqual(argv.slice(flag - after.length, flag), after);
  const path = argv[flag + 1];
  assert.notEqual(path, claimPolicyPath());
  assert.equal(relative(repositoryRoot, path).startsWith(".."), true);
  assert.match(
    path,
    /dependabot-claim-policy-[^/]*\/dependabot-prep-policy\.json$/u,
  );
  return path;
}

// Resolves the real pnpm before any stub reaches PATH, so a test can run the
// documented `pnpm dependabot:claim -- ...` form through the package manager
// itself instead of assuming how it forwards its own separator.
function realPnpmCommand() {
  // Read the variable from a copy of the environment: the repository's lint
  // rules require every directly named `process.env` key to be declared in
  // turbo.json, and this one belongs to the package manager, not the build.
  const { npm_execpath: execPath } = { ...process.env };
  if (execPath && existsSync(execPath)) return [process.execPath, execPath];
  const found = spawnSync("/usr/bin/env", ["sh", "-c", "command -v pnpm"], {
    encoding: "utf8",
  });
  const resolved = found.stdout?.trim();
  return found.status === 0 && resolved ? [resolved] : null;
}

// Runs the wrapper the way the playbook documents it: through `pnpm run`, in a
// throwaway project whose script is this repository's wrapper. The stub `pnpm`
// records the wrapper's own child argv in a file, because `pnpm run` writes its
// banner to the same stdout.
function runDocumentedForm(args) {
  const command = realPnpmCommand();
  assert.ok(command, "pnpm must be resolvable to exercise the documented form");
  const project = mkdtempSync(join(tmpdir(), "dependabot-claim-project-"));
  try {
    const wrapper = fileURLToPath(
      new URL(`../${CLAIM_WRAPPER}`, import.meta.url),
    );
    writeFileSync(
      join(project, "package.json"),
      `${JSON.stringify(
        {
          name: "dependabot-claim-documented-form",
          version: "0.0.0",
          private: true,
          scripts: { "dependabot:claim": `node '${wrapper}'` },
        },
        null,
        2,
      )}\n`,
    );
    const argvFile = join(project, "argv.txt");
    const [executable, ...prefix] = command;
    const run = withStubPnpm(
      0,
      (environment) =>
        spawnSync(
          executable,
          [...prefix, "--dir", project, "run", "dependabot:claim", ...args],
          { encoding: "utf8", env: environment },
        ),
      { argvFile },
    );
    const argv = existsSync(argvFile)
      ? readFileSync(argvFile, "utf8").trim().split("\n")
      : [];
    return { run, argv };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

// Polls for a file a spawned shell writes, so a signal test never races the
// child's startup and never depends on a fixed delay.
async function waitForFile(path, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

function runClaimWrapper(args, { exitCode = 0 } = {}) {
  return withStubPnpm(exitCode, (environment) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)), ...args],
      { encoding: "utf8", env: environment },
    ),
  );
}

// Runs the wrapper against a throwaway revision carrying an edited policy, so a
// test can observe how the wrapper validates policy values it must never trust.
function runClaimWrapperWithPin(packageOverrides, args) {
  const policy = authorityJson(read(CLAIM_POLICY));
  policy.coordination.claims.package = {
    ...policy.coordination.claims.package,
    ...packageOverrides,
  };
  return withStubPnpm(
    0,
    (environment) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)),
          ...args,
        ],
        { encoding: "utf8", env: environment },
      ),
    { policyRef: policyRevision(JSON.stringify(policy)) },
  );
}

test("trusted-agent policy limits authority to existing Dependabot pull requests", () => {
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.equal(policy.schema, "dependabot-prep-policy:v4");
  assert.equal(policy.executionModel, "trusted-openclaw-agent");
  assert.equal(policy.repository, "mento-protocol/frontend-monorepo");
  assert.equal(policy.baseRef, "main");
  assert.deepEqual(policy.authority, {
    source: "live-main",
    candidateInstructions: "not-authority",
    requireCurrentPolicyBeforeWrites: true,
  });
  assert.deepEqual(policy.admission.author, {
    id: 49699333,
    login: "dependabot[bot]",
    type: "Bot",
  });
  assert.equal(policy.admission.sameRepository, true);
  assert.equal(policy.admission.openOnly, true);
  assert.equal(policy.admission.drafts, "needs-decision-no-state-change");
  assert.ok(policy.forbiddenActions.includes("mark-ready-for-review"));
  assert.match(read("AGENTS.md"), /draft Dependabot PRs are maintainer holds/);
  assert.match(read(policy.entryPrompt), /Only non-draft authenticated/);
  assert.match(read(policy.canonicalPlaybook), /Require `isDraft: false`/);
  assert.doesNotMatch(
    read(".github/dependabot.yml"),
    /strict patches have a narrow full lane|minor and major updates remain manual|own manual lane/,
  );
  assert.equal(policy.admission.headRefPrefix, "dependabot/");
  assert.equal(policy.admission.autoMergeMustBeDisabled, true);
  assert.equal(policy.admission.unexplainedForeignCommits, "needs-decision");
  assert.deepEqual(policy.admission.vetoLabels, [
    "dependencies:manual",
    "dependabot:manual",
    "do-not-merge",
    "no-auto-merge",
    "processor:veto",
  ]);
  assert.deepEqual(policy.limits, {
    batchMinutes: 360,
    perPullRequestMinutes: 45,
    repairAttempts: 3,
  });
  assert.deepEqual(policy.coordination, {
    primitive: "github-ref-claims",
    claims: {
      schema: "mento-claims-config:v1",
      profile: "pr",
      namespace: "refs/mento-claims/v1/pr",
      scopeTemplate: "refs/mento-claims/v1/pr/{pr}",
      kind: "mento-claim",
      payloadVersion: 1,
      author: {
        name: "Mento claims",
        email: "claims@users.noreply.github.com",
      },
      ttlMinutes: 30,
      renewMinutes: 10,
      graceMinutes: 10,
      maxTtlMinutes: 360,
      minRemainingSeconds: 360,
      skewToleranceSeconds: 300,
      label: "dependabot-prep:claimed",
      markerRevision: "v2",
      requiredBefore: ["branch-push", "review-request"],
      advisoryBefore: ["summary-comment", "inline-reply", "long-wait"],
      allowOverrides: false,
      allowCloudWriters: false,
      command: ["pnpm", "dependabot:claim", "--"],
      package: { name: "@mento-protocol/issues", version: "0.1.0" },
    },
    hostLock: {
      scope: "host-local-heavy-tree",
      path: HOST_LOCK_PATH_TEMPLATE,
      pathMacos: HOST_LOCK_PATH_MACOS,
      purpose: "process-tree-resource-cap-only-not-cross-host-serialization",
    },
    allWriters:
      "claim-required-before-push-and-review-request-advisory-otherwise",
    unavailable: "read-only-for-that-pull-request",
    release: "owner-only-on-terminal-verdict-or-expiry-takeover",
  });
  assert.deepEqual(policy.changes.push, {
    existingPullRequestBranchOnly: true,
    fastForwardOnly: true,
    explicitRefspec: true,
    recheckRemoteHeadBeforePush: true,
    lease: "exact-ref-and-observed-nonzero-sha",
    proveFastForwardBeforeLease: true,
    noOpPush: false,
  });
  assert.match(read(policy.canonicalPlaybook), /git merge-base --is-ancestor/);
  assert.match(
    read(policy.canonicalPlaybook),
    /--force-with-lease="\$pushRef:\$observedHead"/,
  );
});

test("dependency repairs remain executable without granting security or final PR-state changes", () => {
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.deepEqual(
    [...policy.changes.allowed].sort(),
    [
      "dependency-source-repairs",
      "manifest-and-lockfile-updates",
      "documented-runtime-contract-updates",
      "focused-tests",
      "package-installation",
      "local-build-and-test",
      "merge-current-main",
      "request-current-head-review",
      "answer-review-feedback",
    ].sort(),
  );
  assert.equal(
    policy.changes.majorOrRuntimeUpdate,
    "research-and-repair-with-documented-validation",
  );
  assert.equal(policy.changes.needsDecisionPublication, false);
  assert.deepEqual(policy.changes.needsDecisionPathExceptions, {
    ".github/workflows/**":
      "version-only-ci-coupling-for-package-patch-or-minor",
  });
  for (const path of [
    ".github/workflows/**",
    ".github/actions/**",
    ".github/dependabot-prep-policy.json",
    "AGENTS.md",
    "CLAUDE.md",
    CLAIM_WRAPPER,
    policy.canonicalPlaybook,
    policy.entryPrompt,
  ])
    assert.ok(policy.changes.needsDecisionPaths.includes(path), path);
  for (const trigger of [
    "security-control-changes",
    "automation-policy-changes",
    "weakened-or-disabled-checks",
    "credential-or-permission-changes",
    "unexplained-history",
    "irreversible-or-out-of-scope-product-or-architecture-changes",
  ])
    assert.ok(policy.changes.needsDecisionTriggers.includes(trigger), trigger);
  for (const action of [
    "approve",
    "merge",
    "close",
    "enable-auto-merge",
    "disable-auto-merge",
    "enqueue-merge",
    "dismiss-review",
    "resolve-thread",
    "unresolve-thread",
    "force-push",
    "rebase",
    "recreate",
    "rerun-checks",
    "publish-needs-decision-changes",
    "weaken-security-or-checks",
    "expose-secrets",
    // The quarterly prune is the only destructive operation the claim design
    // adds, and its copy-pasteable mutation sits in the agent-facing playbook.
    "delete-claim-refs",
  ])
    assert.ok(policy.forbiddenActions.includes(action), action);
  assert.deepEqual(
    policy.changes.allowed.filter((action) =>
      policy.forbiddenActions.includes(action),
    ),
    [],
  );
  assert.deepEqual(policy.security, {
    dependabotCi: "secretless",
    vercelCredentialedPreview: "forbidden",
    githubActionsRefs: "full-lowercase-40-hex-sha",
    osvScannerAndReporter: "same-revision",
    checksAndSecurityControls: "never-weaken",
  });
});

test("agent decisions, delivered reports and serialized heavy work are the default", () => {
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.equal(policy.operatingRevision, "autonomous-decisions-v1");
  assert.equal(policy.decisions.uncertaintyAloneBlocks, false);
  assert.equal(
    policy.decisions.default,
    "best-supported-reversible-choice-and-continue",
  );
  assert.equal(
    policy.decisions.explicitHoldsAndForbiddenActions,
    "never-override",
  );
  assert.deepEqual(policy.reporting.slack, [
    "start",
    "actionable-exception",
    "final-report",
  ]);
  assert.equal(policy.reporting.periodicStatusMessages, false);
  assert.equal(
    policy.reporting.finalDelivery,
    "full-readable-report-not-local-path-only",
  );
  assert.equal(policy.reporting.requireDeliveryReceipt, true);
  assert.deepEqual(policy.hostResources, {
    heavyTrees: 1,
    memoryHigh: "2G",
    memoryMax: "3G",
    memorySwapMax: 0,
    cpuQuota: "100%",
    turboConcurrency: 1,
    vitestWorkers: 1,
    hooks: "enabled-verify-effective-serialization",
  });
  const prompt = read(policy.entryPrompt);
  const playbook = read(policy.canonicalPlaybook);
  assert.ok(prompt.includes(policy.operatingRevision));
  assert.ok(playbook.includes(policy.reporting.prCommentMarker));
  assert.ok(playbook.includes("Input welcome"));
  assert.ok(playbook.includes("lowest-numbered eligible PR"));
  assert.ok(playbook.includes("Retain the delivery receipt"));
  assert.ok(playbook.includes("--concurrency=1"));
  assert.doesNotMatch(prompt + playbook, /at-least-five-minute/);
  assert.ok(
    !policy.changes.needsDecisionTriggers.includes("disputed-review-findings"),
  );
  assert.ok(
    !policy.changes.needsDecisionTriggers.includes(
      "product-or-architecture-decisions",
    ),
  );
  assert.ok(
    policy.changes.needsDecisionTriggers.includes(
      "irreversible-or-out-of-scope-product-or-architecture-changes",
    ),
  );
});

test("every dependency receives research and readiness requires exact-head review and checks", () => {
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.equal(
    policy.research.scope,
    "every-dependency-in-every-pull-request-including-manual",
  );
  assert.deepEqual(policy.research.tupleFields, [
    "name",
    "fromVersion",
    "toVersion",
  ]);
  assert.deepEqual(policy.research.sources, [
    "upstream-release-notes",
    "upstream-changelog",
    "migration-guide",
    "security-advisory",
  ]);
  assert.equal(policy.research.requireLiveVerification, true);
  assert.equal(
    policy.research.fallback,
    "verified-upstream-project-page-with-explicit-source-gaps",
  );
  assert.equal(
    policy.research.unavailable,
    "blocked-and-operationally-incomplete",
  );
  for (const field of [
    "source-links",
    "breaking-changes",
    "repository-impact",
    "recommendation",
    "risk",
    "confidence",
    "confidence-rationale",
    "source-gaps",
  ]) {
    assert.ok(policy.research.reportFields.includes(field), field);
  }
  const handoff = policy.handoff;
  assert.deepEqual(handoff.verdicts, [
    "ready-for-maintainer-decision",
    "needs-decision",
    "blocked",
  ]);
  for (const gate of [
    "exactHeadAndBase",
    "containsCurrentMain",
    "mergeable",
    "autoMergeMustBeDisabled",
    "recheckOnHeadOrBaseDrift",
  ])
    assert.equal(handoff[gate], true, gate);
  assert.equal(
    handoff.requiredChecks,
    "all-live-required-checks-with-authenticated-producers",
  );
  assert.equal(
    handoff.checkEvidence,
    "exact-head-app-or-status-creator-and-workflow-binding",
  );
  assert.equal(handoff.additionalChecks, "all-affected-repository-gates");
  assert.deepEqual(handoff.reviewer, {
    id: 136622811,
    login: "coderabbitai[bot]",
    type: "Bot",
  });
  assert.equal(handoff.reviewCommit, "exact-final-head");
  assert.equal(
    handoff.feedback,
    "all-surfaces-including-walkthroughs-and-followups",
  );
  assert.equal(handoff.actionableFeedback, "address-and-answer-every-item");
  assert.equal(
    handoff.disputedFeedback,
    "investigate-decide-and-answer-with-evidence-no-unproven-ready",
  );
  assert.equal(handoff.answeredUnresolvedThreads, "list-for-maintainer");
  assert.equal(handoff.humanApprovalAndMerge, "maintainer-only");
});

test("Dependabot PRs keep repository credentials and caches disabled", () => {
  const configurations = [
    {
      expectedSecretCount: 24,
      gate: "needs.changes.outputs.allow_repository_credentials",
      path: ".github/workflows/ci.yml",
      planJob: "changes",
    },
    {
      expectedSecretCount: 6,
      gate: "needs.e2e-plan.outputs.allow_repository_credentials",
      path: ".github/workflows/e2e.yml",
      planJob: "e2e-plan",
    },
    {
      expectedSecretCount: 6,
      gate: "needs.visual-plan.outputs.allow_repository_credentials",
      path: ".github/workflows/visual.yml",
      planJob: "visual-plan",
    },
    {
      expectedSecretCount: 0,
      gate: "env.ALLOW_REPOSITORY_CREDENTIALS",
      path: ".github/workflows/quality-budgets.yml",
      planJob: null,
    },
  ];
  const protectedPaths = configurations.map(({ path }) => path).sort();
  const workflowRoot = fileURLToPath(
    new URL("../.github/workflows/", import.meta.url),
  );
  const directPullRequestWorkflows = readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => {
      const path = `.github/workflows/${name}`;
      return { parsed: yaml(path), path };
    })
    .filter(({ parsed }) => Object.hasOwn(parsed.on ?? {}, "pull_request"));

  assert.deepEqual(
    directPullRequestWorkflows
      .filter(({ parsed }) =>
        nestedStrings(parsed).some((value) => value.includes("secrets.")),
      )
      .map(({ path }) => path)
      .sort(),
    [
      ".github/workflows/ci.yml",
      ".github/workflows/claude-code-review.yml",
      ".github/workflows/e2e.yml",
      ".github/workflows/visual.yml",
    ],
  );
  const humanReviewJob = yaml(".github/workflows/claude-code-review.yml").jobs[
    "claude-review-human"
  ];
  assert.match(humanReviewJob.if, /pull_request\.user\.type == 'User'/u);
  for (const { parsed, path } of directPullRequestWorkflows) {
    assert.doesNotMatch(
      JSON.stringify(parsed.jobs),
      /"secrets":"inherit"/u,
      `${path} must not inherit an unbounded secret set`,
    );
  }

  const cachePaths = directPullRequestWorkflows
    .filter(({ parsed }) =>
      Object.values(parsed.jobs).some((job) =>
        (job.steps ?? []).some(
          (step) =>
            step.uses === "./.github/actions/pnpm-install" ||
            step.uses?.startsWith("actions/cache@") ||
            step.uses?.startsWith("trunk-io/trunk-action@") ||
            Object.hasOwn(step.with ?? {}, "cache-dependency-path"),
        ),
      ),
    )
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(cachePaths, protectedPaths);

  const directLocalActions = directPullRequestWorkflows
    .flatMap(({ parsed }) => Object.values(parsed.jobs))
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.uses)
    .filter((uses) => uses?.startsWith("./.github/actions/"));
  assert.deepEqual([...new Set(directLocalActions)].sort(), [
    "./.github/actions/pnpm-install",
  ]);

  const installAction = yaml(".github/actions/pnpm-install/action.yml");
  assert.deepEqual(
    installAction.runs.steps
      .map((step) => step.uses)
      .filter((uses) => uses?.startsWith("./")),
    [],
  );
  const cachedNode = installAction.runs.steps.find(
    (step) =>
      step.uses?.startsWith("actions/setup-node@") &&
      step.with?.cache === "pnpm",
  );
  assert.equal(cachedNode.if, "inputs.cache == 'true'");
  assert.equal(
    cachedNode.with["cache-dependency-path"],
    "${{ inputs.working-directory }}/pnpm-lock.yaml",
  );
  const uncachedNode = installAction.runs.steps.find(
    (step) =>
      step.uses?.startsWith("actions/setup-node@") &&
      step.with?.["package-manager-cache"] === false,
  );
  assert.equal(uncachedNode.if, "inputs.cache != 'true'");

  const requiredGrantSignals = [
    "github.event_name != 'pull_request'",
    "github.event.pull_request.user.type == 'User'",
    "github.event.pull_request.user.id != 49699333",
    "github.event.pull_request.user.login != 'dependabot[bot]'",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "github.event.pull_request.head.ref != 'dependabot'",
    "!startsWith(github.event.pull_request.head.ref, 'dependabot/')",
    "github.event.sender.type == 'User'",
  ];

  for (const { expectedSecretCount, gate, path, planJob } of configurations) {
    const parsed = yaml(path);
    const grant = parsed.env.ALLOW_REPOSITORY_CREDENTIALS;
    for (const signal of requiredGrantSignals) {
      assert.ok(grant.includes(signal), `${path} is missing ${signal}`);
    }

    if (planJob !== null) {
      const classifier = parsed.jobs[planJob].steps[0];
      assert.equal(classifier.name, "Classify repository credential access");
      assert.equal(classifier.id, "credentials");
      assert.equal(
        classifier.run,
        [
          "set -euo pipefail",
          'case "$ALLOW_REPOSITORY_CREDENTIALS" in',
          "  true | false) ;;",
          "  *) exit 1 ;;",
          "esac",
          'echo "allow_repository_credentials=$ALLOW_REPOSITORY_CREDENTIALS" >> "$GITHUB_OUTPUT"',
          "",
        ].join("\n"),
        `${path} must validate and propagate the exact fail-closed credential grant`,
      );
      assert.equal(
        parsed.jobs[planJob].outputs.allow_repository_credentials,
        "${{ steps.credentials.outputs.allow_repository_credentials }}",
      );
    }

    const secretValues = nestedStrings(parsed).filter((value) =>
      value.includes("secrets."),
    );
    assert.equal(secretValues.length, expectedSecretCount, path);
    for (const value of secretValues) {
      assert.match(
        value,
        new RegExp(
          `^\\$\\{\\{ ${gate.replaceAll(".", "\\.")} == 'true' && secrets\\.[A-Z0-9_]+ \\|\\| '' \\}\\}$`,
          "u",
        ),
        `${path} secret access must require the positive grant`,
      );
    }

    const steps = Object.values(parsed.jobs).flatMap((job) => job.steps ?? []);
    for (const checkout of steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    )) {
      assert.equal(checkout.with?.["persist-credentials"], false, path);
    }
    for (const install of steps.filter(
      (step) => step.uses === "./.github/actions/pnpm-install",
    )) {
      assert.equal(install.with?.cache, `\${{ ${gate} == 'true' }}`, path);
    }
    for (const cache of steps.filter((step) =>
      step.uses?.startsWith("actions/cache@"),
    )) {
      assert.equal(cache.if, `${gate} == 'true'`, path);
    }
  }

  const trunk = yaml(".github/workflows/ci.yml").jobs.static.steps.find(
    (step) => step.uses?.startsWith("trunk-io/trunk-action@"),
  );
  assert.deepEqual(yaml(".github/workflows/ci.yml").jobs.static.permissions, {
    contents: "read",
  });
  assert.equal(
    trunk.with?.cache,
    "${{ needs.changes.outputs.allow_repository_credentials == 'true' }}",
  );
  assert.equal(trunk.with?.["save-annotations"], true);
});

test("the shared fork clock selects every connected E2E lane", () => {
  const e2e = yaml(".github/workflows/e2e.yml");
  const impact = e2e.jobs["e2e-plan"].steps.find(
    (step) => step.name === "Detect E2E impact",
  );
  assert.ok(impact);
  assert.match(
    impact.run,
    /scripts\/fork-test-clock\.mjs \| scripts\/fork-test-clock\.test\.mjs\)\n\s+run_app=true\n\s+run_gov=true\n\s+run_monad=true/u,
  );
});

test("human Claude review keeps its same-repository marketplace boundary", () => {
  const humanReview = yaml(".github/workflows/claude-code-review.yml");
  const job = humanReview.jobs["claude-review-human"];
  assert.ok(job);
  assert.equal(job.name, "claude-review-human");
  assert.match(job.if, /head\.repo\.full_name == github\.repository/u);
  assert.match(job.if, /pull_request\.user\.type == 'User'/u);
  assert.equal(humanReview.jobs["claude-review"], undefined);

  const guardIndex = job.steps.findIndex(
    (step) => step.name === "Reject candidate marketplace path collision",
  );
  const marketplaceCheckoutIndex = job.steps.findIndex(
    (step) => step.name === "Checkout pinned Claude plugin marketplace",
  );
  assert.ok(guardIndex >= 0);
  assert.equal(marketplaceCheckoutIndex, guardIndex + 1);
  const marketplaceGuard = job.steps[guardIndex];
  assert.match(marketplaceGuard.run, /GITHUB_WORKSPACE/u);
  assert.match(marketplaceGuard.run, /-e "\$marketplace_path"/u);
  assert.match(marketplaceGuard.run, /-L "\$marketplace_path"/u);

  const marketplaceCheckout = job.steps[marketplaceCheckoutIndex];
  assert.equal(
    marketplaceCheckout.uses,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assert.equal(marketplaceCheckout.with.repository, "anthropics/claude-code");
  assert.equal(marketplaceCheckout.with.ref, CLAUDE_PLUGIN_MARKETPLACE_REF);
  assert.equal(
    marketplaceCheckout.with.path,
    CLAUDE_PLUGIN_MARKETPLACE.slice(2),
  );
  assert.equal(marketplaceCheckout.with["persist-credentials"], false);
  assert.deepEqual(
    marketplaceCheckout.with["sparse-checkout"].trim().split("\n"),
    [".claude-plugin", "plugins/code-review"],
  );

  const marketplaceVerification = job.steps[marketplaceCheckoutIndex + 1];
  assert.equal(
    marketplaceVerification.name,
    "Verify pinned Claude plugin marketplace",
  );
  assert.equal(
    marketplaceVerification.env.EXPECTED_MARKETPLACE_SHA,
    CLAUDE_PLUGIN_MARKETPLACE_REF,
  );
  assert.match(marketplaceVerification.run, /! -L "\$marketplace_path"/u);
  assert.match(
    marketplaceVerification.run,
    /git -C "\$marketplace_path" rev-parse HEAD/u,
  );

  const review = job.steps.find((step) => step.uses === CLAUDE_ACTION);
  assert.ok(review);
  assert.equal(
    review.with.claude_args,
    `--plugin-dir ${CLAUDE_CODE_REVIEW_PLUGIN}`,
  );
  assert.equal(Object.hasOwn(review.with, "plugin_marketplaces"), false);
  assert.equal(Object.hasOwn(review.with, "plugins"), false);
  assert.equal(Object.hasOwn(review.with, "allowed_bots"), false);
});

test("human Claude review rejects a candidate marketplace symlink", () => {
  const humanReview = yaml(".github/workflows/claude-code-review.yml");
  const guard = humanReview.jobs["claude-review-human"].steps.find(
    (step) => step.name === "Reject candidate marketplace path collision",
  );
  assert.ok(guard);

  const workspace = mkdtempSync(join(tmpdir(), "claude-review-workspace-"));
  try {
    const redirect = join(workspace, "redirect");
    mkdirSync(redirect);
    symlinkSync(
      redirect,
      join(workspace, CLAUDE_PLUGIN_MARKETPLACE.slice(2)),
      "dir",
    );
    const result = spawnSync("/bin/bash", ["-c", guard.run], {
      encoding: "utf8",
      env: { GITHUB_WORKSPACE: workspace, PATH: "/usr/bin:/bin" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Candidate content occupies/u);
    assert.deepEqual(readdirSync(redirect), []);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("pull requests diff OSV findings read-only and trusted runs own full SARIF scans", () => {
  const supplyChain = yaml(".github/workflows/supply-chain.yml");
  const readOnlyOsv = yaml(".github/workflows/_osv-scanner-readonly.yml");
  const osvJobIds = [
    "osv",
    "osv-pnpm-runtime",
    "osv-vercel-cli-runtime",
    "osv-pnpm-bootstrap",
  ];
  const sarifJobIds = osvJobIds.map((jobId) => `${jobId}-sarif`);
  const sarifRevisions = [];

  assert.deepEqual(Object.keys(supplyChain.on).sort(), [
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
  ]);
  assert.deepEqual(supplyChain.on.push, { branches: ["main"] });
  assert.deepEqual(supplyChain.on.schedule, [{ cron: "17 6 * * *" }]);
  assert.deepEqual(
    Object.keys(supplyChain.jobs).sort(),
    [...osvJobIds, ...sarifJobIds, "lockfile-lint", "version-skew"].sort(),
  );

  for (const jobId of osvJobIds) {
    const readOnlyJob = supplyChain.jobs[jobId];
    // One job per target, so no `needs` edge can skip the required check. A
    // skipped required check sits pending forever and blocks every merge.
    assert.equal(readOnlyJob.if, "github.event_name == 'pull_request'");
    assert.equal(readOnlyJob.needs, undefined);
    // With the artifact hop gone the scan reads no Actions API, so it no longer
    // asks for `actions: read`.
    assert.deepEqual(readOnlyJob.permissions, { contents: "read" });
    assert.equal(Object.hasOwn(readOnlyJob.with, "upload-sarif"), false);
    assert.equal(
      readOnlyJob.uses,
      "./.github/workflows/_osv-scanner-readonly.yml",
    );
    // The two sides must scan the same config and lockfile relative paths, each
    // rooted at its own checkout directory. Anything else and the two result
    // sets are not comparable and the diff is meaningless.
    const baseArgs = readOnlyJob.with["base-scan-args"];
    const headArgs = readOnlyJob.with["head-scan-args"];
    assert.equal(typeof baseArgs, "string");
    assert.equal(typeof headArgs, "string");
    assert.notEqual(baseArgs, headArgs);
    assert.equal(headArgs.replaceAll("candidate/", "base/"), baseArgs);

    const sarifJob = supplyChain.jobs[`${jobId}-sarif`];
    assert.equal(
      sarifJob.if,
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );
    assert.deepEqual(sarifJob.permissions, {
      actions: "read",
      contents: "read",
      "security-events": "write",
    });
    const sarifRevision = osvReusableRevision(sarifJob.uses);
    assert.ok(sarifRevision);
    sarifRevisions.push(sarifRevision);
    assert.equal(sarifJob.with["upload-sarif"], true);
  }

  for (const jobId of ["lockfile-lint", "version-skew"]) {
    const baselineJob = supplyChain.jobs[jobId];
    assert.equal(
      baselineJob.if,
      undefined,
      `${jobId} must run on main pushes as deterministic recovery evidence`,
    );
    const checkout = baselineJob.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with?.["persist-credentials"], false);
  }

  assert.deepEqual(Object.keys(readOnlyOsv.on), ["workflow_call"]);
  assert.deepEqual(Object.keys(readOnlyOsv.on.workflow_call.inputs).sort(), [
    "base-scan-args",
    "head-scan-args",
  ]);
  for (const input of ["base-scan-args", "head-scan-args"]) {
    assert.equal(readOnlyOsv.on.workflow_call.inputs[input].required, true);
  }
  assert.deepEqual(readOnlyOsv.permissions, { contents: "read" });
  const readOnlyJob = readOnlyOsv.jobs["osv-scan"];
  assert.deepEqual(readOnlyJob.permissions, { contents: "read" });
  // A reusable-workflow check reports as `<caller job name> / <called job
  // name>`, so this name is half of the exact required `osv-scanner / osv-scan`.
  assert.equal(readOnlyJob.name, "osv-scan");
  assert.equal(readOnlyJob["timeout-minutes"], 10);
  const readOnlySteps = readOnlyJob.steps;
  const checkouts = readOnlySteps.filter((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  // Two directories, never one path checked out twice: head content must never
  // be able to land on top of the tree the base scan reads. The base tree is
  // then deleted before the head arrives, so the two never coexist.
  assert.equal(checkouts.length, 2);
  const [baseCheckout, checkout] = checkouts;
  assert.equal(baseCheckout.with.path, "base");
  assert.equal(checkout.with.path, "candidate");
  // Both sides come from one event snapshot. A branch name resolves to whatever
  // main points at when this job starts, while the head scan always scans the
  // event's fixed merge commit; if main moved in between, a dependency the new
  // tip fixed would be reported as newly introduced.
  assert.equal(
    baseCheckout.with.ref,
    "${{ github.event.pull_request.base.sha }}",
  );
  assert.notEqual(baseCheckout.with.ref, "${{ github.base_ref }}");
  assert.equal(checkout.with.ref, undefined);
  for (const step of checkouts) {
    assert.equal(step.with["persist-credentials"], false);
  }

  // Two scanner steps, base and head, plus exactly one reporter: the shape
  // upstream's PR mode ships. AGENTS.md's OSV rule is about keeping the scanner
  // and reporter actions at the same pinned revision, asserted below.
  const scannerSteps = readOnlySteps.filter((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-scanner-action@"),
  );
  assert.equal(scannerSteps.length, 2);
  const [baseScanner, scanner] = scannerSteps;
  const scannerRevision =
    /^google\/osv-scanner-action\/osv-scanner-action@([0-9a-f]{40})$/u.exec(
      scanner.uses,
    )?.[1];
  assert.ok(scannerRevision);
  assert.equal(baseScanner.uses, scanner.uses);
  assert.equal(baseScanner.id, "base-scan");
  assert.equal(scanner.id, "scan");
  for (const step of scannerSteps) {
    assert.equal(step["continue-on-error"], true);
    assert.match(step.with["scan-args"], /--format=json/u);
  }
  // Each side takes its own arguments, which is what carries its own config.
  // Scanning both sides with the head config would let a pull request that
  // removes a suppression pass, because the advisory would be suppressed in the
  // baseline too.
  assert.match(
    baseScanner.with["scan-args"],
    /\$\{\{ inputs\.base-scan-args \}\}/u,
  );
  assert.match(
    scanner.with["scan-args"],
    /\$\{\{ inputs\.head-scan-args \}\}/u,
  );
  assert.doesNotMatch(baseScanner.with["scan-args"], /inputs\.head-scan-args/u);
  assert.doesNotMatch(scanner.with["scan-args"], /inputs\.base-scan-args/u);

  // A base scan that failed, or a base commit without this lockfile, falls back
  // to an empty baseline, so every finding here counts as new. That can only
  // over-report, never under-report, and it keeps this job reporting.
  const baselineGuards = readOnlySteps.filter(
    (step) => step.name === "Establish the base vulnerability baseline",
  );
  assert.equal(baselineGuards.length, 1);
  const [baselineGuard] = baselineGuards;
  assert.equal(baselineGuard.shell, "bash");
  assert.deepEqual(baselineGuard.env, {
    BASE_RESULTS: "${{ github.workspace }}/osv-state/old-results.json",
  });
  assert.match(baselineGuard.run, /Array\.isArray\(parsed\.results\)/u);
  assert.match(baselineGuard.run, /\{"results":\[\]\}/u);

  // First half of the anti-aliasing pair. Once the baseline is captured the
  // base tree is deleted, so a candidate symlink has no second tree to name.
  // Without it a pull request could commit `pnpm-lock.yaml -> ../base/…`, have
  // the head scan reproduce the baseline, and pass the required check while the
  // proposed lockfile carried vulnerable dependencies.
  const baseRemovals = readOnlySteps.filter(
    (step) => step.name === "Remove the base tree before the head checkout",
  );
  assert.equal(baseRemovals.length, 1);
  const [baseRemoval] = baseRemovals;
  assert.equal(baseRemoval.if, undefined);
  assert.equal(baseRemoval.shell, "bash");
  assert.match(baseRemoval.run, /rm -rf "\$\{GITHUB_WORKSPACE\}\/base"/u);
  assert.match(baseRemoval.run, /exit 1/u);

  // Second half: every head scan input must resolve to a real file inside the
  // head checkout. The config toml is validated alongside the lockfile — it is
  // a scan input too, and the one that decides which advisories are suppressed.
  const pathGuards = readOnlySteps.filter(
    (step) =>
      step.name === "Reject head scan inputs that leave the candidate checkout",
  );
  assert.equal(pathGuards.length, 1);
  const [pathGuard] = pathGuards;
  assert.equal(pathGuard.if, undefined);
  assert.equal(pathGuard.shell, "bash");
  assert.deepEqual(pathGuard.env, {
    HEAD_SCAN_ARGS: "${{ inputs.head-scan-args }}",
  });
  assert.match(pathGuard.run, /--lockfile=\* \| --config=\*/u);
  assert.ok(
    readOnlySteps.indexOf(baseRemoval) < readOnlySteps.indexOf(checkout),
    "the base tree must be gone before the head is checked out",
  );
  assert.ok(
    readOnlySteps.indexOf(checkout) < readOnlySteps.indexOf(pathGuard) &&
      readOnlySteps.indexOf(pathGuard) < readOnlySteps.indexOf(scanner),
    "head scan inputs must be validated after the head checkout and before the head scan",
  );

  const completionGuards = readOnlySteps.filter(
    (step) => step.name === "Check that the scan completed",
  );
  assert.equal(completionGuards.length, 1);
  const [completionGuard] = completionGuards;
  // Content, not size. A pull request can add a tracked non-empty file, which
  // is not evidence that a scan ran. The guard is also unconditional, so a
  // scanner that exits 0 without writing a usable result still fails the job.
  assert.equal(completionGuard.if, undefined);
  assert.equal(completionGuard.shell, "bash");
  assert.deepEqual(completionGuard.env, {
    RESULTS: "${{ github.workspace }}/osv-state/results.json",
  });
  assert.match(completionGuard.run, /Array\.isArray\(parsed\.results\)/u);
  assert.match(completionGuard.run, /exit 1/u);

  const reporterSteps = readOnlySteps.filter((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-reporter-action@"),
  );
  assert.equal(reporterSteps.length, 1);
  const [reporter] = reporterSteps;
  const reporterRevision =
    /^google\/osv-scanner-action\/osv-reporter-action@([0-9a-f]{40})$/u.exec(
      reporter.uses,
    )?.[1];
  assert.ok(reporterRevision);
  assert.equal(reporterRevision, scannerRevision);
  assert.deepEqual([...new Set(sarifRevisions)], [scannerRevision]);
  assert.equal(
    osvReusableRevision(
      `google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yaml@${scannerRevision}`,
    ),
    undefined,
  );
  assert.notEqual(
    osvReusableRevision(
      `google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@${"f".repeat(40)}`,
    ),
    scannerRevision,
  );

  // The directory is cleared before every write, so even if a future change
  // moved scan state back inside the candidate tree, a tracked file could not
  // survive to stand in for a result.
  const scratchSteps = readOnlySteps.filter(
    (step) =>
      step.name === "Create the scan state directory beside the checkouts",
  );
  assert.equal(scratchSteps.length, 1);
  const [scratch] = scratchSteps;
  assert.match(scratch.run, /rm -rf "\$\{GITHUB_WORKSPACE\}\/osv-state"/u);
  assert.match(scratch.run, /mkdir -p "\$\{GITHUB_WORKSPACE\}\/osv-state"/u);

  const order = [
    baseCheckout,
    scratch,
    baseScanner,
    baselineGuard,
    baseRemoval,
    checkout,
    pathGuard,
    scanner,
    completionGuard,
    reporter,
  ].map((step) => readOnlySteps.indexOf(step));
  assert.deepEqual(
    order,
    [...order].sort((left, right) => left - right),
    "the base checkout, scratch directory, base scan, baseline, base removal, head checkout, input validation, head scan, guard, and reporter must run in that order",
  );
  assert.ok(order.every((index) => index >= 0));
  assert.match(reporter.with["scan-args"], /--gh-annotations=false/u);
  assert.match(reporter.with["scan-args"], /--fail-on-vuln=true/u);
  // No SARIF write path, and no artifact hop in either direction: the whole
  // diff is computed and consumed inside this one job.
  assert.doesNotMatch(
    JSON.stringify(readOnlyOsv),
    /security-events|upload-sarif|github\/codeql-action|actions\/(?:upload|download)-artifact/u,
  );

  // No scan input or output may sit inside either checkout. The head checkout
  // is candidate-controlled, so a tracked file at a workspace-relative path
  // could stand in for a real scan result: as a forged empty baseline that
  // hides an introduced vulnerability, or as a forged result that satisfies the
  // completion guard after a scan failed. The job checks the base out into
  // `base/`, the head into `candidate/`, and keeps scan state beside both in
  // `osv-state/`, which a pull request cannot write to because it can only add
  // files inside its own tree. GITHUB_WORKSPACE is the one bind mount GitHub
  // documents for container actions, where it appears at /github/workspace.
  const scanPathFlag = /--(?:output|old|new)=(\S+)/gu;
  const assertOutsideCheckout = (step) => {
    const values = [...step.with["scan-args"].matchAll(scanPathFlag)].map(
      ([, value]) => value,
    );
    assert.ok(values.length > 0);
    for (const value of values) {
      assert.ok(
        value.startsWith("/github/workspace/osv-state/"),
        `${step.uses} reads or writes ${value} inside the checkout`,
      );
    }
  };
  assertOutsideCheckout(baseScanner);
  assertOutsideCheckout(scanner);
  assertOutsideCheckout(reporter);

  // The container path the actions write to and the host path the shell guards
  // read must stay the same file. Container actions see GITHUB_WORKSPACE
  // mounted at /github/workspace, so the two spellings differ only by prefix.
  // If they ever drift, the guards would check a file nothing wrote and the
  // scan would report a clean diff it never computed.
  const CONTAINER_TEMP = "/github/workspace/";
  const HOST_TEMP = "${{ github.workspace }}/";
  const hostPathFor = (containerPath) =>
    `${HOST_TEMP}${containerPath.slice(CONTAINER_TEMP.length)}`;
  const scannerOutput = /--output=(\S+)/u.exec(scanner.with["scan-args"])[1];
  assert.equal(completionGuard.env.RESULTS, hostPathFor(scannerOutput));
  const reporterOld = /--old=(\S+)/u.exec(reporter.with["scan-args"])[1];
  assert.equal(baselineGuard.env.BASE_RESULTS, hostPathFor(reporterOld));
  const reporterNew = /--new=(\S+)/u.exec(reporter.with["scan-args"])[1];
  assert.equal(
    reporterNew,
    scannerOutput,
    "the reporter must read exactly the file the scanner wrote",
  );
  // Same matched-pair rule on the base side: what the base scan's container
  // writes is the file the fallback guard reads and the reporter compares
  // against, and the two scans must not write to the same file.
  const baseScannerOutput = /--output=(\S+)/u.exec(
    baseScanner.with["scan-args"],
  )[1];
  assert.equal(baselineGuard.env.BASE_RESULTS, hostPathFor(baseScannerOutput));
  assert.equal(reporterOld, baseScannerOutput);
  assert.notEqual(baseScannerOutput, scannerOutput);

  // Every scan path is rooted at its own side's checkout directory, so each
  // side is scanned with its own config. Scanning the base with the head's
  // config would suppress an advisory in the baseline that the head removed the
  // suppression for, and the pull request would pass.
  for (const jobId of osvJobIds) {
    const job = supplyChain.jobs[jobId];
    for (const [input, root] of [
      ["base-scan-args", "base/"],
      ["head-scan-args", "candidate/"],
    ]) {
      const values = [
        ...job.with[input].matchAll(/--(?:config|lockfile)=(\S+)/gu),
      ].map(([, value]) => value);
      assert.ok(values.length > 0);
      for (const value of values) {
        assert.ok(
          value.startsWith(root),
          `${jobId} ${input} must be rooted at ${root}, found ${value}`,
        );
      }
    }
    // A target either configures both sides or neither, and a configured side
    // reads the config out of its own checkout.
    const baseConfig = /--config=(\S+)/u.exec(job.with["base-scan-args"])?.[1];
    const headConfig = /--config=(\S+)/u.exec(job.with["head-scan-args"])?.[1];
    assert.equal(baseConfig === undefined, headConfig === undefined);
    if (baseConfig !== undefined) {
      assert.ok(baseConfig.startsWith("base/"));
      assert.ok(headConfig.startsWith("candidate/"));
    }
  }

  // Tripwire: nothing tracked may sit where scan state is written. A pull
  // request that added such a path fails here rather than silently forging a
  // result. The jobs also rm -rf the directory before writing to it.
  const trackedScanState = spawnSync("git", ["ls-files", "-z", "osv-state"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(trackedScanState.status, 0);
  assert.equal(trackedScanState.stdout, "");
  // The separate baseline workflow is gone; the diff is one job again.
  assert.equal(
    existsSync(
      new URL(
        "../.github/workflows/_osv-scanner-baseline.yml",
        import.meta.url,
      ),
    ),
    false,
  );

  const dependencyReview = yaml(".github/workflows/dependency-review.yml");
  const dependencyCheckout = dependencyReview.jobs[
    "dependency-review"
  ].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(dependencyCheckout.with["persist-credentials"], false);
});

test("the OSV head scan refuses inputs that leave the candidate checkout", () => {
  const readOnlyOsv = yaml(".github/workflows/_osv-scanner-readonly.yml");
  const steps = readOnlyOsv.jobs["osv-scan"].steps;
  const stepNamed = (name) => {
    const step = steps.find((candidate) => candidate.name === name);
    assert.ok(step, `missing step: ${name}`);
    return step;
  };
  const pathGuard = stepNamed(
    "Reject head scan inputs that leave the candidate checkout",
  );
  const baseRemoval = stepNamed(
    "Remove the base tree before the head checkout",
  );

  const workspace = mkdtempSync(join(tmpdir(), "osv-scan-inputs-"));
  try {
    // A workspace shaped like the job's: a candidate checkout beside a base
    // tree that has not been removed yet, which is the state the guard has to
    // survive even when the removal step is defeated.
    mkdirSync(join(workspace, "candidate", "scripts"), { recursive: true });
    mkdirSync(join(workspace, "base"), { recursive: true });
    writeFileSync(
      join(workspace, "candidate", "pnpm-lock.yaml"),
      "head lock\n",
    );
    writeFileSync(join(workspace, "candidate", "osv-scanner.toml"), "\n");
    writeFileSync(join(workspace, "base", "pnpm-lock.yaml"), "base lock\n");
    writeFileSync(join(workspace, "base", "osv-scanner.toml"), "\n");
    // A lockfile replaced by a symlink into the trusted base tree — the exact
    // bypass: the head scan would reproduce the baseline and every introduced
    // vulnerability would look unchanged.
    symlinkSync(
      "../base/pnpm-lock.yaml",
      join(workspace, "candidate", "escape.yaml"),
    );
    // The config toml is a scan input too, and the one that decides which
    // advisories are suppressed.
    symlinkSync(
      "../base/osv-scanner.toml",
      join(workspace, "candidate", "escape.toml"),
    );
    // A symlink that stays inside the candidate tree is still rejected: a scan
    // input must be the file the pull request proposes, not an alias for one.
    symlinkSync("pnpm-lock.yaml", join(workspace, "candidate", "alias.yaml"));
    // A symlinked parent directory leaves the final component a real file, so
    // only resolving the whole path catches it.
    symlinkSync("../base", join(workspace, "candidate", "aliasdir"));

    const runGuard = (headScanArgs) =>
      spawnSync("/bin/bash", ["-c", pathGuard.run], {
        encoding: "utf8",
        env: {
          GITHUB_WORKSPACE: workspace,
          HEAD_SCAN_ARGS: headScanArgs,
          PATH: "/usr/bin:/bin",
        },
      });

    const accepted = runGuard(
      "--config=candidate/osv-scanner.toml\n--lockfile=candidate/pnpm-lock.yaml",
    );
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /candidate\/osv-scanner\.toml resolves to/u);
    assert.match(accepted.stdout, /candidate\/pnpm-lock\.yaml resolves to/u);

    for (const [args, expected] of [
      // A lockfile symlinked out of the candidate tree.
      ["--lockfile=candidate/escape.yaml", /is a symlink/u],
      // The same trick on the config, which suppresses advisories.
      [
        "--config=candidate/escape.toml\n--lockfile=candidate/pnpm-lock.yaml",
        /is a symlink/u,
      ],
      // A symlink that never leaves the candidate tree.
      ["--lockfile=candidate/alias.yaml", /is a symlink/u],
      // A real file reached through a symlinked parent directory.
      [
        "--lockfile=candidate/aliasdir/pnpm-lock.yaml",
        /outside the candidate/u,
      ],
      // An argument that was never rooted at the candidate tree.
      ["--lockfile=base/pnpm-lock.yaml", /is not rooted at candidate\//u],
      // A missing input fails closed rather than being skipped.
      [
        "--lockfile=candidate/absent.yaml",
        /is missing or is not a regular file/u,
      ],
      // A directory is not a scan input.
      ["--lockfile=candidate/scripts", /is missing or is not a regular file/u],
      // Arguments carrying nothing to validate must not pass silently.
      ["--format=json", /No --lockfile or --config head scan input/u],
    ]) {
      const rejected = runGuard(args);
      assert.notEqual(rejected.status, 0, `accepted ${args}`);
      assert.match(rejected.stdout, expected);
      assert.match(rejected.stdout, /^::error::/mu);
    }

    // The removal step actually removes the tree, and says so.
    const removal = spawnSync("/bin/bash", ["-c", baseRemoval.run], {
      encoding: "utf8",
      env: { GITHUB_WORKSPACE: workspace, PATH: "/usr/bin:/bin" },
    });
    assert.equal(removal.status, 0, removal.stdout + removal.stderr);
    assert.equal(existsSync(join(workspace, "base")), false);
    // With the base tree gone the escaping symlink dangles, so the guard's
    // second layer would catch it even if the first were bypassed.
    const dangling = runGuard("--lockfile=candidate/escape.yaml");
    assert.notEqual(dangling.status, 0);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("pnpm release-age exclusions stay exact and bounded", () => {
  const workspace = yaml("pnpm-workspace.yaml");
  const turboReleaseAgeExclusions = [
    "turbo@2.10.11",
    "@turbo/darwin-64@2.10.11",
    "@turbo/darwin-arm64@2.10.11",
    "@turbo/linux-64@2.10.11",
    "@turbo/linux-arm64@2.10.11",
    "@turbo/windows-64@2.10.11",
    "@turbo/windows-arm64@2.10.11",
  ];

  assert.deepEqual(
    workspace.minimumReleaseAgeExclude,
    turboReleaseAgeExclusions,
  );

  const lockfile = yaml("pnpm-lock.yaml");
  for (const packageSelector of turboReleaseAgeExclusions) {
    assert.ok(
      lockfile.packages[packageSelector],
      `remove the release-age exclusion when ${packageSelector} leaves the reviewed lockfile`,
    );
  }
});

test("Wormhole Connect owns isolated UI dependencies", () => {
  const appManifest = JSON.parse(read("apps/app.mento.org/package.json"));
  const uiManifest = JSON.parse(read("packages/ui/package.json"));
  const workspace = yaml("pnpm-workspace.yaml");
  const lockfile = yaml("pnpm-lock.yaml");
  const appLucide =
    lockfile.importers["apps/app.mento.org"].dependencies["lucide-react"];
  const wormholePackage =
    lockfile.packages["@wormhole-foundation/wormhole-connect@6.0.0"];
  const wormholeSnapshots = Object.entries(lockfile.snapshots).filter(([key]) =>
    key.startsWith("@wormhole-foundation/wormhole-connect@6.0.0("),
  );
  const approvedResolvedLucide = /^1\.31\.0(?:\(|$)/u;
  const widgetResolvedLucide = /^0\.554\.0(?:\(|$)/u;
  const widgetOnlyUiDependencies = [
    "@emotion/react",
    "@emotion/styled",
    "@mui/icons-material",
    "@mui/material",
    "@mui/styled-engine",
    "@mui/system",
  ];
  const allowedPeerVersions =
    workspace.peerDependencyRules?.allowedVersions ?? {};

  assert.equal(
    appManifest.dependencies["@wormhole-foundation/wormhole-connect"],
    "^6.0.0",
  );
  assert.equal(appManifest.dependencies["lucide-react"], "catalog:");
  assert.equal(uiManifest.dependencies["lucide-react"], "^1.28.0");
  assert.equal(workspace.catalog["lucide-react"], "^1.28.0");
  assert.equal(appLucide.specifier, "catalog:");
  assert.match(appLucide.version, approvedResolvedLucide);
  assert.equal(
    Object.keys(allowedPeerVersions).some((selector) =>
      selector.startsWith("@wormhole-foundation/wormhole-connect@"),
    ),
    false,
  );
  assert.equal(wormholePackage.peerDependencies["lucide-react"], undefined);
  assert.equal(wormholeSnapshots.length, 1);

  const wormholeDependencies = wormholeSnapshots[0][1].dependencies;
  for (const packageName of widgetOnlyUiDependencies) {
    assert.equal(appManifest.dependencies[packageName], undefined);
    assert.ok(wormholeDependencies[packageName]);
  }
  assert.match(wormholeDependencies["lucide-react"], widgetResolvedLucide);
});

test("Wagmi paths share one use-sync-external-store peer snapshot", () => {
  const manifest = JSON.parse(read("package.json"));
  const vercelRuntimeManifest = JSON.parse(
    read("scripts/vercel-cli-runtime/package.json"),
  );
  const lockfile = read("pnpm-lock.yaml");

  assert.equal(
    manifest.pnpm.overrides["zustand>use-sync-external-store"],
    "1.4.0",
  );
  assert.equal(
    vercelRuntimeManifest.pnpm.overrides["zustand>use-sync-external-store"],
    "1.4.0",
  );
  const wagmiPeerSnapshots = [
    ...lockfile.matchAll(/^ {2}'(@wagmi\/core@[^']+\([^']+\))':$/gmu),
  ].map((match) => match[1]);

  assert.equal(wagmiPeerSnapshots.length, 1);
  assert.equal(
    wagmiPeerSnapshots[0].includes("use-sync-external-store@1.4.0"),
    true,
  );
});

test("Dependabot groups isolate protected runtimes and couple test tooling", () => {
  const dependabotSource = read(".github/dependabot.yml");
  const config = parse(dependabotSource, { uniqueKeys: true });
  const web3Patterns = [
    "wagmi",
    "viem",
    "viem-*",
    "@wagmi/*",
    "@rainbow-me/*",
    "@metamask/*",
    "ethers",
    "ethers-*",
    "@mento-protocol/*",
    "@wormhole-foundation/*",
    "@solana/*",
    "@walletconnect/*",
    "@reown/*",
    "@celo/*",
    "@ledgerhq/*",
    "@trezor/*",
    "@safe-global/*",
    "@noble/*",
    "@scure/*",
    "*wallet*",
    "*web3*",
  ];
  const sensitiveActionPatterns = [
    "actions/create-github-app-token",
    "actions/dependency-review-action",
    "anthropics/*",
    "dependabot/*",
    "github/codeql-action*",
    "google/osv-scanner-action*",
    "ossf/scorecard-action",
  ];
  const npmConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "npm",
  );
  const actionsConfigs = config.updates.filter(
    (update) => update["package-ecosystem"] === "github-actions",
  );
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const localActionRoot = join(repositoryRoot, ".github/actions");
  const nestedActionDirectories = filesBelow(localActionRoot)
    .filter((path) => /(?:^|\/)action\.ya?ml$/u.test(path))
    .map((path) => `/${relative(repositoryRoot, dirname(path))}`)
    .sort();
  assert.equal(actionsConfigs.length, 2);
  const actionsConfig = actionsConfigs.find(
    (update) => update.directory === "/",
  );
  const localActionsConfig = actionsConfigs.find(
    (update) => update.directories,
  );
  assert.equal(actionsConfig.directories, undefined);
  assert.equal(localActionsConfig.directory, undefined);
  assert.deepEqual(
    [...localActionsConfig.directories].sort(),
    nestedActionDirectories,
    "the exact local Action manifest directories need Dependabot coverage",
  );
  assert.equal(
    new Set(localActionsConfig.directories).size,
    localActionsConfig.directories.length,
    "local Action directories must not be duplicated",
  );
  assert.equal(
    localActionsConfig.directories.includes("/"),
    false,
    "the local Action entry must not overlap the root workflow entry",
  );
  for (const field of [
    "schedule",
    "cooldown",
    "open-pull-requests-limit",
    "labels",
    "commit-message",
  ]) {
    assert.deepEqual(
      localActionsConfig[field],
      actionsConfig[field],
      `local Actions must preserve root ${field} semantics`,
    );
  }
  assert.deepEqual(localActionsConfig.groups, {
    "github-actions-local-manual": {
      "applies-to": "version-updates",
      patterns: ["*"],
    },
    "github-actions-local-security-manual": {
      "applies-to": "security-updates",
      patterns: ["*"],
    },
  });

  for (const update of [npmConfig, ...actionsConfigs]) {
    assert.deepEqual(update.schedule, {
      interval: "weekly",
      day: "monday",
      time: "06:00",
      timezone: "UTC",
    });
  }
  assert.equal(npmConfig["open-pull-requests-limit"], 12);
  assert.deepEqual(npmConfig.cooldown, {
    "default-days": 7,
    "semver-major-days": 21,
    "semver-minor-days": 7,
    "semver-patch-days": 7,
  });
  assert.deepEqual(npmConfig.groups["vercel-cli"], {
    "applies-to": "version-updates",
    patterns: ["vercel"],
    "update-types": ["minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["vercel-cli-security"], {
    "applies-to": "security-updates",
    patterns: ["vercel"],
  });
  assert.deepEqual(npmConfig.groups["next-runtime"], {
    "applies-to": "version-updates",
    patterns: ["next"],
    "update-types": ["major", "minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["next-runtime-security"], {
    "applies-to": "security-updates",
    patterns: ["next"],
  });
  assert.deepEqual(npmConfig.groups["playwright-runtime"], {
    "applies-to": "version-updates",
    patterns: ["@playwright/test", "@argos-ci/playwright"],
    "update-types": ["major", "minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["playwright-runtime-security"], {
    "applies-to": "security-updates",
    patterns: ["@playwright/test", "@argos-ci/playwright"],
  });
  assert.deepEqual(npmConfig.groups["pnpm-runtime"], {
    "applies-to": "version-updates",
    patterns: ["pnpm", "@pnpm/linux-x64"],
    "update-types": ["major", "minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["pnpm-runtime-security"], {
    "applies-to": "security-updates",
    patterns: ["pnpm", "@pnpm/linux-x64"],
  });
  const protectedRuntimeDependencies = [
    "vercel",
    "next",
    "@playwright/test",
    "@argos-ci/playwright",
    "pnpm",
    "@pnpm/linux-x64",
  ];
  const protectedVersionGroups = {
    vercel: "vercel-cli",
    next: "next-runtime",
    "@playwright/test": "playwright-runtime",
    "@argos-ci/playwright": "playwright-runtime",
    pnpm: "pnpm-runtime",
    "@pnpm/linux-x64": "pnpm-runtime",
  };
  const protectedSecurityGroups = {
    vercel: "vercel-cli-security",
    next: "next-runtime-security",
    "@playwright/test": "playwright-runtime-security",
    "@argos-ci/playwright": "playwright-runtime-security",
    pnpm: "pnpm-runtime-security",
    "@pnpm/linux-x64": "pnpm-runtime-security",
  };
  for (const dependencyType of ["production", "development"]) {
    for (const [dependency, expectedGroup] of Object.entries(
      protectedVersionGroups,
    )) {
      const updateTypes =
        dependency === "vercel"
          ? ["minor", "patch"]
          : ["major", "minor", "patch"];
      for (const updateType of updateTypes) {
        assert.deepEqual(
          matchingDependabotGroups(
            npmConfig.groups,
            dependency,
            dependencyType,
            updateType,
          ),
          [expectedGroup],
          `${dependency} ${updateType} must not overlap an ordinary version-update group`,
        );
      }
    }
    for (const [dependency, expectedGroup] of Object.entries(
      protectedSecurityGroups,
    )) {
      assert.deepEqual(
        matchingDependabotGroups(
          npmConfig.groups,
          dependency,
          dependencyType,
          "patch",
          "security-updates",
        ),
        [expectedGroup],
        `${dependency} must not overlap a catch-all security group`,
      );
    }
  }
  for (const groupName of [
    "production-misc",
    "tooling",
    "security-runtime",
    "security-tooling",
  ]) {
    for (const dependency of protectedRuntimeDependencies) {
      assert.ok(
        npmConfig.groups[groupName]["exclude-patterns"].includes(dependency),
        `${groupName} must exclude protected ${dependency}`,
      );
    }
  }
  for (const dependencyType of ["production", "development"]) {
    assert.deepEqual(
      matchingDependabotGroups(
        npmConfig.groups,
        "vercel",
        dependencyType,
        "major",
      ),
      [],
      "a Vercel major must stay an ungrouped protected update",
    );
  }
  for (const dependencyType of ["production", "development"]) {
    for (const updateType of ["minor", "patch"]) {
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          "vercel",
          dependencyType,
          updateType,
        ),
        "vercel-cli",
      );
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          "next",
          dependencyType,
          updateType,
        ),
        "next-runtime",
      );
      for (const dependency of ["@playwright/test", "@argos-ci/playwright"]) {
        assert.equal(
          firstDependabotGroup(
            npmConfig.groups,
            dependency,
            dependencyType,
            updateType,
          ),
          "playwright-runtime",
        );
      }
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          "pnpm",
          dependencyType,
          updateType,
        ),
        "pnpm-runtime",
      );
    }
  }
  assert.deepEqual(npmConfig.groups["test-toolchain"], {
    "applies-to": "version-updates",
    "dependency-type": "development",
    patterns: ["vite", "vitest", "@vitest/*"],
    "update-types": ["major", "minor", "patch"],
  });
  for (const dependency of ["vite", "vitest", "@vitest/coverage-v8"]) {
    for (const updateType of ["major", "minor", "patch"]) {
      assert.deepEqual(
        matchingDependabotGroups(
          npmConfig.groups,
          dependency,
          "development",
          updateType,
        ),
        ["test-toolchain"],
        `${dependency} must be coupled only through test-toolchain`,
      );
    }
  }
  for (const pattern of ["vite", "vitest", "@vitest/*"]) {
    assert.ok(npmConfig.groups.tooling["exclude-patterns"].includes(pattern));
  }

  const namedProductionGroups = ["frontend-core", "web3-stack", "ui-styling"];
  assert.deepEqual(
    web3Patterns,
    npmConfig.groups["web3-stack"].patterns,
    "focused web3 dependency grouping must stay intact",
  );
  const namedProductionPatterns = namedProductionGroups.flatMap(
    (groupName) => npmConfig.groups[groupName].patterns,
  );
  const protectedProductionPatterns = [
    ...npmConfig.groups["next-runtime"].patterns,
    ...npmConfig.groups["playwright-runtime"].patterns,
    ...npmConfig.groups["vercel-cli"].patterns,
    ...npmConfig.groups["pnpm-runtime"].patterns,
  ];
  assert.deepEqual(
    [...npmConfig.groups["production-misc"]["exclude-patterns"]].sort(),
    [
      ...new Set([...namedProductionPatterns, ...protectedProductionPatterns]),
    ].sort(),
    "production-misc exclusions must mirror named and protected production groups",
  );
  for (const [groupName, dependencies] of Object.entries({
    "frontend-core": [
      "react",
      "react-dom",
      "@types/react",
      "@vercel/analytics",
    ],
    "web3-stack": [
      "@mento-protocol/mento-sdk",
      "@metamask/jazzicon",
      "@rainbow-me/rainbowkit",
      "viem",
      "wagmi",
      "wallet-sdk",
    ],
    "ui-styling": ["@radix-ui/react-dialog", "jotai", "tailwindcss", "zod"],
  })) {
    for (const dependency of dependencies) {
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          dependency,
          "production",
          "minor",
        ),
        groupName,
        `${dependency} must route to ${groupName}`,
      );
    }
  }
  const expectedSensitiveDependencies = [
    "@celo/wallet-base",
    "@ledgerhq/connect-kit",
    "@mento-protocol/mento-sdk",
    "@metamask/jazzicon",
    "@noble/hashes",
    "@rainbow-me/rainbowkit",
    "@reown/appkit",
    "@safe-global/protocol-kit",
    "@scure/bip39",
    "@solana/web3.js",
    "@trezor/connect-web",
    "@wagmi/core",
    "@walletconnect/sign-client",
    "@wormhole-foundation/wormhole-connect",
    "ethers",
    "ethers-utils",
    "viem",
    "viem-utils",
    "wallet-sdk",
    "web3",
  ];
  for (const dependency of expectedSensitiveDependencies) {
    for (const dependencyType of ["production", "development"]) {
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          dependency,
          dependencyType,
          "minor",
        ),
        "web3-stack",
        `${dependency} (${dependencyType}) must route to web3-stack`,
      );
    }
  }
  assert.equal(
    firstDependabotGroup(npmConfig.groups, "date-fns", "production", "patch"),
    "production-misc",
  );
  assert.equal(
    firstDependabotGroup(npmConfig.groups, "eslint", "development", "patch"),
    "tooling",
  );

  assert.deepEqual(npmConfig.groups["web3-stack-security"], {
    "applies-to": "security-updates",
    patterns: web3Patterns,
  });
  const securityExclusions = [...protectedRuntimeDependencies, ...web3Patterns];
  assert.deepEqual(npmConfig.groups["security-runtime"], {
    "applies-to": "security-updates",
    "dependency-type": "production",
    patterns: ["*"],
    "exclude-patterns": securityExclusions,
  });
  assert.deepEqual(npmConfig.groups["security-tooling"], {
    "applies-to": "security-updates",
    "dependency-type": "development",
    patterns: ["*"],
    "exclude-patterns": securityExclusions,
  });
  for (const dependency of expectedSensitiveDependencies) {
    for (const dependencyType of ["production", "development"]) {
      assert.deepEqual(
        matchingDependabotGroups(
          npmConfig.groups,
          dependency,
          dependencyType,
          "patch",
          "security-updates",
        ),
        ["web3-stack-security"],
        `${dependency} security update must stay in the focused web3 security group`,
      );
    }
  }
  assert.deepEqual(npmConfig.ignore, [
    {
      "dependency-name": "wagmi",
      "update-types": ["version-update:semver-major"],
    },
  ]);
  const wagmiHoldDeadline =
    /# wagmi-major-review-deadline: (\d{4}-\d{2}-\d{2})$/mu.exec(
      dependabotSource,
    )?.[1];
  assert.equal(wagmiHoldDeadline, "2027-03-09");
  const wagmiHoldDeadlineMs = Date.parse(`${wagmiHoldDeadline}T00:00:00Z`);
  assert.ok(
    Date.now() < wagmiHoldDeadlineMs,
    `The Wagmi major-version hold expired on ${wagmiHoldDeadline}. Recheck RainbowKit's Wagmi v3 support, then remove or renew the hold with current evidence.`,
  );

  const routine = actionsConfig.groups["github-actions-routine"];
  const manual = actionsConfig.groups["github-actions-manual"];
  assert.deepEqual(manual.patterns, routine["exclude-patterns"]);
  assert.deepEqual(sensitiveActionPatterns, routine["exclude-patterns"]);
  const actionDependencies = new Set();
  const githubRoot = fileURLToPath(new URL("../.github/", import.meta.url));
  for (const path of filesBelow(githubRoot).filter((entry) =>
    /\.ya?ml$/u.test(entry),
  )) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gmu)) {
      const dependency = match[1].replace(/^['"]|['"]$/gu, "").split("@")[0];
      if (!dependency.startsWith("./") && dependency.includes("/")) {
        actionDependencies.add(dependency);
      }
    }
  }
  const sensitive = [...actionDependencies]
    .filter((dependency) =>
      /(?:create-github-app-token|dependency-review|anthropic|claude|codex|copilot|codeql|dependabot|osv|scorecard|security|harden-runner|trivy|snyk|attest|reviewer|review-action)/iu.test(
        dependency,
      ),
    )
    .sort();
  assert.deepEqual(sensitive, [
    "actions/dependency-review-action",
    "anthropics/claude-code-action",
    "github/codeql-action/upload-sarif",
    "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml",
    "google/osv-scanner-action/osv-reporter-action",
    "google/osv-scanner-action/osv-scanner-action",
    "ossf/scorecard-action",
  ]);
  for (const dependency of sensitive) {
    assert.ok(
      routine["exclude-patterns"].some((pattern) =>
        dependabotPatternMatches(pattern, dependency),
      ),
      `${dependency} must stay out of the routine Actions group`,
    );
  }

  for (const packagePath of workspacePackagePaths()) {
    const manifest = JSON.parse(read(packagePath));
    for (const [manifestKey, dependencyType] of [
      ["dependencies", "production"],
      ["devDependencies", "development"],
    ]) {
      for (const [dependency, version] of Object.entries(
        manifest[manifestKey] ?? {},
      )) {
        if (String(version).startsWith("workspace:")) continue;
        for (const updateType of ["minor", "patch"]) {
          assert.ok(
            firstDependabotGroup(
              npmConfig.groups,
              dependency,
              dependencyType,
              updateType,
            ),
            `${packagePath} ${dependency} has no ${updateType} group`,
          );
        }
      }
    }
  }
});

test("repository workflow code cannot merge Dependabot pull requests", () => {
  const workflowDirectory = fileURLToPath(
    new URL("../.github/workflows/", import.meta.url),
  );
  assert.equal(
    existsSync(
      new URL(
        "../.github/workflows/dependabot-auto-merge.yml",
        import.meta.url,
      ),
    ),
    false,
  );
  const forbiddenMergeAuthority =
    /gh\s+pr\s+merge|enablePullRequestAutoMerge|enqueuePullRequest|mergePullRequest|\/pulls\/[^\s"'`]*\/merge|pulls\.merge/iu;

  const actionDirectory = fileURLToPath(
    new URL("../.github/actions/", import.meta.url),
  );
  const scriptDirectory = fileURLToPath(
    new URL("../scripts/", import.meta.url),
  );
  const authoritySources = [
    ...filesBelow(workflowDirectory).filter((path) => /\.ya?ml$/u.test(path)),
    ...filesBelow(actionDirectory).filter((path) =>
      /\.(?:c?js|mjs|sh|ts|ya?ml)$/u.test(path),
    ),
    ...filesBelow(scriptDirectory).filter(
      (path) =>
        /\.(?:js|mjs|sh|ts)$/u.test(path) &&
        !/\.test\.(?:js|mjs|ts)$/u.test(path),
    ),
    fileURLToPath(new URL("../package.json", import.meta.url)),
  ];
  for (const path of authoritySources) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      forbiddenMergeAuthority,
      `${path} must not merge or enable native auto-merge`,
    );
  }
});

test("entry instructions resolve to the canonical trusted-agent playbook", () => {
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.equal(policy.canonicalPlaybook, "docs/dependabot-automation.md");
  assert.equal(policy.entryPrompt, "scripts/prompts/dependabot-weekly.md");
  assert.deepEqual(policy.workflow, {
    skill: "dependabot-prep",
    revision: "trusted-agent-v2",
    runtimes: ["openclaw", "codex", "claude"],
    hostProfile: "giskard-capped-otherwise-portable-serial",
  });
  const entry = read(policy.entryPrompt);
  assert.ok(entry.includes(policy.workflow.skill));
  assert.ok(entry.includes(policy.workflow.revision));
  assert.ok(entry.includes(policy.repository));
  assert.ok(entry.includes("giskard-only scheduled-job adapter"));
  assert.ok(entry.includes("Verify the host before writes"));
  assert.ok(entry.includes("On another host, stop this adapter"));
  for (const path of [policy.canonicalPlaybook, policy.entryPrompt]) {
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
    assert.ok(read(path).includes(".github/dependabot-prep-policy.json"), path);
  }
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    policy.entryPrompt,
  ]) {
    assert.ok(read(path).includes(policy.canonicalPlaybook), path);
  }
});

test("runtime guidance does not reinstate retired no-exec admission", () => {
  const guide = read("docs/dependency-overrides.md");
  assert.ok(guide.includes("[canonical playbook](dependabot-automation.md)"));
  assert.doesNotMatch(guide, /v3 playbook|under v3/u);
  assert.doesNotMatch(guide, /scheduled no-exec agent must classify/u);
  assert.doesNotMatch(guide, /generic external agent must not prepare/u);
  assert.doesNotMatch(guide, /For the automatic patch lane/u);
  for (const command of [
    "pnpm supply-chain:version-skew",
    "pnpm supply-chain:lockfile-lint",
    "pnpm vercel:versions:check",
    "pnpm vercel:production-shadow:test",
    "pnpm vercel:workflow:test",
  ]) {
    assert.ok(guide.includes(command), command);
  }
});

test("claims policy validates against mento-claims-config v1", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  const claims = policy.coordination.claims;
  assert.equal(policy.coordination.primitive, "github-ref-claims");
  assert.equal(claims.schema, "mento-claims-config:v1");
  assert.equal(claims.profile, "pr");
  assert.match(claims.namespace, /^refs\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u);
  assert.equal(claims.scopeTemplate, `${claims.namespace}/{pr}`);
  assert.ok(claims.renewMinutes > 0);
  assert.ok(claims.renewMinutes * 2 <= claims.ttlMinutes);
  assert.ok(claims.ttlMinutes <= claims.maxTtlMinutes);
  assert.ok(claims.maxTtlMinutes <= 360);
  assert.ok(claims.graceMinutes >= 1);
  // Grace absorbs clock disagreement between the expiring owner and the taker,
  // so it must exceed the tolerated skew or the two can both believe they own
  // the claim.
  assert.ok(claims.graceMinutes * 60 > claims.skewToleranceSeconds);
  assert.ok(claims.minRemainingSeconds >= 30);
  assert.ok(claims.minRemainingSeconds * 1000 < claims.renewMinutes * 60_000);
  assert.match(claims.label, /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,49}$/u);
  assert.deepEqual(claims.requiredBefore, ["branch-push", "review-request"]);
  assert.deepEqual(claims.advisoryBefore, [
    "summary-comment",
    "inline-reply",
    "long-wait",
  ]);
  // The policy names purposes and the CLI names `--gate` values. Two of the five
  // differ, so the playbook has to carry the mapping; without it an agent that
  // reads `requiredBefore` as operating parameters passes `--gate branch-push`
  // and is refused.
  const playbookGates = read(policy.canonicalPlaybook).replaceAll(/\s+/gu, " ");
  assert.ok(
    playbookGates.includes(
      "`branch-push` in `requiredBefore` is `--gate push`",
    ),
  );
  assert.ok(
    playbookGates.includes("`long-wait` in `advisoryBefore` is `--gate wait`"),
  );
  for (const purpose of [...claims.requiredBefore, ...claims.advisoryBefore]) {
    assert.ok(playbookGates.includes(`\`${purpose}\``), purpose);
  }
  assert.equal(claims.allowOverrides, false);
  assert.equal(claims.allowCloudWriters, false);
  assert.equal(Object.hasOwn(claims, "waitUnderGuard"), false);
  assert.deepEqual(claims.command, ["pnpm", "dependabot:claim", "--"]);
  assert.equal(policy.coordination.hostLock.scope, "host-local-heavy-tree");
  assert.equal(policy.coordination.hostLock.path, HOST_LOCK_PATH_TEMPLATE);
  assert.equal(policy.coordination.hostLock.pathMacos, HOST_LOCK_PATH_MACOS);
});

test("activeBatches cannot reappear in policy limits", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  assert.equal(Object.hasOwn(policy.limits, "activeBatches"), false);
  assert.doesNotMatch(read(CLAIM_POLICY), /activeBatches/u);
});

test("the claims package pin is exact and consumed through pnpm dlx", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  const pin = policy.coordination.claims.package;
  assert.equal(pin.name, "@mento-protocol/issues");
  assert.match(pin.version, /^\d+\.\d+\.\d+$/u);
  assert.equal(Object.hasOwn(pin, "minimumVersion"), false);
  const manifest = JSON.parse(read("package.json"));
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    assert.equal(Object.hasOwn(manifest[field] ?? {}, pin.name), false, field);
  }
  assert.doesNotMatch(read("pnpm-lock.yaml"), /@mento-protocol\/issues/u);
  // `--package=<spec>` selects the binary by name. Without it `pnpm dlx` reads
  // its first positional as the package specifier alone and forwards the rest
  // to the binary it derives, so `pnpm dlx <spec> mento-issues …` would deliver
  // `mento-issues` to the CLI as its first argument. `--ignore-scripts` is not
  // a `dlx` option, so the suppression is spelled `--config.ignore-scripts=true`
  // and keeps the whole resolved tree's install scripts off.
  const run = runClaimWrapper(["claims", "read", "--pr", "872", "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const argv = run.stdout.trim().split("\n");
  const injected = assertInjectedConfig(argv, { after: ["claims", "read"] });
  assert.deepEqual(argv, [
    "--config.ignore-scripts=true",
    `--package=${pin.name}@${pin.version}`,
    "dlx",
    "mento-issues",
    "claims",
    "read",
    "--config",
    injected,
    "--pr",
    "872",
    "--json",
  ]);
});

test("the documented pnpm invocation reaches the wrapper intact", () => {
  // pnpm 10.34.5 forwards its own `--` as the script's first argument, so the
  // documented `pnpm dependabot:claim -- claims claim ...` form arrives at the
  // wrapper with a leading separator that must not be read as the guard
  // separator. Both documented shapes run through the real pnpm here, so a
  // change in that behaviour fails this test instead of the weekly job.
  const pin = authorityJson(read(CLAIM_POLICY)).coordination.claims.package;
  const plain = runDocumentedForm([
    "--",
    "claims",
    "claim",
    "--pr",
    "872",
    "--json",
  ]);
  assert.equal(plain.run.status, 0, plain.run.stderr);
  const plainConfig = assertInjectedConfig(plain.argv, {
    after: ["claims", "claim"],
  });
  assert.deepEqual(plain.argv, [
    "--config.ignore-scripts=true",
    `--package=${pin.name}@${pin.version}`,
    "dlx",
    "mento-issues",
    "claims",
    "claim",
    "--config",
    plainConfig,
    "--pr",
    "872",
    "--json",
  ]);

  const guarded = runDocumentedForm([
    "--",
    "claims",
    "guard",
    "--pr",
    "872",
    "--token",
    "a".repeat(40),
    "--run-id",
    "rehearsal-a",
    "--gate",
    "push",
    "--",
    "/bin/echo",
    "pushed",
  ]);
  assert.equal(guarded.run.status, 0, guarded.run.stderr);
  const guardedConfig = assertInjectedConfig(guarded.argv, {
    after: ["claims", "guard"],
  });
  assert.deepEqual(guarded.argv, [
    "--config.ignore-scripts=true",
    `--package=${pin.name}@${pin.version}`,
    "dlx",
    "mento-issues",
    "claims",
    "guard",
    "--config",
    guardedConfig,
    "--pr",
    "872",
    "--token",
    "a".repeat(40),
    "--run-id",
    "rehearsal-a",
    "--gate",
    "push",
    "--",
    "/bin/echo",
    "pushed",
  ]);
});

test("the claim wrapper drops the separator pnpm forwards", () => {
  const pin = authorityJson(read(CLAIM_POLICY)).coordination.claims.package;
  const run = runClaimWrapper([
    "--",
    "claims",
    "claim",
    "--pr",
    "872",
    "--json",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const argv = run.stdout.trim().split("\n");
  const injected = assertInjectedConfig(argv, { after: ["claims", "claim"] });
  assert.deepEqual(argv, [
    "--config.ignore-scripts=true",
    `--package=${pin.name}@${pin.version}`,
    "dlx",
    "mento-issues",
    "claims",
    "claim",
    "--config",
    injected,
    "--pr",
    "872",
    "--json",
  ]);
});

test("the claim wrapper forwards a guarded child's own config flag", () => {
  const pin = authorityJson(read(CLAIM_POLICY)).coordination.claims.package;
  const run = runClaimWrapper([
    "--",
    "claims",
    "guard",
    "--pr",
    "872",
    "--token",
    "a".repeat(40),
    "--run-id",
    "rehearsal-a",
    "--gate",
    "push",
    "--",
    "git",
    "push",
    "--config",
    "push.default=simple",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const argv = run.stdout.trim().split("\n");
  const injected = assertInjectedConfig(argv, { after: ["claims", "guard"] });
  assert.deepEqual(argv, [
    "--config.ignore-scripts=true",
    `--package=${pin.name}@${pin.version}`,
    "dlx",
    "mento-issues",
    "claims",
    "guard",
    "--config",
    injected,
    "--pr",
    "872",
    "--token",
    "a".repeat(40),
    "--run-id",
    "rehearsal-a",
    "--gate",
    "push",
    "--",
    "git",
    "push",
    "--config",
    "push.default=simple",
  ]);
});

test("the claim wrapper refuses a policy package name it cannot trust", () => {
  // A name that begins with a dash is refused too: the pin is concatenated into
  // a `pnpm` argument, and the guard must not depend on that concatenation
  // happening to defuse a flag.
  for (const name of ["--package=other-package", "--registry", "-r", "-"]) {
    const refused = runClaimWrapperWithPin({ name }, [
      "claims",
      "read",
      "--pr",
      "872",
    ]);
    assert.equal(refused.status, 3, name);
    assert.match(refused.stderr, /must be an npm package name/u, name);
  }
  const accepted = runClaimWrapperWithPin({}, [
    "claims",
    "read",
    "--pr",
    "872",
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
});

test("the claim wrapper inserts its config flag before a guard separator", () => {
  const run = runClaimWrapper([
    "claims",
    "guard",
    "--pr",
    "872",
    "--token",
    "a".repeat(40),
    "--run-id",
    "rehearsal-a",
    "--gate",
    "push",
    "--",
    "/bin/echo",
    "ok",
  ]);
  assert.equal(run.status, 0, run.stderr);
  const argv = run.stdout.trim().split("\n");
  assert.deepEqual(argv.slice(-3), ["--", "/bin/echo", "ok"]);
  // The flag follows the group and command words, so no caller flag can take
  // the policy path as its value, and it stays before the guard separator. The
  // four leading tokens are pnpm's own: the script suppression, the package
  // selector, `dlx` and the binary name.
  const injected = assertInjectedConfig(argv, { after: ["claims", "guard"] });
  assert.deepEqual(argv.slice(4, 8), ["claims", "guard", "--config", injected]);
  assert.ok(argv.indexOf("--config") < argv.indexOf("--"));
});

test("the claim wrapper reads its policy from the default branch, not the tree", () => {
  // The wrapper must not trust the checkout it runs from: a per-PR worktree is
  // a candidate branch, and a candidate branch may edit the policy. Everything
  // the wrapper acts on therefore comes out of the object store.
  const wrapper = read(CLAIM_WRAPPER);
  assert.match(wrapper, /refs\/remotes\/origin\/main/u);
  assert.match(wrapper, /cat-file/u);
  assert.doesNotMatch(wrapper, /new URL\(\s*"\.\.\/\.github/u);

  // A revision whose policy differs from the working tree's decides the pin and
  // the injected bytes, which the working tree could not do if it were read.
  const edited = authorityJson(read(CLAIM_POLICY));
  edited.coordination.claims.package.version = "9.9.9";
  edited.coordination.claims.namespace = "refs/mento-claims/v1/rehearsal";
  const editedText = JSON.stringify(edited);
  const revision = policyRevision(editedText);

  const captured = mkdtempSync(join(tmpdir(), "dependabot-claim-config-"));
  try {
    const configCopy = join(captured, "forwarded.json");
    const run = withStubPnpm(
      0,
      (environment) =>
        spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)),
            "claims",
            "read",
            "--pr",
            "872",
          ],
          { encoding: "utf8", env: environment },
        ),
      { configCopy, policyRef: revision },
    );
    assert.equal(run.status, 0, run.stderr);
    const argv = run.stdout.trim().split("\n");
    const pin = authorityJson(read(CLAIM_POLICY)).coordination.claims.package;
    assert.ok(argv.includes(`--package=${pin.name}@9.9.9`));
    assert.equal(argv.includes(`--package=${pin.name}@${pin.version}`), false);

    // The forwarded file is byte-identical to the blob at that revision, and it
    // is not the working tree's file.
    assert.equal(readFileSync(configCopy, "utf8"), editedText);
    assert.equal(
      readFileSync(configCopy, "utf8"),
      git(["cat-file", "blob", `${revision}:${CLAIM_POLICY}`]),
    );
    assert.notEqual(readFileSync(configCopy, "utf8"), read(CLAIM_POLICY));

    // The wrapper names the revision it used, so a stale fetch is visible, and
    // it removes the copy as it exits rather than leaving policy bytes behind.
    assert.match(run.stderr, new RegExp(revision, "u"));
    assert.equal(existsSync(assertInjectedConfig(argv, { after: [] })), false);
  } finally {
    rmSync(captured, { recursive: true, force: true });
  }
});

test("the claim wrapper fails closed when the policy revision is missing", () => {
  const missingRef = withStubPnpm(
    0,
    (environment) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)),
          "claims",
          "read",
          "--pr",
          "872",
        ],
        { encoding: "utf8", env: environment },
      ),
    { policyRef: "refs/remotes/origin/no-such-default-branch" },
  );
  assert.equal(missingRef.status, 3);
  assert.match(missingRef.stderr, /cannot resolve/u);

  // A revision that exists but carries no policy file is refused just as hard,
  // so a truncated fetch cannot silently fall back to anything.
  const emptyTree = git(["mktree"], "");
  const missingFile = withStubPnpm(
    0,
    (environment) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)),
          "claims",
          "read",
          "--pr",
          "872",
        ],
        { encoding: "utf8", env: environment },
      ),
    { policyRef: emptyTree },
  );
  assert.equal(missingFile.status, 3);
  assert.match(missingFile.stderr, /cannot read \.github/u);

  // A ref that could reach `git` as a flag is refused before `git` runs.
  const flagRef = withStubPnpm(
    0,
    (environment) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)),
          "claims",
          "read",
          "--pr",
          "872",
        ],
        { encoding: "utf8", env: environment },
      ),
    { policyRef: "--upload-pack=touch" },
  );
  assert.equal(flagRef.status, 3);
  assert.match(flagRef.stderr, /must be a git ref or object id/u);
});

test("the unpublished-package fallback stays under the wrapper's checks", () => {
  // The playbook's fallback for an unpublished pin runs through the wrapper, so
  // it keeps the default-branch policy, the schema check and the injected
  // `--config`, and it adds an exact-pin check the raw binary could not make.
  const pin = authorityJson(read(CLAIM_POLICY)).coordination.claims.package;
  const checkout = mkdtempSync(join(tmpdir(), "dependabot-claim-package-"));
  try {
    mkdirSync(join(checkout, "bin"));
    writeFileSync(
      join(checkout, "bin", "mento-issues.mjs"),
      `#!/usr/bin/env node\nfor (const argument of process.argv.slice(2)) console.log(argument);\n`,
    );
    const manifest = (version) =>
      writeFileSync(
        join(checkout, "package.json"),
        `${JSON.stringify({
          name: pin.name,
          version,
          bin: { "mento-issues": "bin/mento-issues.mjs" },
        })}\n`,
      );

    manifest(pin.version);
    const environment = { ...process.env };
    environment.DEPENDABOT_CLAIM_POLICY_REF = policyRevision();
    environment.DEPENDABOT_CLAIM_PACKAGE_DIR = checkout;
    const wrapperPath = fileURLToPath(
      new URL(`../${CLAIM_WRAPPER}`, import.meta.url),
    );
    const run = spawnSync(
      process.execPath,
      [wrapperPath, "claims", "doctor", "--json"],
      { encoding: "utf8", env: environment },
    );
    assert.equal(run.status, 0, run.stderr);
    const argv = run.stdout.trim().split("\n");
    const injected = assertInjectedConfig(argv, {
      after: ["claims", "doctor"],
    });
    assert.deepEqual(argv, [
      "claims",
      "doctor",
      "--config",
      injected,
      "--json",
    ]);

    // A checkout that is not exactly the pinned version is refused, so the
    // fallback cannot run a version the policy does not name.
    manifest("9.9.9");
    const mismatched = spawnSync(
      process.execPath,
      [wrapperPath, "claims", "doctor"],
      { encoding: "utf8", env: environment },
    );
    assert.equal(mismatched.status, 3);
    assert.match(mismatched.stderr, /must hold .*@/u);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("the claim wrapper refuses a caller config and forwards the exit code", () => {
  const refused = runClaimWrapper([
    "claims",
    "read",
    "--pr",
    "872",
    "--config",
    "/nonexistent/other-policy.json",
  ]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /supplies --config from repository policy/u);
  const joined = runClaimWrapper([
    "claims",
    "read",
    "--pr",
    "872",
    "--config=/nonexistent/other-policy.json",
  ]);
  assert.equal(joined.status, 2);
  assert.match(joined.stderr, /supplies --config from repository policy/u);
  const superseded = runClaimWrapper(
    ["claims", "verify", "--pr", "872", "--json"],
    { exitCode: 13 },
  );
  assert.equal(superseded.status, 13);
});

test("the claim wrapper forwards a termination signal to the claim command", async () => {
  // A signal addressed to the wrapper's pid alone must not orphan a guard that
  // keeps renewing the claim. The child runs in its own process group here, so
  // only the wrapper receives the signal.
  const stubDirectory = mkdtempSync(join(tmpdir(), "dependabot-claim-signal-"));
  const started = join(stubDirectory, "started.txt");
  const terminated = join(stubDirectory, "terminated.txt");
  try {
    writeFileSync(
      join(stubDirectory, "pnpm"),
      `#!/bin/sh\ntrap "printf terminated > '${terminated}'; exit 0" TERM\nprintf started > '${started}'\nwhile true; do sleep 1; done\n`,
      { mode: 0o755 },
    );
    const environment = { ...process.env };
    environment.PATH = `${stubDirectory}${delimiter}${environment.PATH}`;
    environment.DEPENDABOT_CLAIM_POLICY_REF = policyRevision();
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)),
        "claims",
        "guard",
        "--pr",
        "872",
        "--gate",
        "push",
      ],
      { env: environment, detached: true, stdio: "ignore" },
    );
    const exited = new Promise((resolve) => child.on("exit", resolve));
    await waitForFile(started);
    process.kill(child.pid, "SIGTERM");
    const exitCode = await exited;
    await waitForFile(terminated);
    assert.equal(readFileSync(terminated, "utf8"), "terminated");
    // The stub traps the signal and exits 0. An interrupted run must not reach
    // the caller as "proceed", and `128 + signal` is outside the coarse rule, so
    // the wrapper reports the rule's "stop and report" code instead.
    assert.equal(exitCode, 3);
  } finally {
    rmSync(stubDirectory, { recursive: true, force: true });
  }
});

test("the claim wrapper exists and is wired to the policy", () => {
  assert.ok(existsSync(new URL(`../${CLAIM_WRAPPER}`, import.meta.url)));
  const manifest = JSON.parse(read("package.json"));
  assert.equal(
    manifest.scripts["dependabot:claim"],
    "node scripts/dependabot-claim.mjs",
  );
  const policy = authorityJson(read(CLAIM_POLICY));
  assert.ok(policy.changes.needsDecisionPaths.includes(CLAIM_WRAPPER));
  const wrapper = read(CLAIM_WRAPPER);
  assert.ok(wrapper.includes(policy.schema));
  assert.doesNotMatch(wrapper, /@mento-protocol\/issues/u);
  assert.doesNotMatch(wrapper, /\bimport\s*\(/u);
  // `pnpm dlx` resolves the package into a temporary project outside this
  // workspace, so `onlyBuiltDependencies` does not gate that install. The
  // suppression the wrapper passes covers the whole resolved tree, and both
  // documents say so rather than naming a per-package check as the control.
  assert.match(wrapper, /--config\.ignore-scripts=true/u);
  assert.match(wrapper, /--package=/u);
  assert.match(
    read(policy.canonicalPlaybook),
    /--config\.ignore-scripts=true/u,
  );
  assert.doesNotMatch(wrapper, /lifecycle scripts run/u);
});

test("the summary marker keeps the v1 token and adds the v2 claim schema", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  assert.equal(
    policy.reporting.prCommentMarker,
    "<!-- mento-dependabot-preparation:v1 -->",
  );
  assert.equal(
    policy.reporting.prCommentClaimMarkerSchema,
    "mento-dependabot-preparation:v2",
  );
  assert.equal(Object.hasOwn(policy.reporting, "prCommentMarkerPrefix"), false);
  assert.equal(Object.hasOwn(policy.reporting, "prCommentMarkerSchema"), false);
  const playbook = read(policy.canonicalPlaybook);
  assert.ok(playbook.includes(policy.reporting.prCommentMarker));
  assert.ok(
    playbook.includes(
      `<!-- ${policy.reporting.prCommentClaimMarkerSchema} pr=`,
    ),
  );
});

test("the playbook and prompt carry the skill revision stop sentence", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  for (const path of [policy.canonicalPlaybook, policy.entryPrompt]) {
    const document = read(path);
    assert.ok(document.includes(policy.workflow.revision), path);
    assert.ok(document.includes("stop before any write"), path);
  }
});

test("the playbook and prompt carry the coarse exit-code rule", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  for (const path of [policy.canonicalPlaybook, policy.entryPrompt]) {
    // Both documents hard-wrap, so compare against collapsed whitespace and let
    // the rule's wording, not its line breaks, decide.
    const document = read(path).replaceAll(/\s+/gu, " ");
    // The rule is copied verbatim from the CLI's COARSE_EXIT_RULE, which spells
    // the command bare. Backticks around `adopt` would read the same but make
    // the four prose copies differ from the string they quote.
    assert.ok(document.includes("12 run adopt;"), path);
    // The contract's exit-13 clause scopes the stop to this PR and states the
    // forfeit; a bare "stop publishing" reads as halting the whole batch and
    // leaves the prepared commit looking reusable.
    assert.ok(
      document.includes(
        "13 stop publishing this PR and treat work in flight as forfeit",
      ),
      path,
    );
  }
});

test("the playbook documents the claim label and the legacy lock migration", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  const playbook = read(policy.canonicalPlaybook);
  assert.ok(playbook.includes(policy.coordination.claims.label));
  assert.ok(
    playbook.includes(`${policy.coordination.claims.namespace}/<number>`),
  );
  assert.ok(playbook.includes("/home/molt/.local/state/mento-dependabot"));
  assert.ok(playbook.includes("Rollback"));
  // The retired directory also holds the v1 runs' reports, so the migration
  // removes the lock child alone and the preservation rule stays written down.
  assert.ok(
    playbook.includes(
      "ssh giskard 'rm -rf /home/molt/.local/state/mento-dependabot/active'",
    ),
  );
  assert.doesNotMatch(
    playbook,
    /rm -rf \/home\/molt\/\.local\/state\/mento-dependabot'/u,
  );
  assert.ok(playbook.includes("Preserve reports and checkouts"));
  // The rollback meets the state it is most likely to meet — a claim still held
  // — so it stops there first, and it names the revert rather than a hand-edited
  // subset that would leave the suites red.
  // The rollback inventory must list every claim: `--stale` filters to expired
  // leases, so a writer holding a fresh LOCK would be invisible and rollback
  // could restore the legacy lock while that writer still publishes.
  const rollbackStart = playbook.indexOf("Rollback runs in reverse");
  assert.ok(rollbackStart > 0, "playbook has a rollback section");
  const rollback = playbook.slice(rollbackStart);
  assert.ok(rollback.includes("claims list --json"));
  assert.ok(!rollback.includes("list --stale"));
  assert.match(rollback, /every returned `state` is `UNLOCK`/u);
  // The stale-lock recovery path elsewhere still uses the filtered listing.
  assert.ok(playbook.includes("claims list --stale --json"));
  assert.ok(playbook.includes("--outcome family-rollback"));
  assert.ok(playbook.includes("label:%22dependabot-prep:claimed%22"));
  assert.match(playbook, /Revert the pull request that introduced/u);
  // The prune is the operator's, and the playbook the preparation agent reads
  // says so beside the mutation.
  assert.ok(playbook.includes("`delete-claim-refs` is"));
});

test("the publication steps name the mandatory claim gates", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  const playbook = read(policy.canonicalPlaybook);
  assert.deepEqual(policy.coordination.claims.requiredBefore, [
    "branch-push",
    "review-request",
  ]);
  // The fenced push block's fragments are pinned above, so the fence is named in the
  // prose that introduces it and in the review-request step beside it.
  const [, pushStep] = playbook.split("   Require an existing, nonzero 40-hex");
  assert.match(pushStep.split("```")[0], /claims guard --gate push/u);
  const [, reviewStep] = playbook.split("5. Request CodeRabbit once per head");
  assert.match(
    reviewStep.split("\n6.")[0],
    /claims guard --gate review-request/u,
  );
});

test("the playbook names the read-only, advisory and record-keeping commands", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  const playbook = read(policy.canonicalPlaybook).replaceAll(/\s+/gu, " ");
  assert.ok(playbook.includes("claims read --pr <n>"));
  assert.ok(playbook.includes("--gate summary-comment"));
  assert.ok(playbook.includes("--set lastPushedHead=<sha>"));
  assert.ok(playbook.includes("reviewRequestedHead=<sha>"));
  assert.ok(playbook.includes("summaryCommentUrl=<url>"));
  assert.ok(playbook.includes("--if-due"));
  // `pnpm run` resolves the script from the nearest package.json, and the
  // wrapper hands its own working directory to a guarded child, so a per-PR
  // tree needs both an explicit `--dir` and an explicit `git -C`.
  assert.ok(
    playbook.includes(
      "pnpm --dir <main-tracking-checkout> dependabot:claim -- claims <command>",
    ),
  );
  assert.ok(playbook.includes("git -C <pr-worktree>"));
  assert.ok(playbook.includes("linked `git worktree`"));
});

test("the retired coordinator instruction is gone from the playbook and prompt", () => {
  const policy = authorityJson(read(CLAIM_POLICY));
  const documents = read(policy.canonicalPlaybook) + read(policy.entryPrompt);
  assert.doesNotMatch(
    documents,
    /shared batch lock|single-batch lock|SSH to giskard as molt|existing session and batch lock|Acquire a single-batch lock/u,
  );
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    assert.doesNotMatch(
      read(path),
      /single-batch lock|trusted-agent-v1/u,
      path,
    );
  }
});

test("README no longer claims a single active batch", () => {
  const readme = read("README.md");
  assert.doesNotMatch(readme, /One active batch/u);
  assert.match(readme, /One claim\s+per pull request/u);
});
