#!/usr/bin/env node
/**
 * Reject mutable third-party `uses:` references in GitHub workflow and
 * composite-action YAML. Local actions are allowed; referenced manifests are
 * followed recursively so actions outside `.github/actions` are covered too.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

// Script-local fixture knob, not an input to the Turbo task graph.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const ROOT = resolve(process.env["GITHUB_ACTION_PINS_ROOT"] ?? process.cwd());
const PINNED_REF = /^[0-9a-f]{40}$/i;
const SCAN_DIRS = [".github/workflows", ".github/actions"];

/** @param {string} path */
function isYaml(path) {
  return path.endsWith(".yml") || path.endsWith(".yaml");
}

/** @param {string} directory */
function* walkYaml(directory) {
  if (!existsSync(directory)) return;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkYaml(path);
    } else if (entry.isFile() && isYaml(path)) {
      yield path;
    }
  }
}

/** @param {string} raw */
function splitInlineComment(raw) {
  let quote = "";

  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    const escapedDoubleQuote =
      character === '"' && quote === '"' && raw[index - 1] === "\\";

    if ((character === '"' || character === "'") && !escapedDoubleQuote) {
      quote = quote === character ? "" : quote === "" ? character : quote;
    }

    if (character === "#" && quote === "") {
      return {
        value: raw.slice(0, index).trim(),
        comment: raw.slice(index + 1).trim(),
      };
    }
  }

  return { value: raw.trim(), comment: "" };
}

/** @param {string} raw */
function normalizeUsesValue(raw) {
  const { value } = splitInlineComment(raw);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/** @param {string} line */
function extractUsesRawValue(line) {
  const plain = line.match(
    /^\s*(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*(.+?)\s*$/,
  );
  if (plain) return plain[1] ?? "";

  const { value: lineWithoutComment, comment } = splitInlineComment(line);
  const flow = lineWithoutComment.match(
    /^\s*-\s*\{.*(?:"uses"|'uses'|uses)\s*:\s*([^,}]+).*}\s*$/,
  );
  if (!flow) return null;

  const value = flow[1] ?? "";
  return comment ? `${value} # ${comment}` : value;
}

/** @param {string} value */
function isLocalAction(value) {
  return value.startsWith("./") || value.startsWith("../");
}

/** @param {string} value */
function isPinnedExternalAction(value) {
  const atIndex = value.lastIndexOf("@");
  return atIndex !== -1 && PINNED_REF.test(value.slice(atIndex + 1));
}

/** @param {string} raw */
function hasReleaseTagComment(raw) {
  const { comment } = splitInlineComment(raw);
  return /^v\d+(?:[.\w-].*)?$/.test(comment);
}

/** @param {string} root @param {string} path */
function isInsideRoot(root, path) {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.startsWith("/"))
  );
}

/** @param {string} fromFile @param {string} value */
function localActionManifestPaths(fromFile, value) {
  const actionDirectory = value.startsWith("../")
    ? resolve(dirname(fromFile), value)
    : resolve(ROOT, value);

  if (!isInsideRoot(ROOT, actionDirectory)) return [];

  return ["action.yml", "action.yaml"]
    .map((name) => join(actionDirectory, name))
    .filter((path) => existsSync(path));
}

const failures = [];
const files = SCAN_DIRS.flatMap((directory) => [
  ...walkYaml(join(ROOT, directory)),
]).sort();
const queuedFiles = new Set(files);

for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
  const file = files[fileIndex];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const rawValue = extractUsesRawValue(line);
    if (rawValue == null) return;

    const value = normalizeUsesValue(rawValue);
    if (value === "") return;

    if (isLocalAction(value)) {
      for (const manifest of localActionManifestPaths(file, value)) {
        if (!queuedFiles.has(manifest)) {
          queuedFiles.add(manifest);
          files.push(manifest);
        }
      }
      return;
    }

    if (isPinnedExternalAction(value) && hasReleaseTagComment(rawValue)) return;

    failures.push({
      file: relative(ROOT, file),
      line: lineIndex + 1,
      value,
    });
  });
}

if (failures.length > 0) {
  console.error("Unpinned or undocumented GitHub Actions references found:");
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line} uses: ${failure.value}`);
  }
  console.error(
    "Third-party actions must use a full 40-character commit SHA and keep " +
      "the release tag as an inline comment, for example: " +
      "`uses: org/action@<sha> # v1.2.3`.",
  );
  process.exit(1);
}

console.log(
  `All ${files.length} workflow/composite-action YAML files use pinned external actions.`,
);
