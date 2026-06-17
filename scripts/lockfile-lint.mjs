#!/usr/bin/env node
/**
 * Lockfile security validation for pnpm v9 YAML lockfiles.
 *
 * lockfile-lint (the npm package) does not support pnpm lockfile v9 format —
 * v9 no longer embeds `resolved:` URLs in pnpm-lock.yaml, so the
 * "registry-URL poisoning" class of attacks must be validated differently:
 *
 *   1. Integrity gate: every registry-tarball package entry must have a
 *      `resolution.integrity` field with a valid sha512 hash. A missing or
 *      malformed hash means pnpm cannot verify the tarball at install time.
 *
 *   2. Registry gate: the registry source of truth lives in `.npmrc` and
 *      `pnpm-workspace.yaml`, not in the lockfile. We validate that no custom
 *      registry is configured (i.e. all packages resolve from the default
 *      https://registry.npmjs.org).
 *
 * Ported from monitoring-monorepo. Frontend adaptations:
 *   - The override-floor gate (monitoring's gate 3) is intentionally omitted:
 *     30 of frontend's pnpm.overrides deliberately use `>=patched` floor
 *     values, which that gate rejects.
 *   - The integrity gate exempts the one remote-HTTPS-tarball dependency
 *     (`@metamask/jazzicon`, github-codeload, no integrity hash) — see
 *     REMOTE_TARBALL_ENTRY below.
 *
 * No external dependencies — parses the lockfile with pure Node.js regex on
 * the known-structured pnpm v9 format.
 *
 * Run: `pnpm supply-chain:lockfile-lint`
 * CI: .github/workflows/supply-chain.yml
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";

// ROOT defaults to cwd so the script works from any worktree root without
// path-hardcoding. Tests override via LOCKFILE_LINT_ROOT env var so they can
// point at a synthetic temp directory without relocating the script file.
// Script-local test knob (points tests at a temp dir), not a turbo pipeline input.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const ROOT = process.env["LOCKFILE_LINT_ROOT"] ?? process.cwd();

// Directories never walked when discovering .npmrc / pnpm-workspace.yaml files
// (build output + VCS/agent dirs). Scanning generated trees risks false-REDs on
// vendored config and wastes time.
const SKIP_WALK_DIRS = new Set([
  ".git",
  ".claude",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
]);

// ── helpers ──────────────────────────────────────────────────────────────────

/** @param {string} msg */
function fail(msg) {
  console.error(`\x1b[31m✖ ${msg}\x1b[0m`);
  process.exitCode = 1;
}

/** @param {string} msg */
function ok(msg) {
  console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
}

// ── 1. Parse lockfile ─────────────────────────────────────────────────────────

const lockfilePath = resolve(ROOT, "pnpm-lock.yaml");
if (!existsSync(lockfilePath)) {
  fail(`pnpm-lock.yaml not found at ${lockfilePath}`);
  process.exit(1);
}

const lockfileText = readFileSync(lockfilePath, "utf8");

// Confirm lockfile version — only v9 is understood by this script.
const versionMatch = lockfileText.match(
  /^lockfileVersion:\s*['"]?(\S+?)['"]?\s*$/m,
);
if (!versionMatch) {
  fail("Could not determine lockfile version from pnpm-lock.yaml");
  process.exit(1);
}
const lockfileVersion = versionMatch[1];
if (!lockfileVersion.startsWith("9")) {
  fail(
    `Unexpected lockfile version "${lockfileVersion}" — this script targets pnpm v9.x. ` +
      "Update the script if you upgraded pnpm.",
  );
  process.exit(1);
}

// Extract the `packages:` section (between "packages:\n" and "snapshots:\n" or EOF).
// In pnpm v9 the packages section lists every resolved package with its
// resolution block (integrity hash + optional engines/peerDependencies).
const packagesSectionStart = lockfileText.indexOf("\npackages:\n");
const snapshotsSectionStart = lockfileText.indexOf("\nsnapshots:\n");
const packagesSection =
  packagesSectionStart !== -1
    ? lockfileText.slice(
        packagesSectionStart + "\npackages:\n".length,
        snapshotsSectionStart !== -1 ? snapshotsSectionStart : undefined,
      )
    : "";

if (!packagesSection.trim()) {
  // An empty packages section is only valid for a completely empty monorepo.
  fail("pnpm-lock.yaml has an empty `packages:` section — unexpected.");
  process.exit(1);
}

// ── 2. Integrity validation ───────────────────────────────────────────────────
//
// Every registry-tarball top-level package entry looks like:
//
//   '@scope/name@version':            ← key at 2-space indent
//     resolution: {integrity: sha512-<base64>==}
//
// pnpm v9 also writes local file/directory dependencies under `packages:`,
// keyed as `<name>@file:<path>` with `resolution: {directory: ..., type: directory}`.
// Those entries don't carry an integrity hash (they're not registry tarballs)
// and must be exempted from the integrity check.

/**
 * Regex to extract a registry-tarball package entry + its sha512 integrity.
 *
 * The integrity value is captured up to the next `,` or `}` (`sha512-[^,}\n]+`)
 * and then validated WHOLE by SHA512_RE — so trailing garbage inside the value
 * (e.g. `sha512-<88 chars>EXTRA`) is part of the captured token and fails the
 * canonical-shape check, instead of being silently dropped by a trailing
 * wildcard. `\{[^}\n]*` before `integrity:` allows other resolution fields
 * (e.g. a `tarball:` from `lockfileIncludeTarballUrl`) to precede it, so field
 * order doesn't cause a false "missing integrity".
 *
 * The key is captured lazily up to the `:` that ends its line, so keys that
 * contain a `:` — pnpm alias entries like `lodash1@npm:lodash@1.0.0` — are
 * recognized (a `[^:]` key class would truncate them and false-flag missing
 * integrity). The `\n\s+resolution:` anchor keeps the match to real entries.
 */
const PKG_ENTRY =
  /^ {2}('?.+?'?):\s*\n\s+resolution:\s*\{[^}\n]*\bintegrity:\s*(sha512-[^,}\n]+)[^}\n]*\}/gm;

/**
 * Regex to identify TRULY LOCAL entries (`file:` / `link:` only) that
 * legitimately have no integrity hash. Remote git protocols (`git+ssh:`,
 * `git+https:`, `github:`) are NOT exempted here — pnpm v9 stores integrity
 * for those too, and treating them as local would let a PR add an unaudited
 * remote git dep that bypasses the registry gate.
 */
const LOCAL_SOURCE_ENTRY =
  /^ {2}('[^':\n]+@(?:file|link):[^\n']+'|[^':\n]+@(?:file|link):[^\n:']+):/gm;

/**
 * Remote HTTPS-tarball entries that pnpm v9 stores as
 * `resolution: {tarball: <url>}` with NO integrity hash, so they cannot satisfy
 * the sha512 gate. Pinned to the EXACT lockfile key (name + full URL incl.
 * commit) of the ONE known such dep — `@metamask/jazzicon` at commit 7a8df28.
 *
 * Pinning the full URL (not just the package name) is deliberate: if the
 * catalog repoints jazzicon to another host or commit, the key changes, this
 * exemption no longer matches, and the gate FAILS — forcing a conscious update
 * here rather than silently exempting a different, unaudited tarball.
 *
 * The match also requires the entry's `resolution: {tarball: <url>}` to equal
 * the expected URL, so a lockfile that keeps the allowlisted key but tampers
 * the resolution to a different host is NOT exempted (it fails the gate).
 *
 * Conscious tradeoff: a github tag/commit tarball is mutable, so this is a
 * weaker guarantee than a registry sha512.
 */
const REMOTE_TARBALL_ALLOWLIST = [
  {
    key: "@metamask/jazzicon@https://codeload.github.com/jmrossy/jazzicon/tar.gz/7a8df28",
    tarball: "https://codeload.github.com/jmrossy/jazzicon/tar.gz/7a8df28",
  },
];
/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REMOTE_TARBALL_ENTRY = new RegExp(
  REMOTE_TARBALL_ALLOWLIST.map(
    ({ key, tarball }) =>
      `^ {2}'?${escapeRegExp(key)}'?:\\n\\s+resolution:\\s*\\{tarball:\\s*${escapeRegExp(
        tarball,
      )}\\}`,
  ).join("|"),
  "gm",
);

/**
 * sha512 integrity. SHA-512 = 64 raw bytes = exactly 88 base64 chars total
 * (86 data chars + 2 `=` padding). Lock to the SHA-512 canonical shape so the
 * gate rejects malformed integrity at PR time.
 */
const SHA512_RE = /^sha512-[A-Za-z0-9+/]{86}={2}$/;

let totalPackages = 0;
let integrityErrors = 0;

/** @type {RegExpExecArray | null} */
let match;

while ((match = PKG_ENTRY.exec(packagesSection)) !== null) {
  totalPackages++;
  const name = match[1];
  const integrity = match[2];
  if (!SHA512_RE.test(integrity)) {
    fail(`Invalid integrity hash for ${name}: "${integrity}"`);
    integrityErrors++;
  }
}

// Cross-check #1: every entry with a `resolution:` block must carry a sha512.
// A `resolution:` line that's not followed by `{integrity: sha512-...}` won't
// match PKG_ENTRY, so we count `resolution:` lines and compare.
const totalResolutions = (packagesSection.match(/^\s+resolution:/gm) ?? [])
  .length;

// Cross-check #2: every top-level package entry must have either a sha512
// integrity (registry tarball) OR be an exempt-source entry (file:/link: local
// or remote https tarball). Match any EXACTLY-2-space-indented YAML key ending
// in `:` at end-of-line. Sub-keys (`resolution:`, `engines:`) live at 4+ space
// indent so don't match.
const totalEntries = (
  packagesSection.match(
    /^ {2}('[^':\n]+@[^\n']+'|[^':\n ][^:\n]*@[^\n]+?):\s*$/gm,
  ) ?? []
).length;

// Count exempt-source entries (no sha512 expected) so the discrepancy check
// doesn't false-positive on legitimate file:/link: deps or the remote tarball.
const totalLocalSources = (packagesSection.match(LOCAL_SOURCE_ENTRY) ?? [])
  .length;
const totalRemoteTarballs = (packagesSection.match(REMOTE_TARBALL_ENTRY) ?? [])
  .length;
const totalExemptSources = totalLocalSources + totalRemoteTarballs;
const expectedRegistryEntries = totalEntries - totalExemptSources;

// Sanity floor: if the regex matched zero top-level entries against a
// non-empty `packages:` section, the regex is out of sync with the lockfile
// format and the gate would silently pass. Fail loudly instead.
if (totalEntries === 0) {
  fail(
    "pnpm-lock.yaml `packages:` section is non-empty but no top-level package " +
      "entries matched the parser. The lockfile-lint regex is likely out of sync " +
      "with pnpm v9's on-disk format. Inspect `scripts/lockfile-lint.mjs` and " +
      "update PKG_ENTRY / LOCAL_SOURCE_ENTRY / totalEntries patterns to match.",
  );
  process.exit(1);
}

if (expectedRegistryEntries !== totalPackages) {
  const nonExemptResolutions = totalResolutions - totalExemptSources;
  const missingResolution = expectedRegistryEntries - nonExemptResolutions;
  const missingIntegrity = nonExemptResolutions - totalPackages;
  if (missingResolution > 0) {
    fail(
      `${missingResolution} package entry/entries in pnpm-lock.yaml have NO resolution block. ` +
        "Re-run `pnpm install` from a known-good registry and re-inspect.",
    );
  }
  if (missingIntegrity > 0) {
    fail(
      `${missingIntegrity} package(s) in pnpm-lock.yaml have a resolution block without a sha512 ` +
        "integrity hash. Re-run `pnpm install` from a known-good registry and re-inspect.",
    );
  }
  // Neither delta is positive yet the counts still disagree — the counters are
  // out of sync with the lockfile shape. Fail loudly instead of falling through
  // to a silent "passed".
  if (missingResolution <= 0 && missingIntegrity <= 0) {
    fail(
      `Package-entry accounting mismatch: expected ${expectedRegistryEntries} registry ` +
        `entries to carry sha512 integrity, matched ${totalPackages}. The lockfile-lint ` +
        "counters are likely out of sync with pnpm v9's on-disk format — inspect " +
        "`scripts/lockfile-lint.mjs`.",
    );
  }
} else if (integrityErrors === 0) {
  const exemptNote =
    totalExemptSources > 0
      ? ` (${totalLocalSources} local file:/link: + ${totalRemoteTarballs} remote-tarball deps exempted from the integrity check)`
      : "";
  ok(
    `All ${totalPackages} registry-tarball packages in pnpm-lock.yaml have valid sha512 integrity hashes${exemptNote}.`,
  );
}

// ── 3. Registry source validation ────────────────────────────────────────────
//
// pnpm v9 no longer embeds resolved: URLs in the lockfile. The install-time
// registry is controlled by `.npmrc` + `pnpm-workspace.yaml`. We validate:
//   a) No `registry=` override in any .npmrc in this repo.
//   b) No `registries:` block / `registry:` key in pnpm-workspace.yaml.
//
// Workspace `link:` and `file:` protocol entries are fine — they are internal
// refs, not registry fetches.

/**
 * @param {string} dir
 * @param {string[]} out
 */
function findNpmrcs(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findNpmrcs(full, out);
    } else if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      entry.name === ".npmrc"
    ) {
      // Include a symlinked `.npmrc` FILE — pnpm follows it at install time, so
      // a `.npmrc` pointing to a malicious file via symlink would bypass the
      // gate unless we read the resolved target. (Symlinked directories are not
      // recursed into — see the `entry.isDirectory()` branch above — which
      // avoids symlink-cycle hangs.)
      out.push(full);
    }
  }
}

/** @type {string[]} */
const npmrcFiles = [];
findNpmrcs(ROOT, npmrcFiles);

/**
 * Registry-host check is exact-canonical (NOT prefix-based) so an attacker
 * cannot bypass with a lookalike host like
 * `https://registry.npmjs.org.evil.com/`.
 * @param {string} val
 */
function isOfficialNpmRegistry(val) {
  const canonical = "https://registry.npmjs.org";
  return (
    val === canonical ||
    val === canonical + "/" ||
    val.startsWith(canonical + "/")
  );
}

let registryErrors = 0;

/**
 * Strip optional surrounding quotes from an npmrc/yaml key.
 * @param {string} key
 */
function unquote(key) {
  return key.replace(/^['"]|['"]$/g, "");
}

for (const absPath of npmrcFiles) {
  const rel = relative(ROOT, absPath);
  const content = readFileSync(absPath, "utf8");
  const lines = content.split("\n");
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    // Skip comments and empty lines.
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Reject userconfig / globalconfig indirection: those directives make
    // pnpm read a SECOND config file whose contents could carry the
    // attacker's `registry=...`. Reject outright rather than recursively
    // resolving + scanning every possible target.
    if (/^['"]?(userconfig|globalconfig)['"]?\s*=/.test(trimmed)) {
      fail(
        `${rel}:${i + 1} — npmrc directive forbidden: "${trimmed}". ` +
          "pnpm follows `userconfig=` / `globalconfig=` to a second config " +
          "file, which can carry an attacker-controlled `registry=` line " +
          "and bypass this check. Inline any required config in the same " +
          ".npmrc instead.",
      );
      registryErrors++;
      continue;
    }
    // Split on `=` and normalize the key half so `"registry"=` and
    // `'registry'=` parse the same as `registry=`.
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const rawKey = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    const key = unquote(rawKey);
    // Flag any `registry=` line that doesn't point to the official npm registry.
    if (key === "registry") {
      if (!isOfficialNpmRegistry(val)) {
        fail(
          `${rel}:${i + 1} — non-npmjs registry detected: "${val}". ` +
            "All packages must resolve from https://registry.npmjs.org.",
        );
        registryErrors++;
      }
      continue;
    }
    // Scope-specific registries: key looks like `@scope:registry` (possibly
    // quoted as `"@scope:registry"`). Use the SAME exact-canonical check.
    if (/^@[^:]+:registry$/.test(key)) {
      if (!isOfficialNpmRegistry(val)) {
        fail(
          `${rel}:${i + 1} — scope-specific non-npmjs registry: "${trimmed}". ` +
            "If this is intentional, document why and add an exemption comment above this line.",
        );
        registryErrors++;
      }
    }
  }
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function findPnpmWorkspaces(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK_DIRS.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findPnpmWorkspaces(full, out);
    } else if (
      (entry.isFile() || entry.isSymbolicLink()) &&
      entry.name === "pnpm-workspace.yaml"
    ) {
      out.push(full);
    }
  }
}

/** @type {string[]} */
const workspaceFiles = [];
findPnpmWorkspaces(ROOT, workspaceFiles);

/**
 * Extract the URL values from a YAML flow mapping such as
 * `{ work: https://x, pub: 'https://y' }`. Each `key: value` value is returned
 * (quotes stripped); keys are ignored.
 *
 * @param {string} flow
 * @returns {string[]}
 */
function flowMapUrls(flow) {
  const inner = flow.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
  /** @type {string[]} */ const urls = [];
  for (const part of splitTopLevelCommas(inner)) {
    const match = /^\s*["']?[^"':\s]+["']?\s*:\s*(.+)$/.exec(part);
    if (match) urls.push(unquote(match[1].trim()));
  }
  return urls;
}

/**
 * Split a YAML flow body on top-level commas only — commas inside single or
 * double quotes are preserved.
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

// Check every pnpm-workspace.yaml for the registry source of truth:
//   - singular `registry: <url>` (default registry)
//   - `registries:` and `namedRegistries:` alias→url maps (block OR flow style)
// pnpm resolves `alias:@scope/pkg` specs through namedRegistries, so a non-npmjs
// URL in any of these is a registry redirect just like a bare `registry=`. We
// validate each configured URL rather than rejecting the block outright (an
// all-npmjs map is harmless).
for (const absPath of workspaceFiles) {
  const rel = relative(ROOT, absPath);
  const ws = readFileSync(absPath, "utf8");
  const lines = ws.split("\n");
  /** @type {string | null} */ let registryMapLabel = null;
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const isTopLevel = /^\S/.test(line);
    // Any column-0 line ends an open block-style registry map.
    if (registryMapLabel && isTopLevel) registryMapLabel = null;

    // Singular top-level `registry: <url>`.
    const singularMatch = /^['"]?registry['"]?\s*:\s*(.+?)\s*$/.exec(line);
    if (singularMatch && isTopLevel) {
      const raw = unquote(singularMatch[1].trim());
      if (!isOfficialNpmRegistry(raw)) {
        fail(
          `${rel}:${i + 1} — non-npmjs default registry: "${raw}". ` +
            "All packages must resolve from https://registry.npmjs.org.",
        );
        registryErrors++;
      }
    }

    // `registries:` / `namedRegistries:` alias→url map header.
    const mapHeader =
      /^['"]?(registries|namedRegistries)['"]?\s*:\s*(.*)$/.exec(trimmed);
    if (mapHeader && isTopLevel) {
      const label = mapHeader[1];
      const inlineValue = mapHeader[2].trim();
      if (inlineValue.startsWith("{")) {
        // Flow-style mapping on the same line.
        for (const url of flowMapUrls(inlineValue)) {
          if (!isOfficialNpmRegistry(url)) {
            fail(
              `${rel}:${i + 1} — ${label} entry points off-npmjs: "${url}". ` +
                "All packages must resolve from https://registry.npmjs.org.",
            );
            registryErrors++;
          }
        }
      } else if (inlineValue === "") {
        // Block-style mapping — validate the indented child entries below.
        registryMapLabel = label;
      } else {
        // A bare scalar value on the header line (e.g. `registries: <url>`):
        // validate it directly so an off-npmjs scalar can't slip past the
        // flow/block branches.
        const url = unquote(inlineValue);
        if (!isOfficialNpmRegistry(url)) {
          fail(
            `${rel}:${i + 1} — ${label} entry points off-npmjs: "${url}". ` +
              "All packages must resolve from https://registry.npmjs.org.",
          );
          registryErrors++;
        }
      }
      continue;
    }

    // Block-style child entry: `alias: <url>`.
    if (registryMapLabel) {
      const entry = /^\s+["']?[^"':\s]+["']?\s*:\s*(.+?)\s*$/.exec(line);
      if (entry) {
        const url = unquote(entry[1].trim());
        if (!isOfficialNpmRegistry(url)) {
          fail(
            `${rel}:${i + 1} — ${registryMapLabel} entry points off-npmjs: "${url}". ` +
              "All packages must resolve from https://registry.npmjs.org.",
          );
          registryErrors++;
        }
      }
    }
  }
}

// Tarball-host gate: any `resolution: {... tarball: <url> ...}` in the packages
// section must resolve from npmjs OR be on the remote-tarball allowlist.
// A valid sha512 does NOT make an off-npmjs tarball safe: in a tampered
// lockfile the integrity is attacker-controlled too, so pnpm would fetch
// attacker content from the off-host URL that matches an attacker-chosen hash.
const allowedTarballs = new Set(REMOTE_TARBALL_ALLOWLIST.map((e) => e.tarball));
const TARBALL_FIELD = /resolution:\s*\{[^}\n]*\btarball:\s*([^\s,}]+)/g;
/** @type {RegExpExecArray | null} */
let tarballMatch;
while ((tarballMatch = TARBALL_FIELD.exec(packagesSection)) !== null) {
  const url = tarballMatch[1];
  if (!isOfficialNpmRegistry(url) && !allowedTarballs.has(url)) {
    fail(
      `pnpm-lock.yaml has a resolution tarball pointing off-npmjs: "${url}". ` +
        "Registry packages must resolve from https://registry.npmjs.org; add an " +
        "explicit entry to REMOTE_TARBALL_ALLOWLIST if this is intentional.",
    );
    registryErrors++;
  }
}

// Git-source gate: a git dependency entry carries `resolution: {repo: <url>,
// type: git, ...}`. Such an entry also has an integrity hash, so it passes the
// integrity gate, but its source host is never the npm registry. Like the
// tarball gate, a valid sha512 does NOT make an off-registry git source safe
// (tampered lockfile = attacker-controlled integrity). Reject any git source
// unless explicitly allowlisted (none are today).
const GIT_REPO_ALLOWLIST = new Set();
const REPO_FIELD = /resolution:\s*\{[^}\n]*\brepo:\s*([^\s,}]+)/g;
/** @type {RegExpExecArray | null} */
let repoMatch;
while ((repoMatch = REPO_FIELD.exec(packagesSection)) !== null) {
  const url = repoMatch[1];
  if (!GIT_REPO_ALLOWLIST.has(url)) {
    fail(
      `pnpm-lock.yaml has a git-sourced dependency: "${url}". Git sources are ` +
        "not audited like the npm registry; resolve from npmjs or add an " +
        "explicit GIT_REPO_ALLOWLIST entry if this is intentional.",
    );
    registryErrors++;
  }
}

if (registryErrors === 0) {
  ok(
    "No custom registry overrides detected — all packages resolve from registry.npmjs.org.",
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

if (process.exitCode === 1) {
  console.error(
    "\n\x1b[31mlockfile-lint failed. Fix the issues above before merging.\x1b[0m",
  );
} else {
  console.log("\n\x1b[32mlockfile-lint passed.\x1b[0m");
}
