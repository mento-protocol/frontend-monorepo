import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("root commands cover every Vitest workspace with a measured threshold", () => {
  const rootPackage = JSON.parse(read("package.json"));
  assert.match(rootPackage.scripts["quality:coverage"], /app\.mento\.org/);
  assert.match(
    rootPackage.scripts["quality:coverage"],
    /governance\.mento\.org/,
  );
  assert.match(rootPackage.scripts["quality:coverage"], /@mento-protocol\/ui/);
  assert.match(rootPackage.scripts["quality:coverage"], /@repo\/web3/);
  assert.match(rootPackage.scripts["quality:budgets"], /quality:coverage/);
  assert.match(rootPackage.scripts["quality:budgets"], /quality:bundle:check/);

  const expectedThresholds = {
    "apps/app.mento.org": [30, 72, 72, 30],
    "apps/governance.mento.org": [8, 60, 50, 8],
    "packages/ui": [5, 80, 80, 5],
    "packages/web3": [90, 90, 90, 90],
  };
  const metrics = ["statements", "branches", "functions", "lines"];
  const productionScopes = {
    "apps/app.mento.org": "app/**/*.{js,jsx,mjs,ts,tsx}",
    "apps/governance.mento.org": "app/**/*.{js,jsx,mjs,ts,tsx}",
    "packages/ui": "src/**/*.{js,jsx,ts,tsx}",
  };
  const appInstrumentation = [
    "instrumentation.ts",
    "instrumentation-client.ts",
    "sentry.edge.config.ts",
    "sentry.server.config.ts",
  ];

  for (const [workspace, thresholds] of Object.entries(expectedThresholds)) {
    const manifest = JSON.parse(read(`${workspace}/package.json`));
    assert.equal(
      manifest.scripts["test:coverage"],
      "vitest run --coverage",
      `${workspace} must expose the Turbo coverage task`,
    );

    const config = read(`${workspace}/vitest.config.ts`);
    if (productionScopes[workspace]) {
      assert.ok(
        config.includes(`"${productionScopes[workspace]}"`),
        `${workspace} coverage must include only its production source root`,
      );
      assert.match(config, /\*\.test\.\{js,jsx,(?:mjs,)?ts,tsx\}/);
      assert.match(config, /\*\.spec\.\{js,jsx,(?:mjs,)?ts,tsx\}/);
      assert.match(config, /generated\/\*\*/);
      assert.match(config, /\*\.d\.ts/);
      assert.doesNotMatch(config, /["'](?:e2e|playwright)\//);
      if (workspace.startsWith("apps/")) {
        for (const instrumentationFile of appInstrumentation) {
          assert.ok(
            config.includes(`"${instrumentationFile}"`),
            `${workspace} coverage must include ${instrumentationFile}`,
          );
        }
      }
    }
    for (const [index, metric] of metrics.entries()) {
      assert.match(
        config,
        new RegExp(`${metric}: ${thresholds[index]}`),
        `${workspace} has the wrong ${metric} threshold`,
      );
    }
  }
});

test("the quality workflow is always reported and runs the canonical command", () => {
  const workflow = read(".github/workflows/quality-budgets.yml");
  const ciWorkflow = read(".github/workflows/ci.yml");

  assert.match(workflow, /^name: Quality Budgets$/m);
  assert.match(workflow, /^ {2}pull_request:$/m);
  assert.match(workflow, /^ {2}push:$/m);
  assert.doesNotMatch(
    workflow,
    /^ {2}pull_request:\n(?: {4}.*\n)* {4}branches:/m,
  );
  assert.doesNotMatch(workflow, /^\s+paths(?:-ignore)?:/m);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.match(workflow, /uses: \.\/\.github\/actions\/pnpm-install/);
  assert.doesNotMatch(workflow, /uses: pnpm\/action-setup/);
  assert.doesNotMatch(workflow, /uses: actions\/setup-node/);
  const ciAnalyticsUrl = /^ {6}NEXT_PUBLIC_ANALYTICS_API_URL: (.+)$/m.exec(
    ciWorkflow,
  )?.[1];
  const qualityAnalyticsUrl = /^ {2}NEXT_PUBLIC_ANALYTICS_API_URL: (.+)$/m.exec(
    workflow,
  )?.[1];
  assert.ok(ciAnalyticsUrl, "CI must configure the reserve analytics URL");
  assert.equal(
    qualityAnalyticsUrl,
    ciAnalyticsUrl,
    "the quality build must mirror CI's reserve analytics URL",
  );
  assert.match(
    workflow,
    /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.sha \}\}/,
  );
  const concurrencyStart = workflow.indexOf("concurrency:");
  const permissionsStart = workflow.indexOf("permissions:");
  assert.ok(concurrencyStart >= 0, "workflow must declare concurrency");
  assert.ok(
    permissionsStart > concurrencyStart,
    "permissions must follow the top-level concurrency block",
  );
  const concurrency = workflow.slice(concurrencyStart, permissionsStart);
  assert.doesNotMatch(concurrency, /pull_request\.head\.ref/);
  assert.match(
    workflow,
    /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
  );
  assert.match(workflow, /run: pnpm quality:budgets/);
});

test("default-branch visual successes prove that both surfaces recovered", () => {
  const workflow = read(".github/workflows/visual.yml");
  const pushBlock = /^ {2}push:\n([\s\S]*?)^ {2}pull_request:/m.exec(
    workflow,
  )?.[1];
  assert.ok(pushBlock, "the visual workflow must declare its push trigger");
  const pushPaths = [...pushBlock.matchAll(/^ {6}- (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(pushPaths, [
    ".github/workflows/visual.yml",
    ".github/actions/pnpm-install/**",
    ".npmrc",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "patches/**",
    "scripts/security-headers.mjs",
    "apps/app.mento.org/**",
    "apps/ui.mento.org/**",
    "packages/ui/**",
    "packages/web3/**",
  ]);
  assert.match(
    workflow,
    /if \[\[ "\$EVENT_NAME" == "push" \]\]; then\n {12}run_app=true\n {12}run_ui=true\n {10}else/,
  );
  assert.match(
    workflow,
    /else\n {12}while IFS= read -r file; do[\s\S]*done < changed-files\.txt\n {10}fi/,
    "pull requests must retain per-surface changed-file planning",
  );
});

test("the Celo E2E fork excludes the exhausted anonymous 1RPC endpoint", () => {
  const workflow = read(".github/workflows/e2e.yml");
  const celoCandidateLists = [
    ...workflow.matchAll(
      / {6}- name: (?:Resolve nightly fork block \(scheduled runs only\)|Select fork RPC \(archive state at the pinned block required\))\n[\s\S]*? {10}candidates=\(\n((?: {12}https:\/\/[^\n]+\n)+) {10}\)/g,
    ),
  ].map((match) => match[1]);

  assert.doesNotMatch(workflow, /https:\/\/1rpc\.io\/celo/);
  assert.equal(celoCandidateLists.length, 4);
  for (const candidates of celoCandidateLists) {
    assert.equal(
      [...candidates.matchAll(/https:\/\/rpc\.ankr\.com\/celo/g)].length,
      1,
      "each Celo head and archive candidate list must retain Ankr once",
    );
  }
});

test("the notifier is loop-safe, secretless, and least privilege", () => {
  const workflow = read(".github/workflows/ci-failure-notifier.yml");
  const monitoredNames = [
    ".github/workflows/ci.yml",
    ".github/workflows/e2e.yml",
    ".github/workflows/publish-ui.yml",
    ".github/workflows/quality-budgets.yml",
    ".github/workflows/scorecard.yml",
    ".github/workflows/supply-chain.yml",
    ".github/workflows/vercel-main-deployment.yml",
    ".github/workflows/visual.yml",
  ].map((path) => /^name: (.+)$/m.exec(read(path))?.[1]);

  assert.match(workflow, /^name: CI Failure Notifier$/m);
  assert.match(workflow, /^ {2}workflow_run:$/m);
  assert.match(workflow, /^ {6}- Quality Budgets$/m);
  assert.match(workflow, /^ {6}- Supply Chain$/m);
  assert.match(workflow, /^ {6}- Vercel Main Deployment$/m);
  assert.ok(
    monitoredNames.every(Boolean),
    "every monitored workflow must declare a top-level name",
  );
  const allowlistBlock =
    /workflows:\n((?: {6}- .+\n)+) {4}types:/.exec(workflow)?.[1] ?? "";
  const actualAllowlist = [...allowlistBlock.matchAll(/^ {6}- (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    actualAllowlist,
    monitoredNames,
    "the notifier must monitor exactly the operational workflow allowlist",
  );
  assert.doesNotMatch(workflow, /^ {6}- CI Failure Notifier$/m);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(workflow, /^concurrency:/m);
  assert.match(
    workflow,
    /^ {4}concurrency:\n {6}group: ci-failure-\$\{\{ github\.event\.workflow_run\.workflow_id \}\}\n {6}cancel-in-progress: false\n {6}queue: max # trunk-ignore\(actionlint\/syntax-check\)$/m,
  );
  const handledEvents =
    /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.workflow_run\.event\)/.exec(
      workflow,
    )?.[1];
  assert.deepEqual(JSON.parse(handledEvents ?? "[]"), [
    "push",
    "schedule",
    "workflow_dispatch",
    "workflow_run",
  ]);
  const handledConclusions =
    /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.workflow_run\.conclusion\)/.exec(
      workflow,
    )?.[1];
  assert.deepEqual(JSON.parse(handledConclusions ?? "[]"), [
    "success",
    "action_required",
    "failure",
    "startup_failure",
    "timed_out",
  ]);
  assert.match(workflow, /^ {6}actions: read$/m);
  assert.match(workflow, /^ {6}issues: write$/m);
  assert.match(workflow, /workflow_run\.name == 'Publish UI Package'/);
  assert.match(workflow, /workflow_run\.name == 'Vercel Main Deployment'/);
  assert.match(
    workflow,
    /github\.event\.workflow_run\.head_branch == github\.event\.repository\.default_branch &&\n {10}github\.event\.workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(
    workflow,
    /workflow_run\.event == 'schedule' \|\|\n {8}\(\n {10}github\.event\.workflow_run\.event == 'push'/,
  );
  assert.match(
    workflow,
    /workflow_run\.event == 'workflow_dispatch' &&\n {10}github\.event\.workflow_run\.head_branch == github\.event\.repository\.default_branch/,
  );
  assert.match(workflow, /ref: \$\{\{ github\.workflow_sha \}\}/);
  assert.doesNotMatch(workflow, /workflow_run\.head_sha/);
  assert.doesNotMatch(
    workflow,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
});

test("the general notifier replaces the legacy supply-chain-only issue job", () => {
  const supplyChainWorkflow = read(".github/workflows/supply-chain.yml");

  assert.doesNotMatch(supplyChainWorkflow, /cron-failure-issue/);
  assert.doesNotMatch(supplyChainWorkflow, /supply-chain-cron-failure/);
  assert.match(supplyChainWorkflow, /ci-failure-notifier\.yml/);
});

test("the Slack notifier watches the issue notifier's allowlist and never shells untrusted metadata", () => {
  const slack = read(".github/workflows/notify-slack-on-main-failure.yml");
  const issueNotifier = read(".github/workflows/ci-failure-notifier.yml");
  const allowlistOf = (workflow) =>
    [
      ...(/workflows:\n((?: {6}- .+\n)+) {4}types:/
        .exec(workflow)?.[1]
        ?.matchAll(/^ {6}- (.+)$/gm) ?? []),
    ].map((match) => match[1]);

  assert.match(slack, /^name: Notify Slack on main-branch workflow failure$/m);
  assert.deepEqual(
    allowlistOf(slack),
    allowlistOf(issueNotifier),
    "both notifiers must watch exactly the same operational workflows",
  );
  assert.ok(allowlistOf(slack).length > 0, "the allowlist must not be empty");
  assert.doesNotMatch(
    slack,
    /^ {6}- Notify Slack on main-branch workflow failure$/m,
    "the Slack notifier must not watch itself",
  );

  // The smoke test is a bare workflow_dispatch: checkov CKV_GHA_7 forbids
  // workflow_dispatch inputs.
  assert.match(slack, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(slack, /^ {4}inputs:$/m);

  // Least privilege: the GITHUB_TOKEN needs nothing; the credential goes to
  // Slack, not GitHub. The only secret referenced is the Slack bot token.
  assert.match(slack, /^permissions: \{\}$/m);
  assert.match(slack, /^ {4}permissions: \{\}$/m);
  const referencedSecrets = new Set(
    [...slack.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]),
  );
  assert.deepEqual([...referencedSecrets], ["SLACK_BOT_TOKEN"]);

  // The Slack side channel must cover exactly the incident set the issue
  // notifier treats as a failure, minus the `success` recovery conclusion it
  // uses to close issues.
  const conclusions =
    /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.workflow_run\.conclusion\)/.exec(
      slack,
    )?.[1];
  const issueFailureConclusions = [
    ...(/const FAILURE_CONCLUSIONS = new Set\(\[\n((?: {2}"[a-z_]+",\n)+)\]\)/
      .exec(read("scripts/ci-failure-issue.mjs"))?.[1]
      ?.matchAll(/"([a-z_]+)"/g) ?? []),
  ].map((match) => match[1]);
  assert.deepEqual(
    JSON.parse(conclusions ?? "[]"),
    issueFailureConclusions,
    "Slack must alert on the same conclusions the issue notifier tracks",
  );
  assert.ok(
    issueFailureConclusions.includes("action_required"),
    "the parity anchor must actually have read the issue notifier's set",
  );
  assert.match(
    slack,
    /github\.event_name == 'workflow_dispatch' \|\|/,
    "workflow_dispatch must bypass the failure gate for the smoke test",
  );

  // A branch-selected `gh workflow run --ref <branch>` runs that branch's copy
  // of this file. Two layers keep the Slack token off a non-default ref: the
  // ref equality below, which gates EVERY event, and the environment, whose
  // deployment branch policy GitHub enforces server-side before the job runs.
  assert.match(
    slack,
    /^ {6}github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\) &&$/m,
    "every event must be gated on the default branch before a step reads the secret",
  );
  assert.match(
    slack,
    /^ {4}environment:\n {6}name: slack-ci-notifications\n {6}deployment: false/m,
    "the credential-bearing job must run in the branch-policy-protected environment",
  );
  assert.match(
    slack,
    /github\.event\.workflow_run\.head_branch == github\.event\.repository\.default_branch/,
  );

  // Injection safety: attacker-controlled workflow_run metadata (a commit
  // title can contain backticks or $(…)) must reach the shell only as an
  // environment variable, never as a `${{ }}` expansion inside `run:`.
  const runBlocks = [
    ...slack.matchAll(/^ {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/gm),
  ].map((match) => match[1]);
  assert.equal(
    runBlocks.length,
    1,
    "the notifier must have exactly one run block",
  );
  for (const block of runBlocks) {
    assert.match(
      block,
      /curl -fsS -X POST https:\/\/slack\.com\/api\/chat\.postMessage/,
      "the captured run block must be the Slack post body",
    );
    assert.doesNotMatch(
      block,
      /\$\{\{/,
      "no GitHub expression may be interpolated into the shell",
    );
  }
  for (const variable of [
    "COMMIT_MSG",
    "WORKFLOW_NAME",
    "ACTOR",
    "RUN_URL",
    "HEAD_BRANCH",
  ]) {
    assert.match(
      slack,
      new RegExp(
        `^ {10}${variable}: \\$\\{\\{ github\\.event\\.workflow_run\\.`,
        "m",
      ),
      `${variable} must be bound in env:, not interpolated`,
    );
  }
  assert.match(
    slack,
    /--arg msg "\$COMMIT_MSG"/,
    "the commit title must be passed to jq via --arg so jq escapes it",
  );
  assert.match(
    slack,
    /gsub\("&"; "&amp;"\) \| gsub\("<"; "&lt;"\) \| gsub\(">"; "&gt;"\)/,
    "the commit title must be escaped for Slack mrkdwn before insertion",
  );

  // This privileged workflow_run listener must never check out or execute the
  // triggering head SHA.
  assert.doesNotMatch(slack, /actions\/checkout/);
  assert.doesNotMatch(slack, /^ {6}- uses:/m);
});

test("the Slack notifier names the same target ref as the managed issue", () => {
  const slack = read(".github/workflows/notify-slack-on-main-failure.yml");

  // Parity anchor. The Slack notifier checks out nothing, so it cannot import
  // targetRefFor(); it mirrors the expression in jq instead. If the source
  // below changes, this fails and forces the jq mirror to change with it.
  assert.match(
    read("scripts/ci-failure-issue.mjs"),
    /function targetRefFor\(run, defaultBranch\) \{\n {2}return \(\n {4}run\.head_branch \|\| \(run\.event === "push" \? "release tag" : defaultBranch\)\n {2}\);\n\}/,
    "targetRefFor changed; update the jq mirror in the Slack notifier",
  );
  const mirror =
    'if $head_branch != "" then $head_branch elif $event == "push" then "release tag" else $default_branch end';
  assert.ok(
    slack.includes(`| (${mirror}) as $ref`),
    "the Slack notifier must apply the event-aware target-ref fallback",
  );
  assert.match(
    slack,
    /^ {10}DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}$/m,
  );

  // Prove the jq mirror computes what targetRefFor computes. GitHub renders a
  // null head_branch as an empty string, which is the case that matters.
  const targetRefFor = (run, defaultBranch) =>
    run.head_branch || (run.event === "push" ? "release tag" : defaultBranch);
  const cases = [
    { head_branch: "main", event: "push" },
    { head_branch: "", event: "push" },
    { head_branch: "", event: "schedule" },
    { head_branch: "", event: "workflow_dispatch" },
    { head_branch: "", event: "workflow_run" },
    { head_branch: "main", event: "workflow_run" },
  ];
  for (const run of cases) {
    const actual = execFileSync(
      "jq",
      [
        "-rn",
        "--arg",
        "head_branch",
        run.head_branch,
        "--arg",
        "event",
        run.event,
        "--arg",
        "default_branch",
        "main",
        mirror,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    assert.equal(
      actual,
      targetRefFor(run, "main"),
      `jq mirror diverged for ${run.event} with head_branch "${run.head_branch}"`,
    );
  }
});
