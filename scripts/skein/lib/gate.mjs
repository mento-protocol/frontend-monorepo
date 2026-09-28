#!/usr/bin/env node
// The merge gate for one task. One gate, three callers: the worker before it claims done,
// the coordinator before it merges, and CI. Vendored into the repo (scripts/skein/) and
// coordinator-owned there, so a worker can never weaken the gate it is judged by.
// Dependency-free on purpose: runs on whatever `node` is on PATH, before install.
//
// usage: skein gate <task-id> [--base <ref>] [--only <check>[,<check>]] [--timeout-min <n>]
//        skein gate --from-branch
//        skein gate --standard-only         # no task: just the config's standard commands (CI on the base branch)
//
// Checks, in order: brief, clean-tree, boundary, secrets, test-integrity, invariants,
// standard, e2e, accept. The last three run the commands in .skein/config.json and the
// task's own `accept` list. Everything project-specific comes from that config:
//   standard        commands that must pass on every task (typecheck, lint, test)
//   e2e             optional heavier suite (production build + smoke)
//   invariants      [{name, pattern, except:[files], message}]  added lines matching
//                   `pattern` outside `except` fail: the repo's own "never do this" rules
//   monotonic       [{file, pattern}]  the count of `pattern` in `file` may never fall
//                   (shared regression suites only grow)
//   secretPatterns  extra [pattern, label] pairs;  secretAllow: known dev keys to ignore

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CONFIG_PATH = ".skein/config.json";
const ALL_CHECKS = ["brief", "clean-tree", "boundary", "secrets", "test-integrity", "invariants", "standard", "e2e", "accept"];
const VALUE_FLAGS = new Set(["--base", "--only", "--timeout-min"]);

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
let taskId = null, baseRef = null, only = null, timeoutMin = 30, fromBranch = false, standardOnly = false;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--from-branch") fromBranch = true;
  else if (arg === "--standard-only") standardOnly = true;
  else if (VALUE_FLAGS.has(arg)) {
    const value = argv[++i];
    if (value === undefined) die(`${arg} needs a value`);
    if (arg === "--base") baseRef = value;
    if (arg === "--only") only = value.split(",").map((s) => s.trim()).filter(Boolean);
    if (arg === "--timeout-min") timeoutMin = Number(value);
  } else if (arg.startsWith("--")) die(`unknown flag: ${arg}`);
  else if (taskId === null) taskId = arg;
  else die(`unexpected argument: ${arg}`);
}
if (only) {
  const unknown = only.filter((c) => !ALL_CHECKS.includes(c));
  if (unknown.length) die(`unknown check(s): ${unknown.join(", ")}. known: ${ALL_CHECKS.join(", ")}`);
}
if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) die("--timeout-min must be a positive number");

// ---------------------------------------------------------------- helpers
function die(message) { process.stderr.write(`skein gate: ${message}\n`); process.exit(2); }
function sh(command, options = {}) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options });
}
function shQuiet(command) { try { return sh(command); } catch { return null; } }
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { i++; if (glob[i + 1] === "/") { i++; out += "(?:.*/)?"; } else out += ".*"; }
      else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) out += "\\" + c;
    else out += c;
  }
  return new RegExp("^" + out + "$");
}
const results = [];
function record(name, status, notes = []) {
  results.push({ name, status });
  process.stdout.write(`[${status}] ${name}\n`);
  for (const note of notes.slice(0, 40)) process.stdout.write(`       ${note}\n`);
  if (notes.length > 40) process.stdout.write(`       … and ${notes.length - 40} more\n`);
}
const enabled = (name) => (only ? only.includes(name) : true);

// ---------------------------------------------------------------- config, plan, task
const repoRoot = (shQuiet("git rev-parse --show-toplevel") || "").trim();
if (!repoRoot) die("not inside a git repository");
process.chdir(repoRoot);
if (!existsSync(CONFIG_PATH)) die(`${CONFIG_PATH} not found: run 'skein init'`);
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
function runStandardOnly(reason) {
  const cmds = config.standard || [];
  if (!cmds.length) die("no `standard` commands in .skein/config.json");
  if (reason) process.stdout.write(`${reason}\n`);
  let ok = true;
  for (const command of cmds) {
    process.stdout.write(`$ ${command}\n`);
    try { sh(command, { stdio: ["ignore", "inherit", "inherit"], timeout: timeoutMin * 60_000 }); } catch { ok = false; break; }
  }
  process.stdout.write(`\nSKEIN_GATE_RESULT task=- status=${ok ? "PASS" : "FAIL"} checks=standard:${ok ? "PASS" : "FAIL"}\n`);
  process.exit(ok ? 0 : 1);
}
if (standardOnly) runStandardOnly();
const PLAN_PATH = config.plan || "docs/plan/wps.json";
if (!existsSync(PLAN_PATH)) die(`${PLAN_PATH} not found`);
const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));

if (fromBranch) {
  // On a pull_request run actions/checkout leaves a detached HEAD, so the branch name is in
  // GITHUB_HEAD_REF; locally it is the checked-out branch.
  const branch = (process.env.GITHUB_HEAD_REF || process.env.SKEIN_BRANCH || shQuiet("git rev-parse --abbrev-ref HEAD") || "").trim();
  const candidate = (branch.split("/").pop() || "").toLowerCase();
  const match = plan.tasks
    .filter((t) => { const id = t.id.toLowerCase(); return candidate === id || candidate.startsWith(id + "-") || candidate.endsWith("-" + id); })
    .sort((a, b) => b.id.length - a.id.length)[0];
  // A branch that names no task (a coordinator's docs or ADR PR) gets the standard checks.
  if (!match) runStandardOnly(`branch "${branch}" names no task in ${PLAN_PATH}: running the standard commands only`);
  taskId = match.id;
  process.stdout.write(`task from branch "${branch}": ${taskId}\n`);
}
if (!taskId) die("no task id. usage: skein gate <task-id> | --from-branch");
const task = plan.tasks.find((t) => t.id.toLowerCase() === taskId.toLowerCase());
if (!task) die(`task "${taskId}" not found in ${PLAN_PATH}`);
taskId = task.id;
if (!baseRef) baseRef = shQuiet("git rev-parse --verify --quiet origin/main") ? "origin/main" : "main";
process.stdout.write(`skein gate ${taskId} (base ${baseRef})\n`);

// ---------------------------------------------------------------- diff
let changedCache = null, addedCache = null;
function changedFiles() {
  if (changedCache) return changedCache;
  const out = shQuiet(`git diff --name-only ${baseRef}...HEAD`);
  if (out === null) die(`cannot diff against ${baseRef}: fetch it first (git fetch origin)`);
  return (changedCache = out.split("\n").map((s) => s.trim()).filter(Boolean));
}
function addedLines() {  // added lines only: a rule about what you wrote
  if (addedCache) return addedCache;
  const out = shQuiet(`git diff -U0 ${baseRef}...HEAD`) || "";
  const lines = []; let file = null;
  for (const raw of out.split("\n")) {
    if (raw.startsWith("+++ b/")) file = raw.slice(6);
    else if (raw.startsWith("+") && !raw.startsWith("+++")) lines.push({ file, text: raw.slice(1) });
  }
  return (addedCache = lines);
}
const isComment = (text) => /^\s*(?:\/\/|\*|\/\*|#)/.test(text);

// ---------------------------------------------------------------- checks
function checkBrief() {
  const briefsDir = config.briefs || "docs/plan/briefs";
  if (!task.brief) return record("brief", "FAIL", [`${taskId} has "brief": null in ${PLAN_PATH}: it is not dispatchable.`, `Write ${briefsDir}/${taskId}.md, then set the path here.`]);
  if (!existsSync(task.brief)) return record("brief", "FAIL", [`brief not found: ${task.brief}`]);
  record("brief", "PASS", [task.brief]);
}
function checkCleanTree() {
  const status = (shQuiet("git status --porcelain") || "").trim();
  if (status) return record("clean-tree", "FAIL", ["uncommitted changes:", ...status.split("\n").slice(0, 20)]);
  record("clean-tree", "PASS");
}
function checkBoundary() {
  const owned = (task.owned || []).map(globToRegExp);
  const allowed = (plan.alwaysAllowed || []).map(globToRegExp);
  const coordinator = (plan.coordinatorOwned || []).map(globToRegExp);
  const isCoordinatorTask = task.coordinator === true;
  const bad = [];
  for (const file of changedFiles()) {
    if (!isCoordinatorTask && coordinator.some((re) => re.test(file))) { bad.push(`${file}: coordinator-owned`); continue; }
    if (owned.some((re) => re.test(file)) || allowed.some((re) => re.test(file))) continue;
    bad.push(`${file}: outside this task's owned globs`);
  }
  if (bad.length) return record("boundary", "FAIL", [...bad, "", `owned: ${JSON.stringify(task.owned || [])}`]);
  record("boundary", "PASS", [`${changedFiles().length} changed file(s), all owned`]);
}

const SECRET_PATTERNS = [
  [/\bsk_(?:live|test)_[A-Za-z0-9]{16,}/, "Stripe or Clerk secret key"],
  [/\brk_(?:live|test)_[A-Za-z0-9]{16,}/, "Stripe restricted key"],
  [/\bpk_live_[A-Za-z0-9]{16,}/, "Stripe live publishable key"],
  [/\bwhsec_[A-Za-z0-9]{16,}/, "Stripe webhook signing secret"],
  [/\bre_[A-Za-z0-9_-]{24,}/, "Resend API key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsk-proj-[A-Za-z0-9_-]{20,}/, "OpenAI API key"],
  [/\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}/, "Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  ...((config.secretPatterns || []).map(([p, l]) => [new RegExp(p), l])),
];
// Anvil / Hardhat published dev accounts are fine in scripts and tests.
const KEY_ALLOW = new Set([
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  ...((config.secretAllow || []).map((s) => s.toLowerCase().replace(/^0x/, ""))),
]);
const PRIVATE_KEY_HEX = /\b(?:0x)?([0-9a-fA-F]{64})\b/;
const PRIVATE_KEY_NAME = /private[_-]?key|signer|secret|mnemonic/i;
const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.local$/, /(^|\/)\.env\.production(\.local)?$/, /(^|\/)id_(?:rsa|ed25519)$/];

function checkSecrets() {
  const bad = [];
  for (const file of changedFiles()) if (FORBIDDEN_FILES.some((re) => re.test(file))) bad.push(`${file}: never commit this file`);
  for (const { file, text } of addedLines()) {
    let hit = null;
    for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) { hit = what; break; }
    if (!hit && PRIVATE_KEY_NAME.test(text)) {
      const m = PRIVATE_KEY_HEX.exec(text);
      if (m && !KEY_ALLOW.has(m[1].toLowerCase())) hit = "32-byte private key";
    }
    if (hit) bad.push(`${file}: looks like a committed ${hit}`);
  }
  if (bad.length) return record("secrets", "FAIL", [...new Set(bad), "", "Rotate anything real that reached a commit, then remove it from history."]);
  record("secrets", "PASS");
}

const WEAKENERS = [
  [/(?:^|[^A-Za-z0-9_.])(?:it|test|describe)\s*\.\s*(?:only|skip|todo)\s*\(/, "focused or skipped test"],
  [/(?:^|[^A-Za-z0-9_.])(?:xit|xdescribe|fit|fdescribe)\s*\(/, "focused or skipped test"],
  [/@ts-nocheck/, "@ts-nocheck disables the typecheck for a whole file"],
  [/@ts-ignore/, "@ts-ignore: use @ts-expect-error, which fails when the error goes away"],
  [/eslint-disable(?!-next-line)/, "file-wide eslint-disable"],
  [/#\[ignore\]|@pytest\.mark\.skip\b|\bunittest\.skip\b/, "skipped test"],
];
function checkTestIntegrity() {
  const bad = [];
  for (const { file, text } of addedLines()) for (const [re, what] of WEAKENERS) if (re.test(text)) { bad.push(`${file}: ${what}: ${text.trim().slice(0, 100)}`); break; }
  for (const { file, pattern } of config.monotonic || []) {
    if (!changedFiles().includes(file)) continue;
    const re = new RegExp(pattern, "g");
    const before = ((shQuiet(`git show ${baseRef}:${file}`) || "").match(re) || []).length;
    const after = (existsSync(file) ? readFileSync(file, "utf8") : "").match(re)?.length ?? 0;
    if (after < before) bad.push(`${file}: count of /${pattern}/ fell from ${before} to ${after}: shared suites only grow`);
  }
  if (bad.length) return record("test-integrity", "FAIL", [...bad, "", "AGENTS.md: never weaken a test to get green."]);
  record("test-integrity", "PASS");
}

function checkInvariants() {
  const rules = config.invariants || [];
  if (!rules.length) return record("invariants", "PASS", ["none configured"]);
  const bad = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern);
    const except = (rule.except || []).map(globToRegExp);
    for (const { file, text } of addedLines()) {
      if (except.some((x) => x.test(file)) || isComment(text)) continue;
      if (re.test(text)) bad.push(`${rule.name}: ${file}: ${text.trim().slice(0, 100)}${rule.message ? `\n         ${rule.message}` : ""}`);
    }
  }
  if (bad.length) return record("invariants", "FAIL", bad);
  record("invariants", "PASS", [`${rules.length} rule(s)`]);
}

function run(name, commands) {
  const notes = []; let failed = false;
  for (const command of commands) {
    process.stdout.write(`       $ ${command}\n`);
    try { sh(command, { stdio: ["ignore", "inherit", "inherit"], timeout: timeoutMin * 60_000 }); notes.push(`ok: ${command}`); }
    catch (error) { failed = true; notes.push(`failed (${error.status ?? error.code ?? "error"}): ${command}`); break; }
  }
  record(name, failed ? "FAIL" : "PASS", notes);
}
function checkStandard() {
  const cmds = config.standard || [];
  if (!cmds.length) return record("standard", "FAIL", ["no `standard` commands in .skein/config.json: until the gate can run a real test suite, nothing is verifiable"]);
  run("standard", cmds);
}
function checkE2E() {
  const cmds = config.e2e || [];
  if (!cmds.length) return record("e2e", "PASS", ["none configured"]);
  run("e2e", cmds);
}
function checkAccept() {
  const cmds = task.accept || [];
  if (!cmds.length) return record("accept", "FAIL", [`${taskId} has no accept commands in ${PLAN_PATH}`]);
  run("accept", cmds);
}

// ---------------------------------------------------------------- main
if (enabled("brief")) checkBrief();
if (enabled("clean-tree")) checkCleanTree();
if (enabled("boundary")) checkBoundary();
if (enabled("secrets")) checkSecrets();
if (enabled("test-integrity")) checkTestIntegrity();
if (enabled("invariants")) checkInvariants();
const anyFailed = () => results.some((r) => r.status === "FAIL");
if (enabled("standard")) { if (anyFailed() && !only) record("standard", "SKIP", ["static checks failed; fix those first"]); else checkStandard(); }
if (enabled("e2e"))      { if (anyFailed() && !only) record("e2e", "SKIP", ["earlier checks failed"]); else checkE2E(); }
if (enabled("accept"))   { if (anyFailed() && !only) record("accept", "SKIP", ["earlier checks failed"]); else checkAccept(); }
const failed = anyFailed();
process.stdout.write(`\nSKEIN_GATE_RESULT task=${taskId} base=${baseRef} status=${failed ? "FAIL" : "PASS"} checks=${results.map((r) => `${r.name}:${r.status}`).join(",")}\n`);
process.exit(failed ? 1 : 0);
