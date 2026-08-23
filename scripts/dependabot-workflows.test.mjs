/* eslint-disable turbo/no-undeclared-env-vars -- The Bash-validator harness preserves the host executable search path. */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function workflow(relativePath) {
  return parse(read(relativePath), { uniqueKeys: true });
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

function makeDirectoryTreeRemovable(directory) {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      makeDirectoryTreeRemovable(join(directory, entry.name));
    }
  }
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
  const excludePatterns = group["exclude-patterns"] ?? [];
  return (
    patterns.some((pattern) => dependabotPatternMatches(pattern, dependency)) &&
    !excludePatterns.some((pattern) =>
      dependabotPatternMatches(pattern, dependency),
    )
  );
}

function firstDependabotGroup(groups, dependency, dependencyType, updateType) {
  return Object.entries(groups).find(([, group]) =>
    dependabotGroupMatches(group, dependency, dependencyType, updateType),
  )?.[0];
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

const intakePath = ".github/workflows/dependabot-intake.yml";
const preparedIntakePath =
  ".github/workflows/dependabot-prepared-head-intake.yml";
const processorPath = ".github/workflows/dependabot-process.yml";
const repairPath = ".github/workflows/dependabot-prepare-repair.yml";
const preparedDispatchPath =
  ".github/workflows/dependabot-prepared-head-dispatch.yml";
const dependabotReviewPath = ".github/workflows/dependabot-claude-review.yml";
const humanReviewPath = ".github/workflows/claude-code-review.yml";
const dependabotReviewToolGuardPath = fileURLToPath(
  new URL("./dependabot-claude-review-tool-guard.mjs", import.meta.url),
);
const repairEvidenceToolGuardPath = fileURLToPath(
  new URL("./dependabot-repair-evidence-tool-guard.mjs", import.meta.url),
);
const intake = workflow(intakePath);
const processor = workflow(processorPath);
const repair = workflow(repairPath);
const preparedDispatch = workflow(preparedDispatchPath);
const dependabotReview = workflow(dependabotReviewPath);
const humanReview = workflow(humanReviewPath);

const claudeAction =
  "anthropics/claude-code-action@be7b93b1907a4abad570368f3c74b6fe3807510b";
const claudeBaseAction =
  "anthropics/claude-code-action/base-action@be7b93b1907a4abad570368f3c74b6fe3807510b";
const claudePluginMarketplace = "./.claude-code-plugin-marketplace";
const claudeCodeReviewPlugin = `${claudePluginMarketplace}/plugins/code-review`;
const claudePluginMarketplaceRef = "2bb60696142b493eafaeacfe00eac51d16c50c4f";

const forbiddenCandidateSurfaces =
  /actions\/(?:download-artifact|upload-artifact|cache)@|cache-dependency-path|gh pr checkout|git (?:checkout|switch|fetch)|node_modules|pnpm install|npm (?:ci|install)|yarn install/;

test("workflow parsing rejects duplicate YAML keys", () => {
  assert.throws(
    () =>
      parse("steps:\n  - run: first\n    run: second\n", {
        uniqueKeys: true,
      }),
    /Map keys must be unique/,
  );
});

test("repaired Dependabot PR jobs retain native secret and credential isolation", () => {
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
  const protectedWorkflowPaths = configurations.map(({ path }) => path).sort();
  const workflowRoot = fileURLToPath(
    new URL("../.github/workflows/", import.meta.url),
  );
  const directPullRequestWorkflows = readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => {
      const path = `.github/workflows/${name}`;
      return { parsed: workflow(path), path };
    })
    .filter(({ parsed }) => Object.hasOwn(parsed.on ?? {}, "pull_request"));
  const directSecretPaths = directPullRequestWorkflows
    .filter(({ parsed }) =>
      nestedStrings(parsed).some((value) => value.includes("secrets.")),
    )
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(directSecretPaths, [
    ".github/workflows/ci.yml",
    ".github/workflows/claude-code-review.yml",
    ".github/workflows/e2e.yml",
    ".github/workflows/visual.yml",
  ]);
  const humanReviewJob = workflow(".github/workflows/claude-code-review.yml")
    .jobs["claude-review-human"];
  assert.match(humanReviewJob.if, /pull_request\.user\.type == 'User'/u);
  assert.doesNotMatch(humanReviewJob.if, /sender/u);
  for (const { parsed, path } of directPullRequestWorkflows) {
    assert.doesNotMatch(
      JSON.stringify(parsed.jobs),
      /"secrets":"inherit"/u,
      `${path} must not inherit an unbounded secret set`,
    );
  }

  const directCandidateCachePaths = directPullRequestWorkflows
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
  assert.deepEqual(directCandidateCachePaths, protectedWorkflowPaths);

  const directLocalActions = directPullRequestWorkflows
    .flatMap(({ parsed }) => Object.values(parsed.jobs))
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.uses)
    .filter((uses) => uses?.startsWith("./.github/actions/"));
  assert.deepEqual([...new Set(directLocalActions)].sort(), [
    "./.github/actions/pnpm-install",
  ]);
  const installAction = parse(read(".github/actions/pnpm-install/action.yml"), {
    uniqueKeys: true,
  });
  assert.deepEqual(
    installAction.runs.steps
      .map((step) => step.uses)
      .filter((uses) => uses?.startsWith("./")),
    [],
    "the protected local install action must not hide another local action",
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
  const positiveGrantSignals = [
    "github.event_name != 'pull_request'",
    "github.event.pull_request.user.type == 'User'",
    "github.event.pull_request.user.id != 49699333",
    "github.event.pull_request.user.login != 'dependabot[bot]'",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "github.event.pull_request.head.ref != 'dependabot'",
    "!startsWith(github.event.pull_request.head.ref, 'dependabot/')",
    "github.event.sender.type == 'User'",
    "github.event.sender.id != 315967666",
    "github.event.sender.login != 'mento-dependabot-prepare[bot]'",
  ];

  for (const { expectedSecretCount, gate, path, planJob } of configurations) {
    const parsed = workflow(path);
    const grant = parsed.env.ALLOW_REPOSITORY_CREDENTIALS;
    for (const signal of positiveGrantSignals) {
      assert.ok(grant.includes(signal), `${path} is missing ${signal}`);
    }
    if (planJob !== null) {
      const classifier = parsed.jobs[planJob].steps[0];
      assert.equal(classifier.name, "Classify repository credential access");
      assert.equal(classifier.id, "credentials");
      assert.match(
        classifier.run,
        /case "\$ALLOW_REPOSITORY_CREDENTIALS" in[\s\S]*true \| false[\s\S]*allow_repository_credentials=\$ALLOW_REPOSITORY_CREDENTIALS/u,
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
        `${path} secret access must require the positive grant output`,
      );
    }

    const steps = Object.values(parsed.jobs).flatMap((job) => job.steps ?? []);
    const checkouts = steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.ok(checkouts.length > 0, `${path} must contain a checkout`);
    for (const checkout of checkouts) {
      assert.equal(
        checkout.with?.["persist-credentials"],
        false,
        `${path} candidate checkout must not persist the event token`,
      );
    }

    const installs = steps.filter(
      (step) => step.uses === "./.github/actions/pnpm-install",
    );
    assert.ok(installs.length > 0, `${path} must contain a pnpm install`);
    for (const install of installs) {
      assert.equal(
        install.with?.cache,
        `\${{ ${gate} == 'true' }}`,
        `${path} must disable the package cache for Dependabot PRs`,
      );
    }

    const directCaches = steps.filter((step) =>
      step.uses?.startsWith("actions/cache@"),
    );
    for (const cache of directCaches) {
      assert.equal(
        cache.if,
        `${gate} == 'true'`,
        `${path} must disable direct caches for Dependabot PRs`,
      );
    }
  }

  const ci = workflow(".github/workflows/ci.yml");
  assert.deepEqual(ci.jobs.static.permissions, { contents: "read" });
  const trunk = ci.jobs.static.steps.find((step) =>
    step.uses?.startsWith("trunk-io/trunk-action@"),
  );
  assert.equal(
    trunk.with?.cache,
    "${{ needs.changes.outputs.allow_repository_credentials == 'true' }}",
    "Trunk must disable its internal cache for prepared Dependabot PRs",
  );
});

test("main pushes publish only deterministic supply-chain baselines", () => {
  const supplyChain = workflow(".github/workflows/supply-chain.yml");
  const readOnlyOsv = workflow(".github/workflows/_osv-scanner-readonly.yml");

  assert.deepEqual(Object.keys(supplyChain.on).sort(), [
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
  ]);
  assert.deepEqual(supplyChain.on.push, { branches: ["main"] });
  assert.deepEqual(supplyChain.on.pull_request, { branches: ["main"] });
  assert.deepEqual(supplyChain.on.schedule, [{ cron: "17 6 * * *" }]);
  assert.equal(supplyChain.on.workflow_dispatch, null);
  assert.equal(
    supplyChain.concurrency.group,
    "${{ github.workflow }}-${{ github.event_name }}-${{ github.event_name == 'pull_request' && github.ref || github.sha }}",
  );
  const readOnlyNames = {
    osv: "osv-scanner",
    "osv-pnpm-runtime": "osv-scanner (trusted pnpm runtime)",
    "osv-vercel-cli-runtime": "osv-scanner (standalone Vercel CLI runtime)",
    "osv-pnpm-bootstrap": "osv-scanner (trusted pnpm bootstrap)",
  };
  for (const jobId of Object.keys(readOnlyNames)) {
    assert.equal(supplyChain.jobs[jobId].name, readOnlyNames[jobId]);
    assert.equal(
      supplyChain.jobs[jobId].if,
      "github.event_name == 'pull_request'",
    );
    assert.deepEqual(supplyChain.jobs[jobId].permissions, {
      actions: "read",
      contents: "read",
    });
    assert.equal(
      supplyChain.jobs[jobId].uses,
      "./.github/workflows/_osv-scanner-readonly.yml",
    );
    assert.equal(
      Object.hasOwn(supplyChain.jobs[jobId].with, "upload-sarif"),
      false,
    );
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
    assert.match(
      sarifJob.uses,
      /^google\/osv-scanner-action\/\.github\/workflows\/osv-scanner-reusable\.yml@[0-9a-f]{40}$/,
    );
    assert.equal(sarifJob.with["upload-sarif"], true);
  }
  assert.deepEqual(Object.keys(readOnlyOsv.on), ["workflow_call"]);
  assert.equal(readOnlyOsv.on.workflow_call.inputs["scan-args"].required, true);
  assert.deepEqual(readOnlyOsv.permissions, {
    actions: "read",
    contents: "read",
  });
  assert.deepEqual(readOnlyOsv.jobs["osv-scan"].permissions, {
    actions: "read",
    contents: "read",
  });
  assert.equal(readOnlyOsv.jobs["osv-scan"].name, "osv-scan");
  assert.equal(readOnlyOsv.jobs["osv-scan"]["timeout-minutes"], 10);
  const readOnlySteps = readOnlyOsv.jobs["osv-scan"].steps;
  const readOnlyCheckout = readOnlySteps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(readOnlyCheckout.with["persist-credentials"], false);
  const scanner = readOnlySteps.find((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-scanner-action@"),
  );
  assert.equal(scanner["continue-on-error"], true);
  assert.match(scanner.with["scan-args"], /--output=results\.json/);
  assert.match(scanner.with["scan-args"], /--format=json/);
  assert.match(scanner.with["scan-args"], /\$\{\{ inputs\.scan-args \}\}/);
  const reporter = readOnlySteps.find((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-reporter-action@"),
  );
  assert.match(reporter.with["scan-args"], /--output=results\.sarif/);
  assert.match(reporter.with["scan-args"], /--new=results\.json/);
  assert.match(reporter.with["scan-args"], /--gh-annotations=false/);
  assert.match(reporter.with["scan-args"], /--fail-on-vuln=true/);
  const readOnlySource = JSON.stringify(readOnlyOsv);
  assert.doesNotMatch(
    readOnlySource,
    /security-events|upload-sarif|github\/codeql-action|actions\/upload-artifact/,
  );
  for (const jobId of ["lockfile-lint", "version-skew"]) {
    const checkout = supplyChain.jobs[jobId].steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with["persist-credentials"], false);
  }
  const dependencyReview = workflow(".github/workflows/dependency-review.yml");
  const dependencyCheckout = dependencyReview.jobs[
    "dependency-review"
  ].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(dependencyCheckout.with["persist-credentials"], false);
  assert.equal(supplyChain.jobs["lockfile-lint"].if, undefined);
  assert.equal(supplyChain.jobs["version-skew"].if, undefined);
});

test("sensitive Actions updates stay out of the routine Dependabot group", () => {
  const config = parse(read(".github/dependabot.yml"), { uniqueKeys: true });
  const actionsConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "github-actions",
  );
  const routine = actionsConfig.groups["github-actions-routine"];
  const manual = actionsConfig.groups["github-actions-manual"];
  assert.deepEqual(
    manual.patterns,
    routine["exclude-patterns"],
    "the manual group must exactly mirror the routine exclusions",
  );

  const actionDependencies = new Set();
  const githubRoot = fileURLToPath(new URL("../.github/", import.meta.url));
  for (const path of filesBelow(githubRoot).filter((entry) =>
    /\.ya?ml$/.test(entry),
  )) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
      const dependency = match[1].replace(/^['"]|['"]$/g, "").split("@")[0];
      if (!dependency.startsWith("./") && dependency.includes("/")) {
        actionDependencies.add(dependency);
      }
    }
  }

  const sensitive = [...actionDependencies]
    .filter((dependency) =>
      /(?:create-github-app-token|dependency-review|anthropic|claude|codex|copilot|codeql|dependabot|osv|scorecard|security|harden-runner|trivy|snyk|attest|reviewer|review-action)/i.test(
        dependency,
      ),
    )
    .sort();
  assert.deepEqual(sensitive, [
    "actions/create-github-app-token",
    "actions/dependency-review-action",
    "anthropics/claude-code-action",
    "anthropics/claude-code-action/base-action",
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
      `${dependency} must be excluded from the routine group`,
    );
  }
});

test("npm group routing isolates sensitive dependencies and covers the workspace", () => {
  const config = parse(read(".github/dependabot.yml"), { uniqueKeys: true });
  const npmConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "npm",
  );
  const enumeratedGroups = ["frontend-core", "web3-stack", "ui-styling"];
  const productionMisc = npmConfig.groups["production-misc"];
  assert.ok(
    npmConfig["open-pull-requests-limit"] >= 6,
    "the isolated Vercel CLI lane must have capacity beyond the observed five-PR pressure set",
  );
  assert.deepEqual(npmConfig.groups["vercel-cli"], {
    "applies-to": "version-updates",
    patterns: ["vercel"],
    "update-types": ["minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["vercel-cli-security"], {
    "applies-to": "security-updates",
    patterns: ["vercel"],
  });
  assert.ok(
    npmConfig.groups.tooling["exclude-patterns"].includes("vercel"),
    "the broad development group must not absorb Vercel CLI rotations",
  );
  assert.ok(
    npmConfig.groups["security-tooling"]["exclude-patterns"].includes("vercel"),
    "the broad security group must not absorb Vercel CLI security rotations",
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
  assert.deepEqual(productionMisc.patterns, ["*"]);
  assert.deepEqual(npmConfig.cooldown, {
    "default-days": 7,
    "semver-major-days": 21,
    "semver-minor-days": 7,
    "semver-patch-days": 7,
  });
  assert.equal(
    npmConfig.ignore,
    undefined,
    "npm majors must stay eligible for processor preparation and human merge",
  );

  // Preserve explicit group boundaries even if the YAML order changes.
  for (const groupName of enumeratedGroups) {
    for (const pattern of npmConfig.groups[groupName].patterns) {
      assert.ok(
        productionMisc["exclude-patterns"].includes(pattern),
        `${groupName} pattern ${pattern} must be excluded from production-misc`,
      );
    }
  }
  const ownedPatterns = enumeratedGroups.flatMap(
    (groupName) => npmConfig.groups[groupName].patterns,
  );
  for (const pattern of productionMisc["exclude-patterns"]) {
    assert.ok(
      ownedPatterns.includes(pattern),
      `production-misc excludes ${pattern}, which no enumerated group owns`,
    );
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
            `${packagePath} ${manifestKey} dependency ${dependency} has no ${updateType} group`,
          );
        }
      }
    }
  }
});

test("pnpm release-age exclusions stay exact and bounded", () => {
  const workspace = parse(read("pnpm-workspace.yaml"), { uniqueKeys: true });

  assert.deepEqual(workspace.minimumReleaseAgeExclude, [
    "@mento-protocol/mento-sdk@3.4.0",
  ]);
  assert.equal(
    workspace.catalog["@mento-protocol/mento-sdk"],
    "3.4.0",
    "remove the release-age exclusion when the reviewed catalog pin changes",
  );
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
    ...lockfile.matchAll(/^ {2}'(@wagmi\/core@[^']+\([^']+\))':$/gm),
  ].map((match) => match[1]);

  assert.equal(wagmiPeerSnapshots.length, 1);
  assert.equal(
    wagmiPeerSnapshots[0].includes("use-sync-external-store@1.4.0"),
    true,
  );
});

test("embedded workflow JavaScript parses before GitHub executes it", () => {
  const expectedModuleCounts = new Map([
    [processorPath, 4],
    [dependabotReviewPath, 6],
    [preparedIntakePath, 1],
    [repairPath, 3],
  ]);
  for (const [path, expectedCount] of expectedModuleCounts) {
    const modules = [
      ...read(path).matchAll(
        /node --input-type=module --eval '\n([\s\S]*?)\n\s*'(?:\s+"\$[A-Za-z_][A-Za-z0-9_]*")?/g,
      ),
    ];
    assert.equal(modules.length, expectedCount, path);
    for (const [, source] of modules) {
      const result = spawnSync("node", ["--input-type=module", "--check"], {
        encoding: "utf8",
        input: source,
      });
      assert.equal(result.status, 0, `${path}: ${result.stderr}`);
    }
  }
});

function runBashStep(step, env, eventPayload) {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-workflow-test-"),
  );
  const githubOutput = join(temporaryDirectory, "github-output");
  const eventPath = join(temporaryDirectory, "event.json");
  try {
    if (eventPayload !== undefined) {
      writeFileSync(eventPath, JSON.stringify(eventPayload));
    }
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: githubOutput,
        ...env,
        ...(eventPayload === undefined ? {} : { GITHUB_EVENT_PATH: eventPath }),
      },
    });
    return {
      ...result,
      githubOutput: existsSync(githubOutput)
        ? readFileSync(githubOutput, "utf8")
        : "",
    };
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function liveIntakeEnvironment(overrides = {}) {
  const headSha = "a".repeat(40);
  return {
    DEFAULT_BRANCH: "main",
    INTAKE_ACTOR_LOGIN: "dependabot[bot]",
    INTAKE_ACTOR_ID: "49699333",
    INTAKE_ACTOR_TYPE: "Bot",
    INTAKE_CONCLUSION: "success",
    INTAKE_EVENT: "pull_request_target",
    INTAKE_HEAD_BRANCH: "dependabot/npm_and_yarn/runtime-packages-123abc",
    INTAKE_HEAD_REPOSITORY: "mento-protocol/frontend-monorepo",
    INTAKE_HEAD_SHA: headSha,
    INTAKE_PATH: ".github/workflows/dependabot-intake.yml",
    INTAKE_PULL_REQUESTS_JSON: JSON.stringify([
      {
        number: 701,
        head: {
          ref: "dependabot/npm_and_yarn/runtime-packages-123abc",
          sha: headSha,
        },
        base: { ref: "main" },
      },
    ]),
    INTAKE_TITLE: `dependabot-intake:v1 | repository=mento-protocol/frontend-monorepo | pr=701 | sha=${headSha} | action=synchronize | receipt=true`,
    INTAKE_TRIGGERING_ACTOR_LOGIN: "dependabot[bot]",
    INTAKE_TRIGGERING_ACTOR_TYPE: "Bot",
    INTAKE_STATUS: "completed",
    INTAKE_RUN_ATTEMPT: "1",
    INTAKE_RUN_ID: "123456789",
    EXPECTED_PREPARE_BOT_ID: "123456",
    EXPECTED_PREPARE_BOT_LOGIN: "mento-dependabot-prepare[bot]",
    REPOSITORY: "mento-protocol/frontend-monorepo",
    ...overrides,
  };
}

function liveRepositoryDispatchPayload(overrides = {}) {
  return {
    action: "dependabot-process",
    client_payload: { scope: "open" },
    repository: {
      default_branch: "main",
      full_name: "mento-protocol/frontend-monorepo",
    },
    sender: {
      login: "mento-operator",
      type: "User",
    },
    ...overrides,
  };
}

function liveRepositoryDispatchEnvironment() {
  return {
    DEFAULT_BRANCH: "main",
    EVENT_NAME: "repository_dispatch",
    REPOSITORY: "mento-protocol/frontend-monorepo",
  };
}

test("intake is an exact credentialless metadata receipt", () => {
  assert.equal(intake.name, "Dependabot Intake");
  assert.deepEqual(intake.on, {
    pull_request_target: {
      types: ["opened", "synchronize", "reopened"],
    },
  });
  assert.deepEqual(intake.permissions, {});
  assert.match(
    intake["run-name"],
    /^\$\{\{ format\('dependabot-intake:v1 \| repository=\{0\} \| pr=\{1\} \| sha=\{2\} \| action=\{3\} \| receipt=\{4\}'/,
  );

  const job = intake.jobs["validate-receipt"];
  assert.equal(Object.hasOwn(job, "permissions"), false);
  assert.equal(job.steps.length, 1);
  assert.equal(Object.hasOwn(job.steps[0], "uses"), false);
  assert.match(job.if, /dependabot\[bot\].*dependabot\//s);
  assert.match(job.if, /github\.event\.sender\.login.*dependabot\[bot\]/s);
  assert.match(job.if, /github\.event\.sender\.id.*49699333/s);
  assert.match(job.if, /github\.event\.sender\.type.*Bot/s);
  assert.deepEqual(Object.keys(job.steps[0].env).sort(), [
    "ACTION",
    "AUTHOR",
    "BASE_REF",
    "DEFAULT_BRANCH",
    "HEAD_REF",
    "HEAD_REPOSITORY",
    "HEAD_SHA",
    "PR_NUMBER",
    "REPOSITORY",
    "SENDER_ID",
    "SENDER_LOGIN",
    "SENDER_TYPE",
  ]);
  assert.match(job.steps[0].run, /mento-protocol\/frontend-monorepo/);
  assert.match(job.steps[0].run, /dependabot\[bot\]/);
  assert.match(job.steps[0].run, /SENDER_ID.*49699333/);
  assert.match(job.steps[0].run, /SENDER_LOGIN.*dependabot\[bot\]/);
  assert.match(job.steps[0].run, /SENDER_TYPE.*Bot/);
  assert.match(job.steps[0].run, /HEAD_REPOSITORY.*REPOSITORY/);
  assert.match(job.steps[0].run, /DEFAULT_BRANCH.*main/);
  assert.match(job.steps[0].run, /BASE_REF.*main/);
  assert.match(job.steps[0].run, /HEAD_REF.*dependabot\/\*/);
  assert.match(job.steps[0].run, /\[0-9a-f\]\{40\}/);
  assert.match(job.steps[0].run, /opened\|synchronize\|reopened/);
  assert.match(
    intake["run-name"],
    /github\.event\.sender\.login.*github\.event\.sender\.id.*github\.event\.sender\.type/s,
  );

  const raw = JSON.stringify(intake);
  assert.doesNotMatch(
    raw,
    /secrets\.|github\.token|GITHUB_TOKEN|\buses:|actions\/|gh api|curl|wget|artifact|checkout|cache/,
  );
});

test("processor has only trusted automatic and strict repository triggers", () => {
  assert.equal(processor.name, "Dependabot Processor");
  assert.deepEqual(Object.keys(processor.on), [
    "workflow_run",
    "repository_dispatch",
    "schedule",
  ]);
  assert.deepEqual(processor.on.workflow_run, {
    workflows: [
      "Dependabot Intake",
      "Dependabot Prepared Head Intake",
      "Dependabot Claude Review",
    ],
    types: ["completed"],
  });
  assert.deepEqual(processor.on.repository_dispatch, {
    types: ["dependabot-process"],
  });
  assert.deepEqual(processor.on.schedule, [
    { cron: "3,13,23,33,43,53 * * * *" },
  ]);
  assert.deepEqual(processor.permissions, {});
  assert.deepEqual(processor.concurrency, {
    group: "dependabot-processor",
    "cancel-in-progress": false,
    queue: "max",
  });
  assert.equal(
    processor.env.DEPENDABOT_PROCESSOR_MODE,
    "${{ vars.DEPENDABOT_PROCESSOR_MODE }}",
  );
  assert.match(
    processor["run-name"],
    /receipt=\{0\}.*workflow_run\.display_title/s,
  );
  assert.doesNotMatch(processor["run-name"], /workflow_run\.pull_requests/);
  assert.match(processor["run-name"], /target=scope=open/);

  const raw = read(processorPath);
  assert.doesNotMatch(raw, /workflow_dispatch|\binputs\./);
  assert.doesNotMatch(raw, /--admin\b/);
});

test("read-only evaluation authenticates every trigger before live collection", () => {
  const evaluate = processor.jobs.evaluate;
  assert.deepEqual(evaluate.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });
  assert.match(
    evaluate.if,
    /github\.repository == 'mento-protocol\/frontend-monorepo'/,
  );
  assert.match(
    evaluate.if,
    /endsWith\(github\.event\.workflow_run\.display_title, 'receipt=true'\)/,
  );
  assert.match(evaluate.if, /dependabot-prepared-head-intake\.yml/);
  assert.match(evaluate.if, /dependabot-claude-review\.yml/);
  assert.match(evaluate.if, /github\.event\.action == 'dependabot-process'/);
  assert.doesNotMatch(evaluate.if, /client_payload/);
  assert.doesNotMatch(evaluate.if, /workflow_run\.name/);
  assert.doesNotMatch(
    evaluate.if,
    /workflow_run\.(?:event|conclusion|head_repository|head_branch)/,
  );
  assert.match(evaluate.if, /workflow_run\.path/);

  const target = evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  assert.ok(target);
  assert.equal(target.env.INTAKE_PATH, "${{ github.event.workflow_run.path }}");
  assert.equal(Object.hasOwn(target.env, "INTAKE_WORKFLOW"), false);
  assert.match(target.run, /case "\$INTAKE_PATH" in/);
  assert.match(target.run, /Object\.keys\(clientPayload\)\.sort\(\)/);
  assert.match(target.run, /process\.env\.GITHUB_EVENT_PATH/);
  assert.equal(Object.hasOwn(target.env, "EVENT_PATH"), false);
  assert.equal(Object.hasOwn(target.env, "GITHUB_EVENT_PATH"), false);
  assert.doesNotMatch(JSON.stringify(target.env), /github\.event_path/);
  assert.match(target.run, /\["scope"\]/);
  assert.doesNotMatch(target.run, /clientPayload\.(?:repository|schema)/);
  assert.match(target.run, /dependabot-intake:v1/);
  assert.match(target.run, /dependabot-prepared-head:v1/);
  assert.match(target.run, /dependabot-claude-review:v1/);
  assert.match(target.run, /success\|failure/);
  assert.match(target.run, /\[0-9a-f\]\{40\}/);
  assert.match(target.run, /INTAKE_ACTOR_LOGIN.*dependabot\[bot\]/);
  assert.match(target.run, /INTAKE_ACTOR_TYPE.*Bot/);
  assert.match(target.run, /INTAKE_HEAD_BRANCH.*dependabot\/\*/);
  assert.match(target.run, /INTAKE_HEAD_SHA.*receipt_head_sha/s);
  assert.match(target.run, /linked\.length > 1/);
  assert.match(target.run, /pullRequest\?\.head\?\.sha/);

  const invocation = evaluate.steps.find((step) =>
    String(step.run ?? "").includes("evaluate"),
  );
  assert.ok(invocation);
  assert.match(invocation.run, /evaluate\s+--live/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ steps.mode.outputs.processor_mode }}",
  );
});

test("processor accepts a live-shaped Dependabot intake receipt", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(target, {
    ...liveIntakeEnvironment(),
    EVENT_NAME: "workflow_run",
    EVENT_PATH: "/dev/null",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_numbers=701\nexpected_head_sha=${"a".repeat(40)}\nfollowup_kind=native-intake\noperation_code=\noperation_check_id=\noperation_digest=\n`,
  );
});

test("processor rejects an intake whose upstream head differs from its receipt", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(target, {
    ...liveIntakeEnvironment({ INTAKE_HEAD_SHA: "b".repeat(40) }),
    EVENT_NAME: "workflow_run",
    EVENT_PATH: "/dev/null",
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.githubOutput, "");
});

test("processor accepts an exact prepared-head intake completion", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const headSha = "b".repeat(40);
  const digest = "d".repeat(64);
  const result = runBashStep(target, {
    ...liveIntakeEnvironment(),
    EVENT_NAME: "workflow_run",
    INTAKE_ACTOR_ID: "123456",
    INTAKE_ACTOR_LOGIN: "mento-dependabot-prepare[bot]",
    INTAKE_CONCLUSION: "success",
    INTAKE_EVENT: "repository_dispatch",
    INTAKE_HEAD_BRANCH: "main",
    INTAKE_HEAD_SHA: "c".repeat(40),
    INTAKE_PATH: ".github/workflows/dependabot-prepared-head-intake.yml",
    INTAKE_PULL_REQUESTS_JSON: "[]",
    INTAKE_TITLE: `dependabot-prepared-head:v1|p=701|h=${headSha}|o=p|c=321|d=${digest}|ok=true`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_numbers=701\nexpected_head_sha=${headSha}\nfollowup_kind=prepared-intake\noperation_code=p\noperation_check_id=321\noperation_digest=${digest}\n`,
  );
});

test("processor wakes on a failed exact Claude reviewer completion", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const headSha = "a".repeat(40);
  const result = runBashStep(target, {
    ...liveIntakeEnvironment(),
    EVENT_NAME: "workflow_run",
    INTAKE_CONCLUSION: "failure",
    INTAKE_EVENT: "workflow_run",
    INTAKE_HEAD_BRANCH: "main",
    INTAKE_HEAD_SHA: "c".repeat(40),
    INTAKE_PATH: ".github/workflows/dependabot-claude-review.yml",
    INTAKE_TITLE: `dependabot-claude-review:v1 | source=dependabot-intake:v1 | repository=mento-protocol/frontend-monorepo | pr=701 | sha=${headSha} | action=synchronize | receipt=true`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_numbers=701\nexpected_head_sha=${headSha}\nfollowup_kind=claude-review\noperation_code=\noperation_check_id=\noperation_digest=\n`,
  );
});

test("processor accepts a live-shaped repository dispatch envelope", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(
    target,
    liveRepositoryDispatchEnvironment(),
    liveRepositoryDispatchPayload(),
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.githubOutput, "pr_numbers=all\nexpected_head_sha=\n");
});

test("processor fails closed without the runner event path", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const result = runBashStep(target, liveRepositoryDispatchEnvironment());

  assert.notEqual(result.status, 0);
  assert.equal(result.githubOutput, "");
});

test("processor rejects malformed repository dispatch envelopes", () => {
  const target = processor.jobs.evaluate.steps.find(
    (step) => step.name === "Validate trigger and select a bounded target",
  );
  const invalidPayloads = [
    {
      name: "extra client-payload key",
      payload: liveRepositoryDispatchPayload({
        client_payload: { scope: "open", mode: "merge" },
      }),
    },
    {
      name: "wrong scope",
      payload: liveRepositoryDispatchPayload({
        client_payload: { scope: "selected" },
      }),
    },
    {
      name: "wrong action",
      payload: liveRepositoryDispatchPayload({
        action: "dependabot-repair",
      }),
    },
  ];

  for (const { name, payload } of invalidPayloads) {
    const result = runBashStep(
      target,
      liveRepositoryDispatchEnvironment(),
      payload,
    );
    assert.notEqual(result.status, 0, name);
    assert.equal(result.githubOutput, "", name);
  }
});

test("every processor phase materializes only the exact trusted sources", () => {
  for (const jobName of [
    "evaluate",
    "process",
    "prepare-request",
    "prepare-mutate",
    "prepare-finalize",
  ]) {
    const job = processor.jobs[jobName];
    const step = job.steps.find(
      (candidate) =>
        candidate.name ===
        "Materialize the processor from the exact trusted workflow SHA",
    );
    assert.ok(step, `${jobName} must materialize the processor`);
    assert.equal(Object.hasOwn(step, "uses"), false);
    assert.equal(step.env.WORKFLOW_SHA, "${{ github.workflow_sha }}");
    assert.equal(step.env.REPOSITORY, "${{ github.repository }}");
    assert.match(step.run, /commits\/\$WORKFLOW_SHA/);
    assert.match(
      step.run,
      /contents\/scripts\/dependabot-processor\.mjs\?ref=\$WORKFLOW_SHA/,
    );
    assert.match(
      step.run,
      /trusted_receipts="\$trusted_root\/dependabot-preparation-receipts\.mjs"/,
    );
    assert.match(
      step.run,
      /contents\/scripts\/dependabot-preparation-receipts\.mjs\?ref=\$WORKFLOW_SHA/,
    );
    assert.match(step.run, /test -s "\$trusted_processor"/);
    assert.match(step.run, /test -s "\$trusted_receipts"/);
    assert.match(step.run, /chmod 0400 "\$trusted_receipts"/);
    assert.match(step.run, /resolved_sha.*WORKFLOW_SHA/s);
    assert.doesNotMatch(step.run, forbiddenCandidateSurfaces);
  }
});

test("the exact-SHA processor materialization imports its receipt dependency", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-processor-materialization-"),
  );
  const mockBin = join(temporaryDirectory, "bin");
  const mockGh = join(mockBin, "gh");
  const processorSourcePath = fileURLToPath(
    new URL("../scripts/dependabot-processor.mjs", import.meta.url),
  );
  const receiptsSourcePath = fileURLToPath(
    new URL("../scripts/dependabot-preparation-receipts.mjs", import.meta.url),
  );
  const workflowSha = "d".repeat(40);

  try {
    mkdirSync(mockBin, { recursive: true });
    writeFileSync(
      mockGh,
      `#!/usr/bin/env bash
set -euo pipefail
test "$GH_TOKEN" = "$EXPECTED_READ_TOKEN"
for argument in "$@"; do
  if [[ "$argument" == repos/*/commits/* ]]; then
    printf '%s\\n' "$WORKFLOW_SHA"
    exit 0
  fi
  if [[ "$argument" == *"contents/scripts/dependabot-processor.mjs?ref="* ]]; then
    /bin/cat "$MOCK_PROCESSOR_SOURCE"
    exit 0
  fi
  if [[ "$argument" == *"contents/scripts/dependabot-preparation-receipts.mjs?ref="* ]]; then
    /bin/cat "$MOCK_RECEIPTS_SOURCE"
    exit 0
  fi
done
exit 64
`,
    );
    chmodSync(mockGh, 0o500);

    for (const jobName of [
      "evaluate",
      "process",
      "prepare-request",
      "prepare-mutate",
      "prepare-finalize",
    ]) {
      const step = processor.jobs[jobName].steps.find(
        (candidate) =>
          candidate.name ===
          "Materialize the processor from the exact trusted workflow SHA",
      );
      const runnerTemp = join(temporaryDirectory, jobName);
      mkdirSync(runnerTemp, { recursive: true });
      const result = runBashStep(step, {
        EXPECTED_READ_TOKEN: "normal-read-token",
        GH_TOKEN: "normal-read-token",
        MOCK_PROCESSOR_SOURCE: processorSourcePath,
        MOCK_RECEIPTS_SOURCE: receiptsSourcePath,
        PATH: `${mockBin}:${process.env.PATH}`,
        REPOSITORY: "mento-protocol/frontend-monorepo",
        RUNNER_TEMP: runnerTemp,
        WORKFLOW_SHA: workflowSha,
      });
      assert.equal(result.status, 0, `${jobName}: ${result.stderr}`);

      const trustedRoot = join(runnerTemp, "dependabot-processor");
      const trustedProcessor = join(trustedRoot, "dependabot-processor.mjs");
      const trustedReceipts = join(
        trustedRoot,
        "dependabot-preparation-receipts.mjs",
      );
      assert.equal(result.githubOutput, `path=${trustedProcessor}\n`, jobName);
      assert.equal(
        readFileSync(trustedProcessor, "utf8"),
        readFileSync(processorSourcePath, "utf8"),
        jobName,
      );
      assert.equal(
        readFileSync(trustedReceipts, "utf8"),
        readFileSync(receiptsSourcePath, "utf8"),
        jobName,
      );

      const imported = spawnSync(
        "node",
        [
          "--input-type=module",
          "--eval",
          'import { pathToFileURL } from "node:url"; await import(pathToFileURL(process.argv[2]).href);',
          "materialization-test",
          trustedProcessor,
        ],
        { encoding: "utf8" },
      );
      assert.equal(imported.status, 0, `${jobName}: ${imported.stderr}`);
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("the exact-SHA terminal source materialization imports every local dependency", () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-terminal-source-materialization-"),
  );
  const mockBin = join(temporaryDirectory, "bin");
  const mockGh = join(mockBin, "gh");
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const workflowSha = "d".repeat(40);
  const runId = `${process.pid}${Date.now()}`;
  const trustedRoot = join("/tmp", `dependabot-terminal-source-${runId}-1`);

  try {
    mkdirSync(mockBin, { recursive: true });
    writeFileSync(
      mockGh,
      `#!/usr/bin/env bash
set -euo pipefail
test "$GH_TOKEN" = "$EXPECTED_READ_TOKEN"
for argument in "$@"; do
  if [[ "$argument" == repos/*/commits/* ]]; then
    test "$argument" = "repos/$REPOSITORY/commits/$WORKFLOW_SHA"
    printf '%s\\n' "$WORKFLOW_SHA"
    exit 0
  fi
  if [[ "$argument" == repos/*/contents/* ]]; then
    source_path="\${argument#*contents/}"
    source_path="\${source_path%%\\?ref=*}"
    test "$argument" = "repos/$REPOSITORY/contents/$source_path?ref=$WORKFLOW_SHA"
    test -f "$MOCK_REPOSITORY_ROOT/$source_path"
    /bin/cat "$MOCK_REPOSITORY_ROOT/$source_path"
    exit 0
  fi
done
exit 64
`,
    );
    chmodSync(mockGh, 0o500);

    const step = repair.jobs.candidate_cli_smoke.steps[0];
    const result = runBashStep(step, {
      EXPECTED_READ_TOKEN: "normal-read-token",
      GH_TOKEN: "normal-read-token",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_RUN_ID: runId,
      MOCK_REPOSITORY_ROOT: repositoryRoot,
      PATH: `${mockBin}:${process.env.PATH}`,
      REPOSITORY: "mento-protocol/frontend-monorepo",
      WORKFLOW_SHA: workflowSha,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.githubOutput, `root=${trustedRoot}\n`);

    const trustedSync = join(
      trustedRoot,
      "scripts",
      "dependabot-protected-runtime-sync.mjs",
    );
    const trustedContract = join(
      trustedRoot,
      "scripts",
      "vercel-cli-runtime",
      "contract.json",
    );
    assert.equal(
      readFileSync(trustedContract, "utf8"),
      read("scripts/vercel-cli-runtime/contract.json"),
    );

    const imported = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import { pathToFileURL } from "node:url"; await import(pathToFileURL(process.argv[2]).href);',
        "materialization-test",
        trustedSync,
      ],
      { encoding: "utf8" },
    );
    assert.equal(imported.status, 0, imported.stderr);
  } finally {
    makeDirectoryTreeRemovable(trustedRoot);
    rmSync(trustedRoot, { force: true, recursive: true });
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("processor normalizes only exact human-merge-only modes", () => {
  const evaluateJob = processor.jobs.evaluate;
  const mode = evaluateJob.steps.find(
    (step) =>
      step.name === "Normalize the exact processor mode without credentials",
  );
  assert.ok(mode);
  assert.equal(mode.id, "mode");
  assert.equal(mode.shell, "bash");
  assert.deepEqual(mode.env, {
    RAW_PROCESSOR_MODE: "${{ env.DEPENDABOT_PROCESSOR_MODE }}",
  });
  assert.equal(Object.hasOwn(mode, "uses"), false);
  assert.doesNotMatch(JSON.stringify(mode), /secrets\.|github\.token/);
  assert.match(mode.run, /observe\|assist\|prepare/);
  assert.match(mode.run, /processor_mode="observe"/);

  for (const [rawMode, expectedMode, expectedPrepare] of [
    ["observe", "observe", false],
    ["assist", "assist", false],
    ["prepare", "prepare", true],
    ["merge", "observe", false],
    ["Prepare", "observe", false],
    ["PREPARE", "observe", false],
    [" prepare ", "observe", false],
    ["", "observe", false],
    ["unknown", "observe", false],
  ]) {
    const result = runBashStep(mode, { RAW_PROCESSOR_MODE: rawMode });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.githubOutput,
      `processor_mode=${expectedMode}\nprepare=${expectedPrepare}\n`,
      JSON.stringify(rawMode),
    );
  }

  assert.deepEqual(evaluateJob.outputs, {
    expected_head_sha: "${{ steps.target.outputs.expected_head_sha }}",
    pr_numbers: "${{ steps.target.outputs.pr_numbers }}",
    processor_mode: "${{ steps.mode.outputs.processor_mode }}",
    prepare: "${{ steps.mode.outputs.prepare }}",
    refresh_pending: "${{ steps.evaluation.outputs.refresh_pending }}",
    refresh_required: "${{ steps.evaluation.outputs.refresh_required }}",
  });

  const invocation = evaluateJob.steps.find((step) =>
    String(step.run ?? "").includes("evaluate"),
  );
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ steps.mode.outputs.processor_mode }}",
  );
});

test("observe and assist processing have no branch-write App credential", () => {
  const processJob = processor.jobs.process;
  assert.equal(processJob.needs, "evaluate");
  assert.match(processJob.if, /needs\.evaluate\.result == 'success'/);
  assert.match(processJob.if, /needs\.evaluate\.outputs\.prepare != 'true'/);
  assert.deepEqual(processJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "write",
    statuses: "read",
  });
  assert.deepEqual(
    processJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [],
  );

  const invocation = processJob.steps.find(
    (step) =>
      step.name === "Re-query exact heads and process the current sweep",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+--live\s+--publish-checks/);
  assert.match(invocation.run, /--phase finalize/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.PROCESSOR_MODE,
    "${{ needs.evaluate.outputs.processor_mode }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    Object.hasOwn(invocation.env, "DEPENDABOT_PROCESSOR_REPAIR_TOKEN"),
    false,
  );

  const raw = JSON.stringify(processJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /PREPARE_APP|REPAIR_TOKEN|secrets\./);
  assert.doesNotMatch(raw, /--admin\b/);
});

test("initial evaluation exports only validated prepare routing booleans", () => {
  const evaluation = processor.jobs.evaluate.steps.find(
    (step) => step.id === "evaluation",
  );
  assert.ok(evaluation);
  assert.match(evaluation.run, /> "\$EVALUATION_RESULT_PATH"/);
  assert.match(evaluation.run, /dependabot-processor:v2/);
  assert.match(evaluation.run, /allowedDispositions/);
  assert.match(evaluation.run, /refresh_pending=/);
  assert.match(evaluation.run, /refresh_required=/);
  assert.doesNotMatch(evaluation.run, /prepareCandidate=.*GITHUB_OUTPUT/);

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "dependabot-evaluation-routing-test-"),
  );
  const mockProcessor = join(temporaryDirectory, "mock-processor.mjs");
  writeFileSync(
    mockProcessor,
    "process.stdout.write(process.env.MOCK_EVALUATION_RESULT);\n",
  );

  const candidate = (disposition) => ({
    disposition,
    headSha: "a".repeat(40),
    pullRequestNumber: 777,
  });
  const resultFor = ({
    prepareCandidate = null,
    mode = "prepare",
    repository = "mento-protocol/frontend-monorepo",
    schema = "dependabot-processor:v2",
  } = {}) => ({
    evaluations: prepareCandidate === null ? [] : [{ ...prepareCandidate }],
    mode,
    prepareCandidate,
    repository,
    schema,
  });
  const runRouting = (result, mode = result.mode) =>
    runBashStep(evaluation, {
      EVALUATION_RESULT_PATH: join(temporaryDirectory, "evaluation.json"),
      EXPECTED_HEAD_SHA: "",
      MOCK_EVALUATION_RESULT: JSON.stringify(result),
      PROCESSOR_MODE: mode,
      PROCESSOR_PATH: mockProcessor,
      PR_NUMBERS: "all",
      REPOSITORY: "mento-protocol/frontend-monorepo",
    });

  try {
    for (const [disposition, expectedPending, expectedRequired] of [
      [null, false, false],
      ["feedback-remediation-required", false, false],
      ["prepare-candidate", false, false],
      ["refresh-receipt-required", false, false],
      ["refresh-required", false, true],
      ["refresh-pending", true, false],
      ["repair-pending", false, false],
      ["repair-required", false, false],
      ["waiting-baseline", false, false],
      ["waiting-checks", false, false],
      ["waiting-retry", false, false],
    ]) {
      const result = runRouting(
        resultFor({
          prepareCandidate:
            disposition === null ? null : candidate(disposition),
        }),
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        result.githubOutput,
        `refresh_pending=${expectedPending}\n` +
          `refresh_required=${expectedRequired}\n`,
      );
    }

    const observe = runRouting(resultFor({ mode: "observe" }), "observe");
    assert.equal(observe.status, 0, observe.stderr);
    assert.equal(
      observe.githubOutput,
      "refresh_pending=false\nrefresh_required=false\n",
    );
    const observeCandidate = runRouting(
      resultFor({
        mode: "observe",
        prepareCandidate: candidate("refresh-required"),
      }),
      "observe",
    );
    assert.notEqual(observeCandidate.status, 0, observeCandidate.stderr);
    assert.equal(observeCandidate.githubOutput, "");

    for (const invalid of [
      resultFor({ schema: "dependabot-processor:v1" }),
      resultFor({ repository: "other/repository" }),
      resultFor({ mode: "assist" }),
      resultFor({
        prepareCandidate: {
          ...candidate("refresh-required"),
          headSha: "b".repeat(39),
        },
      }),
      resultFor({
        prepareCandidate: {
          ...candidate("refresh-required"),
          pullRequestNumber: 0,
        },
      }),
      resultFor({
        prepareCandidate: {
          ...candidate("refresh-required"),
          pullRequestNumber: 10_000_000_000,
        },
      }),
      {
        evaluations: [],
        mode: "prepare",
        repository: "mento-protocol/frontend-monorepo",
        schema: "dependabot-processor:v2",
      },
      resultFor({
        prepareCandidate: {
          ...candidate("refresh-required"),
          extra: true,
        },
      }),
      resultFor({ prepareCandidate: candidate("unknown") }),
      {
        ...resultFor({
          prepareCandidate: candidate("refresh-required"),
        }),
        evaluations: [],
      },
      {
        ...resultFor({
          prepareCandidate: candidate("refresh-required"),
        }),
        evaluations: [
          candidate("refresh-required"),
          candidate("refresh-required"),
        ],
      },
    ]) {
      const result = runRouting(invalid, "prepare");
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
      assert.equal(result.githubOutput, "", JSON.stringify(invalid));
    }
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

test("refresh request publication has checks authority but no branch credential", () => {
  const requestJob = processor.jobs["prepare-request"];
  assert.equal(requestJob.needs, "evaluate");
  assert.match(requestJob.if, /needs\.evaluate\.result == 'success'/);
  assert.match(requestJob.if, /needs\.evaluate\.outputs\.prepare == 'true'/);
  assert.match(
    requestJob.if,
    /needs\.evaluate\.outputs\.refresh_required == 'true'/,
  );
  assert.match(
    requestJob.if,
    /needs\.evaluate\.outputs\.refresh_pending == 'true'/,
  );
  assert.deepEqual(requestJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });
  assert.deepEqual(requestJob.outputs, {
    refresh_pending: "${{ steps.plan.outputs.refresh_pending }}",
    refresh_requested: "${{ steps.plan.outputs.refresh_requested }}",
  });
  const invocation = requestJob.steps.find(
    (step) =>
      step.name === "Publish only an exact-head refresh request when required",
  );
  assert.ok(invocation);
  assert.equal(invocation.id, "request");
  assert.match(invocation.run, /process[\s\S]*--publish-checks/);
  assert.match(invocation.run, /--phase request/);
  assert.match(invocation.run, /--mode prepare/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );
  assert.match(invocation.run, /> "\$REQUEST_RESULT_PATH"/);

  const plan = requestJob.steps.find(
    (step) => step.name === "Classify the authenticated request-phase result",
  );
  assert.ok(plan);
  assert.equal(plan.id, "plan");
  assert.match(plan.run, /dependabot-processor:v2/);
  assert.match(plan.run, /result\?\.mode !== "prepare"/);
  assert.match(plan.run, /result\?\.phase !== "request"/);
  assert.match(plan.run, /mutation\?\.kind !== "refresh-requested"/);
  assert.match(plan.run, /refresh_pending=/);
  assert.match(plan.run, /refresh_requested=/);
  assert.doesNotMatch(
    JSON.stringify(requestJob),
    /create-github-app-token|PREPARE_APP_CLIENT_ID|PREPARE_APP_PRIVATE_KEY|REPAIR_TOKEN|REPAIR_APP|secrets\./,
  );
});

test("prepare jobs mint a branch token only for a trusted pending refresh", () => {
  const requestJob = processor.jobs["prepare-request"];
  const plan = requestJob.steps.find((step) => step.id === "plan");
  const runPlan = (prepareCandidate, mutations = []) => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "dependabot-request-plan-test-"),
    );
    const resultPath = join(temporaryDirectory, "result.json");
    const outputPath = join(temporaryDirectory, "output");
    try {
      writeFileSync(
        resultPath,
        JSON.stringify({
          mode: "prepare",
          mutations,
          phase: "request",
          prepareCandidate,
          schema: "dependabot-processor:v2",
        }),
      );
      const result = spawnSync("bash", ["-c", plan.run], {
        encoding: "utf8",
        env: {
          GITHUB_OUTPUT: outputPath,
          PATH: process.env.PATH,
          REQUEST_RESULT_PATH: resultPath,
        },
      });
      return {
        ...result,
        output: existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "",
      };
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  };

  const nativeGreen = runPlan({
    disposition: "prepare-candidate",
    headSha: "a".repeat(40),
    pullRequestNumber: 731,
  });
  assert.equal(nativeGreen.status, 0, nativeGreen.stderr);
  assert.equal(
    nativeGreen.output,
    "refresh_pending=false\nrefresh_requested=false\n",
  );

  const pending = runPlan({
    disposition: "refresh-pending",
    headSha: "a".repeat(40),
    pullRequestNumber: 731,
  });
  assert.equal(pending.status, 0, pending.stderr);
  assert.equal(
    pending.output,
    "refresh_pending=true\nrefresh_requested=false\n",
  );

  const requested = runPlan(
    {
      disposition: "refresh-required",
      headSha: "a".repeat(40),
      pullRequestNumber: 731,
    },
    [{ kind: "refresh-requested" }],
  );
  assert.equal(requested.status, 0, requested.stderr);
  assert.equal(
    requested.output,
    "refresh_pending=false\nrefresh_requested=true\n",
  );

  const mutateJob = processor.jobs["prepare-mutate"];
  assert.match(
    mutateJob.if,
    /needs\.prepare-request\.outputs\.refresh_pending == 'true'/,
  );
  const finalizeJob = processor.jobs["prepare-finalize"];
  assert.match(finalizeJob.if, /^always\(\)/);
  assert.match(
    finalizeJob.if,
    /needs\.prepare-request\.outputs\.refresh_requested == 'false'/,
  );
  assert.match(finalizeJob.if, /needs\.prepare-request\.result == 'skipped'/);
  assert.match(
    finalizeJob.if,
    /needs\.evaluate\.outputs\.refresh_required == 'false'/,
  );
  assert.match(
    finalizeJob.if,
    /needs\.evaluate\.outputs\.refresh_pending == 'false'/,
  );
  assert.match(finalizeJob.if, /needs\.prepare-mutate\.result == 'skipped'/);
});

test("only the prepare mutator receives the refresh-capable App token", () => {
  const mutateJob = processor.jobs["prepare-mutate"];
  assert.deepEqual(mutateJob.needs, ["evaluate", "prepare-request"]);
  assert.match(mutateJob.if, /needs\.evaluate\.outputs\.prepare == 'true'/);
  assert.match(mutateJob.if, /needs\.prepare-request\.result == 'success'/);
  assert.match(
    mutateJob.if,
    /needs\.prepare-request\.outputs\.refresh_pending == 'true'/,
  );
  assert.deepEqual(mutateJob.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    issues: "read",
    "pull-requests": "read",
    statuses: "read",
  });

  const requireCredentials = mutateJob.steps.find(
    (step) =>
      step.name === "Require exact Prepare App identity and credentials",
  );
  assert.ok(requireCredentials);
  assert.deepEqual(requireCredentials.env, {
    PREPARE_APP_CLIENT_ID:
      "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
    PREPARE_APP_SLUG: "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
    PREPARE_APP_PRIVATE_KEY:
      "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
    PREPARE_BOT_ID: "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
    PREPARE_BOT_LOGIN: "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  });
  assert.match(requireCredentials.run, /PREPARE_BOT_ID.*\^\[1-9\]\[0-9\]\*\$/);
  assert.match(requireCredentials.run, /PREPARE_APP_SLUG.*\[a-z0-9-\]/);
  assert.match(requireCredentials.run, /PREPARE_BOT_LOGIN.*PREPARE_APP_SLUG/);

  const prepareToken = mutateJob.steps.find(
    (step) => step.name === "Create repository-scoped Prepare App token",
  );
  assert.ok(prepareToken);
  assert.equal(prepareToken.id, "prepare-token");
  assert.equal(
    prepareToken.uses,
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
  );
  assert.deepEqual(prepareToken.with, {
    "client-id": "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
    "private-key":
      "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
    owner: "mento-protocol",
    repositories: "frontend-monorepo",
    "permission-contents": "write",
    "permission-pull-requests": "write",
  });
  assert.equal(Object.hasOwn(prepareToken.with, "skip-token-revoke"), false);
  assert.deepEqual(
    mutateJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [prepareToken],
  );

  const identity = mutateJob.steps.find(
    (step) =>
      step.name === "Bind the token to the exact Prepare App bot identity",
  );
  assert.ok(identity);
  assert.equal(
    identity.env.ACTUAL_APP_SLUG,
    "${{ steps.prepare-token.outputs.app-slug }}",
  );
  assert.equal(
    identity.env.ACTUAL_INSTALLATION_ID,
    "${{ steps.prepare-token.outputs.installation-id }}",
  );
  assert.match(identity.run, /gh api "users\/\$EXPECTED_BOT_LOGIN"/);
  assert.match(identity.run, /actual_bot_id.*EXPECTED_BOT_ID/s);
  assert.match(identity.run, /actual_bot_login.*EXPECTED_BOT_LOGIN/s);

  const invocation = mutateJob.steps.find(
    (step) =>
      step.name === "Re-query exact heads and apply refresh-only mutation",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+--live/);
  assert.doesNotMatch(invocation.run, /--publish-checks/);
  assert.match(invocation.run, /--phase mutate/);
  assert.match(invocation.run, /--mode prepare/);
  assert.match(invocation.run, /--expected-head-sha/);
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_REPAIR_TOKEN,
    "${{ steps.prepare-token.outputs.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );

  for (const [jobName, job] of Object.entries(processor.jobs)) {
    if (jobName === "prepare-mutate") continue;
    assert.doesNotMatch(
      JSON.stringify(job),
      /DEPENDABOT_PROCESSOR_PREPARE_APP_(?:CLIENT_ID|PRIVATE_KEY)|DEPENDABOT_PROCESSOR_REPAIR_TOKEN/,
      jobName,
    );
  }

  for (const [jobName, job] of Object.entries(processor.jobs)) {
    const rawJob = JSON.stringify(job);
    if (
      rawJob.includes("create-github-app-token") ||
      rawJob.includes("DEPENDABOT_PROCESSOR_REPAIR_TOKEN")
    ) {
      assert.notEqual(job.permissions?.checks, "write", jobName);
    }
  }

  const raw = JSON.stringify(mutateJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /--admin\b/);
  assert.doesNotMatch(raw, /approvePullRequest|Dependabot ALL CLEAR/);
  assert.doesNotMatch(raw, /PREPARE_APP_ID|REPAIR_APP_ID/);
});

test("prepare finalization has approval authority but no branch-write credential", () => {
  const finalizeJob = processor.jobs["prepare-finalize"];
  assert.deepEqual(finalizeJob.needs, [
    "evaluate",
    "prepare-request",
    "prepare-mutate",
  ]);
  assert.match(finalizeJob.if, /^always\(\)/);
  assert.match(finalizeJob.if, /needs\.evaluate\.outputs\.prepare == 'true'/);
  assert.match(finalizeJob.if, /needs\.prepare-request\.result == 'success'/);
  assert.match(finalizeJob.if, /needs\.prepare-request\.result == 'skipped'/);
  assert.match(
    finalizeJob.if,
    /needs\.prepare-request\.outputs\.refresh_requested == 'false'/,
  );
  assert.doesNotMatch(
    finalizeJob.if,
    /needs\.prepare-request\.outputs\.refresh_requested != 'true'/,
  );
  assert.match(
    finalizeJob.if,
    /needs\.evaluate\.outputs\.refresh_required == 'false'/,
  );
  assert.match(
    finalizeJob.if,
    /needs\.evaluate\.outputs\.refresh_pending == 'false'/,
  );
  assert.match(finalizeJob.if, /needs\.prepare-mutate\.result == 'success'/);
  assert.match(finalizeJob.if, /needs\.prepare-mutate\.result == 'skipped'/);
  assert.deepEqual(finalizeJob.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    issues: "read",
    "pull-requests": "write",
    statuses: "read",
  });
  assert.deepEqual(
    finalizeJob.steps.filter((step) => Object.hasOwn(step, "uses")),
    [],
  );

  const invocation = finalizeJob.steps.find(
    (step) =>
      step.name === "Recollect exact state and publish human-only readiness",
  );
  assert.ok(invocation);
  assert.match(invocation.run, /process\s+\\/);
  assert.match(invocation.run, /--phase finalize/);
  assert.match(invocation.run, /--mode prepare/);
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_GITHUB_TOKEN,
    "${{ github.token }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_SLUG }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_ID }}",
  );
  assert.equal(
    invocation.env.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN,
    "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_BOT_LOGIN }}",
  );

  const raw = JSON.stringify(finalizeJob);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(
    raw,
    /PREPARE_APP_CLIENT_ID|PREPARE_APP_PRIVATE_KEY|REPAIR_TOKEN|REPAIR_APP|create-github-app-token|secrets\./,
  );
});

test("the processor workflow contains no merge or native auto-merge authority", () => {
  const raw = read(processorPath);
  assert.doesNotMatch(
    raw,
    /DEPENDABOT_PROCESSOR_MERGE_|MERGE_APP_PRIVATE_KEY|MERGE_TOKEN/,
  );
  assert.doesNotMatch(
    raw,
    /gh pr merge|pulls\.merge|mergePullRequest|enablePullRequestAutoMerge/,
  );
});

test("repair planning, validation, mutation, and receipt publication stay isolated", () => {
  assert.equal(repair.name, "Dependabot Prepare Repair");
  assert.deepEqual(repair.concurrency, {
    "cancel-in-progress": false,
    group: "dependabot-prepare-repair",
    queue: "max",
  });
  assert.deepEqual(repair.on, {
    repository_dispatch: {
      types: ["dependabot-prepare-repair", "dependabot-prepare-repair-recover"],
    },
  });
  assert.deepEqual(repair.permissions, {});
  assert.doesNotMatch(read(repairPath), /workflow_dispatch/);
  assert.match(
    repair["run-name"],
    /pr=\{0\}.*head=\{1\}.*check=\{2\}.*digest=\{3\}/s,
  );
  assert.match(repair["run-name"], /retry=\{4\}/);

  const preflight = repair.jobs.preflight;
  const plan = repair.jobs.plan;
  const validate = repair.jobs.validate;
  const candidateCliSmoke = repair.jobs.candidate_cli_smoke;
  const stage = repair.jobs.stage;
  const intent = repair.jobs.intent;
  const mutate = repair.jobs.mutate;
  const receipt = repair.jobs.receipt;
  const recovery = repair.jobs.recovery;
  const readPermissions = {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  };
  assert.deepEqual(preflight.permissions, readPermissions);
  assert.deepEqual(plan.permissions, readPermissions);
  assert.deepEqual(validate.permissions, readPermissions);
  assert.deepEqual(candidateCliSmoke.permissions, readPermissions);
  assert.equal(plan["timeout-minutes"], 20);
  assert.equal(validate["timeout-minutes"], 20);
  assert.equal(candidateCliSmoke["timeout-minutes"], 45);
  assert.deepEqual(stage.permissions, readPermissions);
  assert.deepEqual(mutate.permissions, readPermissions);
  assert.deepEqual(intent.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(receipt.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(recovery.permissions, {
    actions: "read",
    checks: "write",
    contents: "read",
    "pull-requests": "read",
  });

  const envelope = preflight.steps[0];
  assert.equal(Object.hasOwn(envelope.env, "GH_TOKEN"), false);
  assert.doesNotMatch(JSON.stringify(envelope), /secrets\.|github\.token/);
  assert.match(envelope.run, /process\.env\.GITHUB_EVENT_PATH/);
  assert.match(envelope.run, /Object\.keys\(payload\)\.length > 10/);
  assert.match(envelope.run, /dependabot-prepare-repair:v1/);
  assert.match(envelope.run, /processorReceipt/);
  assert.match(envelope.run, /retryCount/);

  const checkout = plan.steps.find(
    (step) => step.name === "Check out only the exact trusted workflow source",
  );
  const evidence = plan.steps.find(
    (step) => step.name === "Materialize exact packet-bound repair evidence",
  );
  const planner = plan.steps.find(
    (step) => step.name === "Plan the exact packet-bound repair",
  );
  const evidenceCompletion = plan.steps.find(
    (step) => step.name === "Require a completed exact evidence read",
  );
  assert.equal(plan.name, "Produce a bounded sealed-evidence repair plan");
  assert.deepEqual(checkout.with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });
  assert.equal(evidence.id, "evidence");
  assert.equal(evidence.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    evidence.env.PACKET_BASE64,
    "${{ needs.preflight.outputs.packet_base64 }}",
  );
  assert.equal(
    evidence.env.PACKET_DIGEST,
    "${{ needs.preflight.outputs.packet_digest }}",
  );
  assert.equal(
    evidence.env.PROCESSOR_CHECK_ID,
    "${{ needs.preflight.outputs.processor_check_id }}",
  );
  assert.match(evidence.run, /materialize-repair-evidence/);
  assert.match(evidence.run, /--output-root "\$evidence_root"/);
  assert.match(evidence.run, /--github-output "\$GITHUB_OUTPUT"/);

  assert.equal(planner.uses, claudeBaseAction);
  assert.equal(
    planner.if,
    "needs.preflight.outputs.plan_kind == 'claude-repair'",
  );
  assert.equal(Object.hasOwn(planner.with, "github_token"), false);
  assert.equal(Object.hasOwn(planner.with, "allowed_bots"), false);
  assert.equal(Object.hasOwn(planner.with, "additional_permissions"), false);
  assert.equal(Object.hasOwn(planner.with, "plugins"), false);
  assert.equal(Object.hasOwn(planner.with, "plugin_marketplaces"), false);
  assert.equal(planner.with.show_full_output, false);
  assert.equal(
    planner.with.anthropic_api_key,
    "${{ secrets.ANTHROPIC_API_KEY }}",
  );
  assert.equal(
    planner.with.claude_code_oauth_token,
    "${{ secrets.ANTHROPIC_API_KEY == '' && secrets.CLAUDE_CODE_OAUTH_TOKEN || '' }}",
  );
  assert.doesNotMatch(
    JSON.stringify(planner),
    /github\.token|GH_TOKEN|DEPENDABOT_PROCESSOR_PREPARE_APP|mcpServers/,
  );
  const plannerSettings = JSON.parse(planner.with.settings);
  assert.deepEqual(plannerSettings.env, {
    DEPENDABOT_REPAIR_EVIDENCE_MANIFEST:
      "${{ steps.evidence.outputs.evidence_manifest }}",
    DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST:
      "${{ steps.evidence.outputs.evidence_manifest_digest }}",
    DEPENDABOT_REPAIR_EVIDENCE_ROOT:
      "${{ steps.evidence.outputs.evidence_root }}",
  });
  assert.deepEqual(plannerSettings.hooks.PreToolUse, [
    {
      hooks: [
        {
          command:
            'node "${{ github.workspace }}/scripts/dependabot-repair-evidence-tool-guard.mjs" || exit 2',
          timeout: 5,
          type: "command",
        },
      ],
      matcher: "Read|Grep",
    },
  ]);
  assert.deepEqual(plannerSettings.hooks.PostToolUse, [
    {
      hooks: [
        {
          command:
            'node "${{ github.workspace }}/scripts/dependabot-repair-evidence-tool-guard.mjs" || exit 2',
          timeout: 5,
          type: "command",
        },
      ],
      matcher: "Read|Grep",
    },
  ]);
  assert.match(planner.with.prompt, /BEGIN UNTRUSTED REPAIR PACKET/);
  assert.match(planner.with.prompt, /needs\.preflight\.outputs\.packet_json/);
  assert.doesNotMatch(planner.with.prompt, /packet_base64/);
  assert.match(planner.with.prompt, /evidence_manifest/);
  assert.match(planner.with.prompt, /only Read and Grep/);
  assert.match(
    planner.with.prompt,
    /Preserve each dependency declaration.*Dependabot diff.*Never edit a changed package\.json or pnpm-workspace\.yaml.*unchanged packet-bound companion declarations.*generated lockfiles/s,
  );
  assert.match(
    planner.with.prompt,
    /Use Grep.*when useful.*\.json.*above 12,500 bytes.*\.patch.*\.txt.*above 16,384 bytes.*explicit byte-efficient pages.*one-based offsets and limits.*at most 2,000 lines.*25,000 raw bytes.*\.patch.*\.txt.*12,500 raw bytes.*\.json.*enforced media-aware maxima/s,
  );
  const printedPagePolicy = spawnSync(
    process.execPath,
    [repairEvidenceToolGuardPath, "--print-policy"],
    { encoding: "utf8" },
  );
  assert.equal(printedPagePolicy.status, 0, printedPagePolicy.stderr);
  const pagePolicy = JSON.parse(printedPagePolicy.stdout);
  assert.deepEqual(pagePolicy, {
    claudeCodeActionRef: "be7b93b1907a4abad570368f3c74b6fe3807510b",
    claudeCodeVersion: "2.1.220",
    evidenceMaxLineBytes: 4 * 1024,
    jsonMaxBytes: 12_500,
    jsonMaxLines: 2_000,
    jsonMaxUnpagedBytes: 12_500,
    schema: "dependabot-repair-evidence-page-policy:v1",
    textMaxBytes: 25_000,
    textMaxLines: 2_000,
    textMaxUnpagedBytes: 16 * 1024,
  });
  assert.equal(
    planner.with.prompt.includes(
      `Read \`.json\` evidence above ${pagePolicy.jsonMaxUnpagedBytes.toLocaleString("en-US")} bytes and \`.patch\`/\`.txt\` evidence above ${pagePolicy.textMaxUnpagedBytes.toLocaleString("en-US")} bytes only in explicit byte-efficient pages with one-based offsets and limits. Each page may request at most ${pagePolicy.textMaxLines.toLocaleString("en-US")} lines and must stay within ${pagePolicy.textMaxBytes.toLocaleString("en-US")} raw bytes for \`.patch\`/\`.txt\` or ${pagePolicy.jsonMaxBytes.toLocaleString("en-US")} raw bytes for \`.json\` (the enforced media-aware maxima)`,
    ),
    true,
    "the workflow prompt must match the guard's computed page policy",
  );
  assert.equal(
    planner.uses,
    `anthropics/claude-code-action/base-action@${pagePolicy.claudeCodeActionRef}`,
    "the page estimator must stay bound to the action pin that installs its Claude Code version",
  );
  const materializerLineCap =
    /const MAX_EVIDENCE_LINE_BYTES = ([0-9]+) \* ([0-9]+);/.exec(
      read("scripts/dependabot-preparation-receipts.mjs"),
    );
  assert.ok(materializerLineCap);
  assert.equal(
    Number(materializerLineCap[1]) * Number(materializerLineCap[2]),
    pagePolicy.evidenceMaxLineBytes,
    "the materializer and guard must share the exact evidence-line cap",
  );
  assert.match(
    planner.with.prompt,
    /Every hunk header count must exactly match its body.*unchanged context line before.*and after.*unless.*first or final line.*Prefix each unchanged hunk-body line.*required single.*diff marker space.*original indentation.*Never emit a context-free or one-sided-context.*away from a file.*boundary/s,
  );
  assert.match(planner.with.claude_args, /--tools "Read,Grep"/);
  assert.doesNotMatch(planner.with.claude_args, /--allowedTools/);
  assert.match(
    planner.with.claude_args,
    /--disallowedTools "Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Agent,Skill,Glob,mcp__\*"/,
  );
  assert.match(planner.with.claude_args, /--permission-mode dontAsk/);
  assert.match(planner.with.claude_args, /--setting-sources user/);
  assert.match(planner.with.claude_args, /--strict-mcp-config/);
  assert.match(planner.with.claude_args, /--disable-slash-commands/);
  assert.match(planner.with.claude_args, /--no-session-persistence/);
  assert.match(
    planner.with.claude_args,
    /--add-dir "\$\{\{ steps\.evidence\.outputs\.evidence_root \}\}"/,
  );
  assert.match(planner.with.claude_args, /"maxLength":8192/);
  assert.match(
    planner.with.claude_args,
    /"description":"Valid contextual unified diff with exact hunk counts, required diff marker prefixes, and unchanged context before and after each changed run unless it touches a file boundary\."/,
  );
  assert.deepEqual(evidenceCompletion.env, {
    DEPENDABOT_REPAIR_EVIDENCE_MANIFEST:
      "${{ steps.evidence.outputs.evidence_manifest }}",
    DEPENDABOT_REPAIR_EVIDENCE_MANIFEST_DIGEST:
      "${{ steps.evidence.outputs.evidence_manifest_digest }}",
    DEPENDABOT_REPAIR_EVIDENCE_ROOT:
      "${{ steps.evidence.outputs.evidence_root }}",
  });
  assert.match(
    evidenceCompletion.run,
    /dependabot-repair-evidence-tool-guard\.mjs --verify-completion/,
  );
  assert.equal(
    evidenceCompletion.if,
    "needs.preflight.outputs.plan_kind == 'claude-repair'",
  );

  assert.equal(
    preflight.outputs.plan_kind,
    "${{ steps.packet.outputs.plan_kind }}",
  );
  assert.equal(
    plan.outputs.structured_output,
    "${{ steps.plan-output.outputs.structured_output }}",
  );
  const modelFreePnpm = plan.steps.find(
    (step) => step.name === "Install the exact model-free planner pnpm",
  );
  const modelFreePnpmProof = plan.steps.find(
    (step) =>
      step.name === "Prove the exact model-free planner pnpm and registry",
  );
  const firstModelFreePlan = plan.steps.find(
    (step) => step.name === "Generate the protected-runtime sync plan once",
  );
  const secondModelFreePlan = plan.steps.find(
    (step) => step.name === "Generate the protected-runtime sync plan again",
  );
  const planOutput = plan.steps.find(
    (step) => step.name === "Select exactly one typed repair plan",
  );
  assert.equal(
    modelFreePnpm.if,
    "needs.preflight.outputs.plan_kind == 'protected-runtime-sync'",
  );
  assert.equal(
    modelFreePnpm.uses,
    "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86",
  );
  assert.deepEqual(modelFreePnpm.with, {
    standalone: true,
    version: "10.34.4",
  });
  assert.deepEqual(modelFreePnpm.env, {
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
  });
  assert.match(modelFreePnpmProof.run, /pnpm --version.*10\.34\.4/s);
  assert.match(
    modelFreePnpmProof.run,
    /pnpm config get registry.*https:\/\/registry\.npmjs\.org\//s,
  );
  assert.equal(secondModelFreePlan, undefined);
  for (const generator of [firstModelFreePlan]) {
    assert.equal(
      generator.if,
      "needs.preflight.outputs.plan_kind == 'protected-runtime-sync'",
    );
    assert.deepEqual(Object.keys(generator.env).sort(), [
      "EVIDENCE_MANIFEST",
      "NPM_CONFIG_REGISTRY",
      "PACKET_BASE64",
      "PROCESSOR_CHECK_ID",
    ]);
    assert.equal(
      generator.env.NPM_CONFIG_REGISTRY,
      "https://registry.npmjs.org/",
    );
    assert.match(
      generator.run,
      /dependabot-protected-runtime-sync\.mjs generate-plan[\s\S]*--packet-base64[\s\S]*--evidence-manifest[\s\S]*--processor-check-id[\s\S]*--github-output/,
    );
    assert.doesNotMatch(
      JSON.stringify(generator),
      /CLAUDE|secrets\.|github\.token|GH_TOKEN|PREPARE_APP|VERCEL_TOKEN|write/,
    );
  }
  assert.match(planOutput.run, /first\.length === 0/);
  assert.doesNotMatch(
    JSON.stringify(planOutput),
    /SECOND_PROTECTED_RUNTIME_PLAN/,
  );
  assert.match(planOutput.run, /claude\.length !== 0/);
  assert.match(planOutput.run, /Unknown repair plan kind/);
  assert.doesNotMatch(
    JSON.stringify(planOutput),
    /secrets\.|github\.token|GH_TOKEN|PREPARE_APP|VERCEL_TOKEN/,
  );

  assert.doesNotMatch(
    JSON.stringify(validate),
    /secrets\.|contents:write|checks:write/,
  );
  assert.match(
    validate.steps.at(-1).run,
    /validate-repair-plan[\s\S]*--packet-base64[\s\S]*--plan-json/,
  );
  const validateCheckout = validate.steps.find(
    (step) => step.name === "Check out only the exact trusted workflow source",
  );
  assert.deepEqual(validateCheckout.with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });
  const verificationEvidence = validate.steps.find(
    (step) =>
      step.name === "Materialize exact packet-bound verification evidence",
  );
  const modelFreeVerify = validate.steps.find(
    (step) =>
      step.name === "Independently verify the protected-runtime sync plan",
  );
  assert.equal(
    verificationEvidence.if,
    "needs.preflight.outputs.plan_kind == 'protected-runtime-sync'",
  );
  assert.equal(verificationEvidence.env.GH_TOKEN, "${{ github.token }}");
  assert.match(
    verificationEvidence.run,
    /materialize-repair-evidence[\s\S]*--packet-digest[\s\S]*--processor-check-id/,
  );
  assert.equal(
    modelFreeVerify.if,
    "needs.preflight.outputs.plan_kind == 'protected-runtime-sync'",
  );
  assert.match(
    modelFreeVerify.run,
    /dependabot-protected-runtime-sync\.mjs verify-plan[\s\S]*--packet-base64[\s\S]*--evidence-manifest[\s\S]*--processor-check-id[\s\S]*--plan-json/,
  );
  assert.doesNotMatch(
    JSON.stringify(modelFreeVerify),
    /CLAUDE|secrets\.|github\.token|GH_TOKEN|PREPARE_APP|VERCEL_TOKEN|write/,
  );
  assert.doesNotMatch(
    modelFreeVerify.run,
    /candidate-cli-smoke|--frozen-lockfile|node_modules\/vercel/,
  );

  assert.deepEqual(candidateCliSmoke.needs, ["preflight", "plan", "validate"]);
  assert.match(candidateCliSmoke.if, /plan_kind == 'protected-runtime-sync'/);
  assert.match(candidateCliSmoke.if, /needs\.validate\.result == 'success'/);
  assert.equal(Object.hasOwn(candidateCliSmoke, "outputs"), false);
  assert.equal(
    candidateCliSmoke.steps.every((step) => !Object.hasOwn(step, "uses")),
    true,
    "the candidate smoke must not register a runner action or post action",
  );
  const trustedSmokeSource = candidateCliSmoke.steps[0];
  assert.equal(
    trustedSmokeSource.name,
    "Materialize the exact trusted terminal source without actions",
  );
  assert.equal(trustedSmokeSource.id, "trusted-source");
  assert.equal(trustedSmokeSource.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    trustedSmokeSource.env.WORKFLOW_SHA,
    "${{ github.workflow_sha }}",
  );
  assert.match(trustedSmokeSource.run, /commits\/\$WORKFLOW_SHA/);
  for (const path of [
    "scripts/dependabot-preparation-receipts.mjs",
    "scripts/dependabot-protected-runtime-sync.mjs",
    "scripts/vercel-cli-runtime-contract.mjs",
    "scripts/vercel-cli-runtime/contract.json",
    "scripts/vercel-pnpm-bootstrap/package.json",
    "scripts/vercel-pnpm-bootstrap/package-lock.json",
  ]) {
    assert.match(
      trustedSmokeSource.run,
      new RegExp(path.replaceAll("/", "\\/"), "u"),
    );
  }
  const smokePnpm = candidateCliSmoke.steps[1];
  assert.equal(
    smokePnpm.name,
    "Install and authenticate the exact terminal-smoke pnpm",
  );
  assert.match(
    smokePnpm.run,
    /npm ci .*--ignore-scripts --no-audit --no-fund/u,
  );
  assert.match(
    smokePnpm.run,
    /e02c01738ce850754cf00111fd97bec24de550e1e963690486f02d9dae1a2193/u,
  );
  assert.match(smokePnpm.run, /pnpm_binary.*--version.*10\.34\.4/su);
  assert.match(smokePnpm.run, /source_node_binary=.*realpath/su);
  assert.ok(
    smokePnpm.run.includes(
      'install -m 0555 "$source_node_binary" "$node_binary"',
    ),
  );
  assert.ok(
    smokePnpm.run.includes('cmp -s "$source_node_binary" "$node_binary"'),
  );
  assert.ok(smokePnpm.run.includes('test ! -L "$source_node_binary"'));
  assert.ok(smokePnpm.run.includes('test ! -L "$node_binary"'));
  assert.ok(smokePnpm.run.includes('chmod 0555 "$node_binary" "$pnpm_binary"'));
  assert.match(
    smokePnpm.run,
    /node_binary.*--version.*source_node_binary.*--version/su,
  );
  assert.ok(smokePnpm.run.includes("node_binary=$node_binary"));
  assert.match(smokePnpm.run, /useradd --system --user-group/u);
  assert.match(smokePnpm.run, /dependabot-candidate/u);
  assert.match(
    smokePnpm.run,
    /sudo -n -u "\$candidate_user" \/usr\/bin\/sudo -n true/u,
  );
  const smokeEvidence = candidateCliSmoke.steps.find(
    (step) =>
      step.name === "Materialize exact packet-bound terminal-smoke evidence",
  );
  assert.equal(smokeEvidence.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    smokeEvidence.env.TRUSTED_ROOT,
    "${{ steps.trusted-source.outputs.root }}",
  );
  assert.match(smokeEvidence.run, /materialize-repair-evidence/);
  assert.match(
    smokeEvidence.run,
    /find "\$evidence_root" -type f -exec chmod 0444/u,
  );
  assert.match(
    smokeEvidence.run,
    /find "\$evidence_root" -type d -exec chmod 0555/u,
  );
  const terminalSmoke = candidateCliSmoke.steps.at(-1);
  assert.equal(
    terminalSmoke.name,
    "Execute the generated candidate CLI as a terminal smoke",
  );
  assert.deepEqual(Object.keys(terminalSmoke.env).sort(), [
    "CANDIDATE_ROOT",
    "CANDIDATE_USER",
    "EVIDENCE_MANIFEST",
    "NODE_BINARY",
    "NPM_CONFIG_REGISTRY",
    "PACKET_BASE64",
    "PNPM_BINARY",
    "PNPM_DIR",
    "PROCESSOR_CHECK_ID",
    "TRUSTED_ROOT",
    "VALIDATED_PLAN_BASE64",
    "VALIDATED_PLAN_DIGEST",
  ]);
  assert.equal(
    terminalSmoke.env.NODE_BINARY,
    "${{ steps.terminal-runtime.outputs.node_binary }}",
  );
  assert.equal(
    terminalSmoke.env.VALIDATED_PLAN_BASE64,
    "${{ needs.validate.outputs.validated_plan_base64 }}",
  );
  assert.equal(
    terminalSmoke.env.VALIDATED_PLAN_DIGEST,
    "${{ needs.validate.outputs.validated_plan_digest }}",
  );
  assert.match(
    terminalSmoke.run,
    /dependabot-protected-runtime-sync\.mjs" candidate-cli-smoke[\s\S]*--packet-base64[\s\S]*--evidence-manifest[\s\S]*--processor-check-id[\s\S]*--validated-plan-base64[\s\S]*--validated-plan-digest/,
  );
  assert.ok(
    terminalSmoke.run.includes(
      '"$NODE_BINARY" "$TRUSTED_ROOT/scripts/dependabot-protected-runtime-sync.mjs"',
    ),
  );
  assert.match(terminalSmoke.run, /assert_not_writable/u);
  assert.match(terminalSmoke.run, /actions_parent/u);
  assert.ok(
    terminalSmoke.run.includes(
      'candidate_path="$PNPM_DIR:$(dirname "$NODE_BINARY"):/usr/bin:/bin"',
    ),
  );
  assert.match(
    terminalSmoke.run,
    /for executable_dir in "\$\{candidate_path_dirs\[@\]\}"; do[\s\S]*assert_not_writable "\$executable_dir"/u,
  );
  assert.ok(terminalSmoke.run.includes('assert_not_writable "$NODE_BINARY"'));
  assert.ok(terminalSmoke.run.includes('assert_not_writable "$PNPM_BINARY"'));
  assert.match(terminalSmoke.run, /find "\$TRUSTED_ROOT"/u);
  assert.match(terminalSmoke.run, /GITHUB_ENV/u);
  assert.match(terminalSmoke.run, /GITHUB_STEP_SUMMARY/u);
  assert.match(terminalSmoke.run, /dirname "\$command_file"/u);
  assert.match(
    terminalSmoke.run,
    /sudo -n -u "\$CANDIDATE_USER" \/usr\/bin\/env -i/u,
  );
  assert.doesNotMatch(
    JSON.stringify(terminalSmoke),
    /GH_TOKEN|github\.token|secrets\.|PREPARE_APP|VERCEL_TOKEN|DEPLOYMENT|PACKAGE/,
  );
  assert.doesNotMatch(terminalSmoke.run, /\/usr\/local\/bin/u);
  assert.doesNotMatch(terminalSmoke.run, /command -v node/u);
  assert.doesNotMatch(
    read("scripts/dependabot-protected-runtime-sync.mjs"),
    /"\/usr\/local\/bin"/u,
  );
  assert.doesNotMatch(terminalSmoke.run, />>.*GITHUB_OUTPUT/u);
  assert.deepEqual(stage.needs, [
    "preflight",
    "validate",
    "candidate_cli_smoke",
  ]);
  assert.match(stage.if, /^!cancelled\(\)/);
  assert.match(stage.if, /candidate_cli_smoke\.result == 'success'/);
  assert.match(stage.if, /candidate_cli_smoke\.result == 'skipped'/);
  for (const [jobName, job] of [
    ["intent", intent],
    ["mutate", mutate],
    ["receipt", receipt],
  ]) {
    assert.match(
      job.if,
      /^!cancelled\(\)/,
      `${jobName} must evaluate its exact result checks after the generic repair path skips candidate_cli_smoke and stop after cancellation`,
    );
  }

  for (const appJob of [stage, mutate]) {
    const repairToken = appJob.steps.find(
      (step) => step.name === "Create repository-scoped Repair App token",
    );
    assert.ok(repairToken);
    assert.deepEqual(repairToken.with, {
      "client-id": "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
      "private-key":
        "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
      owner: "mento-protocol",
      repositories: "frontend-monorepo",
      "permission-contents": "write",
    });
    assert.equal(
      Object.hasOwn(repairToken.with, "permission-pull-requests"),
      false,
    );
    assert.equal(Object.hasOwn(repairToken.with, "skip-token-revoke"), false);
    const publisher = appJob.steps.at(-1);
    assert.equal(publisher.env.GH_TOKEN, "${{ github.token }}");
    assert.notEqual(
      publisher.env.GH_TOKEN,
      "${{ steps.repair-token.outputs.token }}",
    );
    assert.equal(publisher.env.GH_READ_TOKEN, "${{ github.token }}");
    assert.equal(
      publisher.env.GH_WRITE_TOKEN,
      "${{ steps.repair-token.outputs.token }}",
    );
  }
  assert.match(stage.steps.at(-1).run, /stage-repair/);
  assert.match(stage.steps.at(-1).run, /--retry-count/);
  assert.match(mutate.steps.at(-1).run, /apply-repair-intent/);
  assert.match(mutate.steps.at(-1).run, /--intent-check-id/);
  assert.doesNotMatch(
    JSON.stringify(mutate),
    /checks:write|pull-requests:write/,
  );

  assert.ok(intent.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.match(intent.steps.at(-1).run, /publish-repair-intent/);
  assert.doesNotMatch(
    JSON.stringify(intent),
    /PREPARE_APP_PRIVATE_KEY|repair-token|GH_WRITE_TOKEN|secrets\.|dispatches/,
  );

  assert.ok(receipt.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.match(receipt.steps.at(-1).run, /publish-repair-receipt/);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /PREPARE_APP_PRIVATE_KEY|repair-token|GH_WRITE_TOKEN|secrets\.|dispatches/,
  );
  const recoveryEnvelope = recovery.steps[0];
  assert.equal(Object.hasOwn(recoveryEnvelope.env, "GH_TOKEN"), false);
  assert.doesNotMatch(
    JSON.stringify(recoveryEnvelope),
    /secrets\.|github\.token/,
  );
  assert.match(recoveryEnvelope.run, /dependabot-repair-recovery:v1/);
  assert.match(recoveryEnvelope.run, /Object\.keys\(payload\)\.length > 10/);
  assert.match(recoveryEnvelope.run, /retryCount/);
  assert.ok(recovery.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.match(recovery.steps.at(-1).run, /recover-repair/);
  assert.doesNotMatch(
    JSON.stringify(recovery),
    /PREPARE_APP_CLIENT_ID|PREPARE_APP_PRIVATE_KEY|repair-token|GH_WRITE_TOKEN|secrets\.|contents:write|dispatches/,
  );
  for (const [jobName, job] of Object.entries(repair.jobs)) {
    if (jobName !== "plan") {
      assert.doesNotMatch(JSON.stringify(job), /CLAUDE_CODE_OAUTH_TOKEN/);
    }
    if (!new Set(["mutate", "stage"]).has(jobName)) {
      assert.doesNotMatch(
        JSON.stringify(job),
        /DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY|GH_WRITE_TOKEN/,
      );
    }
  }

  for (const step of candidateCliSmoke.steps.filter(
    (step) => step !== smokePnpm,
  )) {
    assert.doesNotMatch(JSON.stringify(step), forbiddenCandidateSurfaces);
  }
  const raw = read(repairPath);
  assert.doesNotMatch(
    raw,
    /gh pr merge|pulls\.merge|mergePullRequest|enablePullRequestAutoMerge|APPROVE|\/reviews|\/comments/,
  );
  const helper = read("scripts/dependabot-preparation-receipts.mjs");
  const applyHelper = helper.slice(
    helper.indexOf("export async function applyRepairPlan"),
    helper.indexOf("async function commandValidateRepairPlan"),
  );
  assert.match(
    applyHelper,
    /\["apply", "--check", "--whitespace=error-all", patchPath\]/,
  );
  assert.doesNotMatch(applyHelper, /--recount/);
  assert.doesNotMatch(applyHelper, /--unidiff-zero/);
  const stageHelper = helper.slice(
    helper.indexOf("async function commandStageRepair"),
    helper.indexOf("function loadIntentArgument"),
  );
  const moveHelper = helper.slice(
    helper.indexOf("async function commandApplyRepairIntent"),
    helper.indexOf("async function commandPublishRepairReceipt"),
  );
  const recoveryHelper = helper.slice(
    helper.indexOf("async function commandRecoverRepair"),
    helper.indexOf("async function commandTerminalDispatchPlan"),
  );
  assert.doesNotMatch(stageHelper, /"PATCH"|git\/refs\/heads/);
  assert.match(moveHelper, /"PATCH"/);
  assert.doesNotMatch(
    recoveryHelper,
    /GH_WRITE_TOKEN|"PATCH"|git\/refs\/heads\/.*"PATCH"/,
  );
});

test("terminal dispatch accepts successful Processor and exact terminal Repair outcomes", () => {
  assert.equal(preparedDispatch.name, "Dependabot Prepared Head Dispatch");
  assert.deepEqual(preparedDispatch.on, {
    workflow_run: {
      workflows: ["Dependabot Processor", "Dependabot Prepare Repair"],
      types: ["completed"],
    },
  });
  assert.deepEqual(preparedDispatch.permissions, {});
  const plan = preparedDispatch.jobs.plan;
  const dispatch = preparedDispatch.jobs.dispatch;
  assert.doesNotMatch(read(preparedDispatchPath), /workflow_run\.name/);
  assert.match(preparedDispatch["run-name"], /workflow_run\.path/);
  assert.match(plan.if, /workflow_run\.status == 'completed'/);
  assert.match(plan.if, /dependabot-process\.yml/);
  assert.match(plan.if, /dependabot-prepare-repair\.yml/);
  assert.doesNotMatch(plan.if, /workflow_run\.name/);
  assert.match(plan.if, /workflow_run\.conclusion == 'success'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'failure'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'cancelled'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'timed_out'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'startup_failure'/);
  assert.match(plan.if, /workflow_run\.conclusion == 'action_required'/);
  assert.doesNotMatch(
    plan.if,
    /workflow_run\.conclusion == '(?:neutral|skipped|stale)'/,
  );
  assert.deepEqual(plan.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  });
  assert.doesNotMatch(
    JSON.stringify(plan),
    /secrets\.|create-github-app-token/,
  );
  assert.match(plan.steps[0].run, /SOURCE_STATUS.*completed/s);
  assert.match(plan.steps[0].run, /SOURCE_CONCLUSION.*success/s);
  assert.match(plan.steps[0].run, /dependabot-process\.yml@main/);
  assert.match(plan.steps[0].run, /dependabot-prepare-repair\.yml@main/);
  assert.match(
    plan.steps[0].run,
    /success\|action_required\|failure\|cancelled\|startup_failure\|timed_out/,
  );
  assert.match(plan.steps[0].run, /dependabot-repair-recover:v1/);
  assert.match(plan.steps[0].run, /retry=\[0-2\]/);
  assert.equal(
    plan.steps[0].env.SOURCE_PATH,
    "${{ github.event.workflow_run.path }}",
  );
  assert.equal(Object.hasOwn(plan.steps[0].env, "SOURCE_WORKFLOW"), false);
  assert.equal(
    plan.steps.at(-1).env.SOURCE_PATH,
    "${{ github.event.workflow_run.path }}",
  );
  assert.match(plan.steps.at(-1).run, /source_workflow="Dependabot Processor"/);
  assert.match(
    plan.steps.at(-1).run,
    /source_workflow="Dependabot Prepare Repair"/,
  );
  assert.match(plan.steps.at(-1).run, /terminal-dispatch-plan/);
  assert.match(plan.steps.at(-1).run, /--source-workflow "\$source_workflow"/);

  const token = dispatch.steps[0];
  assert.equal(
    token.uses,
    "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1",
  );
  assert.deepEqual(token.with, {
    "client-id": "${{ vars.DEPENDABOT_PROCESSOR_PREPARE_APP_CLIENT_ID }}",
    "private-key":
      "${{ secrets.DEPENDABOT_PROCESSOR_PREPARE_APP_PRIVATE_KEY }}",
    owner: "mento-protocol",
    repositories: "frontend-monorepo",
    "permission-contents": "write",
  });
  assert.equal(Object.hasOwn(token.with, "skip-token-revoke"), false);
  assert.match(dispatch.steps.at(-1).run, /dispatch-terminal-event/);
  assert.doesNotMatch(
    read(preparedDispatchPath),
    /workflow_dispatch|checks: write|pull-requests: write|gh pr merge|APPROVE|ALL CLEAR|enablePullRequestAutoMerge|\/reviews|\/comments/,
  );
});

test("Dependabot Claude review follows only authenticated intake runs", () => {
  assert.equal(dependabotReview.name, "Dependabot Claude Review");
  assert.deepEqual(dependabotReview.on, {
    workflow_run: {
      workflows: ["Dependabot Intake", "Dependabot Prepared Head Intake"],
      types: ["completed"],
    },
  });
  assert.deepEqual(dependabotReview.permissions, {});
  assert.equal(
    dependabotReview["run-name"],
    "${{ format('dependabot-claude-review:v1 | source={0}', github.event.workflow_run.display_title) }}",
  );

  const preflightJob = dependabotReview.jobs.preflight;
  const reviewJob = dependabotReview.jobs.review;
  const publishJob = dependabotReview.jobs.publish;
  assert.equal(preflightJob.name, "dependabot-claude-review-preflight");
  assert.match(preflightJob.if, /mento-protocol\/frontend-monorepo/);
  assert.match(preflightJob.if, /receipt=true/);
  assert.match(preflightJob.if, /dependabot-intake\.yml/);
  assert.match(preflightJob.if, /dependabot-prepared-head-intake\.yml/);
  assert.doesNotMatch(preflightJob.if, /workflow_run\.name/);
  assert.deepEqual(preflightJob.permissions, {
    actions: "read",
    checks: "read",
    contents: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(preflightJob.outputs, {
    head_ref: "${{ steps.pr.outputs.head_ref }}",
    head_sha: "${{ steps.intake.outputs.head_sha }}",
    identity_digest: "${{ steps.pr.outputs.identity_digest }}",
    operation: "${{ steps.intake.outputs.operation }}",
    operation_check_id: "${{ steps.intake.outputs.operation_check_id }}",
    operation_digest: "${{ steps.intake.outputs.operation_digest }}",
    pr_number: "${{ steps.intake.outputs.pr_number }}",
    review_actor_login: "${{ steps.intake.outputs.review_actor_login }}",
    source_kind: "${{ steps.intake.outputs.source_kind }}",
  });

  const [intake, pr, preparedValidator, preparedLineage] = preflightJob.steps;
  assert.equal(intake.id, "intake");
  assert.equal(Object.hasOwn(intake, "uses"), false);
  assert.equal(Object.hasOwn(intake.env, "GH_TOKEN"), false);
  assert.equal(Object.hasOwn(intake.env, "INTAKE_WORKFLOW"), false);
  assert.equal(intake.env.INTAKE_PATH, "${{ github.event.workflow_run.path }}");
  assert.doesNotMatch(JSON.stringify(intake), /secrets\.|github\.token/);
  assert.match(intake.run, /INTAKE_CONCLUSION.*success/);
  assert.match(intake.run, /INTAKE_EVENT.*pull_request_target/);
  assert.match(intake.run, /INTAKE_ACTOR_LOGIN.*dependabot\[bot\]/);
  assert.match(intake.run, /INTAKE_ACTOR_TYPE.*Bot/);
  assert.match(intake.run, /INTAKE_TRIGGERING_ACTOR_LOGIN/);
  assert.match(intake.run, /INTAKE_HEAD_REPOSITORY.*REPOSITORY/);
  assert.match(intake.run, /INTAKE_HEAD_BRANCH.*dependabot\/\*/);
  assert.match(intake.run, /INTAKE_HEAD_SHA.*receipt_head_sha/s);
  assert.match(intake.run, /linked\.length > 1/);
  assert.match(intake.run, /pullRequest\?\.number/);
  assert.match(intake.run, /pullRequest\?\.head\?\.sha/);
  assert.match(intake.run, /dependabot-intake:v1/);
  assert.match(intake.run, /dependabot-intake\.yml@main/);
  assert.match(intake.run, /dependabot-prepared-head-intake\.yml/);
  assert.match(intake.run, /dependabot-prepared-head:v1/);
  assert.match(intake.run, /EXPECTED_PREPARE_BOT_ID/);

  assert.equal(pr.id, "pr");
  assert.equal(Object.hasOwn(pr, "uses"), false);
  assert.equal(pr.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    pr.env.EXPECTED_HEAD_SHA,
    "${{ steps.intake.outputs.head_sha }}",
  );
  assert.match(pr.run, /repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER/);
  assert.match(pr.run, /state !== "open"/);
  assert.match(pr.run, /draft !== false/);
  assert.match(pr.run, /dependabot\[bot\]/);
  assert.equal(
    pr.env.EXPECTED_HEAD_REF,
    "${{ steps.intake.outputs.head_ref }}",
  );
  assert.match(pr.run, /head\?\.ref !== expectedHeadRef/);
  assert.match(pr.run, /base\?\.ref !== "main"/);
  assert.match(pr.run, /head\?\.sha !== expectedHeadSha/);
  assert.match(pr.run, /identity_digest/);
  assert.match(pr.run, /commits\/\$EXPECTED_HEAD_SHA/);
  assert.match(pr.run, /web-flow/);
  assert.match(pr.run, /verification\?\.verified !== true/);
  assert.match(pr.run, /verification\?\.reason !== "valid"/);
  assert.equal(
    preparedValidator.if,
    "steps.intake.outputs.source_kind == 'prepared'",
  );
  assert.match(
    preparedValidator.run,
    /contents\/scripts\/dependabot-prepared-review\.mjs\?ref=\$WORKFLOW_SHA/,
  );
  assert.match(
    preparedValidator.run,
    /trusted_receipts="\$trusted_root\/dependabot-preparation-receipts\.mjs"/,
  );
  assert.match(
    preparedValidator.run,
    /contents\/scripts\/dependabot-preparation-receipts\.mjs\?ref=\$WORKFLOW_SHA/,
  );
  assert.match(
    preparedValidator.run,
    /test -s "\$trusted_receipts"[\s\S]*chmod 0500 "\$trusted_validator" "\$trusted_receipts"/,
  );
  assert.equal(
    preparedLineage.if,
    "steps.intake.outputs.source_kind == 'prepared'",
  );
  assert.match(
    preparedLineage.run,
    /--check-id "\$EXPECTED_OPERATION_CHECK_ID"/,
  );
  assert.match(preparedLineage.run, /--digest "\$EXPECTED_OPERATION_DIGEST"/);

  assert.equal(reviewJob.name, "dependabot-claude-review-agent");
  assert.equal(reviewJob.needs, "preflight");
  assert.equal(reviewJob.if, "needs.preflight.result == 'success'");
  assert.deepEqual(reviewJob.permissions, {
    contents: "read",
    issues: "read",
    "pull-requests": "read",
  });
  assert.equal(Object.hasOwn(reviewJob.permissions, "checks"), false);
  assert.equal(Object.hasOwn(reviewJob.permissions, "id-token"), false);
  assert.equal(
    reviewJob.outputs.structured_output,
    "${{ steps.claude-review.outputs.structured_output }}",
  );

  const [immediate, checkout, review, diagnostics, verifyDiffRead] =
    reviewJob.steps;
  assert.equal(Object.hasOwn(immediate, "uses"), false);
  assert.equal(immediate.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(
    immediate.env.EXPECTED_HEAD_REF,
    "${{ needs.preflight.outputs.head_ref }}",
  );
  assert.match(immediate.run, /EXPECTED_IDENTITY_DIGEST/);
  assert.match(immediate.run, /head\?\.ref !== expectedHeadRef/);
  assert.match(immediate.run, /head\?\.sha !== expectedHeadSha/);

  assert.equal(
    checkout.uses,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assert.deepEqual(checkout.with, {
    "fetch-depth": 1,
    "persist-credentials": false,
    ref: "${{ github.workflow_sha }}",
  });

  assert.equal(review.id, "claude-review");
  assert.equal(review.uses, claudeAction);
  assert.equal(
    review.with.allowed_bots,
    "${{ needs.preflight.outputs.review_actor_login }}",
  );
  assert.equal(review.with.github_token, "${{ github.token }}");
  assert.equal(Object.hasOwn(review.with, "plugin_marketplaces"), false);
  assert.equal(Object.hasOwn(review.with, "plugins"), false);
  assert.match(
    review.with.prompt,
    /pull\/\$\{\{ needs\.preflight\.outputs\.pr_number \}\}/,
  );
  assert.match(
    review.with.prompt,
    /head.*needs\.preflight\.outputs\.head_sha/s,
  );
  assert.match(
    review.with.prompt,
    /gh pr diff.*needs\.preflight\.outputs\.pr_number.*--repo.*github\.repository/s,
  );
  assert.match(review.with.prompt, /one plain-text document tool result/);
  assert.match(review.with.prompt, /Do not make any.*mutation/s);
  assert.match(
    review.with.prompt,
    /transitive dependency change.*concrete evidence.*incompatible constraint.*specific repository defect/s,
  );
  assert.match(
    review.with.prompt,
    /declared internal dependency.*separate finding.*only because its version changed or it might regress/s,
  );
  assert.equal(
    review.with.anthropic_api_key,
    "${{ secrets.ANTHROPIC_API_KEY }}",
  );
  assert.equal(
    review.with.claude_code_oauth_token,
    "${{ secrets.ANTHROPIC_API_KEY == '' && secrets.CLAUDE_CODE_OAUTH_TOKEN || '' }}",
  );
  const settings = JSON.parse(review.with.settings);
  assert.deepEqual(settings.env, {
    BASH_MAX_OUTPUT_LENGTH: "150000",
    DEPENDABOT_REVIEW_PR_NUMBER: "${{ needs.preflight.outputs.pr_number }}",
    DEPENDABOT_REVIEW_REPOSITORY: "mento-protocol/frontend-monorepo",
  });
  assert.deepEqual(settings.hooks, {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command:
              'node "${{ github.workspace }}/scripts/dependabot-claude-review-tool-guard.mjs" || exit 2',
            timeout: 5,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command:
              'node "${{ github.workspace }}/scripts/dependabot-claude-review-tool-guard.mjs" || exit 2',
            timeout: 5,
          },
        ],
      },
    ],
  });
  const toolFlags = [
    ...review.with.claude_args.matchAll(/--tools\s+"([^"]+)"/g),
  ];
  assert.deepEqual(
    toolFlags.map((match) => match[1]),
    ["Bash"],
  );
  const disallowedToolFlags = [
    ...review.with.claude_args.matchAll(
      /--(?:disallowedTools|disallowed-tools)\s+"([^"]+)"/g,
    ),
  ];
  assert.deepEqual(
    disallowedToolFlags.map((match) => match[1]),
    ["mcp__*"],
  );
  assert.deepEqual(
    [...review.with.claude_args.matchAll(/--model\s+(\S+)/g)].map(
      (match) => match[1],
    ),
    ["claude-sonnet-4-6"],
  );
  assert.match(review.with.claude_args, /--permission-mode\s+dontAsk/);
  assert.match(review.with.claude_args, /--setting-sources\s+user/);
  assert.match(review.with.claude_args, /--strict-mcp-config\b/);
  assert.doesNotMatch(
    review.with.claude_args,
    /--(?:allowedTools|allowed-tools)\b/,
  );
  assert.doesNotMatch(
    review.with.claude_args,
    /Bash\(gh api|Bash\(curl|Bash\(git|WebFetch|WebSearch|mcp__github__|--permission-mode\s+bypassPermissions|--dangerously-skip-permissions|--tools\s+"[^"]*(?:Read|Edit|Write|Glob|Grep|Agent)/,
  );
  assert.match(review.with.claude_args, /--json-schema/);
  assert.match(review.with.claude_args, /dependabot-claude-review-result:v1/);
  assert.match(review.with.claude_args, /"maxItems":20/);
  assert.match(review.with.claude_args, /"additionalProperties":false/);

  assert.equal(
    diagnostics.name,
    "Report sanitized Claude terminal diagnostics",
  );
  assert.equal(diagnostics.if, "${{ always() }}");
  assert.equal(diagnostics["continue-on-error"], true);
  assert.equal(
    diagnostics.env.CLAUDE_EXECUTION_FILE,
    "${{ steps.claude-review.outputs.execution_file }}",
  );
  assert.match(
    diagnostics.run,
    /expected="\$RUNNER_TEMP\/claude-execution-output\.json"/,
  );
  assert.match(diagnostics.run, /! test -L "\$expected"/);
  assert.match(diagnostics.run, /bytes <= 2097152/);
  assert.match(diagnostics.run, /\(\$results \| length\) != 1/);
  assert.match(diagnostics.run, /\^\[A-Za-z0-9_-\]\{1,64\}\$/);
  assert.match(diagnostics.run, /\. >= 100 and \. <= 599/);
  for (const key of [
    "subtype",
    "is_error",
    "terminal_reason",
    "api_error_status",
  ]) {
    assert.match(diagnostics.run, new RegExp(`${key}=`));
  }
  assert.doesNotMatch(
    diagnostics.run,
    /\.result\b|\.errors\b|\.message\b|\.content\b|\bcat\b/,
  );

  assert.equal(verifyDiffRead.name, "Require a completed exact diff read");
  assert.equal(verifyDiffRead.if, "${{ always() }}");
  assert.equal(
    verifyDiffRead.env.DEPENDABOT_REVIEW_PR_NUMBER,
    "${{ needs.preflight.outputs.pr_number }}",
  );
  assert.equal(
    verifyDiffRead.env.DEPENDABOT_REVIEW_REPOSITORY,
    "mento-protocol/frontend-monorepo",
  );
  assert.match(
    verifyDiffRead.run,
    /dependabot-claude-review-tool-guard\.mjs[\s\S]*--verify-completion/,
  );

  assert.equal(publishJob.name, "dependabot-claude-review-publisher");
  assert.deepEqual(publishJob.needs, ["preflight", "review"]);
  assert.match(
    publishJob.if,
    /always\(\).*needs\.preflight\.result == 'success'/,
  );
  assert.deepEqual(publishJob.permissions, {
    actions: "read",
    checks: "write",
    "pull-requests": "read",
  });
  assert.ok(publishJob.steps.every((step) => !Object.hasOwn(step, "uses")));
  assert.doesNotMatch(
    JSON.stringify(publishJob),
    /secrets\.|claude-code-action/,
  );

  const [postflight, publish] = publishJob.steps;
  assert.equal(postflight.id, "postflight");
  assert.equal(
    postflight.env.EXPECTED_HEAD_REF,
    "${{ needs.preflight.outputs.head_ref }}",
  );
  assert.match(postflight.run, /repos\/\$REPOSITORY\/pulls\/\$PR_NUMBER/);
  assert.match(postflight.run, /EXPECTED_IDENTITY_DIGEST/);
  assert.match(postflight.run, /head\?\.ref !== expectedHeadRef/);
  assert.match(postflight.run, /head\?\.sha !== expectedHeadSha/);
  assert.match(postflight.run, /stable=true/);

  assert.equal(publish.if, "${{ always() }}");
  assert.equal(
    publish.env.EXPECTED_HEAD_SHA,
    "${{ needs.preflight.outputs.head_sha }}",
  );
  assert.equal(
    publish.env.CHECK_DETAILS_URL,
    "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
  );
  assert.equal(
    publish.env.CHECK_EXTERNAL_ID,
    "dependabot-claude-review:v1:pr=${{ needs.preflight.outputs.pr_number }}:sha=${{ needs.preflight.outputs.head_sha }}:run=${{ github.run_id }}:attempt=${{ github.run_attempt }}",
  );
  assert.equal(
    publish.env.REVIEW_OUTPUT,
    "${{ needs.review.outputs.structured_output }}",
  );
  assert.match(publish.run, /repos\/\$REPOSITORY\/check-runs/);
  assert.match(publish.run, /name: "claude-review"/);
  assert.match(publish.run, /head_sha: \$headSha/);
  assert.match(publish.run, /details_url: \$detailsUrl/);
  assert.match(publish.run, /external_id: \$externalId/);
  assert.match(publish.run, /dependabot-claude-review-result:v1/);
  assert.match(publish.run, /reviewCompleted == true/);
  assert.match(publish.run, /verdict == "clean"/);
  assert.match(publish.run, /findings \| length\) == 0/);
  assert.match(publish.run, /all\(\.findings\[\];/);
  assert.match(publish.run, /jq -S -c '\.'/);
  assert.match(publish.run, /--arg text "\$text"/);
  assert.match(publish.run, /text: \$text/);
  assert.match(publish.run, /POST_IDENTITY_STABLE.*true/s);
  assert.match(publish.run, /test "\$conclusion" = "success"/);

  assert.match(checkout.uses, /@[0-9a-f]{40}$/);
  assert.match(review.uses, /@[0-9a-f]{40}$/);

  const raw = read(dependabotReviewPath);
  assert.doesNotMatch(raw, forbiddenCandidateSurfaces);
  assert.doesNotMatch(raw, /github\.event\.pull_request/);

  const guard = read("scripts/dependabot-claude-review-tool-guard.mjs");
  assert.match(guard, /dependabot-claude-review-tool-completed:v2/);
  assert.match(guard, /hookEventName: "PostToolUse"/);
  assert.match(guard, /updatedToolOutput:/);
  assert.match(guard, /structuredContent:/);
  assert.match(guard, /type: "document"/);
  assert.match(guard, /media_type: "text\/plain"/);
  assert.match(guard, /data: response\.stdout/);
});

test("Dependabot Claude review tool guard permits only the exact bound diff", async () => {
  const environment = {
    ...process.env,
    DEPENDABOT_REVIEW_PR_NUMBER: "731",
    DEPENDABOT_REVIEW_REPOSITORY: "mento-protocol/frontend-monorepo",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "123456",
    RUNNER_TEMP: mkdtempSync(join(tmpdir(), "dependabot-review-tool-")),
  };
  const exactInput = {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_use_id: "toolu_01DependabotDiffRead",
    tool_input: {
      command: "gh pr diff 731 --repo mento-protocol/frontend-monorepo",
      description: "Read the authenticated pull-request diff",
      run_in_background: false,
      timeout: 120_000,
    },
  };
  const allowed = spawnSync(process.execPath, [dependabotReviewToolGuardPath], {
    encoding: "utf8",
    env: environment,
    input: JSON.stringify(exactInput),
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout), {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "Exact receipt-bound Dependabot PR diff command",
    },
  });
  const duplicate = spawnSync(
    process.execPath,
    [dependabotReviewToolGuardPath],
    {
      encoding: "utf8",
      env: environment,
      input: JSON.stringify(exactInput),
    },
  );
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /one permitted diff read/);

  const exactDiff = [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -1 +1 @@",
    `-${"a".repeat(16_000)}`,
    `+${"b".repeat(16_000)}`,
    "",
  ].join("\n");
  assert.ok(Buffer.byteLength(exactDiff) > 30_000);
  const postInput = {
    ...exactInput,
    hook_event_name: "PostToolUse",
    tool_response: {
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
      stderr: "",
      stdout: exactDiff,
    },
  };
  const expectedPostHookOutput = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: {
        interrupted: false,
        isImage: false,
        stderr: "",
        stdout: "",
        structuredContent: [
          {
            source: {
              data: exactDiff,
              media_type: "text/plain",
              type: "text",
            },
            type: "document",
          },
        ],
      },
    },
  };
  const completed = spawnSync(
    process.execPath,
    [dependabotReviewToolGuardPath],
    {
      encoding: "utf8",
      env: environment,
      input: JSON.stringify(postInput),
    },
  );
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(completed.stdout, `${JSON.stringify(expectedPostHookOutput)}\n`);
  const deliveredDiff = JSON.parse(completed.stdout).hookSpecificOutput
    .updatedToolOutput.structuredContent[0].source.data;
  assert.deepEqual(Buffer.from(deliveredDiff), Buffer.from(exactDiff));
  const completedReceipt = JSON.parse(
    readFileSync(
      join(
        environment.RUNNER_TEMP,
        "dependabot-review-tool-123456-1.completed.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    completedReceipt.schema,
    "dependabot-claude-review-tool-completed:v2",
  );
  assert.equal(completedReceipt.outputBytes, Buffer.byteLength(exactDiff));
  const verified = spawnSync(
    process.execPath,
    [dependabotReviewToolGuardPath, "--verify-completion"],
    { encoding: "utf8", env: environment },
  );
  assert.equal(verified.status, 0, verified.stderr);
  const duplicateCompletion = spawnSync(
    process.execPath,
    [dependabotReviewToolGuardPath],
    {
      encoding: "utf8",
      env: environment,
      input: JSON.stringify(postInput),
    },
  );
  assert.equal(duplicateCompletion.status, 2);
  assert.match(duplicateCompletion.stderr, /completion was already sealed/);

  const parallelEnvironment = {
    ...environment,
    RUNNER_TEMP: mkdtempSync(join(tmpdir(), "dependabot-review-tool-race-")),
  };
  const runGuard = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [dependabotReviewToolGuardPath], {
        env: parallelEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      let stdout = "";
      child.stderr.setEncoding("utf8");
      child.stdout.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("close", (status) => resolve({ status, stderr, stdout }));
      child.stdin.end(JSON.stringify(exactInput));
    });
  const parallelResults = await Promise.all([runGuard(), runGuard()]);
  assert.deepEqual(parallelResults.map(({ status }) => status).sort(), [0, 2]);
  assert.equal(
    parallelResults.filter(({ stdout }) =>
      stdout.includes('"permissionDecision":"allow"'),
    ).length,
    1,
  );
  const verifyBeforeCompletion = spawnSync(
    process.execPath,
    [dependabotReviewToolGuardPath, "--verify-completion"],
    { encoding: "utf8", env: parallelEnvironment },
  );
  assert.equal(verifyBeforeCompletion.status, 2);
  assert.match(verifyBeforeCompletion.stderr, /completed diff-read marker/);

  const runCompletionGuard = () =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [dependabotReviewToolGuardPath], {
        env: parallelEnvironment,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stderr = "";
      let stdout = "";
      child.stderr.setEncoding("utf8");
      child.stdout.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("close", (status) => resolve({ status, stderr, stdout }));
      child.stdin.end(JSON.stringify(postInput));
    });
  const parallelCompletionResults = await Promise.all([
    runCompletionGuard(),
    runCompletionGuard(),
  ]);
  assert.deepEqual(
    parallelCompletionResults.map(({ status }) => status).sort(),
    [0, 2],
  );
  assert.equal(
    parallelCompletionResults.filter(
      ({ stdout }) => stdout === `${JSON.stringify(expectedPostHookOutput)}\n`,
    ).length,
    1,
  );
  const parallelVerified = spawnSync(
    process.execPath,
    [dependabotReviewToolGuardPath, "--verify-completion"],
    { encoding: "utf8", env: parallelEnvironment },
  );
  assert.equal(parallelVerified.status, 0, parallelVerified.stderr);

  const blockedInputs = [
    {
      ...exactInput,
      tool_input: { command: ` ${exactInput.tool_input.command}` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} ` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} --patch` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command}; env` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} && env` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} || env` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} | cat` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} > /tmp/diff` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} $(env)` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command} \`env\`` },
    },
    {
      ...exactInput,
      tool_input: { command: `${exactInput.tool_input.command}\ncat .env` },
    },
    {
      ...exactInput,
      tool_input: {
        command: "gh pr diff 732 --repo mento-protocol/frontend-monorepo",
      },
    },
    {
      ...exactInput,
      tool_input: {
        command: "gh pr diff 731 --repo attacker/example",
      },
    },
    {
      ...exactInput,
      tool_input: { command: `command ${exactInput.tool_input.command}` },
    },
    {
      ...exactInput,
      tool_input: { command: `GH_TOKEN=x ${exactInput.tool_input.command}` },
    },
    {
      ...exactInput,
      tool_input: {
        command: exactInput.tool_input.command,
        run_in_background: true,
      },
    },
    {
      ...exactInput,
      tool_input: {
        command: exactInput.tool_input.command,
        timeout: 120_001,
      },
    },
    {
      ...exactInput,
      tool_input: {
        command: exactInput.tool_input.command,
        description: "x".repeat(501),
      },
    },
    {
      ...exactInput,
      tool_input: {
        command: exactInput.tool_input.command,
        dangerouslyDisableSandbox: true,
      },
    },
    { ...exactInput, tool_name: "Read" },
    { ...exactInput, hook_event_name: "PermissionRequest" },
    { ...exactInput, hook_event_name: "PostToolUseFailure" },
    {
      ...postInput,
      tool_use_id: "toolu_01DifferentDiffRead",
    },
    {
      ...postInput,
      tool_response: { ...postInput.tool_response, stdout: "" },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        stdout: "not a unified diff",
      },
    },
    {
      ...postInput,
      tool_response: { ...postInput.tool_response, interrupted: true },
    },
    {
      ...postInput,
      tool_response: { ...postInput.tool_response, isImage: true },
    },
    {
      ...postInput,
      tool_response: { ...postInput.tool_response, noOutputExpected: true },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        persistedOutputPath: "/tmp/full-diff",
        persistedOutputSize: 150_001,
      },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        rawOutputPath: "/tmp/raw-diff",
      },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        structuredContent: [{ type: "text", text: exactDiff }],
      },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        backgroundTaskId: "task-1",
      },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        backgroundedByUser: true,
      },
    },
    {
      ...postInput,
      tool_response: {
        ...postInput.tool_response,
        timedOutAfterMs: 120_000,
      },
    },
  ];
  for (const [index, input] of blockedInputs.entries()) {
    const blockedEnvironment = {
      ...environment,
      RUNNER_TEMP: mkdtempSync(
        join(tmpdir(), `dependabot-review-tool-blocked-${index}-`),
      ),
    };
    try {
      if (input.hook_event_name === "PostToolUse") {
        const issued = spawnSync(
          process.execPath,
          [dependabotReviewToolGuardPath],
          {
            encoding: "utf8",
            env: blockedEnvironment,
            input: JSON.stringify(exactInput),
          },
        );
        assert.equal(issued.status, 0, issued.stderr);
      }
      const blocked = spawnSync(
        process.execPath,
        [dependabotReviewToolGuardPath],
        {
          encoding: "utf8",
          env: blockedEnvironment,
          input: JSON.stringify(input),
        },
      );
      assert.equal(blocked.status, 2, JSON.stringify(input));
      assert.match(blocked.stderr, /Blocked Dependabot review tool call/);
    } finally {
      rmSync(blockedEnvironment.RUNNER_TEMP, {
        force: true,
        recursive: true,
      });
    }
  }

  for (const [input, env] of [
    ["not-json", environment],
    [
      JSON.stringify({
        ...exactInput,
        padding: "x".repeat(2_097_152),
      }),
      environment,
    ],
    [
      JSON.stringify(exactInput),
      { ...environment, DEPENDABOT_REVIEW_PR_NUMBER: "0731" },
    ],
    [
      JSON.stringify(exactInput),
      { ...environment, DEPENDABOT_REVIEW_REPOSITORY: "attacker/example" },
    ],
    [JSON.stringify(exactInput), { ...environment, GITHUB_RUN_ID: "0" }],
    [JSON.stringify(exactInput), { ...environment, RUNNER_TEMP: "relative" }],
  ]) {
    const blocked = spawnSync(
      process.execPath,
      [dependabotReviewToolGuardPath],
      { encoding: "utf8", env, input },
    );
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /Blocked Dependabot review tool call/);
  }
  rmSync(environment.RUNNER_TEMP, { force: true, recursive: true });
  rmSync(parallelEnvironment.RUNNER_TEMP, { force: true, recursive: true });
});

test("Dependabot Claude review authenticates live upstream head metadata", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment(),
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.githubOutput,
    `pr_number=701\nhead_ref=dependabot/npm_and_yarn/runtime-packages-123abc\nhead_sha=${"a".repeat(40)}\noperation=\noperation_check_id=\noperation_digest=\nreview_actor_login=dependabot[bot]\nsource_kind=dependabot\n`,
  );
});

test("native Dependabot review needs no Prepare App configuration", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment({
      EXPECTED_PREPARE_APP_SLUG: "",
      EXPECTED_PREPARE_BOT_ID: "",
      EXPECTED_PREPARE_BOT_LOGIN: "",
    }),
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.githubOutput, /review_actor_login=dependabot\[bot\]/);
});

test("Dependabot Claude review allows an omitted linked PR after receipt authentication", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment({ INTAKE_PULL_REQUESTS_JSON: "[]" }),
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.equal(result.status, 0, result.stderr);
});

test("Dependabot Claude review rejects an upstream head and receipt mismatch", () => {
  const intake = dependabotReview.jobs.preflight.steps[0];
  const result = runBashStep(intake, {
    ...liveIntakeEnvironment({ INTAKE_HEAD_SHA: "b".repeat(40) }),
    RUN_ATTEMPT: "1",
    RUN_ID: "123456789",
    WORKFLOW_SHA: "c".repeat(40),
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.githubOutput, "");
});

test("human Claude review cannot shadow the Dependabot review check", () => {
  const job = humanReview.jobs["claude-review-human"];
  assert.ok(job);
  assert.equal(job.name, "claude-review-human");
  assert.match(job.if, /head\.repo\.full_name == github\.repository/);
  assert.match(job.if, /pull_request\.user\.type == 'User'/);
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
  assert.match(marketplaceGuard.run, /GITHUB_WORKSPACE/);
  assert.match(marketplaceGuard.run, /-e "\$marketplace_path"/);
  assert.match(marketplaceGuard.run, /-L "\$marketplace_path"/);

  const marketplaceCheckout = job.steps[marketplaceCheckoutIndex];
  assert.ok(marketplaceCheckout);
  assert.equal(
    marketplaceCheckout.uses,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assert.equal(marketplaceCheckout.with.repository, "anthropics/claude-code");
  assert.equal(marketplaceCheckout.with.ref, claudePluginMarketplaceRef);
  assert.equal(marketplaceCheckout.with.path, claudePluginMarketplace.slice(2));
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
    claudePluginMarketplaceRef,
  );
  assert.match(marketplaceVerification.run, /! -L "\$marketplace_path"/);
  assert.match(
    marketplaceVerification.run,
    /git -C "\$marketplace_path" rev-parse HEAD/,
  );

  const review = job.steps.find((step) => step.uses === claudeAction);
  assert.ok(review);
  assert.equal(
    review.with.claude_args,
    `--plugin-dir ${claudeCodeReviewPlugin}`,
  );
  assert.equal(Object.hasOwn(review.with, "plugin_marketplaces"), false);
  assert.equal(Object.hasOwn(review.with, "plugins"), false);
  assert.equal(Object.hasOwn(review.with, "allowed_bots"), false);
});

test("human Claude review rejects a candidate marketplace symlink", () => {
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
      join(workspace, claudePluginMarketplace.slice(2)),
      "dir",
    );
    const result = spawnSync("bash", ["-c", guard.run], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_WORKSPACE: workspace },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Candidate content occupies/);
    assert.deepEqual(readdirSync(redirect), []);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("no workflow can automatically merge Dependabot pull requests", () => {
  const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
  const legacyWorkflow = new URL(
    "../.github/workflows/dependabot-auto-merge.yml",
    import.meta.url,
  );
  assert.equal(existsSync(legacyWorkflow), false);

  const forbiddenMergeAuthority =
    /gh\s+pr\s+merge|enablePullRequestAutoMerge|mergePullRequest|\/pulls\/[^\s"'`]*\/merge|pulls\.merge|DEPENDABOT_PROCESSOR_MERGE_/;
  const trustedSources = [
    "scripts/dependabot-preparation-receipts.mjs",
    "scripts/dependabot-prepared-review.mjs",
    "scripts/dependabot-processor.mjs",
  ];
  for (const source of trustedSources) {
    assert.doesNotMatch(
      read(source),
      forbiddenMergeAuthority,
      `${source} must not merge or enable native auto-merge for Dependabot PRs`,
    );
  }

  for (const filename of readdirSync(workflowDirectory)) {
    if (!/\.ya?ml$/.test(filename)) {
      continue;
    }
    const raw = read(`.github/workflows/${filename}`);
    assert.doesNotMatch(
      raw,
      forbiddenMergeAuthority,
      `${filename} must not merge or enable native auto-merge for Dependabot PRs`,
    );
  }
});
