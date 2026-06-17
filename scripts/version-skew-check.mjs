#!/usr/bin/env node
/**
 * Dependency version-skew check against the pnpm catalog.
 *
 * Every declared version of a cataloged package must be either "catalog:" or
 * exactly the catalog version. This keeps workspace members from silently
 * drifting off the shared catalog with a literal pin.
 *
 * This intentionally checks only the default `catalog:` block. If this
 * workspace adopts pnpm named catalogs via `catalogs:`, extend this checker
 * and its fixtures in the same change.
 *
 * Ported from monitoring-monorepo. Adaptation for frontend: this workspace's
 * `packages:` entries are globs (`apps/*`, `packages/*`), so member dirs are
 * expanded — a literal-dir lookup would silently check nothing.
 *
 * No external dependencies. Run: pnpm supply-chain:version-skew
 * CI: .github/workflows/supply-chain.yml
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

// Script-local test knob (points tests at a temp dir), not a turbo pipeline input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const ROOT = process.env["SKEW_CHECK_ROOT"] ?? process.cwd();

/**
 * @param {string} message
 */
function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

/**
 * @param {string} message
 */
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
  // which pnpm accepts — an exact-string match would miss the block entirely
  // and silently report "no catalog entries" / skip workspace members.
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
 * @param {string[]} blockLines
 * @returns {Map<string, string>}
 */
function parseCatalog(blockLines) {
  const catalog = new Map();

  for (const line of blockLines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    // Value capture is `[^"'\s]+` (not `[^"'\s#]+`): a `#` is only a YAML
    // comment when preceded by whitespace (handled by the trailing `\s*#.*`),
    // so an in-value `#` — e.g. a git ref like `github:org/repo#sha` — is kept
    // intact rather than truncated.
    const match = line.match(
      /^ {2}["']?([^"':\s]+)["']?:\s*["']?([^"'\s]+)["']?\s*(?:#.*)?$/,
    );
    if (!match) continue;
    catalog.set(match[1], match[2]);
  }

  return catalog;
}

/**
 * @param {string[]} blockLines
 * @returns {string[]}
 */
function parseWorkspacePackages(blockLines) {
  return blockLines.flatMap((line) => {
    const match = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
    return match ? [match[1]] : [];
  });
}

/**
 * Expand a `packages:` entry into concrete member directories (relative to
 * ROOT). Supports a single trailing `/*` glob (e.g. `apps/*`) and literal
 * directory entries; a literal `*` matches every immediate subdirectory.
 *
 * @param {string} entry
 * @returns {string[]}
 */
function expandMember(entry) {
  if (!entry.endsWith("/*") && entry !== "*") return [entry];

  const baseRel = entry === "*" ? "." : entry.slice(0, -2);
  const baseAbs = resolve(ROOT, baseRel);
  if (!existsSync(baseAbs)) return [];

  return readdirSync(baseAbs)
    .filter((name) => {
      const child = join(baseAbs, name);
      return statSync(child).isDirectory();
    })
    .map((name) => (baseRel === "." ? name : `${baseRel}/${name}`));
}

const workspacePath = resolve(ROOT, "pnpm-workspace.yaml");
const workspaceText = readFileSync(workspacePath, "utf8");
const catalog = parseCatalog(readTopLevelBlock(workspaceText, "catalog"));

if (catalog.size === 0) {
  ok("no catalog entries - nothing to check");
  process.exit(0);
}

const memberDirs = parseWorkspacePackages(
  readTopLevelBlock(workspaceText, "packages"),
).flatMap(expandMember);
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

  const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  for (const section of sections) {
    for (const [name, rawSpec] of Object.entries(manifest[section] ?? {})) {
      const expected = catalog.get(name);
      if (!expected) continue;

      const spec = String(rawSpec);
      if (spec === "catalog:" || spec === expected) continue;

      fail(
        `${dir}/package.json ${section}.${name} is "${spec}" - expected "catalog:" or "${expected}"`,
      );
    }
  }
}

if (process.exitCode !== 1) {
  ok(`all catalog-pinned packages aligned (${[...catalog.keys()].join(", ")})`);
}
