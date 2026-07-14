#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERCEL_DEPLOYMENTS = ["app", "governance", "reserve", "ui"];

const PACKAGE_TO_DEPLOYMENT = new Map([
  ["app.mento.org", "app"],
  ["governance.mento.org", "governance"],
  ["reserve.mento.org", "reserve"],
  ["ui.mento.org", "ui"],
]);

const GLOBAL_BUILD_INPUTS = new Set([
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
]);

const PROVEN_NON_RUNTIME_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "README.md",
]);

const PROVEN_NON_RUNTIME_DIRECTORIES = [
  "docs/",
  "apps/app.mento.org/e2e/",
  "apps/governance.mento.org/e2e/",
  "apps/ui.mento.org/e2e/",
];

function failClosed(base, head, reason) {
  return {
    deployments: [...VERCEL_DEPLOYMENTS],
    base: base ?? null,
    head: head ?? null,
    reason,
  };
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error("git command failed");
  }

  return result.stdout;
}

function resolveCommit(repoRoot, commit) {
  if (typeof commit !== "string" || !/^[a-fA-F0-9]{40,64}$/.test(commit)) {
    throw new Error("commit must be an immutable SHA");
  }

  return runGit(repoRoot, [
    "rev-parse",
    "--verify",
    `${commit}^{commit}`,
  ]).trim();
}

function changedPathsBetween(repoRoot, base, head) {
  const output = runGit(repoRoot, [
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    base,
    head,
  ]);

  return output.split("\0").filter(Boolean);
}

function isGlobalBuildInput(path) {
  return (
    GLOBAL_BUILD_INPUTS.has(path) ||
    path.startsWith("patches/") ||
    path.startsWith(".github/actions/") ||
    path.startsWith(".github/workflows/") ||
    path === "scripts/security-headers.mjs" ||
    path.startsWith("scripts/plan-vercel-deployments.") ||
    path.startsWith("scripts/vercel-prebuilt.") ||
    path.startsWith("scripts/vercel-build-environment.")
  );
}

function isProvenNonRuntimePath(path) {
  return (
    PROVEN_NON_RUNTIME_FILES.has(path) ||
    PROVEN_NON_RUNTIME_DIRECTORIES.some((directory) =>
      path.startsWith(directory),
    )
  );
}

function parseTurboJson(output) {
  if (typeof output === "object" && output !== null) return output;
  if (typeof output !== "string") throw new Error("missing Turbo output");

  const firstBrace = output.indexOf("{");
  if (firstBrace === -1) throw new Error("Turbo output did not contain JSON");
  return JSON.parse(output.slice(firstBrace));
}

export function runTurboAffectedPlan({
  repoRoot,
  base,
  head,
  spawn = spawnSync,
}) {
  const result = spawn(
    "pnpm",
    ["exec", "turbo", "run", "build", "--affected", "--dry=json"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        TURBO_SCM_BASE: base,
        TURBO_SCM_HEAD: head,
        TURBO_TELEMETRY_DISABLED: "1",
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error("Turbo planning failed");
  }

  return parseTurboJson(result.stdout);
}

export function planVercelDeployments({
  repoRoot = process.cwd(),
  base,
  head,
  runTurbo = runTurboAffectedPlan,
}) {
  let resolvedBase;
  let resolvedHead;

  try {
    resolvedBase = resolveCommit(repoRoot, base);
    resolvedHead = resolveCommit(repoRoot, head);
    runGit(repoRoot, [
      "merge-base",
      "--is-ancestor",
      resolvedBase,
      resolvedHead,
    ]);
  } catch {
    return failClosed(base, head, "invalid-commits");
  }

  let changedPaths;
  try {
    changedPaths = changedPathsBetween(repoRoot, resolvedBase, resolvedHead);
  } catch {
    return failClosed(resolvedBase, resolvedHead, "diff-failed");
  }

  if (changedPaths.length === 0) {
    return failClosed(resolvedBase, resolvedHead, "empty-diff");
  }

  if (changedPaths.some(isGlobalBuildInput)) {
    return failClosed(resolvedBase, resolvedHead, "global-build-input");
  }

  if (changedPaths.every(isProvenNonRuntimePath)) {
    return {
      deployments: [],
      base: resolvedBase,
      head: resolvedHead,
      reason: "non-runtime-only",
    };
  }

  try {
    const turboPlan = runTurbo({
      repoRoot,
      base: resolvedBase,
      head: resolvedHead,
    });
    if (!turboPlan || !Array.isArray(turboPlan.tasks)) {
      throw new Error("malformed Turbo plan");
    }

    const affected = new Set();
    for (const task of turboPlan.tasks) {
      if (!task || typeof task.package !== "string") {
        throw new Error("malformed Turbo task");
      }
      const deployment = PACKAGE_TO_DEPLOYMENT.get(task.package);
      if (deployment) affected.add(deployment);
    }

    if (affected.size === 0) {
      throw new Error("Turbo did not identify a deployable application");
    }

    return {
      deployments: VERCEL_DEPLOYMENTS.filter((target) => affected.has(target)),
      base: resolvedBase,
      head: resolvedHead,
      reason: "affected-packages",
    };
  } catch {
    return failClosed(resolvedBase, resolvedHead, "turbo-planning-failed");
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--base", "--head", "--repo"].includes(argument)) continue;
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const options = parseArguments(process.argv.slice(2));
  const plan = planVercelDeployments({
    repoRoot: options.repo ? resolve(options.repo) : process.cwd(),
    base: options.base,
    head: options.head,
  });
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}
