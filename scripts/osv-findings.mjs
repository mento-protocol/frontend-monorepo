import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Structured OSV findings for the managed "CI: Supply Chain is failing" issue.
//
// The issue names the vulnerable package by reading the scanner's own
// `--format=json` output, never a job log. Log text is attacker-influenceable
// and `scripts/ci-failure-issue.mjs` documents why no line selector over it is
// safe. This module is the whole difference: it reads a run artifact produced
// by the `osv-findings` job in `.github/workflows/supply-chain.yml`, validates
// it strictly, and hands back a fixed set of scalar fields.
//
// What leaves here is allowlisted by construction. Every returned finding is a
// fresh object carrying exactly `lockfile`, `id`, `packageName`, `version`,
// `fixedVersion` and `summary`, so no scanner-supplied key, nested object or
// free-form blob can reach the issue body by being passed through. Markdown
// escaping is deliberately NOT done here: the caller owns it, so the repository
// keeps one audited escaping implementation instead of two.
//
// Nothing in here fails the notifier. Every read, parse and validation error
// degrades into a note and an empty finding list.

export const OSV_FINDINGS_ARTIFACT_NAME = "osv-findings";

// The exact files the findings job writes, each bound to the lockfile it
// scanned. The lockfile label is taken from this trusted table rather than from
// the scanner's own `source.path`, so a scan result cannot name a file it did
// not scan. `dependency-policy.test.mjs` pins this list against the job.
export const OSV_FINDINGS_FILES = [
  { file: "application.json", lockfile: "pnpm-lock.yaml" },
  {
    file: "pnpm-runtime.json",
    lockfile: "scripts/vercel-pnpm-runtime/pnpm-lock.yaml",
  },
  {
    file: "vercel-cli-runtime.json",
    lockfile: "scripts/vercel-cli-runtime/pnpm-lock.yaml",
  },
  {
    file: "pnpm-bootstrap.json",
    lockfile: "scripts/vercel-pnpm-bootstrap/package-lock.json",
  },
];

// A scan of four lockfiles; the real files sit far below this. The cap exists
// so a corrupt or padded artifact cannot be parsed at all.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// Enough to name what broke without turning the issue into a report. Anything
// past this is counted, never silently dropped.
const MAX_FINDINGS = 25;
// A generous pre-cap. The caller sanitizes and caps every field again for
// display; this only keeps an absurd string out of the intermediate objects.
const MAX_RAW_FIELD_CHARS = 500;
const MAX_FIXED_VERSIONS = 3;

// An OSV identifier: a database prefix and a suffix, as every OSV home database
// issues them (GHSA-, CVE-, PYSEC-, GO-, RUSTSEC-, MAL-, OSV-). Findings whose
// id does not match are dropped and counted rather than rendered, because the
// id is the one field a reader uses to look the advisory up.
const OSV_ID_PATTERN = /^[A-Z][A-Z0-9_]*-[A-Za-z0-9._-]{1,64}$/;

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(value) === false
  );
}

/** A non-empty string, pre-capped. Anything else is absent. */
function scalarString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, MAX_RAW_FIELD_CHARS);
}

/**
 * The versions an advisory records as carrying the fix, taken only from the
 * `affected` entries that name this exact package. An advisory routinely covers
 * several packages, and quoting another one's fixed version beside this
 * package's name would be actively misleading.
 */
function fixedVersionsFor(vulnerability, packageName) {
  const affected = Array.isArray(vulnerability.affected)
    ? vulnerability.affected
    : [];
  const fixed = new Set();

  for (const entry of affected) {
    if (!isPlainObject(entry)) continue;
    if (scalarString(entry.package?.name) !== packageName) continue;
    const ranges = Array.isArray(entry.ranges) ? entry.ranges : [];
    for (const range of ranges) {
      if (!isPlainObject(range)) continue;
      const events = Array.isArray(range.events) ? range.events : [];
      for (const event of events) {
        if (!isPlainObject(event)) continue;
        const value = scalarString(event.fixed);
        if (value !== undefined) fixed.add(value);
      }
    }
  }

  return [...fixed].sort();
}

/**
 * Validate one `--format=json` document and flatten its
 * `results[].packages[].vulnerabilities[]` into allowlisted findings.
 *
 * Strict throughout: a document that is not an object with a `results` array is
 * rejected whole, and a finding missing an advisory id, a package name or a
 * version is dropped and counted. A partially valid document contributes its
 * valid findings — the alternative would hide a real advisory because an
 * unrelated entry was malformed.
 */
export function parseOsvFindings(text, lockfile) {
  let document;
  try {
    document = JSON.parse(String(text));
  } catch {
    return { findings: [], invalid: true, dropped: 0 };
  }
  if (!isPlainObject(document) || !Array.isArray(document.results)) {
    return { findings: [], invalid: true, dropped: 0 };
  }

  const findings = [];
  let dropped = 0;

  for (const result of document.results) {
    if (!isPlainObject(result)) {
      dropped += 1;
      continue;
    }
    const packages = Array.isArray(result.packages) ? result.packages : [];
    for (const entry of packages) {
      if (!isPlainObject(entry)) {
        dropped += 1;
        continue;
      }
      const packageName = scalarString(entry.package?.name);
      const version = scalarString(entry.package?.version);
      const vulnerabilities = Array.isArray(entry.vulnerabilities)
        ? entry.vulnerabilities
        : [];

      for (const vulnerability of vulnerabilities) {
        if (!isPlainObject(vulnerability)) {
          dropped += 1;
          continue;
        }
        const id = scalarString(vulnerability.id);
        // The three fields that make a finding actionable. Without all of
        // them the row would name no advisory or no package, so it is not
        // rendered at all.
        if (
          id === undefined ||
          packageName === undefined ||
          version === undefined ||
          !OSV_ID_PATTERN.test(id)
        ) {
          dropped += 1;
          continue;
        }

        const fixed = fixedVersionsFor(vulnerability, packageName);
        findings.push({
          lockfile,
          id,
          packageName,
          version,
          fixedVersion:
            fixed.length > 0
              ? fixed.slice(0, MAX_FIXED_VERSIONS).join(", ")
              : undefined,
          summary: scalarString(vulnerability.summary),
        });
      }
    }
  }

  return { findings, invalid: false, dropped };
}

/** Read one findings file, or report why it could not be read. */
function readFindingsFile(directory, file) {
  const path = join(directory, file);
  let stats;
  try {
    // `lstat`, not `stat`: an artifact entry can be a symlink, and following
    // one would read a file on the runner that no scan ever produced.
    stats = lstatSync(path);
  } catch {
    return { missing: true };
  }
  if (!stats.isFile()) return { unreadable: true };
  if (stats.size > MAX_FILE_BYTES) return { unreadable: true };

  try {
    return { text: readFileSync(path, "utf8") };
  } catch {
    return { unreadable: true };
  }
}

/**
 * Collect the findings the `osv-findings` job uploaded for this run.
 *
 * `directory` is where `actions/download-artifact` extracted the artifact, kept
 * outside the notifier's own checkout so an artifact entry cannot overwrite the
 * trusted notifier source. An absent directory, an absent file, an unparsable
 * document and an empty scan are all ordinary outcomes: each yields a note, and
 * none of them ever falls back to reading a log.
 */
export function collectOsvFindings({ directory } = {}) {
  if (typeof directory !== "string" || directory.length === 0) {
    return { findings: [], omitted: 0, notes: [] };
  }

  const findings = [];
  const missing = [];
  const unreadable = [];
  let dropped = 0;

  for (const { file, lockfile } of OSV_FINDINGS_FILES) {
    const read = readFindingsFile(directory, file);
    if (read.missing === true) {
      missing.push(lockfile);
      continue;
    }
    if (read.unreadable === true) {
      unreadable.push(lockfile);
      continue;
    }
    const parsed = parseOsvFindings(read.text, lockfile);
    if (parsed.invalid) {
      unreadable.push(lockfile);
      continue;
    }
    dropped += parsed.dropped;
    findings.push(...parsed.findings);
  }

  // One advisory against one package version is one finding, however many
  // scans or advisory aliases reported it.
  const seen = new Set();
  const unique = findings.filter((finding) => {
    const identity = [
      finding.lockfile,
      finding.id,
      finding.packageName,
      finding.version,
    ].join(" ");
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  unique.sort(
    (left, right) =>
      left.lockfile.localeCompare(right.lockfile) ||
      left.packageName.localeCompare(right.packageName) ||
      left.version.localeCompare(right.version) ||
      left.id.localeCompare(right.id),
  );

  const notes = [];
  if (missing.length === OSV_FINDINGS_FILES.length) {
    notes.push(
      "The OSV findings artifact was unavailable for this run, so no package is named below.",
    );
  } else if (missing.length > 0) {
    notes.push(
      `No findings artifact was uploaded for ${missing.length} of ${OSV_FINDINGS_FILES.length} scanned lockfiles.`,
    );
  }
  if (unreadable.length > 0) {
    notes.push(
      `${unreadable.length} findings ${unreadable.length === 1 ? "file was" : "files were"} unreadable or not a valid scan result.`,
    );
  }
  if (dropped > 0) {
    notes.push(
      `${dropped} scanner ${dropped === 1 ? "entry was" : "entries were"} dropped for failing the expected findings schema.`,
    );
  }
  if (unique.length === 0 && notes.length === 0) {
    notes.push(
      "The scans that produced this run's findings artifact reported no vulnerability.",
    );
  }

  // A list, not one joined string: the caller caps each rendered field at 200
  // characters, and these notes already come to 197 together — a four-digit
  // dropped count tips them past it and the last note is lost to truncation.
  return {
    findings: unique.slice(0, MAX_FINDINGS),
    omitted: Math.max(0, unique.length - MAX_FINDINGS),
    notes,
  };
}
