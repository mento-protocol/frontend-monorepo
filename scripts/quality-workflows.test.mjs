import assert from "node:assert/strict";
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

  // Least privilege: nothing at the workflow level, and the single `actions:
  // read` scope the freshness reconciliation needs at the job level. The
  // credential that matters goes to Slack, not GitHub, and this job writes
  // nothing back.
  assert.match(slack, /^permissions: \{\}$/m);
  assert.match(slack, /^ {4}permissions:\n {6}actions: read$/m);
  assert.doesNotMatch(
    slack,
    /^ {6}(?!actions: read$)[a-z-]+: (read|write)$/m,
    "the job must grant no scope beyond actions: read",
  );
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
    2,
    "the notifier must have exactly the freshness and post run blocks",
  );
  assert.match(
    runBlocks[0],
    /actions\/workflows\/\$WORKFLOW_ID\/runs/,
    "the first run block must be the freshness reconciliation",
  );
  assert.match(
    runBlocks[1],
    /curl -fsS -X POST https:\/\/slack\.com\/api\/chat\.postMessage/,
    "the second run block must be the Slack post body",
  );
  for (const block of runBlocks) {
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

  // Prove the mirrored semantics match targetRefFor. This gate must run with
  // nothing but Node and no network, so the jq expression is reimplemented
  // here rather than shelled out to; the exact-text assertions above are what
  // catch the workflow drifting away from this reimplementation.
  const targetRefFor = (run, defaultBranch) =>
    run.head_branch || (run.event === "push" ? "release tag" : defaultBranch);
  const jqTargetRef = (headBranch, event, defaultBranch) =>
    headBranch !== ""
      ? headBranch
      : event === "push"
        ? "release tag"
        : defaultBranch;
  const cases = [
    { head_branch: "main", event: "push" },
    { head_branch: "", event: "push" },
    { head_branch: "", event: "schedule" },
    { head_branch: "", event: "workflow_dispatch" },
    { head_branch: "", event: "workflow_run" },
    { head_branch: "main", event: "workflow_run" },
  ];
  for (const run of cases) {
    assert.equal(
      jqTargetRef(run.head_branch, run.event, "main"),
      targetRefFor(run, "main"),
      `mirror diverged for ${run.event} with head_branch "${run.head_branch}"`,
    );
  }
});

test("the Slack notifier suppresses the same stale callbacks the issue notifier reconciles away", () => {
  const slack = read(".github/workflows/notify-slack-on-main-failure.yml");
  const issueScript = read("scripts/ci-failure-issue.mjs");

  // Parity anchors on the three pieces of the issue notifier's freshness rule.
  // If any changes, this fails and forces the jq mirror to change with it.
  assert.match(
    issueScript,
    /function runPosition\(run\) \{\n {2}return \[run\.run_number \?\? 0, run\.run_attempt \?\? 1\];\n\}/,
    "runPosition changed; update the freshness mirror in the Slack notifier",
  );
  assert.match(
    issueScript,
    /return leftNumber - rightNumber \|\| leftAttempt - rightAttempt;/,
    "compareRuns changed; update the freshness mirror in the Slack notifier",
  );
  assert.match(
    issueScript,
    /run\.conclusion === "success" \|\| FAILURE_CONCLUSIONS\.has\(run\.conclusion\)/,
    "isDecisiveRun changed; update the freshness mirror in the Slack notifier",
  );

  // The gate itself, and the query shape it mirrors.
  assert.match(
    slack,
    /^ {4}permissions:\n {6}actions: read$/m,
    "the freshness step needs exactly actions: read and nothing more",
  );
  assert.match(
    slack,
    /^ {8}if: steps\.freshness\.outputs\.stale != 'true'$/m,
    "the Slack post must be gated on the freshness reconciliation",
  );
  assert.match(
    slack,
    /^ {8}if: github\.event_name != 'workflow_dispatch'$/m,
    "the smoke test must skip reconciliation entirely",
  );
  for (const parameter of [
    "event=$EVENT",
    "status=completed",
    "exclude_pull_requests=true",
    "per_page=100",
    "page=$PAGE",
  ]) {
    assert.ok(
      slack.includes(`--data-urlencode "${parameter}"`),
      `the run query must mirror listCompletedWorkflowRuns (${parameter})`,
    );
  }
  const decisiveInWorkflow =
    /\[("success", "action_required", "failure", "startup_failure", "timed_out")\] as \$decisive/.exec(
      slack,
    )?.[1];
  assert.equal(
    decisiveInWorkflow,
    '"success", "action_required", "failure", "startup_failure", "timed_out"',
    "the decisive set must be success plus FAILURE_CONCLUSIONS",
  );
  assert.ok(
    slack.includes(
      "($decisivePositions | map(select(. > [$number, $attempt])) | length > 0)",
    ),
    "staleness must be: some decisive run in the partition sorts after this one",
  );

  // A long tail of newer non-decisive runs can push the decisive one past the
  // first page, so the lookup must paginate on the same break condition
  // listCompletedWorkflowRuns() uses: stop once a page holds a run at or
  // before the callback.
  assert.match(
    issueScript,
    /if \(page\.some\(\(candidate\) => compareRuns\(candidate, callbackRun\) <= 0\)\) \{\n {6}break;\n {4}\}/,
    "the helper's pagination break changed; update the workflow loop",
  );
  assert.ok(
    slack.includes(
      "($positions | map(select(. <= [$number, $attempt])) | length > 0)",
    ),
    "the loop must mirror the helper's at-or-before-the-callback break",
  );
  assert.ok(
    slack.includes(
      'if [ "$PAGE_REACHED" = "true" ] || [ "${PAGE_COUNT:-0}" -lt 100 ]; then',
    ),
    "pagination must stop on the break condition or a short final page",
  );
  assert.match(
    slack,
    /^ {10}while \[ "\$PAGE" -le "\$PAGE_LIMIT" \]; do$/m,
    "the lookup must page rather than read only the newest 100 runs",
  );
  assert.ok(
    slack.includes(
      'echo "Reached the $PAGE_LIMIT-page scan limit without finding this run; posting without reconciliation."',
    ),
    "exhausting the page limit must fail open",
  );

  // Reference: the issue notifier reconciles a callback to the latest decisive
  // run in its partition and acts on that run. Mirror: the Slack post is
  // suppressed exactly when that reconciliation would pick a different run.
  const runPosition = (run) => [run.run_number ?? 0, run.run_attempt ?? 1];
  const compareRuns = (left, right) => {
    const [ln, la] = runPosition(left);
    const [rn, ra] = runPosition(right);
    return ln - rn || la - ra;
  };
  const decisive = new Set([
    "success",
    "action_required",
    "failure",
    "startup_failure",
    "timed_out",
  ]);
  const targetRefFor = (run, defaultBranch) =>
    run.head_branch || (run.event === "push" ? "release tag" : defaultBranch);
  const referenceReconcilesAway = (callback, runs, defaultBranch) => {
    const partition = targetRefFor(callback, defaultBranch);
    const latest = [callback, ...runs]
      .filter(
        (candidate) =>
          candidate.status === "completed" &&
          decisive.has(candidate.conclusion) &&
          targetRefFor(candidate, defaultBranch) === partition,
      )
      .sort((left, right) => compareRuns(right, left))[0];
    return latest !== undefined && compareRuns(latest, callback) !== 0;
  };
  // The workflow step, reimplemented: page through the runs newest-first, and
  // on each page ask whether a decisive run in the same partition sorts after
  // the callback. Stop once a page holds a run at or before the callback, or
  // the page is short. `runs` here is the full newest-first listing; the
  // pageSize argument keeps the pagination path testable without 100 fixtures.
  const workflowSkips = (callback, runs, defaultBranch, pageSize = 100) => {
    const partition =
      callback.head_branch !== ""
        ? callback.head_branch
        : callback.event === "push"
          ? "release tag"
          : defaultBranch;
    const inPartition = (candidate) => {
      const headBranch = candidate.head_branch ?? "";
      const ref =
        headBranch !== ""
          ? headBranch
          : callback.event === "push"
            ? "release tag"
            : defaultBranch;
      return ref === partition;
    };
    const callbackPosition = {
      run_number: callback.run_number,
      run_attempt: callback.run_attempt,
    };
    const pageLimit = 10;
    for (let page = 0; page < pageLimit; page += 1) {
      const rows = runs.slice(page * pageSize, (page + 1) * pageSize);
      const stale = rows
        .filter((candidate) => candidate.status === "completed")
        .filter((candidate) => decisive.has(candidate.conclusion))
        .filter(inPartition)
        .some((candidate) => compareRuns(candidate, callbackPosition) > 0);
      if (stale) return true;
      const reached = rows.some(
        (candidate) => compareRuns(candidate, callbackPosition) <= 0,
      );
      if (reached || rows.length < pageSize) return false;
    }
    // Page limit exhausted: fail open.
    return false;
  };

  const callback = {
    status: "completed",
    conclusion: "failure",
    head_branch: "main",
    event: "push",
    run_number: 11,
    run_attempt: 1,
  };
  const scenarios = [
    { name: "callback is the newest decisive run", runs: [], skip: false },
    {
      name: "a newer run already succeeded",
      runs: [{ ...callback, conclusion: "success", run_number: 12 }],
      skip: true,
    },
    {
      name: "a newer attempt of the same run succeeded",
      runs: [{ ...callback, conclusion: "success", run_attempt: 2 }],
      skip: true,
    },
    {
      name: "a newer run also failed and owns its own message",
      runs: [{ ...callback, run_number: 12 }],
      skip: true,
    },
    {
      name: "the newer run was cancelled, which is not decisive",
      runs: [{ ...callback, conclusion: "cancelled", run_number: 12 }],
      skip: false,
    },
    {
      name: "the newer run belongs to another partition",
      runs: [
        {
          ...callback,
          conclusion: "success",
          head_branch: "release-1",
          run_number: 99,
        },
      ],
      skip: false,
    },
    {
      name: "an older run succeeded after this failure",
      runs: [{ ...callback, conclusion: "success", run_number: 10 }],
      skip: false,
    },
    {
      // The case a single-page lookup gets wrong: a newer success buried
      // behind a full page of newer, non-decisive runs.
      name: "the newer success sits beyond the first page",
      runs: [
        ...Array.from({ length: 4 }, (_unused, index) => ({
          ...callback,
          conclusion: "cancelled",
          run_number: 100 - index,
        })),
        { ...callback, conclusion: "success", run_number: 12 },
      ],
      pageSize: 4,
      skip: true,
    },
  ];
  for (const scenario of scenarios) {
    assert.equal(
      workflowSkips(callback, scenario.runs, "main", scenario.pageSize),
      scenario.skip,
      `workflow mirror wrong: ${scenario.name}`,
    );
    assert.equal(
      referenceReconcilesAway(callback, scenario.runs, "main"),
      scenario.skip,
      `the issue notifier disagrees: ${scenario.name}`,
    );
  }

  // Prove the pagination scenario is a real regression guard: a lookup capped
  // at one page reports "not stale" for it, which is the bug being fixed.
  const buriedSuccess = scenarios.at(-1);
  assert.equal(
    workflowSkips(callback, buriedSuccess.runs, "main", 1000),
    true,
    "one big page must still find the buried success",
  );
  assert.equal(
    workflowSkips(callback, buriedSuccess.runs.slice(0, 4), "main", 4),
    false,
    "the fixture must actually hide the success behind a full first page",
  );
});
