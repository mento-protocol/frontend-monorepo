#!/usr/bin/env node
// check-shell-size.mjs - enforce the shell size limits in AGENTS.md.
//
// Every tracked *.sh file may hold at most MAX_FILE_LINES lines, and every
// function in it at most MAX_FUNCTION_LINES lines. Function boundaries come
// from the shfmt parser (mvdan-sh), so they follow bash grammar: here
// documents, multiline strings, `function` keywords and names such as
// `module::name` are all read the way bash reads them. A file the parser
// rejects fails the check rather than passing unmeasured.
//
// shell-size-baseline.txt, beside this file, exempts what predates the
// limits. It holds two kinds of row:
// - a file row, `<path> <count>`, allows that file <count> lines;
// - a function row, `<path> <function> <count>`, allows the longest
//   declaration of that function in that file <count> lines.
// Blank rows and rows that start with # are skipped. A file row exempts the
// length of the file only: its functions are checked like any other. A
// second declaration of an exempt name is checked like any other function.
// A row is keyed by path, and a function row also by name, so a renamed or
// moved function is a new function.
//
// A row is an upper bound, not an exact count. The subject may sit at or
// below its row: below it the run prints one advisory line and still passes,
// so two changes that each shrink one baselined subject merge without
// leaving the default branch red. Above it the run fails.
//
// When SHELL_SIZE_BASE names a git ref (CI sets it to the pull request's
// base branch), the baseline is compared with that ref as well, so it can
// only ratchet down. A row the base's baseline lacks is refused, a count
// above the base's is refused, and the baseline file may not be removed.
// Removing a row is always allowed. When the base holds no baseline file at
// all, every row is accepted as new, which is what an adoption pull request
// needs.
//
// This file is maintained in github.com/mento-protocol/agents at
// scripts/check-shell-size.mjs. Copies in other repositories stay
// byte-identical: change it there first, then copy it.
//
// mvdan-sh is pinned to the exact version 0.10.1 on purpose. Upstream
// deprecated it (https://github.com/mvdan/sh/issues/1145), and it is still
// the only npm binding of the shfmt parser that exposes syntax.Walk and
// syntax.NodeType. Its successor sh-syntax returns an AST without node types
// or function names, so it cannot measure functions.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sh from "mvdan-sh";

// Bracket access on purpose, so every copy of this file reads these names
// the same way. A consumer repository lints every .mjs with
// turbo/no-undeclared-env-vars, which reports both the dot and the bracket
// form; neither form silences it, and there the rule only warns.
const MAX_FILE_LINES = Number(process.env["MAX_FILE_LINES"] ?? 500);
const MAX_FUNCTION_LINES = Number(process.env["MAX_FUNCTION_LINES"] ?? 50);
const BASE_REF = process.env["SHELL_SIZE_BASE"] ?? "";

const BASELINE_NAME = "shell-size-baseline.txt";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(HERE, BASELINE_NAME);
// The repository root, so the checker works at any depth below it, or "" when
// git answers nothing: outside a checkout, or with GIT_DIR pointing elsewhere.
// main() reports that as a problem of its own, so the run never dies with a
// stack trace.
function repositoryRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: HERE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
const ROOT = repositoryRoot();
const BASELINE_REL = relative(ROOT, BASELINE).split(sep).join("/");

const problems = [];
const problem = (message) => problems.push(message);
// An advisory passes the run. It says a row allows more than the subject
// needs, which the next change to that subject can lower.
const advise = (message) => console.log(message);

// What to do with a row whose subject is now shorter than the row allows.
// Below the ordinary limit the row can no longer be lowered, because a count
// at or below the limit is refused, so the row goes away instead.
function lowerOrRemove(actual, allowed, limit) {
  if (actual <= limit)
    return `its baseline allows ${allowed}; it fits the ${limit}-line limit now, so remove the entry`;
  return `its baseline allows ${allowed}; lower the entry to ${actual}`;
}

// The tree listing of a large repository passes Node's 1 MiB default, so this
// raises the ceiling rather than letting git output end the run.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

const git = (args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "ignore"],
  });

// Returns the text of a path at BASE_REF, or null when the ref lacks it.
function atBase(path) {
  try {
    return git(["show", `${BASE_REF}:${path}`]);
  } catch {
    return null;
  }
}

function trackedShellFiles() {
  const out = git(["ls-files", "-z", "--", "*.sh"]);
  return out.split("\0").filter(Boolean);
}

// Counts physical lines, including a final line with no trailing newline.
function countLines(text) {
  if (text === "") return 0;
  const parts = text.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts.length;
}

// Splits a baseline row into fields, or returns null for a blank row or a
// comment row.
function fieldsOf(raw) {
  const row = raw.trim();
  if (row === "" || row.startsWith("#")) return null;
  return row.split(/\s+/);
}

// Reads the fields of a row. A file row has two fields and an empty name; a
// function row has three. Any other field count returns null. The count is
// still text here; validateRow checks it.
function rowOf(fields) {
  const [path, second, third] = fields;
  if (fields.length === 2) return { path, name: "", key: path, count: second };
  if (fields.length === 3)
    return { path, name: second, key: `${path} ${second}`, count: third };
  return null;
}

// Returns the count a valid row allows, or null after reporting why the row
// is refused.
function validateRow(row, tracked) {
  const limit = row.name === "" ? MAX_FILE_LINES : MAX_FUNCTION_LINES;
  if (!tracked.includes(row.path)) {
    problem(
      `${BASELINE_REL} names ${row.path}, which is not tracked; remove the entry`,
    );
    return null;
  }
  if (!/^[0-9]+$/.test(row.count ?? "")) {
    problem(`${BASELINE_REL}: ${row.key} needs a numeric line count`);
    return null;
  }
  const count = Number(row.count);
  if (count <= limit) {
    problem(
      `${BASELINE_REL}: ${row.key} fits the ${limit}-line limit; remove the entry`,
    );
    return null;
  }
  return count;
}

// Files the baseline may exempt by length, functions it may exempt by name,
// and every row by key for the ratchet.
function emptyBaseline() {
  return { files: new Map(), functions: new Map(), rows: new Map() };
}

function storeRow(baseline, row, count) {
  if (baseline.rows.has(row.key)) {
    problem(`${BASELINE_REL} names ${row.key} twice; keep one entry`);
    return;
  }
  baseline.rows.set(row.key, count);
  if (row.name === "") {
    baseline.files.set(row.path, count);
    return;
  }
  if (!baseline.functions.has(row.path))
    baseline.functions.set(row.path, new Map());
  baseline.functions.get(row.path).set(row.name, count);
}

// Reads the baseline, reporting every row the checker refuses.
function readBaseline(tracked) {
  const baseline = emptyBaseline();
  if (!existsSync(BASELINE)) return baseline;
  const lines = readFileSync(BASELINE, "utf8").split("\n");
  lines.forEach((raw, index) => {
    const fields = fieldsOf(raw);
    if (fields === null) return;
    const row = rowOf(fields);
    if (row === null) {
      problem(
        `${BASELINE_REL}:${index + 1}: a row is "<path> <count>" or "<path> <function> <count>"`,
      );
      return;
    }
    const count = validateRow(row, tracked);
    if (count !== null) storeRow(baseline, row, count);
  });
  return baseline;
}

// The rows of a baseline text as a map of key to count. It reads the base's
// copy, which this change cannot fix, so a row this checker would refuse is
// skipped instead of reported.
function parseRows(text) {
  const rows = new Map();
  for (const raw of text.split("\n")) {
    const fields = fieldsOf(raw);
    if (fields === null) continue;
    const row = rowOf(fields);
    if (row !== null && /^[0-9]+$/.test(row.count))
      rows.set(row.key, Number(row.count));
  }
  return rows;
}

// Returns a map of function name to every declaration of it, each as
// {start, length}, or null after reporting a parse failure. A nested
// declaration is reported by the parser on its own and inside its parent, so
// both lengths are measured.
function parseFunctions(file, text) {
  const { syntax } = sh;
  let tree;
  try {
    tree = syntax.NewParser().Parse(text, file);
  } catch (error) {
    // The parser throws a Go error object; Error() carries its message.
    const reason =
      typeof error?.Error === "function"
        ? error.Error()
        : (error?.message ?? String(error));
    problem(`${file}: cannot parse: ${reason}`);
    return null;
  }
  const functions = new Map();
  syntax.Walk(tree, (node) => {
    if (node && syntax.NodeType(node) === "FuncDecl") {
      const start = node.Pos().Line();
      const length = node.End().Line() - start + 1;
      const name = node.Name.Value;
      if (!functions.has(name)) functions.set(name, []);
      functions.get(name).push({ start, length });
    }
    return true;
  });
  return functions;
}

// A function row covers the longest declaration of the name. Every other
// declaration is held to MAX_FUNCTION_LINES.
function checkDeclarations(file, name, declarations, allowed) {
  const sorted = [...declarations].sort((a, b) => b.length - a.length);
  const rest = allowed === undefined ? sorted : sorted.slice(1);
  if (allowed !== undefined) {
    const { start, length } = sorted[0];
    if (length > allowed) {
      problem(
        `${file}:${start}: function ${name} is ${length} lines, grew past its baseline of ${allowed}; split it instead of growing it`,
      );
    } else if (length < allowed) {
      advise(
        `${file}: function ${name} is ${length} lines, ${lowerOrRemove(length, allowed, MAX_FUNCTION_LINES)}`,
      );
    }
  }
  for (const { start, length } of rest) {
    if (length > MAX_FUNCTION_LINES)
      problem(
        `${file}:${start}: function ${name} is ${length} lines, the limit is ${MAX_FUNCTION_LINES}`,
      );
  }
}

// Reports every function over its allowance, and every function row that
// names a function the file does not declare.
function checkFunctions(file, text, rows) {
  const functions = parseFunctions(file, text);
  if (!functions) return;
  for (const [name, declarations] of functions)
    checkDeclarations(file, name, declarations, rows.get(name));
  for (const name of rows.keys()) {
    if (!functions.has(name))
      problem(
        `${BASELINE_REL}: ${file} declares no function ${name}; remove the entry`,
      );
  }
}

function checkLength(file, lines, allowed) {
  if (allowed === undefined) {
    if (lines > MAX_FILE_LINES)
      problem(
        `${file}: ${lines} lines, the limit is ${MAX_FILE_LINES}; split it by topic`,
      );
    return;
  }
  if (lines > allowed) {
    problem(
      `${file}: ${lines} lines, grew past its baseline of ${allowed}; split it instead of growing it`,
    );
  } else if (lines < allowed) {
    advise(
      `${file}: ${lines} lines, ${lowerOrRemove(lines, allowed, MAX_FILE_LINES)}`,
    );
  }
}

function checkFile(file, baseline) {
  let text;
  try {
    text = readFileSync(join(ROOT, file), "utf8");
  } catch (error) {
    // A tracked path the working tree lacks, or one this user cannot read.
    problem(`${file}: cannot read: ${error?.code ?? String(error)}`);
    return;
  }
  checkLength(file, countLines(text), baseline.files.get(file));
  checkFunctions(file, text, baseline.functions.get(file) ?? new Map());
}

// Confirms BASE_REF resolves, and reports whether comparison is possible.
function checkBaseRef() {
  if (BASE_REF === "") {
    console.log(
      "check-shell-size: SHELL_SIZE_BASE unset; not compared with a base ref",
    );
    return false;
  }
  try {
    git(["rev-parse", "--verify", "--quiet", `${BASE_REF}^{commit}`]);
    return true;
  } catch {
    problem(`SHELL_SIZE_BASE=${BASE_REF} does not resolve to a commit`);
    return false;
  }
}

// The base's baseline as {text}, or {missing: true} when the base holds no
// baseline file anywhere, or null after reporting a problem. The checker and
// its baseline may have moved, so a base that lacks BASELINE_REL is searched
// by file name.
function baseBaseline() {
  const here = atBase(BASELINE_REL);
  if (here !== null) return { text: here };
  // -z, so a path holding a non-ASCII or unusual byte arrives raw. Without it
  // git quotes such a path, the name no longer matches, and the run would
  // treat a base that has a baseline as one that has none.
  const paths = git(["ls-tree", "-r", "--name-only", "-z", BASE_REF])
    .split("\0")
    .filter((path) => path.split("/").pop() === BASELINE_NAME);
  if (paths.length > 1) {
    problem(
      `${BASE_REF} holds more than one ${BASELINE_NAME} (${paths.join(" ")}); keep one`,
    );
    return null;
  }
  if (paths.length === 0) return { missing: true };
  return { text: atBase(paths[0]) ?? "" };
}

// Refuses removal of the baseline file once the base has one, any row the
// base's baseline lacks, and any count above the base's.
function checkRatchet(rows) {
  const base = baseBaseline();
  if (base === null) return;
  if (base.missing) {
    console.log(
      `check-shell-size: ${BASE_REF} has no ${BASELINE_NAME}; entries accepted as new`,
    );
    return;
  }
  if (!existsSync(BASELINE)) {
    problem(`${BASELINE_REL} was removed; keep the file, even with no entries`);
    return;
  }
  const before = parseRows(base.text);
  for (const [key, count] of rows) {
    const was = before.get(key);
    if (was === undefined) {
      problem(
        `${BASELINE_REL}: ${key} is not listed in ${BASE_REF}; a removed entry may not return`,
      );
    } else if (count > was) {
      problem(
        `${BASELINE_REL}: ${key} allows ${count} here and ${was} in ${BASE_REF}; an entry may only go down; merge or rebase on ${BASE_REF} if you did not raise it`,
      );
    }
  }
}

// The baseline format separates its fields with whitespace, so it cannot
// name a path that holds any.
function checkPaths(tracked) {
  for (const file of tracked) {
    if (/\s/.test(file))
      problem(
        `${file} holds whitespace; the baseline format cannot name it; rename the file`,
      );
  }
}

function report() {
  if (problems.length === 0) {
    console.log("check-shell-size: ok");
    return;
  }
  for (const message of problems) console.error(message);
  console.error(
    `check-shell-size: ${problems.length} problem(s); see the shell rules in AGENTS.md`,
  );
  process.exit(1);
}

function main() {
  if (ROOT === "") {
    problem(
      `${HERE} is not inside a git repository; run the checker from a checkout`,
    );
    report();
    return;
  }
  // The ".." segment, not the two characters: a directory may be named
  // "..tools", and the checker works at any depth below the root.
  if (BASELINE_REL === ".." || BASELINE_REL.startsWith("../")) {
    problem(
      `${BASELINE} is outside the repository at ${ROOT}; keep ${BASELINE_NAME} beside the checker`,
    );
    report();
    return;
  }
  const tracked = trackedShellFiles();
  checkPaths(tracked);
  const baseline = readBaseline(tracked);
  if (checkBaseRef()) checkRatchet(baseline.rows);
  for (const file of tracked) checkFile(file, baseline);
  report();
}

main();
