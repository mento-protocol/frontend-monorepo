#!/usr/bin/env node
/**
 * Reject mutable third-party `uses:` references in GitHub workflow and
 * composite-action YAML. Local actions are allowed; referenced manifests are
 * followed recursively so actions outside `.github/actions` are covered too.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
} from "yaml";

// Script-local fixture knob, not an input to the Turbo task graph.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const ROOT = resolve(process.env["GITHUB_ACTION_PINS_ROOT"] ?? process.cwd());
const REAL_ROOT = realpathSync(ROOT);
const PINNED_REF = /^[0-9a-f]{40}$/i;
const RELEASE_TAG = /^v\d+(?:[.\w-].*)?$/;
const SCAN_DIRS = [".github/workflows", ".github/actions"];
const REQUIRED_POLICY_FILES = [
  ".github/workflows/action-pins.yml",
  ".github/workflows/action-pins-source.yml",
];
const NORMALIZED_POLICY_WORKFLOWS = new Map([
  [
    ".github/workflows/action-pins.yml",
    {
      name: "GitHub Actions Policy",
      on: { pull_request_target: { branches: ["main"] } },
      concurrency: {
        group: "${{ github.workflow }}-${{ github.event.pull_request.number }}",
        "cancel-in-progress": true,
      },
      permissions: { contents: "read" },
      jobs: {
        "action-pins": {
          name: "Action Pin Policy",
          "runs-on": "ubuntu-latest",
          "timeout-minutes": 5,
          steps: [
            {
              name: "Check out trusted policy",
              uses: "actions/checkout@<sha>",
              with: {
                ref: "${{ github.event.pull_request.base.sha }}",
                path: "trusted-base",
                "persist-credentials": false,
              },
            },
            {
              name: "Check out pull request",
              uses: "actions/checkout@<sha>",
              with: {
                repository:
                  "${{ github.event.pull_request.head.repo.full_name }}",
                ref: "${{ github.event.pull_request.head.sha }}",
                path: "pr-head",
                "persist-credentials": false,
                "allow-unsafe-pr-checkout": true,
              },
            },
            {
              name: "Setup PNPM",
              uses: "pnpm/action-setup@<sha>",
              with: { version: "10.24.0" },
            },
            {
              name: "Set up Node.js",
              uses: "actions/setup-node@<sha>",
              with: { "node-version": 22 },
            },
            {
              name: "Install trusted policy dependencies",
              "working-directory": "trusted-base",
              run: "pnpm install --frozen-lockfile --ignore-scripts --filter .",
            },
            {
              name: "Test action-pin policy",
              "working-directory": "trusted-base",
              run: "node scripts/check-github-action-pins.test.mjs",
            },
            {
              name: "Enforce immutable action pins",
              "working-directory": "trusted-base",
              env: {
                GITHUB_ACTION_PINS_ROOT: "${{ github.workspace }}/pr-head",
              },
              run: "node scripts/check-github-action-pins.mjs",
            },
          ],
        },
      },
    },
  ],
  [
    ".github/workflows/action-pins-source.yml",
    {
      name: "GitHub Actions Policy Source",
      on: { pull_request: { branches: ["main"] } },
      concurrency: {
        group: "${{ github.workflow }}-${{ github.event.pull_request.number }}",
        "cancel-in-progress": true,
      },
      permissions: { contents: "read" },
      jobs: {
        "policy-source": {
          name: "Action Pin Policy Source",
          "runs-on": "ubuntu-latest",
          "timeout-minutes": 5,
          steps: [
            {
              name: "Check out proposed policy",
              uses: "actions/checkout@<sha>",
              with: { "persist-credentials": false },
            },
            {
              name: "Setup PNPM",
              uses: "pnpm/action-setup@<sha>",
              with: { version: "10.24.0" },
            },
            {
              name: "Set up Node.js",
              uses: "actions/setup-node@<sha>",
              with: { "node-version": 22 },
            },
            {
              name: "Install proposed policy dependencies",
              run: "pnpm install --frozen-lockfile --ignore-scripts --filter .",
            },
            {
              name: "Test proposed action-pin policy",
              run: "node scripts/check-github-action-pins.test.mjs",
            },
            {
              name: "Scan proposed action pins",
              run: "node scripts/check-github-action-pins.mjs",
            },
          ],
        },
      },
    },
  ],
]);

/** @param {string} path */
function isYaml(path) {
  return path.endsWith(".yml") || path.endsWith(".yaml");
}

/** @param {string} path */
function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** @param {string} directory */
function* walkYaml(directory) {
  if (!isDirectory(directory)) return;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkYaml(path);
    } else if (entry.isFile() && isYaml(path)) {
      yield path;
    }
  }
}

/** @param {string} path */
function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
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

/** @param {unknown} node @param {import("yaml").Document} document */
function resolveAliases(node, document) {
  const aliases = new Set();
  let resolved = node;

  while (isAlias(resolved)) {
    if (aliases.has(resolved)) throw new Error("cyclic YAML alias");
    aliases.add(resolved);
    const target = resolved.resolve(document);
    if (target == null) {
      throw new Error(`unresolved YAML alias \`*${resolved.source}\``);
    }
    resolved = target;
  }

  return resolved;
}

/** @param {unknown} node @param {import("yaml").Document} document */
function scalarValue(node, document) {
  const resolved = resolveAliases(node, document);
  return isScalar(resolved) && typeof resolved.value === "string"
    ? resolved.value
    : null;
}

/**
 * Match mapping keys by their YAML value, including quoted, tagged, explicit,
 * and alias keys. `YAMLMap#get()` intentionally does not resolve alias keys.
 * @param {unknown} node
 * @param {string} key
 * @param {import("yaml").Document} document
 */
function findPair(node, key, document) {
  const mapping = resolveAliases(node, document);
  if (!isMap(mapping)) return null;
  const matches = mapping.items.filter(
    (pair) => scalarValue(pair.key, document) === key,
  );
  if (matches.length > 1) {
    throw new Error(`duplicate semantic \`${key}\` keys`);
  }
  return matches[0] ?? null;
}

/**
 * Reject duplicate semantic keys even when YAML aliases hide them from the
 * parser's ordinary duplicate-key check. This also makes `toJS()` safe for
 * trust-boundary comparisons below.
 * @param {unknown} node
 * @param {import("yaml").Document} document
 * @param {WeakSet<object>} [visited]
 */
function assertUniqueSemanticMappings(node, document, visited = new WeakSet()) {
  const resolved = resolveAliases(node, document);
  if (!isMap(resolved) && !isSeq(resolved)) return;
  if (visited.has(resolved)) return;
  visited.add(resolved);

  if (isSeq(resolved)) {
    for (const item of resolved.items) {
      assertUniqueSemanticMappings(item, document, visited);
    }
    return;
  }

  const keys = new Set();
  for (const pair of resolved.items) {
    const key = scalarValue(pair.key, document);
    if (key == null) throw new Error("non-string YAML mapping key");
    if (keys.has(key)) throw new Error(`duplicate semantic \`${key}\` keys`);
    keys.add(key);
    assertUniqueSemanticMappings(pair.value, document, visited);
  }
}

/** @param {unknown} value */
function normalizePolicyWorkflow(value) {
  if (Array.isArray(value)) return value.map(normalizePolicyWorkflow);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizePolicyWorkflow(nested),
      ]),
    );
  }
  if (typeof value !== "string") return value;

  for (const action of [
    "actions/checkout",
    "actions/setup-node",
    "pnpm/action-setup",
  ]) {
    const prefix = `${action}@`;
    if (
      value.startsWith(prefix) &&
      PINNED_REF.test(value.slice(prefix.length))
    ) {
      return `${prefix}<sha>`;
    }
  }

  return value;
}

/**
 * These workflows form the policy's trust boundary. The target workflow runs
 * only base-branch code; the source workflow exercises proposed checker code
 * without credentials. Validate their complete executable structure from the
 * trusted checker so a PR cannot replace either required check with a no-op.
 * Action SHAs are normalized; other canonical changes intentionally use the
 * protected two-PR transition documented in README.md.
 * @param {string} path
 * @param {import("yaml").Document} document
 */
function assertPolicyWorkflowStructure(path, document) {
  const expected = NORMALIZED_POLICY_WORKFLOWS.get(path);
  if (!expected) return;

  assertUniqueSemanticMappings(document.contents, document);
  const actual = normalizePolicyWorkflow(document.toJS({ maxAliasCount: 100 }));
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("does not match the trusted action-pin workflow structure");
  }
}

/** @param {unknown} node @param {string} source */
function sourceLine(node, source) {
  const offset = Array.isArray(node?.range) ? node.range[0] : 0;
  const start = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const end = source.indexOf("\n", offset);
  return source.slice(start, end === -1 ? source.length : end);
}

/** @param {unknown} node @param {string} source */
function hasReleaseTagComment(node, source) {
  return RELEASE_TAG.test(splitInlineComment(sourceLine(node, source)).comment);
}

/** @param {unknown} node @param {LineCounter} lineCounter */
function lineNumber(node, lineCounter) {
  const offset = Array.isArray(node?.range) ? node.range[0] : 0;
  return lineCounter.linePos(offset).line;
}

/**
 * Collect only executable `uses` fields: a reusable-workflow job's direct
 * field or a direct item in a workflow/composite action's `steps` sequence.
 * Nested inputs such as `with.uses` are ordinary data and are ignored.
 * @param {unknown} root
 * @param {import("yaml").Document} document
 */
function collectUses(root, document) {
  const references = [];

  /** @param {unknown} executable */
  const addDirectUses = (executable) => {
    const uses = findPair(executable, "uses", document);
    if (!uses) return;

    const reference = {
      keyNode: uses.key,
      valueNode: uses.value,
      // If the executable mapping is itself an alias, the version comment
      // belongs at that use site. Otherwise preserve the original value node
      // so a value alias cannot borrow a comment from its anchor definition.
      commentNode: isAlias(executable) ? executable : (uses.value ?? uses.key),
    };
    if (
      references.some(
        (existing) =>
          existing.keyNode === reference.keyNode &&
          existing.valueNode === reference.valueNode &&
          existing.commentNode === reference.commentNode,
      )
    ) {
      return;
    }
    references.push(reference);
  };

  /** @param {unknown} stepsNode */
  const addSteps = (stepsNode) => {
    const steps = resolveAliases(stepsNode, document);
    if (!isSeq(steps)) return;
    for (const step of steps.items) addDirectUses(step);
  };

  const jobsPair = findPair(root, "jobs", document);
  const jobs = resolveAliases(jobsPair?.value, document);
  if (isMap(jobs)) {
    for (const jobPair of jobs.items) {
      const job = jobPair.value;
      addDirectUses(job);
      addSteps(findPair(job, "steps", document)?.value);
    }
  }

  const runsPair = findPair(root, "runs", document);
  const runs = resolveAliases(runsPair?.value, document);
  if (isMap(runs)) addSteps(findPair(runs, "steps", document)?.value);

  return references;
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

  const manifests = [];
  for (const name of ["action.yml", "action.yaml"]) {
    const path = join(actionDirectory, name);
    let stats;
    try {
      stats = lstatSync(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stats.isFile()) {
      throw new Error(`${relative(ROOT, path)} is not a regular file`);
    }

    const expectedRealPath = resolve(REAL_ROOT, relative(ROOT, path));
    if (realpathSync(path) !== expectedRealPath) {
      throw new Error(`${relative(ROOT, path)} resolves through a symlink`);
    }
    manifests.push(path);
  }
  return manifests;
}

const missingPolicyFiles = REQUIRED_POLICY_FILES.filter(
  (path) => !isRegularFile(join(ROOT, path)),
);
if (missingPolicyFiles.length > 0) {
  console.error("Required action-pin policy workflows are missing:");
  for (const path of missingPolicyFiles) console.error(`- ${path}`);
  process.exit(1);
}

const failures = [];
const files = SCAN_DIRS.flatMap((directory) => [
  ...walkYaml(join(ROOT, directory)),
]).sort();
const queuedFiles = new Set(files);

for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
  const file = files[fileIndex];
  const relativeFile = relative(ROOT, file);
  const source = readFileSync(file, "utf8");
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    uniqueKeys: true,
  });

  const yamlProblems = [...document.errors, ...document.warnings];
  if (yamlProblems.length > 0) {
    for (const error of yamlProblems) {
      failures.push({
        file: relativeFile,
        line:
          Array.isArray(error.pos) && error.pos.length > 0
            ? lineCounter.linePos(error.pos[0]).line
            : 1,
        problem: `invalid YAML (${error.message})`,
      });
    }
    continue;
  }

  try {
    assertPolicyWorkflowStructure(relativeFile, document);
  } catch (error) {
    failures.push({
      file: relativeFile,
      line: 1,
      problem: `invalid action-pin policy workflow (${error instanceof Error ? error.message : String(error)})`,
    });
    continue;
  }

  let references;
  try {
    references = collectUses(document.contents, document);
  } catch (error) {
    failures.push({
      file: relativeFile,
      line: 1,
      problem: `invalid YAML structure (${error instanceof Error ? error.message : String(error)})`,
    });
    continue;
  }

  const referencesPerLine = new Map();
  for (const reference of references) {
    const line = lineNumber(reference.commentNode, lineCounter);
    referencesPerLine.set(line, (referencesPerLine.get(line) ?? 0) + 1);
  }

  for (const reference of references) {
    let resolvedValue;
    try {
      resolvedValue = resolveAliases(reference.valueNode, document);
    } catch (error) {
      failures.push({
        file: relativeFile,
        line: lineNumber(reference.keyNode, lineCounter),
        problem: `invalid YAML alias (${error instanceof Error ? error.message : String(error)})`,
      });
      continue;
    }

    const value =
      isScalar(resolvedValue) && typeof resolvedValue.value === "string"
        ? resolvedValue.value.trim()
        : "";
    const commentLine = lineNumber(reference.commentNode, lineCounter);
    const singleLine =
      lineNumber(reference.keyNode, lineCounter) ===
      lineNumber(reference.valueNode, lineCounter);
    const inlineScalar =
      isScalar(resolvedValue) &&
      resolvedValue.type !== "BLOCK_FOLDED" &&
      resolvedValue.type !== "BLOCK_LITERAL";
    if (!singleLine || !inlineScalar) {
      failures.push({
        file: relativeFile,
        line: lineNumber(reference.keyNode, lineCounter),
        value,
      });
      continue;
    }

    if (isLocalAction(value)) {
      let manifests;
      try {
        manifests = localActionManifestPaths(file, value);
      } catch (error) {
        failures.push({
          file: relativeFile,
          line: lineNumber(reference.keyNode, lineCounter),
          problem: `unsafe local action manifest (${error instanceof Error ? error.message : String(error)})`,
        });
        continue;
      }

      for (const manifest of manifests) {
        if (!queuedFiles.has(manifest)) {
          queuedFiles.add(manifest);
          files.push(manifest);
        }
      }
      continue;
    }

    if (
      isPinnedExternalAction(value) &&
      referencesPerLine.get(commentLine) === 1 &&
      hasReleaseTagComment(reference.commentNode, source)
    ) {
      continue;
    }

    failures.push({
      file: relativeFile,
      line: lineNumber(reference.keyNode, lineCounter),
      value,
    });
  }
}

if (failures.length > 0) {
  console.error("Unpinned or undocumented GitHub Actions references found:");
  for (const failure of failures) {
    const detail = failure.problem ?? `uses: ${failure.value}`;
    console.error(`- ${failure.file}:${failure.line} ${detail}`);
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
