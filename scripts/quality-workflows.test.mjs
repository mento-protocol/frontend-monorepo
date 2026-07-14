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
  assert.match(
    workflow,
    /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.sha \}\}/,
  );
  assert.doesNotMatch(workflow, /pull_request\.head\.ref/);
  assert.match(
    workflow,
    /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
  );
  assert.match(workflow, /run: pnpm quality:budgets/);
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
    ".github/workflows/visual.yml",
  ].map((path) => /^name: (.+)$/m.exec(read(path))?.[1]);

  assert.match(workflow, /^name: CI Failure Notifier$/m);
  assert.match(workflow, /^ {2}workflow_run:$/m);
  assert.match(workflow, /^ {6}- Quality Budgets$/m);
  assert.match(workflow, /^ {6}- Supply Chain$/m);
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
    /^ {4}concurrency:\n {6}group: ci-failure-\$\{\{ github\.event\.workflow_run\.workflow_id \}\}\n {6}cancel-in-progress: false$/m,
  );
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
