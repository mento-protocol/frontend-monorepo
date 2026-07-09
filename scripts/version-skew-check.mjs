#!/usr/bin/env node
/**
 * Dependency version-skew check against the pnpm catalog.
 *
 * Every declared version of a cataloged package must be `catalog:`,
 * `catalog:default`, or exactly the catalog version. This keeps workspace
 * members from silently drifting off the shared catalog with a literal pin.
 *
 * Also checks override settings: pnpm overrides rewrite EVERY specifier for a
 * package name, including `catalog:` references, so any override that can match
 * a cataloged package must match the catalog string exactly or use pnpm's
 * `catalog:` override value. Range-scoped CVE-floor overrides (`axios@<1.15.0`)
 * are skipped only when the selector is proven not to match the catalog range.
 * See docs/dependency-overrides.md.
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
  // Tolerate an inline comment on the header (e.g. `catalog: # default catalog`)
  // and a quoted key (`"catalog":`) — both are valid YAML that pnpm honors; an
  // exact bare-key match would miss the block entirely.
  const headerRe = new RegExp(`^["']?${blockName}["']?:\\s*(#.*)?$`);
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
 * @param {string} entry
 * @returns {[string, string] | null}
 */
function parseMappingEntry(entry) {
  const trimmed = entry.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return null;

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    if (end === -1) return null;
    const afterKey = trimmed.slice(end + 1).trimStart();
    if (!afterKey.startsWith(":")) return null;
    return [trimmed.slice(1, end), parseScalarValue(afterKey.slice(1))];
  }

  const separator = trimmed.indexOf(":");
  if (separator === -1) return null;
  const key = trimmed.slice(0, separator).trim();
  if (key === "") return null;
  return [key, parseScalarValue(trimmed.slice(separator + 1))];
}

/**
 * @param {string[]} blockLines
 * @returns {Map<string, string>}
 */
function parseCatalog(blockLines) {
  const catalog = new Map();

  for (const line of blockLines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^ +/.test(line)) continue;
    // Accept any (non-zero) indentation — YAML permits 2-space, 4-space, etc.
    const entry = parseMappingEntry(line);
    if (!entry) continue;
    const [key, value] = entry;
    if (value === "") continue;
    catalog.set(key, value);
  }

  return catalog;
}

/**
 * Return the inline value after a top-level `key:` header, or null if the key is
 * absent. Yields "" for a bare block header, "{...}" for a flow mapping, or a
 * trailing comment. Accepts a quoted key (`"catalog":`). (`^catalog:` does not
 * match `catalogs:`.)
 *
 * @param {string} text
 * @param {string} key
 * @returns {string | null}
 */
function topLevelHeaderValue(text, key) {
  const match = new RegExp(`^["']?${key}["']?:[ \\t]*(.*)$`, "m").exec(text);
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
    const entry = parseMappingEntry(part);
    if (entry) catalog.set(entry[0], entry[1]);
  }
  return catalog;
}

/**
 * @param {string} spec
 * @returns {boolean}
 */
function isDefaultCatalogReference(spec) {
  return spec === "catalog:" || spec === "catalog:default";
}

/**
 * @param {string} spec
 * @param {string} expected
 * @returns {boolean}
 */
function isCatalogAlignedSpec(spec, expected) {
  return isDefaultCatalogReference(spec) || spec === expected;
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

/**
 * @param {string} key
 * @returns {number}
 */
function findParentOverrideSeparator(key) {
  for (let index = key.length - 1; index >= 0; index -= 1) {
    if (key[index] !== ">") continue;
    const previous = key[index - 1] ?? "";
    const next = key[index + 1] ?? "";
    if (
      next === "" ||
      next === "=" ||
      /\d/.test(next) ||
      /\s/.test(previous) ||
      previous === "@"
    ) {
      continue;
    }
    return index;
  }
  return -1;
}

/**
 * Split a pnpm override key into the overridden package name and optional
 * selector. Parent-scoped overrides (`parent>child`) target the package after
 * the final parent separator; range selectors can also contain comparator `>`
 * tokens, so those are not treated as parent separators. Scoped package names
 * start with `@`, so look for a second `@` only after that.
 *
 * @param {string} key
 * @returns {{ name: string; selector: string | null }}
 */
function parseOverrideKey(key) {
  const separator = findParentOverrideSeparator(key);
  const target = separator === -1 ? key : key.slice(separator + 1);
  const selectorIndex = target.indexOf("@", 1);
  if (selectorIndex === -1) return { name: target, selector: null };
  return {
    name: target.slice(0, selectorIndex),
    selector: target.slice(selectorIndex + 1),
  };
}

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseWorkspaceOverrides(text) {
  const header = topLevelHeaderValue(text, "overrides");
  if (header === null) return new Map();
  return header.startsWith("{")
    ? parseFlowCatalog(header)
    : parseCatalog(readTopLevelBlock(text, "overrides"));
}

/**
 * @param {string} value
 * @returns {[number, number, number] | null}
 */
function parseVersionTuple(value) {
  const match = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * @param {[number, number, number]} left
 * @param {[number, number, number]} right
 * @returns {number}
 */
function compareVersionTuples(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Return an exclusive upper bound for the simple npm ranges this repo uses.
 * Unknown forms return null, which makes selector handling conservative.
 *
 * @param {string} range
 * @returns {[number, number, number] | null}
 */
function simpleRangeUpperBound(range) {
  const version = parseVersionTuple(range);
  if (!version) return null;
  const trimmed = range.trim();
  if (trimmed.startsWith("^")) {
    const [major, minor, patch] = version;
    if (major > 0) return [major + 1, 0, 0];
    if (minor > 0) return [major, minor + 1, 0];
    return [major, minor, patch + 1];
  }
  if (trimmed.startsWith("~")) return [version[0], version[1] + 1, 0];
  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return [version[0], version[1], version[2] + 1];
  }
  return null;
}

/**
 * @param {string} selector
 * @param {string} catalogRange
 * @returns {boolean}
 */
function selectorArmCanMatchCatalog(selector, catalogRange) {
  if (selector === catalogRange || isDefaultCatalogReference(selector)) {
    return true;
  }

  const catalogLower = parseVersionTuple(catalogRange);
  if (!catalogLower) return true;
  const catalogUpper = simpleRangeUpperBound(catalogRange);

  const hyphen = selector.match(
    /^\s*(\d+\.\d+\.\d+)\s+-\s+(\d+\.\d+\.\d+)\s*$/,
  );
  if (hyphen) {
    const lower = parseVersionTuple(hyphen[1]);
    const upper = parseVersionTuple(hyphen[2]);
    if (!lower || !upper) return true;
    if (compareVersionTuples(upper, catalogLower) < 0) return false;
    if (catalogUpper && compareVersionTuples(lower, catalogUpper) >= 0) {
      return false;
    }
    return true;
  }

  const selectorUpper = simpleRangeUpperBound(selector);
  if (selectorUpper && compareVersionTuples(catalogLower, selectorUpper) >= 0) {
    return false;
  }

  const selectorLower = parseVersionTuple(selector);
  if (
    selectorLower &&
    catalogUpper &&
    compareVersionTuples(selectorLower, catalogUpper) >= 0
  ) {
    return false;
  }

  const comparators = [
    ...selector.matchAll(/(<=|<|>=|>|=)?\s*v?(\d+\.\d+\.\d+)/g),
  ];
  if (comparators.length === 0) return true;

  for (const comparator of comparators) {
    const operator = comparator[1] ?? "=";
    const version = parseVersionTuple(comparator[2]);
    if (!version) continue;

    if (operator === "<" && compareVersionTuples(catalogLower, version) >= 0) {
      return false;
    }
    if (operator === "<=" && compareVersionTuples(catalogLower, version) > 0) {
      return false;
    }
    if (
      (operator === ">" || operator === ">=") &&
      catalogUpper &&
      compareVersionTuples(catalogUpper, version) <= 0
    ) {
      return false;
    }
    if (operator === "=") {
      if (
        compareVersionTuples(version, catalogLower) < 0 ||
        (catalogUpper && compareVersionTuples(version, catalogUpper) >= 0)
      ) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Conservative overlap check for pnpm range-scoped override keys. It returns
 * false only when every selector arm is proven not to match the catalog range;
 * otherwise the override must align.
 *
 * @param {string} selector
 * @param {string} catalogRange
 * @returns {boolean}
 */
function selectorCanMatchCatalog(selector, catalogRange) {
  return selector
    .split("||")
    .some((arm) => selectorArmCanMatchCatalog(arm.trim(), catalogRange));
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

/** @type {Map<string, string>} */
const rootDependencySpecs = new Map();
const rootPackageJsonPath = join(ROOT, "package.json");
let rootManifest;
if (existsSync(rootPackageJsonPath)) {
  try {
    rootManifest = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));
  } catch {
    rootManifest = undefined;
  }

  for (const section of sections) {
    for (const [name, rawSpec] of Object.entries(
      rootManifest?.[section] ?? {},
    )) {
      rootDependencySpecs.set(name, String(rawSpec));
    }
  }
}

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
      if (isCatalogAlignedSpec(spec, expected)) continue;

      fail(
        `${dir}/package.json ${section}.${name} is "${spec}" - expected "catalog:" or "${expected}"`,
      );
    }
  }
}

/** @type {{ source: string; key: string; name: string; selector: string | null; value: string }[]} */
const overrideEntries = [];

/**
 * @param {string} source
 * @param {Record<string, unknown> | Map<string, string> | undefined} overrides
 */
function addOverrideEntries(source, overrides) {
  const entries =
    overrides instanceof Map
      ? overrides.entries()
      : Object.entries(overrides ?? {});
  for (const [key, rawValue] of entries) {
    const { name, selector } = parseOverrideKey(key);
    overrideEntries.push({
      source,
      key,
      name,
      selector,
      value: String(rawValue),
    });
  }
}

if (rootManifest) {
  addOverrideEntries(
    "package.json pnpm.overrides",
    rootManifest?.pnpm?.overrides,
  );
}

addOverrideEntries(
  "pnpm-workspace.yaml overrides",
  parseWorkspaceOverrides(workspaceText),
);

for (const entry of overrideEntries) {
  const expected = catalog.get(entry.name);
  if (!expected) continue;
  if (
    entry.selector !== null &&
    !selectorCanMatchCatalog(entry.selector, expected)
  ) {
    continue;
  }
  const value = resolveOverrideValue(entry.name, entry.value);
  if (isCatalogAlignedSpec(value, expected)) continue;

  fail(
    `${entry.source}.${entry.key} is "${entry.value}" - conflicts with catalog "${expected}" (overrides rewrite catalog: references, so the catalog entry is dead)`,
  );
}

/**
 * @param {string} packageName
 * @returns {{ source: string; key: string; value: string } | undefined}
 */
function findUnconditionalOverride(packageName) {
  return overrideEntries.find(
    (entry) => entry.name === packageName && entry.selector === null,
  );
}

/**
 * @param {string} packageName
 * @returns {string | undefined}
 */
function catalogValueForOverride(packageName) {
  return (
    catalog.get(packageName) ??
    (packageName === "@tanstack/query-core"
      ? catalog.get("@tanstack/react-query")
      : undefined)
  );
}

/**
 * @param {string} packageName
 * @param {string} spec
 * @returns {string}
 */
function resolveCatalogReferenceSpec(packageName, spec) {
  if (!isDefaultCatalogReference(spec)) return spec;
  return catalogValueForOverride(packageName) ?? spec;
}

/**
 * @param {string} packageName
 * @param {string} value
 * @returns {string}
 */
function resolveOverrideValue(packageName, value) {
  if (value.startsWith("$")) {
    const referencedPackage = value.slice(1);
    const referencedSpec = rootDependencySpecs.get(referencedPackage);
    return referencedSpec
      ? resolveCatalogReferenceSpec(referencedPackage, referencedSpec)
      : value;
  }
  return resolveCatalogReferenceSpec(packageName, value);
}

/**
 * @param {string} packageName
 * @param {string} value
 * @returns {string}
 */
function normalizeOverrideValue(packageName, value) {
  return resolveOverrideValue(packageName, value);
}

const tanstackReactQueryOverride = findUnconditionalOverride(
  "@tanstack/react-query",
);
const tanstackQueryCoreOverride = findUnconditionalOverride(
  "@tanstack/query-core",
);

if (tanstackReactQueryOverride || tanstackQueryCoreOverride) {
  if (!tanstackReactQueryOverride || !tanstackQueryCoreOverride) {
    fail(
      "@tanstack/react-query and @tanstack/query-core overrides must be declared together so pnpm cannot force a mismatched TanStack Query pair",
    );
  } else {
    const reactQueryValue = normalizeOverrideValue(
      "@tanstack/react-query",
      tanstackReactQueryOverride.value,
    );
    const queryCoreValue = normalizeOverrideValue(
      "@tanstack/query-core",
      tanstackQueryCoreOverride.value,
    );
    if (reactQueryValue !== queryCoreValue) {
      fail(
        `${tanstackReactQueryOverride.source}.${tanstackReactQueryOverride.key} (${tanstackReactQueryOverride.value}) must match ${tanstackQueryCoreOverride.source}.${tanstackQueryCoreOverride.key} (${tanstackQueryCoreOverride.value})`,
      );
    }
  }
}

if (process.exitCode !== 1) {
  ok(`all catalog-pinned packages aligned (${[...catalog.keys()].join(", ")})`);
}
