#!/usr/bin/env node
/**
 * Compare the resolved dependency edges of two copies of a pnpm v9 lockfile.
 *
 * A regenerated lockfile can re-resolve packages that a pull request never
 * meant to change: under a broad override such as `preact: >=10.28.2`, one
 * snapshot moved to a new major while the resolved package set still looked
 * plausible (#1042, #1038). This lists every edge that differs:
 *
 *   importer:<path> -> <dependency>@<version>   (direct workspace dependency)
 *   <package>@<version> -> <dependency>@<version> (snapshot dependency)
 *
 * Peer suffixes such as `(react@19.2.0)` are dropped, so a package resolved
 * under several peer sets counts once. Lines start with `-` (base only) or `+`
 * (head only). Empty output means no edge changed.
 *
 * Usage:
 *   pnpm lockfile:edge-diff [--base <git ref>] [--head <git ref>] [--lockfile <path>]
 *
 * Defaults: base `origin/main`, head the working tree, lockfile
 * `pnpm-lock.yaml`. For the Vercel CLI runtime, pass
 * `--lockfile scripts/vercel-cli-runtime/pnpm-lock.yaml`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

function unquote(value) {
  return value.replace(/^'(.*)'$/u, "$1");
}

function withoutPeerSuffix(value) {
  return value.replace(/\(.*$/u, "");
}

/**
 * @param {string} text pnpm v9 lockfile contents
 * @returns {Set<string>} importer and snapshot edges
 */
export function lockfileEdges(text) {
  const edges = new Set();
  let section = null;
  let owner = null;
  let importerDependency = null;
  for (const line of text.split("\n")) {
    if (/^\S/u.test(line)) {
      section = line.replace(/:.*$/u, "");
      owner = null;
      importerDependency = null;
      continue;
    }
    if (section === "importers") {
      const importer = /^ {2}(\S.*):$/u.exec(line);
      if (importer) {
        owner = `importer:${unquote(importer[1])}`;
        continue;
      }
      const dependency = /^ {6}(\S.*):$/u.exec(line);
      if (dependency) {
        importerDependency = unquote(dependency[1]);
        continue;
      }
      const version = /^ {8}version: (.+)$/u.exec(line);
      if (owner && importerDependency && version) {
        edges.add(
          `${owner} -> ${importerDependency}@${withoutPeerSuffix(unquote(version[1]))}`,
        );
      }
    } else if (section === "snapshots") {
      const snapshot = /^ {2}(\S.*?):(?: \{\})?$/u.exec(line);
      if (snapshot) {
        owner = withoutPeerSuffix(unquote(snapshot[1]));
        continue;
      }
      const dependency = /^ {6}('[^']+'|[^\s'-]\S*): (.+)$/u.exec(line);
      if (owner && dependency) {
        edges.add(
          `${owner} -> ${unquote(dependency[1])}@${withoutPeerSuffix(unquote(dependency[2]))}`,
        );
      }
    }
  }
  return edges;
}

/**
 * @param {string} baseText
 * @param {string} headText
 * @returns {string[]} sorted `- edge` and `+ edge` lines
 */
export function diffLockfileEdges(baseText, headText) {
  const base = lockfileEdges(baseText);
  const head = lockfileEdges(headText);
  const removed = [...base].filter((edge) => !head.has(edge)).sort();
  const added = [...head].filter((edge) => !base.has(edge)).sort();
  return [
    ...removed.map((edge) => `- ${edge}`),
    ...added.map((edge) => `+ ${edge}`),
  ];
}

function readAtRef(ref, path) {
  return execFileSync("git", ["show", `${ref}:${path}`], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "origin/main" },
      head: { type: "string" },
      lockfile: { type: "string", default: "pnpm-lock.yaml" },
    },
  });
  const baseText = readAtRef(values.base, values.lockfile);
  const headText =
    values.head === undefined
      ? readFileSync(values.lockfile, "utf8")
      : readAtRef(values.head, values.lockfile);
  for (const line of diffLockfileEdges(baseText, headText)) console.log(line);
}
