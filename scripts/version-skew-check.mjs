#!/usr/bin/env node
/**
 * Dependency version-skew check against the pnpm catalog.
 *
 * Every declared version of a cataloged package must be `catalog:`,
 * `catalog:default`, or exactly the catalog version. This keeps workspace
 * members from silently drifting off the shared catalog with a literal pin.
 *
 * This intentionally checks only the default `catalog:` block. If this
 * workspace adopts pnpm named catalogs via `catalogs:`, extend this checker
 * and its fixtures in the same change.
 *
 * Ported from monitoring-monorepo, hardened for pnpm-workspace.yaml realities:
 * quoted/unquoted version ranges with spaces, `catalog:`/`catalog:default`,
 * inline comments, and `packages:` globs including `*`, `**`, and `!` negation.
 *
 * No external dependencies. Run: pnpm supply-chain:version-skew
 * CI: .github/workflows/supply-chain.yml
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

// Script-local test knob (points tests at a temp dir), not a turbo pipeline input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const ROOT = process.env["SKEW_CHECK_ROOT"] ?? process.cwd();

// Directories never walked when resolving workspace members.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".claude",
  "dist",
  "build",
]);

/** @param {string} message */
function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

/** @param {string} message */
function ok(message) {
  console.log(`ok: ${message}`);
}

/**
 * @param {string} text
 * @param {string} blockName
 * @returns {string[]}
 */
function readTopLevelBlock(text, blockName) {
  const lines = text.split(/\r?\n/);
  // Tolerate an inline comment on the header (e.g. `catalog: # default catalog`),
  // which pnpm accepts — an exact-string match would miss the block entirely.
  const headerRe = new RegExp(`^${blockName}:\\s*(#.*)?$`);
  const start = lines.findIndex((line) => headerRe.test(line));
  if (start === -1) return [];

  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    // A column-0 non-blank line ends the block — EXCEPT a column-0 comment,
    // which is valid YAML inside a sequence/map and must not truncate it.
    if (
      /^\S/.test(line) &&
      line.trim() !== "" &&
      !line.trimStart().startsWith("#")
    ) {
      break;
    }
    block.push(line);
  }
  return block;
}

/**
 * Parse a YAML scalar value (right-hand side of `key:`). Handles double/single
 * quoted values (which may contain spaces, e.g. an OR range
 * `"^18.0.0 || ^19.0.0"`), unquoted plain scalars with spaces, and a trailing
 * whitespace-separated `# comment`. An in-value `#` (a git ref like
 * `github:org/repo#sha`) is preserved because a comment requires preceding
 * whitespace.
 *
 * @param {string} rest
 * @returns {string}
 */
function parseScalarValue(rest) {
  const trimmed = rest.trim();
  if (trimmed === "") return "";
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }
  const comment = trimmed.match(/\s#.*$/);
  return (comment ? trimmed.slice(0, comment.index) : trimmed).trim();
}

/**
 * @param {string[]} blockLines
 * @returns {Map<string, string>}
 */
function parseCatalog(blockLines) {
  const catalog = new Map();

  for (const line of blockLines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    // Accept any (non-zero) indentation — YAML permits 2-space, 4-space, etc.;
    // a fixed 2-space match would silently skip reindented entries.
    const match = line.match(/^ +["']?([^"':\s]+)["']?:\s*(.*)$/);
    if (!match) continue;
    const value = parseScalarValue(match[2]);
    if (value === "") continue;
    catalog.set(match[1], value);
  }

  return catalog;
}

/**
 * Return the inline value after a top-level `key:` header, or null if the key is
 * absent. Yields "" for a bare block header, "{...}" for a flow mapping, or a
 * trailing comment. (`^catalog:` does not match `catalogs:`.)
 *
 * @param {string} text
 * @param {string} key
 * @returns {string | null}
 */
function topLevelHeaderValue(text, key) {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(text);
  return match ? match[1].trim() : null;
}

/**
 * Whether the workspace declares actual named-catalog ENTRIES (block- or
 * flow-style). A bare/empty/comment-only `catalogs:` header has no entries (and
 * no `catalog:<name>` blind spot), so it must NOT trip the fail-closed guard.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasNamedCatalogEntries(text) {
  const header = topLevelHeaderValue(text, "catalogs");
  if (header === null) return false;
  if (header.startsWith("{")) {
    const open = header.indexOf("{");
    const close = header.lastIndexOf("}");
    return (
      open !== -1 && close > open && header.slice(open + 1, close).trim() !== ""
    );
  }
  // Block style: a non-comment, non-blank child line is a real entry.
  return readTopLevelBlock(text, "catalogs").some(
    (line) => line.trim() !== "" && !line.trim().startsWith("#"),
  );
}

/**
 * Parse a flow-style catalog mapping `{ pkg: ver, ... }` into name -> version.
 *
 * @param {string} flow
 * @returns {Map<string, string>}
 */
function parseFlowCatalog(flow) {
  const open = flow.indexOf("{");
  const close = flow.lastIndexOf("}");
  const inner = open !== -1 && close > open ? flow.slice(open + 1, close) : "";
  const catalog = new Map();
  for (const part of splitTopLevelCommas(inner)) {
    const match = /^\s*["']?([^"':\s]+)["']?\s*:\s*(.+)$/.exec(part);
    if (match) catalog.set(match[1], parseScalarValue(match[2]));
  }
  return catalog;
}

/**
 * Split a YAML flow body on top-level commas only — commas inside single or
 * double quotes are preserved (so a quoted value containing a comma is not torn
 * into invalid fragments).
 *
 * @param {string} str
 * @returns {string[]}
 */
function splitTopLevelCommas(str) {
  const parts = [];
  let current = "";
  /** @type {string | null} */ let quote = null;
  for (const ch of str) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * @param {string[]} blockLines
 * @returns {string[]} raw `packages:` patterns (including `!` negations)
 */
function parseWorkspacePatterns(blockLines) {
  return blockLines.flatMap((line) => {
    // Tolerate a trailing inline comment (`- apps/* # frontend apps`).
    const match = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*(?:#.*)?$/);
    return match ? [match[1]] : [];
  });
}

/**
 * Parse a YAML flow sequence (`["apps/*", "packages/*"]`) into its items.
 * Commas inside quotes are preserved.
 *
 * @param {string} flow
 * @returns {string[]}
 */
function parseFlowSequence(flow) {
  const open = flow.indexOf("[");
  const close = flow.lastIndexOf("]");
  const inner = open !== -1 && close > open ? flow.slice(open + 1, close) : "";
  return splitTopLevelCommas(inner)
    .map((part) =>
      part
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim(),
    )
    .filter((part) => part !== "");
}

/**
 * Convert a single path SEGMENT (no `/`) to a regex body: `*` -> `[^/]*`,
 * `{a,b}` -> `(?:a|b)` (options converted recursively), every other
 * regex-special char escaped. Built char-by-char to keep escaping unambiguous.
 *
 * @param {string} segment
 * @returns {string}
 */
function segmentBody(segment) {
  let body = "";
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === "*") {
      body += "[^/]*";
    } else if (ch === "{") {
      const end = segment.indexOf("}", i);
      if (end === -1) {
        body += "\\{";
      } else {
        const options = segment
          .slice(i + 1, end)
          .split(",")
          .map((option) => segmentBody(option.trim()));
        body += `(?:${options.join("|")})`;
        i = end;
      }
    } else if (/[.+^$()|[\]\\]/.test(ch)) {
      body += `\\${ch}`;
    } else {
      body += ch;
    }
  }
  return body;
}

/**
 * Convert a pnpm workspace glob to an anchored RegExp over a POSIX dir path.
 * Split into `/`-segments so a globstar segment matches ZERO or more path
 * segments: a non-trailing globstar becomes an optional dir-prefix group, and a
 * trailing globstar matches the rest. So a globstar-then-`web` pattern matches
 * both `web` and `a/web`; a plain globstar-to-dot-star would instead require a
 * leading directory. A single star matches within a segment; `{a,b}` is brace
 * alternation.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  const segments = glob.split("/");
  let body = "";
  for (let k = 0; k < segments.length; k += 1) {
    const last = k === segments.length - 1;
    if (segments[k] === "**") {
      // Globstar: zero-or-more leading segments (`(?:.*/)?`) when followed by
      // more, or "the rest" (`.*`) when trailing.
      body += last ? ".*" : "(?:.*/)?";
    } else {
      body += segmentBody(segments[k]);
      if (!last) body += "/";
    }
  }
  return new RegExp(`^${body}$`);
}

/**
 * Resolve `packages:` patterns to concrete member directories (relative POSIX
 * paths) by walking the tree for directories that contain a package.json and
 * match an include glob but no `!` exclude glob. Handles `*`, `**`, negation,
 * and literal directory entries uniformly.
 *
 * @param {string[]} patterns
 * @returns {string[]}
 */
function resolveWorkspaceMembers(patterns) {
  /** @type {RegExp[]} */ const includes = [];
  /** @type {RegExp[]} */ const excludes = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) excludes.push(globToRegExp(pattern.slice(1)));
    else includes.push(globToRegExp(pattern));
  }
  if (includes.length === 0) return [];

  /** @type {string[]} */ const members = [];
  /** @param {string} relDir */
  function walk(relDir) {
    let entries;
    try {
      entries = readdirSync(resolve(ROOT, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const rel = relDir === "." ? entry.name : `${relDir}/${entry.name}`;
      const isMember =
        existsSync(join(ROOT, rel, "package.json")) &&
        includes.some((re) => re.test(rel)) &&
        !excludes.some((re) => re.test(rel));
      if (isMember) members.push(rel);
      walk(rel);
    }
  }
  walk(".");
  return members;
}

const workspacePath = resolve(ROOT, "pnpm-workspace.yaml");
const workspaceText = readFileSync(workspacePath, "utf8");

// Fail closed on named catalogs (`catalogs:`), block- OR flow-style. This
// checker validates only the default `catalog:`; named catalogs would otherwise
// silently pass with real drift in `catalog:<name>` consumers. Fail loudly so
// the script is extended rather than relied on with a blind spot.
if (hasNamedCatalogEntries(workspaceText)) {
  fail(
    "pnpm-workspace.yaml defines named `catalogs:`, which this checker does not " +
      "yet validate. Extend scripts/version-skew-check.mjs to parse named " +
      "catalogs and their `catalog:<name>` consumers before relying on the gate.",
  );
  process.exit(1);
}

// Default catalog — block-style (`catalog:\n  pkg: ver`) or flow-style
// (`catalog: { pkg: ver }`). A flow header was previously treated as absent
// (false green); parse it explicitly.
const catalogHeader = topLevelHeaderValue(workspaceText, "catalog");
const catalog =
  catalogHeader && catalogHeader.startsWith("{")
    ? parseFlowCatalog(catalogHeader)
    : parseCatalog(readTopLevelBlock(workspaceText, "catalog"));

if (catalog.size === 0) {
  ok("no catalog entries - nothing to check");
  process.exit(0);
}

// `packages:` may be a block sequence (`- apps/*`) or a flow sequence
// (`["apps/*", "packages/*"]`). A flow header was previously read as an empty
// block (only the root manifest checked); parse it explicitly.
const packagesHeader = topLevelHeaderValue(workspaceText, "packages");
const patterns =
  packagesHeader && packagesHeader.startsWith("[")
    ? parseFlowSequence(packagesHeader)
    : parseWorkspacePatterns(readTopLevelBlock(workspaceText, "packages"));
const memberDirs = resolveWorkspaceMembers(patterns);

// Fail closed if `packages:` is declared but resolves to zero members while a
// catalog exists: that means the patterns matched nothing (a parsing bug or a
// typo'd/relocated workspace file), and validating only the root manifest would
// silently pass drift in every member. (`packages:` entirely absent is a
// genuine single-package repo where root-only is correct, so don't fail there.)
if (packagesHeader !== null && memberDirs.length === 0) {
  fail(
    "`packages:` is declared in pnpm-workspace.yaml but resolved to no workspace " +
      "members — refusing to validate only the root manifest (likely a parsing " +
      "issue or a typo in the package globs).",
  );
  process.exit(1);
}

const manifestDirs = [".", ...memberDirs];
const sections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

for (const dir of manifestDirs) {
  const packageJsonPath = join(ROOT, dir, "package.json");
  if (!existsSync(packageJsonPath)) continue;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    fail(`${dir}/package.json is not valid JSON`);
    continue;
  }
  for (const section of sections) {
    for (const [name, rawSpec] of Object.entries(manifest[section] ?? {})) {
      const expected = catalog.get(name);
      if (!expected) continue;

      const spec = String(rawSpec);
      // `catalog:` and `catalog:default` both reference the default catalog.
      if (
        spec === "catalog:" ||
        spec === "catalog:default" ||
        spec === expected
      )
        continue;

      fail(
        `${dir}/package.json ${section}.${name} is "${spec}" - expected "catalog:" or "${expected}"`,
      );
    }
  }
}

if (process.exitCode !== 1) {
  ok(`all catalog-pinned packages aligned (${[...catalog.keys()].join(", ")})`);
}
