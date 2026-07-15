#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE = "origin/main";
const ADR_PATH_RE = /^docs\/adr\/\d{4}-[a-z0-9][a-z0-9-]*\.md$/;
const WORKFLOW_PATH_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const WORKSPACE_MANIFEST_RE = /^(?:apps|packages)\/[^/]+\/package\.json$/;

function normalizePaths(paths) {
  return [...new Set(paths.filter(Boolean))].sort();
}

export function classifyAddedPaths(paths) {
  const addedPaths = normalizePaths(paths);
  const adrPaths = addedPaths.filter((path) => ADR_PATH_RE.test(path));
  const triggers = [];

  for (const path of addedPaths) {
    if (WORKFLOW_PATH_RE.test(path)) {
      triggers.push({ kind: "new GitHub Actions workflow", path });
    } else if (WORKSPACE_MANIFEST_RE.test(path)) {
      triggers.push({ kind: "new app or package workspace", path });
    }
  }

  return {
    addedPaths,
    adrPaths,
    triggers,
    needsAdr: triggers.length > 0 && adrPaths.length === 0,
  };
}

function parseArguments(argv) {
  const options = {
    base: DEFAULT_BASE,
    head: undefined,
    includeUntracked: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--strict") {
      options.strict = true;
    } else if (argument === "--include-untracked") {
      options.includeUntracked = true;
    } else if (argument === "--base" || argument === "--head") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${argument} requires a non-option git revision`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  return options;
}

function splitNullDelimited(output) {
  return output.toString("utf8").split("\0").filter(Boolean);
}

function gitDiffAddedPaths(revisions) {
  return splitNullDelimited(
    execFileSync(
      "git",
      [
        "diff",
        "--no-renames",
        "--diff-filter=A",
        "--name-only",
        "-z",
        ...revisions,
        "--",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}

function gitMergeBase(base, head) {
  return execFileSync("git", ["merge-base", base, head], {
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString("utf8")
    .trim();
}

function gitAddedPaths({ base, head, includeUntracked }) {
  const branchHead = head ?? "HEAD";
  const mergeBase = gitMergeBase(base, branchHead);
  const paths =
    head === undefined
      ? [
          ...gitDiffAddedPaths([mergeBase, branchHead]),
          ...gitDiffAddedPaths([branchHead]),
        ]
      : gitDiffAddedPaths([mergeBase, branchHead]);

  if (includeUntracked && head === undefined) {
    paths.push(
      ...splitNullDelimited(
        execFileSync(
          "git",
          ["ls-files", "--others", "--exclude-standard", "-z"],
          { stdio: ["ignore", "pipe", "pipe"] },
        ),
      ),
    );
  }

  return normalizePaths(paths);
}

function reminderMessage(result) {
  const lines = result.triggers.map(({ kind, path }) => `  - ${kind}: ${path}`);
  return [
    "Architecture decision reminder: this change adds a high-signal surface:",
    ...lines,
    "No numbered ADR was added under docs/adr/.",
    "If this makes an architectural decision, add the ADR in this PR. Otherwise explain why it is not applicable on the PR's Architecture decision line.",
    "See docs/pr-checklists/architecture-decisions.md.",
  ].join("\n");
}

export function evaluateAddedPaths(paths, { strict = false } = {}) {
  const result = classifyAddedPaths(paths);
  return {
    ...result,
    exitCode: result.needsAdr && strict ? 1 : 0,
    message: result.needsAdr ? reminderMessage(result) : "",
  };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`ADR check failed: ${error.message}`);
    process.exitCode = 2;
  }

  if (options) {
    try {
      const result = evaluateAddedPaths(gitAddedPaths(options), options);
      if (result.message) console.log(result.message);
      process.exitCode = result.exitCode;
    } catch (error) {
      const message = `ADR check could not compare ${options.base}${options.head ? ` to ${options.head}` : " to the working tree"}: ${error.message}`;
      if (options.strict) {
        console.error(message);
        process.exitCode = 2;
      } else {
        console.warn(
          `${message}\nAdvisory mode is not blocking this operation.`,
        );
      }
    }
  }
}
