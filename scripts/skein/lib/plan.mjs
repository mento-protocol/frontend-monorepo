#!/usr/bin/env node
// The task DAG, read-only. Prints each task's readiness and the ownership overlaps that
// decide what can run together. Also validates a brief against its task.
//
//   node plan.mjs                      the plan view
//   node plan.mjs --json               same, as JSON
//   node plan.mjs --check <TASK-ID>    validate the brief; exit 1 with reasons if not
//   node plan.mjs --dispatchable       ids that could be dispatched now, one per line
//
// "merged" means the plan says done: true (skein merge sets it) or origin/main carries the
// task's squash-merged PR, whose subject ends with "(<ID>)" per the naming convention.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const checkId = argv.includes("--check") ? argv[argv.indexOf("--check") + 1] : null;
const listDispatchable = argv.includes("--dispatchable");

function sh(c) { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } }
const root = sh("git rev-parse --show-toplevel").trim(); if (root) process.chdir(root);
const config = existsSync(".skein/config.json") ? JSON.parse(readFileSync(".skein/config.json", "utf8")) : {};
const PLAN_PATH = config.plan || "docs/plan/wps.json";
const BRIEFS = config.briefs || "docs/plan/briefs";
if (!existsSync(PLAN_PATH)) { console.error(`skein plan: ${PLAN_PATH} not found`); process.exit(2); }
const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8"));

function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") { if (glob[i + 1] === "*") { i++; if (glob[i + 1] === "/") { i++; out += "(?:.*/)?"; } else out += ".*"; } else out += "[^/]*"; }
    else if (c === "?") out += "[^/]"; else if (".+^${}()|[]\\".includes(c)) out += "\\" + c; else out += c;
  }
  return new RegExp("^" + out + "$");
}
// Two globs overlap when one's literal prefix contains the other's. Conservative on
// purpose: a false overlap costs one serialized merge round, a missed one costs a conflict.
function overlaps(a, b) {
  const wild = (g) => /[*?]/.test(g);
  if (!wild(a) && !wild(b)) return a === b;
  const pa = a.split(/[*?]/)[0], pb = b.split(/[*?]/)[0];
  return pa.startsWith(pb) || pb.startsWith(pa);
}

sh("git fetch -q origin");
const mainSubjects = sh("git log --format=%s origin/main -n 1000").split("\n");
// A task is merged when the plan says done: true (skein merge sets it), or when a commit
// subject on origin/main is its squash-merged PR: "<type>(<scope>): <summary> (<ID>) (#<n>)".
function merged(t) {
  if (t.done === true) return true;
  const re = new RegExp(`\\(${t.id}\\)(?: \\(#\\d+\\))?\\s*$`, "i");
  return mainSubjects.some((s) => re.test(s));
}
const rows = plan.tasks.map((t) => {
  const isMerged = merged(t);
  const depsMet = (t.deps || []).every((d) => { const x = plan.tasks.find((y) => y.id === d); return x ? merged(x) : false; });
  const hasBrief = !!t.brief && existsSync(t.brief);
  const status = isMerged ? "merged" : !hasBrief ? "no brief" : !depsMet ? "waiting on deps" : "ready";
  return { id: t.id, title: t.title, status, deps: t.deps || [], owned: t.owned || [], money: !!t.money, pii: !!t.pii, brief: t.brief || null };
});
const ready = rows.filter((r) => r.status === "ready");
const conflicts = [];
for (let i = 0; i < ready.length; i++) for (let j = i + 1; j < ready.length; j++) {
  const shared = ready[i].owned.filter((a) => ready[j].owned.some((b) => overlaps(a, b)));
  if (shared.length) conflicts.push({ a: ready[i].id, b: ready[j].id, shared });
}

if (checkId) {
  const t = plan.tasks.find((x) => x.id.toLowerCase() === checkId.toLowerCase());
  const problems = [];
  if (!t) problems.push(`task ${checkId} not in ${PLAN_PATH}`);
  else {
    const briefPath = t.brief || `${BRIEFS}/${t.id}.md`;
    if (!existsSync(briefPath)) problems.push(`brief missing: ${briefPath}`);
    else {
      const text = readFileSync(briefPath, "utf8");
      if (!t.brief) problems.push(`brief exists but ${PLAN_PATH} still has "brief": null`);
      if (!/^#\s+.*\b/m.test(text)) problems.push("brief has no title");
      for (const h of ["Objective", "Read first", "You own", "Work", "Acceptance"]) if (!new RegExp(`^##\\s+${h}`, "im").test(text)) problems.push(`brief lacks a "## ${h}" section`);
      const ownSection = (text.split(/^##\s+You own/im)[1] || "").split(/^##\s+/m)[0];
      for (const g of t.owned || []) if (!ownSection.includes(g)) problems.push(`owned glob not listed under "You own": ${g}`);
      if (!(t.accept || []).length) problems.push("task has no accept commands");
      if (!(t.owned || []).length) problems.push("task has no owned globs");
      if (!text.includes(t.id)) problems.push("brief never mentions the task id");
    }
  }
  if (problems.length) { console.error(`skein brief --check ${checkId}: NOT READY\n  ${problems.join("\n  ")}`); process.exit(1); }
  console.log(`skein brief --check ${checkId}: ok (${t.brief})`); process.exit(0);
}
if (listDispatchable) { for (const r of ready) console.log(r.id); process.exit(0); }
if (json) { console.log(JSON.stringify({ tasks: rows, conflicts }, null, 2)); process.exit(0); }

const w = Math.max(...rows.map((r) => r.id.length), 4);
console.log(`plan: ${PLAN_PATH}  (${rows.length} tasks, ${ready.length} ready, ${rows.filter((r) => r.status === "merged").length} merged)\n`);
for (const r of rows) {
  const flags = [r.money && "money", r.pii && "pii"].filter(Boolean).join(",");
  console.log(`${r.id.padEnd(w)}  ${r.status.padEnd(15)}  ${r.title}${flags ? `  [${flags}]` : ""}${r.deps.length ? `  deps=${r.deps.join(",")}` : ""}`);
}
if (conflicts.length) {
  console.log("\nownership overlaps among ready tasks (do not run these together):");
  for (const c of conflicts) console.log(`  ${c.a} × ${c.b}: ${c.shared.join(", ")}`);
} else if (ready.length > 1) console.log("\nno ownership overlaps among ready tasks: they can run together.");
