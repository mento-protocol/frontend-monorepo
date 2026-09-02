import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function dependabotGroupMatches(group, dependency, dependencyType, updateType) {
  if ((group["applies-to"] ?? "version-updates") !== "version-updates") {
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

function firstDependabotGroup(groups, dependency, dependencyType, updateType) {
  return Object.entries(groups).find(([, group]) =>
    dependabotGroupMatches(group, dependency, dependencyType, updateType),
  )?.[0];
}

const CLAUDE_ACTION =
  "anthropics/claude-code-action@e5ad3c7725bc2459721893f88879fef9dbcf97b0";
const CLAUDE_PLUGIN_MARKETPLACE = "./.claude-code-plugin-marketplace";
const CLAUDE_CODE_REVIEW_PLUGIN = `${CLAUDE_PLUGIN_MARKETPLACE}/plugins/code-review`;
const CLAUDE_PLUGIN_MARKETPLACE_REF =
  "2bb60696142b493eafaeacfe00eac51d16c50c4f";
const DEPENDABOT_POLICY_TOP_LEVEL_KEYS = [
  "baseRef",
  "branchMaintenance",
  "feedback",
  "githubActions",
  "history",
  "identities",
  "nativeCommit",
  "repository",
  "schema",
  "trustedMaintainer",
  "vetoLabels",
];
function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected)
  );
}

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

test("agent preparation policy pins the repository authority contract", () => {
  assert.throws(() => authorityJson('{"schema":"first","schema":"second"}'));
  assert.throws(() =>
    authorityJson(
      '{"schema":"dependabot-prep-policy:v1","identities":{"pullRequestAuthor":{},"pullRequestAuthor":{}}}',
    ),
  );
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.equal(hasExactKeys(policy, DEPENDABOT_POLICY_TOP_LEVEL_KEYS), true);
  assert.equal(
    hasExactKeys(
      { ...policy, unknownAuthority: { merge: true } },
      DEPENDABOT_POLICY_TOP_LEVEL_KEYS,
    ),
    false,
  );
  assert.equal(policy.schema, "dependabot-prep-policy:v1");
  assert.equal(policy.repository, "mento-protocol/frontend-monorepo");
  assert.equal(policy.baseRef, "main");
  assert.deepEqual(policy.identities, {
    pullRequestAuthor: {
      id: 49699333,
      login: "dependabot[bot]",
      type: "Bot",
    },
    forcePushActor: { id: 49699333, login: "dependabot", type: "Bot" },
    nativeCommitAuthor: {
      id: 49699333,
      login: "dependabot[bot]",
      type: "Bot",
    },
    nativeCommitters: [
      { id: 49699333, login: "dependabot[bot]", type: "Bot" },
      { id: 19864447, login: "web-flow", type: "User" },
    ],
  });
  assert.deepEqual(policy.nativeCommit, {
    parentCount: 1,
    verified: true,
    verificationReason: "valid",
  });
  assert.deepEqual(policy.trustedMaintainer, {
    associations: ["COLLABORATOR", "MEMBER", "OWNER"],
    branchMaintenancePermissions: ["admin", "write"],
  });
  assert.deepEqual(policy.vetoLabels, [
    "dependencies:manual",
    "dependabot:manual",
    "do-not-merge",
    "no-auto-merge",
    "processor:veto",
  ]);
  assert.deepEqual(policy.branchMaintenance, {
    commands: ["@dependabot rebase", "@dependabot recreate"],
    requirePositiveCommentId: true,
    requireUneditedComment: true,
    requireValidUtcTimestamps: true,
    rebaseResetsForcePushHistory: false,
    recreateStartsGenerationAfterComment: true,
  });
  assert.deepEqual(policy.feedback, {
    requireCompletePagination: true,
    reviewRequest: {
      acceptedStates: ["APPROVED", "COMMENTED"],
      body: "@coderabbitai review",
      reviewer: {
        id: 136622811,
        login: "coderabbitai[bot]",
        type: "Bot",
      },
      requiresAuthenticatedOperator: true,
      requiresAppendOnlyInvocationRecords: true,
      requiresExactHeadBindingAtCreation: true,
      requiresStableCommentId: true,
      historicalAuthenticatedHeadsRemainAdmitted: true,
    },
    topLevelResponse: {
      markerSchema: "dependabot-prep-comment:v1",
      requiresAppendOnlyInvocationRecord: true,
      requiresAuthenticatedOperator: true,
      requiresExactHeadBindingAtCreation: true,
      requiresRootBodyDigest: true,
      requiresRootIdDigest: true,
      requiresStableCommentId: true,
      requiresVisibleBodyDigest: true,
    },
    dependabotOperationalComments: {
      actor: {
        id: 49699333,
        login: "dependabot[bot]",
        type: "Bot",
      },
      associations: ["CONTRIBUTOR", "NONE"],
      bodyRule: "any-bounded-body",
      maximumBodyLength: 50_000,
    },
    informationalBotIssueComments: {
      maximumBodyLength: 50_000,
      rules: [
        {
          actor: {
            id: 41898282,
            login: "github-actions[bot]",
            type: "Bot",
          },
          app: { id: 15368, slug: "github-actions" },
          associations: ["NONE"],
          predicates: [
            {
              kind: "startsWith",
              value: "<!-- vercel-preview-journal:v2 -->",
            },
            {
              kind: "includes",
              value: "**No reviewer action is required.**",
            },
          ],
        },
        {
          actor: {
            id: 62215774,
            login: "argos-ci[bot]",
            type: "Bot",
          },
          app: { id: 57576, slug: "argos-ci" },
          associations: ["NONE"],
          predicates: [
            {
              kind: "startsWith",
              value:
                "**The latest updates on your projects.** Learn more about [Argos notifications ↗︎](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments)",
            },
          ],
        },
        {
          actor: { id: 35613825, login: "vercel[bot]", type: "Bot" },
          app: { id: 8329, slug: "vercel" },
          associations: ["NONE"],
          predicates: [{ kind: "startsWith", value: "[vc]: " }],
        },
        {
          actor: {
            id: 199175422,
            login: "chatgpt-codex-connector[bot]",
            type: "Bot",
          },
          app: { id: 1144995, slug: "chatgpt-codex-connector" },
          associations: ["NONE"],
          predicates: [
            {
              kind: "startsWith",
              value: "Codex Review: Didn't find any major issues.",
            },
          ],
        },
      ],
    },
    trustedMaintainerIssueComment:
      "manual-unless-exact-branch-command-or-current-invocation-procedural-comment",
    unknownOrMalformedBotFeedback: "blocked",
  });
  assert.deepEqual(policy.history, {
    closeOrReopenByNonDependabot: "manual",
    existingNonNativeHead: "manual",
    forcePushRequiresCompletePagination: true,
    forcePushRequiresContinuousShas: true,
    forcePushRequiresNonCyclicShas: true,
    forcePushRequiresOrderedUtcTimestamps: true,
    forcePushRequiresUniqueEventIds: true,
    unknownForcePush: "blocked",
  });
  assert.deepEqual(policy.githubActions, {
    refMutation: "forbidden",
    requiresCurrentNativeGreenHead: true,
  });
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

test("pull requests use read-only OSV jobs and trusted runs own SARIF writes", () => {
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
    assert.equal(readOnlyJob.if, "github.event_name == 'pull_request'");
    assert.deepEqual(readOnlyJob.permissions, {
      actions: "read",
      contents: "read",
    });
    assert.equal(
      readOnlyJob.uses,
      "./.github/workflows/_osv-scanner-readonly.yml",
    );
    assert.equal(Object.hasOwn(readOnlyJob.with, "upload-sarif"), false);

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
  assert.equal(readOnlyOsv.on.workflow_call.inputs["scan-args"].required, true);
  assert.deepEqual(readOnlyOsv.permissions, {
    actions: "read",
    contents: "read",
  });
  const readOnlyJob = readOnlyOsv.jobs["osv-scan"];
  assert.deepEqual(readOnlyJob.permissions, {
    actions: "read",
    contents: "read",
  });
  assert.equal(readOnlyJob.name, "osv-scan");
  assert.equal(readOnlyJob["timeout-minutes"], 10);
  const readOnlySteps = readOnlyJob.steps;
  const checkout = readOnlySteps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with["persist-credentials"], false);
  const scannerSteps = readOnlySteps.filter((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-scanner-action@"),
  );
  assert.equal(scannerSteps.length, 1);
  const [scanner] = scannerSteps;
  const scannerRevision =
    /^google\/osv-scanner-action\/osv-scanner-action@([0-9a-f]{40})$/u.exec(
      scanner.uses,
    )?.[1];
  assert.ok(scannerRevision);
  assert.equal(scanner.id, "scan");
  assert.equal(scanner["continue-on-error"], true);
  assert.match(scanner.with["scan-args"], /--output=results\.json/u);
  assert.match(scanner.with["scan-args"], /--format=json/u);
  assert.match(scanner.with["scan-args"], /\$\{\{ inputs\.scan-args \}\}/u);

  const completionGuards = readOnlySteps.filter(
    (step) => step.name === "Check that the scan completed",
  );
  assert.equal(completionGuards.length, 1);
  const [completionGuard] = completionGuards;
  assert.equal(completionGuard.if, "${{ steps.scan.outcome == 'failure' }}");
  assert.equal(completionGuard.shell, "bash");
  assert.deepEqual(completionGuard.env, { RESULTS: "results.json" });
  assert.match(completionGuard.run, /if \[ ! -s "\$\{RESULTS\}" \]; then/u);
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
  assert.ok(
    readOnlySteps.indexOf(scanner) < readOnlySteps.indexOf(completionGuard),
  );
  assert.ok(
    readOnlySteps.indexOf(completionGuard) < readOnlySteps.indexOf(reporter),
  );
  assert.match(reporter.with["scan-args"], /--output=results\.sarif/u);
  assert.match(reporter.with["scan-args"], /--new=results\.json/u);
  assert.match(reporter.with["scan-args"], /--gh-annotations=false/u);
  assert.match(reporter.with["scan-args"], /--fail-on-vuln=true/u);
  assert.doesNotMatch(
    JSON.stringify(readOnlyOsv),
    /security-events|upload-sarif|github\/codeql-action|actions\/upload-artifact/u,
  );

  const dependencyReview = yaml(".github/workflows/dependency-review.yml");
  const dependencyCheckout = dependencyReview.jobs[
    "dependency-review"
  ].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(dependencyCheckout.with["persist-credentials"], false);
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

test("Dependabot groups isolate sensitive and test-toolchain updates", () => {
  const config = yaml(".github/dependabot.yml");
  const npmConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "npm",
  );
  const actionsConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "github-actions",
  );

  for (const update of [npmConfig, actionsConfig]) {
    assert.deepEqual(update.schedule, {
      interval: "weekly",
      day: "monday",
      time: "06:00",
      timezone: "UTC",
    });
  }
  assert.ok(npmConfig["open-pull-requests-limit"] >= 6);
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
  assert.ok(npmConfig.groups.tooling["exclude-patterns"].includes("vercel"));
  assert.ok(
    npmConfig.groups["security-tooling"]["exclude-patterns"].includes("vercel"),
  );
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
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          dependency,
          "development",
          updateType,
        ),
        "test-toolchain",
      );
    }
  }
  for (const pattern of ["vite", "vitest", "@vitest/*"]) {
    assert.ok(npmConfig.groups.tooling["exclude-patterns"].includes(pattern));
  }

  const namedProductionGroups = ["frontend-core", "web3-stack", "ui-styling"];
  const namedProductionPatterns = namedProductionGroups.flatMap(
    (groupName) => npmConfig.groups[groupName].patterns,
  );
  assert.deepEqual(
    [...npmConfig.groups["production-misc"]["exclude-patterns"]].sort(),
    [...namedProductionPatterns].sort(),
    "production-misc exclusions must exactly mirror named production groups",
  );
  for (const [groupName, dependencies] of Object.entries({
    "frontend-core": [
      "next",
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

  assert.deepEqual(npmConfig.groups["security-runtime"], {
    "applies-to": "security-updates",
    "dependency-type": "production",
  });
  assert.deepEqual(npmConfig.groups["security-tooling"], {
    "applies-to": "security-updates",
    "dependency-type": "development",
    patterns: ["*"],
    "exclude-patterns": ["vercel"],
  });
  assert.equal(npmConfig.ignore, undefined);

  const routine = actionsConfig.groups["github-actions-routine"];
  const manual = actionsConfig.groups["github-actions-manual"];
  assert.deepEqual(manual.patterns, routine["exclude-patterns"]);
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

test("canonical instructions preserve the external preparation boundary", () => {
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "docs/dependabot-automation.md",
  ]) {
    const source = read(path).replace(/\s+/gu, " ");
    assert.match(source, /exact final head and base/iu, path);
    assert.match(source, /(?:current-head|exact-head).{0,80}review/iu, path);
    assert.match(source, /auto-merge/iu, path);
    assert.match(
      source,
      /(?:must not|never).{0,100}approv.{0,100}(?:merge|auto-merge)/iu,
      path,
    );
    assert.match(
      source,
      /(?:human approval.{0,80}(?:separate|final)|(?:separate|final).{0,80}human approval|maintainer.{0,80}(?:human|final) approval)/iu,
      path,
    );
  }
});
