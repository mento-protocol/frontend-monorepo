#!/usr/bin/env node

import { Buffer } from "node:buffer";
import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isDocumentationPath(path) {
  return path.startsWith("docs/") || path.endsWith(".md");
}

export function planCiForPaths(paths) {
  const changedPaths = paths.filter(Boolean);

  // An empty diff is unexpected for both pull_request and push. Run the full
  // suite instead of allowing a detection bug to turn into a green skip.
  if (changedPaths.length === 0) {
    return {
      changedCount: 0,
      reason: "empty-diff-full-quality",
      runQuality: true,
    };
  }

  const nonDocumentationPaths = changedPaths.filter(
    (path) => !isDocumentationPath(path),
  );

  return {
    changedCount: changedPaths.length,
    reason:
      nonDocumentationPaths.length === 0
        ? "documentation-only"
        : "code-or-policy-change",
    runQuality: nonDocumentationPaths.length > 0,
  };
}

function parseInput(buffer, nullDelimited) {
  return buffer
    .split(nullDelimited ? "\0" : /\n/)
    .map((path) => (nullDelimited ? path : path.replace(/\r$/, "")))
    .filter(Boolean);
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const nullDelimited = process.argv.includes("--null");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const paths = parseInput(
    Buffer.concat(chunks).toString("utf8"),
    nullDelimited,
  );
  const plan = planCiForPaths(paths);

  console.log(`run_quality=${String(plan.runQuality)}`);
  console.log(`changed_count=${plan.changedCount}`);
  console.log(`reason=${plan.reason}`);
}
