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

/** @param {string} raw */
function stripLeadingAnchor(raw) {
  return raw.replace(/^(?:&[^\s[\]{},]+\s+)*/, "");
}

/** @param {string} raw @param {string} delimiter */
function findTopLevelDelimiter(raw, delimiter) {
  let quote = "";
  let depth = 0;

  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];

    if (quote === '"') {
      if (character === "\\") index++;
      else if (character === '"') quote = "";
      continue;
    }

    if (quote === "'") {
      if (character === "'" && raw[index + 1] === "'") index++;
      else if (character === "'") quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{" || character === "[") {
      depth++;
    } else if (character === "}" || character === "]") {
      depth--;
    } else if (character === delimiter && depth === 0) {
      return index;
    }
  }

  return -1;
}

/** @param {string} body */
function splitFlowFields(body) {
  const fields = [];
  let rest = body;

  while (rest.length > 0) {
    const commaIndex = findTopLevelDelimiter(rest, ",");
    if (commaIndex === -1) {
      fields.push(rest);
      break;
    }

    fields.push(rest.slice(0, commaIndex));
    rest = rest.slice(commaIndex + 1);
  }

  return fields;
}

/** @param {string} line */
function extractFlowMappingBody(line) {
  let candidate = line.trim();
  const sequencePrefix = candidate.match(/^-\s+/)?.[0];
  if (!sequencePrefix) return null;

  candidate = candidate.slice(sequencePrefix.length);
  candidate = stripLeadingAnchor(candidate).trimStart();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return null;
  return candidate.slice(1, -1);
}

/** @param {string} raw */
function normalizeFlowKey(raw) {
  let key = raw.trim();
  if (/^\?\s+/.test(key)) key = key.replace(/^\?\s+/, "");
  return stripLeadingAnchor(key);
}

/** @param {string} line */
function extractUsesRawValues(line) {
  const plain = line.match(
    /^\s*(?:-\s+)?(?:&[^\s[\]{},]+\s+)*(?:"uses"|'uses'|uses)\s*:\s*(.*?)\s*$/,
  );
  if (plain) return [plain[1] ?? ""];

  const { value: lineWithoutComment, comment } = splitInlineComment(line);
  const body = extractFlowMappingBody(lineWithoutComment);
  if (body == null) return [];

  return splitFlowFields(body).flatMap((field) => {
    const colonIndex = findTopLevelDelimiter(field, ":");
    if (colonIndex === -1) return [];

    const key = normalizeFlowKey(field.slice(0, colonIndex));
    if (key !== "uses" && key !== '"uses"' && key !== "'uses'") return [];

    const value = field.slice(colonIndex + 1).trim();
    return [comment ? `${value} # ${comment}` : value];
  });
}

/** @param {string} line */
function blockScalarState(line) {
  const { value } = splitInlineComment(line);
  const indicator = value.match(/:\s*([>|](?:[+-][1-9]?|[1-9][+-]?)?)\s*$/);
  if (!indicator) return null;

  const leadingIndent = value.match(/^\s*/)?.[0].length ?? 0;
  const sequencePrefix = value.slice(leadingIndent).match(/^-\s+/)?.[0] ?? "";
  const parentIndent = leadingIndent + sequencePrefix.length;
  const explicitIndent = indicator[1]?.match(/[1-9]/)?.[0];

  return {
    parentIndent,
    contentIndent: explicitIndent
      ? parentIndent + Number(explicitIndent)
      : null,
  };
}

/**
 * @param {string} line
 * @param {{ parentIndent: number, contentIndent: number | null }} state
 */
function isBlockScalarContent(line, state) {
  if (/^\s*(?:#.*)?$/.test(line)) return true;

  const indent = line.match(/^\s*/)?.[0].length ?? 0;
  if (state.contentIndent != null) return indent >= state.contentIndent;
  if (indent <= state.parentIndent) return false;

  state.contentIndent = indent;
  return true;
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
  let blockScalar = null;

  lines.forEach((line, lineIndex) => {
    if (blockScalar && isBlockScalarContent(line, blockScalar)) return;
    blockScalar = blockScalarState(line);

    for (const rawValue of extractUsesRawValues(line)) {
      const value = normalizeUsesValue(rawValue);
      if (isLocalAction(value)) {
        for (const manifest of localActionManifestPaths(file, value)) {
          if (!queuedFiles.has(manifest)) {
            queuedFiles.add(manifest);
            files.push(manifest);
          }
        }
        continue;
      }

      if (isPinnedExternalAction(value) && hasReleaseTagComment(rawValue)) {
        continue;
      }

      failures.push({
        file: relative(ROOT, file),
        line: lineIndex + 1,
        value,
      });
    }
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
