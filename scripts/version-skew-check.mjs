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
    if (/^\S/.test(line) && line.trim() !== "") break;
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
 * Convert a pnpm workspace glob (fast-glob style) to a regex body. `**` matches
 * any characters (incl. `/`); `*` matches within a path segment; `{a,b}` brace
 * alternation becomes `(?:a|b)` (options converted recursively); every other
 * regex-special char is escaped. Built char-by-char to keep escaping
 * unambiguous.
 *
 * @param {string} glob
 * @returns {string}
 */
function globBody(glob) {
  let body = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        body += ".*";
        i += 1;
      } else {
        body += "[^/]*";
      }
    } else if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        body += "\\{";
      } else {
        const options = glob
          .slice(i + 1, end)
          .split(",")
          .map((option) => globBody(option.trim()));
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
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  return new RegExp(`^${globBody(glob)}$`);
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

// Fail closed on named catalogs (`catalogs:`). This checker validates only the
// default `catalog:` block; a workspace that adopts named catalogs would
// otherwise silently pass with real drift in `catalog:<name>` consumers. Fail
// loudly so the script is extended (and `catalogs:` parsing + fixtures added)
// rather than relied on with a blind spot. (`^catalogs:` does not match the
// singular `catalog:` header.)
if (readTopLevelBlock(workspaceText, "catalogs").some((l) => l.trim() !== "")) {
  fail(
    "pnpm-workspace.yaml defines named `catalogs:`, which this checker does not " +
      "yet validate. Extend scripts/version-skew-check.mjs to parse named " +
      "catalogs and their `catalog:<name>` consumers before relying on the gate.",
  );
  process.exit(1);
}

const catalog = parseCatalog(readTopLevelBlock(workspaceText, "catalog"));

if (catalog.size === 0) {
  ok("no catalog entries - nothing to check");
  process.exit(0);
}

const memberDirs = resolveWorkspaceMembers(
  parseWorkspacePatterns(readTopLevelBlock(workspaceText, "packages")),
);
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
