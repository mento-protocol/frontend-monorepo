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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { OSV_FINDINGS_FILES } from "./osv-findings.mjs";

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
    [
      ...osvJobIds,
      ...sarifJobIds,
      "osv-findings",
      "lockfile-lint",
      "version-skew",
    ].sort(),
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

test("the findings artifact scan mirrors the SARIF gate scan exactly", () => {
  const supplyChain = yaml(".github/workflows/supply-chain.yml");
  const findings = supplyChain.jobs["osv-findings"];

  // Same trigger as the SARIF jobs, and no `needs` edge: this job produces the
  // evidence for the same runs the notifier watches.
  assert.equal(
    findings.if,
    "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
  );
  assert.equal(findings.needs, undefined);
  // Strictly less than the SARIF jobs: no `security-events: write`, because
  // this job publishes nothing, and no `actions: read`, because it reads no
  // Actions API. Uploading its own artifact needs neither.
  assert.deepEqual(findings.permissions, { contents: "read" });
  assert.equal(findings["timeout-minutes"], 15);

  const checkout = findings.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with["persist-credentials"], false);

  // Each findings scan must repeat its SARIF sibling's scan-args verbatim,
  // after the two evidence-only flags. A findings scan that read a different
  // config would report a different suppression set than the gate job that
  // actually failed, so the issue would name the wrong packages — or none.
  const sarifJobIds = [
    "osv-sarif",
    "osv-pnpm-runtime-sarif",
    "osv-vercel-cli-runtime-sarif",
    "osv-pnpm-bootstrap-sarif",
  ];
  const scanSteps = findings.steps.filter((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-scanner-action@"),
  );
  assert.equal(scanSteps.length, OSV_FINDINGS_FILES.length);
  assert.equal(scanSteps.length, sarifJobIds.length);

  const scannerRevisions = new Set();
  for (const [index, step] of scanSteps.entries()) {
    // Evidence, not a gate: the scanner exits non-zero merely for finding
    // something, and this job must stay green so it never adds a second
    // failing job to the issue it exists to annotate.
    assert.equal(step["continue-on-error"], true);
    scannerRevisions.add(step.uses.split("@")[1]);

    const lines = step.with["scan-args"].trimEnd().split("\n");
    const { file, lockfile } = OSV_FINDINGS_FILES[index];
    // The container spelling of GITHUB_WORKSPACE, matched to the
    // workspace-relative upload path below.
    assert.equal(lines[0], `--output=/github/workspace/osv-findings/${file}`);
    assert.equal(lines[1], "--format=json");
    // The trusted lockfile label `osv-findings.mjs` renders is the one this
    // step actually scanned, so a result can never name a file it did not come
    // from.
    assert.ok(
      lines.includes(`--lockfile=${lockfile}`),
      `${file} must be the scan of ${lockfile}`,
    );
    assert.equal(
      lines.slice(2).join("\n"),
      supplyChain.jobs[sarifJobIds[index]].with["scan-args"].trimEnd(),
      `${file} must scan exactly what ${sarifJobIds[index]} scans`,
    );
  }
  // One scanner revision across the evidence job and every SARIF gate job.
  for (const jobId of sarifJobIds) {
    scannerRevisions.add(supplyChain.jobs[jobId].uses.split("@")[1]);
  }
  assert.equal(scannerRevisions.size, 1);

  const upload = findings.steps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  // `always()`: a scan step that failed outright still leaves the other results
  // worth publishing, and the notifier degrades per file.
  assert.equal(upload.if, "always()");
  assert.equal(upload.with.name, "osv-findings");
  assert.equal(upload.with.path, "osv-findings/*.json");
  // Nothing else may leave this job. A second upload, or a wider path, could
  // publish a file no strict schema check ever sees.
  assert.equal(
    findings.steps.filter((step) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    ).length,
    1,
  );
  assert.equal(
    findings.steps.some((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    ),
    false,
  );
});

test("the notifier reads findings from the artifact and never from a log", () => {
  const notifier = read(".github/workflows/ci-failure-notifier.yml");

  // The download is gated on the one workflow that uploads a findings
  // artifact, addresses that run explicitly, and uses the built-in token
  // rather than a repository secret.
  assert.match(notifier, /^ {6}- name: Download the OSV findings artifact$/m);
  assert.match(
    notifier,
    /^ {8}if: github\.event\.workflow_run\.name == 'Supply Chain'$/m,
  );
  assert.match(notifier, /^ {8}continue-on-error: true$/m);
  assert.match(notifier, /^ {10}name: osv-findings$/m);
  assert.match(
    notifier,
    /^ {10}run-id: \$\{\{ github\.event\.workflow_run\.id \}\}$/m,
  );
  assert.match(notifier, /^ {10}github-token: \$\{\{ github\.token \}\}$/m);
  // Extracted outside the trusted notifier checkout, so no artifact entry can
  // land on the script that is about to run.
  assert.match(
    notifier,
    /^ {10}path: \$\{\{ runner\.temp \}\}\/osv-findings$/m,
  );
  assert.doesNotMatch(notifier, /secrets\./);

  // The script is told where the artifact went and which run it came from, so
  // it can refuse to attribute findings to a run it was not downloaded for.
  assert.match(
    notifier,
    /^ {10}OSV_FINDINGS_DIR: \$\{\{ github\.event\.workflow_run\.name == 'Supply Chain' && format\('\{0\}\/osv-findings', runner\.temp\) \|\| '' \}\}$/m,
  );
  assert.match(
    notifier,
    /^ {10}OSV_FINDINGS_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}$/m,
  );

  // The posture, pinned on the collector's source too: this module may read
  // artifact bytes, but nothing here may reach a log body.
  const source = read("scripts/osv-findings.mjs");
  for (const forbidden of [
    "downloadJobLogsForWorkflowRun",
    "/logs",
    "##[error]",
    "child_process",
    "execSync",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `${forbidden} must not appear in the findings collector source`,
    );
  }
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
