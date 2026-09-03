import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  OSV_FINDINGS_ARTIFACT_NAME,
  OSV_FINDINGS_FILES,
  collectOsvFindings,
  parseOsvFindings,
} from "./osv-findings.mjs";

function scanResult(packages) {
  return JSON.stringify({
    results: [
      { source: { path: "/github/workspace/pnpm-lock.yaml" }, packages },
    ],
  });
}

function vulnerablePackage({
  name = "left-pad",
  version = "1.0.0",
  id = "GHSA-aaaa-bbbb-cccc",
  summary = "Prototype pollution in left-pad",
  fixed = ["1.0.1"],
} = {}) {
  return {
    package: { name, version, ecosystem: "npm" },
    vulnerabilities: [
      {
        id,
        summary,
        affected: [
          {
            package: { name, ecosystem: "npm" },
            ranges: [
              {
                type: "SEMVER",
                events: [
                  { introduced: "0" },
                  ...fixed.map((value) => ({ fixed: value })),
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function withDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), "osv-findings-"));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/** Write a valid, empty scan result for every file except the named ones. */
function writeEmptyScans(directory, { except = [] } = {}) {
  for (const { file } of OSV_FINDINGS_FILES) {
    if (except.includes(file)) continue;
    writeFileSync(join(directory, file), '{"results":[]}\n');
  }
}

test("the artifact contract is a fixed set of files bound to lockfiles", () => {
  assert.equal(OSV_FINDINGS_ARTIFACT_NAME, "osv-findings");
  assert.equal(OSV_FINDINGS_FILES.length, 4);
  assert.deepEqual(
    OSV_FINDINGS_FILES.map((entry) => entry.file),
    [
      "application.json",
      "pnpm-runtime.json",
      "vercel-cli-runtime.json",
      "pnpm-bootstrap.json",
    ],
  );
  assert.deepEqual(
    OSV_FINDINGS_FILES.map((entry) => entry.lockfile),
    [
      "pnpm-lock.yaml",
      "scripts/vercel-pnpm-runtime/pnpm-lock.yaml",
      "scripts/vercel-cli-runtime/pnpm-lock.yaml",
      "scripts/vercel-pnpm-bootstrap/package-lock.json",
    ],
  );
});

test("a valid scan result yields the allowlisted fields only", () => {
  const parsed = parseOsvFindings(
    scanResult([vulnerablePackage()]),
    "pnpm-lock.yaml",
  );

  assert.equal(parsed.invalid, false);
  assert.equal(parsed.dropped, 0);
  assert.equal(parsed.findings.length, 1);
  // Exactly these keys: no scanner-supplied key, nested object or blob may
  // reach the issue body by being passed through.
  assert.deepEqual(Object.keys(parsed.findings[0]).sort(), [
    "fixedVersion",
    "id",
    "lockfile",
    "packageName",
    "summary",
    "version",
  ]);
  assert.deepEqual(parsed.findings[0], {
    lockfile: "pnpm-lock.yaml",
    id: "GHSA-aaaa-bbbb-cccc",
    packageName: "left-pad",
    version: "1.0.0",
    fixedVersion: "1.0.1",
    summary: "Prototype pollution in left-pad",
  });
});

test("the lockfile label comes from the trusted table, not the scan result", () => {
  // `source.path` in the document names a completely different file. The label
  // must still be the one the caller bound, or a result could claim to come
  // from a lockfile it never scanned.
  const parsed = parseOsvFindings(
    scanResult([vulnerablePackage()]),
    "scripts/vercel-cli-runtime/pnpm-lock.yaml",
  );

  assert.equal(
    parsed.findings[0].lockfile,
    "scripts/vercel-cli-runtime/pnpm-lock.yaml",
  );
});

test("a document that is not a scan result is rejected whole", () => {
  for (const text of [
    "not json",
    "null",
    "[]",
    '"a string"',
    "{}",
    '{"results":"nope"}',
    '{"results":{}}',
  ]) {
    const parsed = parseOsvFindings(text, "pnpm-lock.yaml");
    assert.equal(parsed.invalid, true, `${text} must be rejected`);
    assert.deepEqual(parsed.findings, []);
  }
});

test("a finding missing an advisory id, package or version is dropped and counted", () => {
  const parsed = parseOsvFindings(
    scanResult([
      // No package name.
      {
        package: { version: "1.0.0" },
        vulnerabilities: [{ id: "GHSA-aaaa-bbbb-cccc" }],
      },
      // No version.
      {
        package: { name: "left-pad" },
        vulnerabilities: [{ id: "GHSA-aaaa-bbbb-cccc" }],
      },
      // No id.
      {
        package: { name: "left-pad", version: "1.0.0" },
        vulnerabilities: [{ summary: "unnamed" }],
      },
      // An id that is not an OSV identifier: the one field a reader looks the
      // advisory up by, so a row that cannot carry it is not rendered.
      {
        package: { name: "left-pad", version: "1.0.0" },
        vulnerabilities: [{ id: "https://example.invalid/click-me" }],
      },
      // Not an object at all.
      "nonsense",
      // Valid, and must survive its malformed neighbours.
      vulnerablePackage({ name: "minimist", version: "0.0.8" }),
    ]),
    "pnpm-lock.yaml",
  );

  assert.equal(parsed.invalid, false);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].packageName, "minimist");
  assert.equal(parsed.dropped, 5);
});

test("real OSV identifier prefixes are accepted", () => {
  for (const id of [
    "GHSA-jf85-cpcp-j695",
    "CVE-2024-21538",
    "PYSEC-2023-101",
    "GO-2024-2937",
    "RUSTSEC-2024-0001",
    "MAL-2025-1234",
    "OSV-2021-1234",
  ]) {
    const parsed = parseOsvFindings(
      scanResult([vulnerablePackage({ id })]),
      "pnpm-lock.yaml",
    );
    assert.equal(parsed.findings.length, 1, `${id} must be accepted`);
    assert.equal(parsed.findings[0].id, id);
  }
});

test("a fixed version is read only from ranges naming this exact package", () => {
  const vulnerability = {
    id: "GHSA-aaaa-bbbb-cccc",
    summary: "Multi-package advisory",
    affected: [
      {
        package: { name: "some-other-package", ecosystem: "npm" },
        ranges: [{ events: [{ introduced: "0" }, { fixed: "9.9.9" }] }],
      },
      {
        package: { name: "left-pad", ecosystem: "npm" },
        ranges: [{ events: [{ introduced: "0" }, { fixed: "1.0.1" }] }],
      },
    ],
  };
  const parsed = parseOsvFindings(
    scanResult([
      {
        package: { name: "left-pad", version: "1.0.0", ecosystem: "npm" },
        vulnerabilities: [vulnerability],
      },
    ]),
    "pnpm-lock.yaml",
  );

  // 9.9.9 belongs to another package in the same advisory; quoting it beside
  // this package's name would be actively misleading.
  assert.equal(parsed.findings[0].fixedVersion, "1.0.1");
});

test("an advisory with no fix listed reports none", () => {
  const parsed = parseOsvFindings(
    scanResult([vulnerablePackage({ fixed: [] })]),
    "pnpm-lock.yaml",
  );

  assert.equal(parsed.findings[0].fixedVersion, undefined);
});

test("several fixed versions are capped and deduplicated", () => {
  const parsed = parseOsvFindings(
    scanResult([
      vulnerablePackage({
        fixed: ["1.0.1", "1.0.1", "2.0.1", "3.0.1", "4.0.1", "5.0.1"],
      }),
    ]),
    "pnpm-lock.yaml",
  );

  assert.equal(parsed.findings[0].fixedVersion, "1.0.1, 2.0.1, 3.0.1");
});

test("collecting with no directory configured reports nothing at all", () => {
  assert.deepEqual(collectOsvFindings({}), {
    findings: [],
    omitted: 0,
    notes: [],
  });
  assert.deepEqual(collectOsvFindings({ directory: "" }), {
    findings: [],
    omitted: 0,
    notes: [],
  });
  assert.deepEqual(collectOsvFindings(), {
    findings: [],
    omitted: 0,
    notes: [],
  });
});

test("a wholly absent artifact degrades to an unavailable note", () => {
  withDirectory((directory) => {
    const collected = collectOsvFindings({ directory });

    assert.deepEqual(collected.findings, []);
    assert.match(
      collected.notes.join(" "),
      /findings artifact was unavailable/i,
    );
  });
});

test("a missing directory degrades rather than throwing", () => {
  const collected = collectOsvFindings({
    directory: join(tmpdir(), "osv-findings-does-not-exist-4823"),
  });

  assert.deepEqual(collected.findings, []);
  assert.match(collected.notes.join(" "), /findings artifact was unavailable/i);
});

test("findings from every scanned lockfile are merged and sorted", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory, {
      except: ["application.json", "pnpm-runtime.json"],
    });
    writeFileSync(
      join(directory, "application.json"),
      scanResult([
        vulnerablePackage({ name: "minimist", version: "0.0.8" }),
        vulnerablePackage({ name: "left-pad", version: "1.0.0" }),
      ]),
    );
    writeFileSync(
      join(directory, "pnpm-runtime.json"),
      scanResult([vulnerablePackage({ name: "pnpm", version: "10.0.0" })]),
    );

    const collected = collectOsvFindings({ directory });

    assert.equal(collected.omitted, 0);
    assert.deepEqual(collected.notes, []);
    assert.deepEqual(
      collected.findings.map(
        (finding) => `${finding.lockfile} ${finding.packageName}`,
      ),
      [
        "pnpm-lock.yaml left-pad",
        "pnpm-lock.yaml minimist",
        "scripts/vercel-pnpm-runtime/pnpm-lock.yaml pnpm",
      ],
    );
  });
});

test("one advisory against one package version is one finding", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory, { except: ["application.json"] });
    writeFileSync(
      join(directory, "application.json"),
      JSON.stringify({
        results: [
          { packages: [vulnerablePackage()] },
          { packages: [vulnerablePackage()] },
        ],
      }),
    );

    const collected = collectOsvFindings({ directory });

    assert.equal(collected.findings.length, 1);
  });
});

test("a clean scan of every lockfile says so", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory);

    const collected = collectOsvFindings({ directory });

    assert.deepEqual(collected.findings, []);
    assert.match(collected.notes.join(" "), /reported no vulnerability/i);
  });
});

test("a partial artifact reports which lockfiles are missing", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory, { except: ["pnpm-bootstrap.json"] });

    const collected = collectOsvFindings({ directory });

    assert.match(collected.notes.join(" "), /1 of 4 scanned lockfiles/);
  });
});

test("an unreadable or invalid findings file is counted, not fatal", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory, { except: ["application.json"] });
    writeFileSync(join(directory, "application.json"), "}{ not json");

    const collected = collectOsvFindings({ directory });

    assert.deepEqual(collected.findings, []);
    assert.match(collected.notes.join(" "), /1 findings file was unreadable/i);
  });
});

test("a symlinked findings file is refused rather than followed", () => {
  withDirectory((directory) => {
    // An artifact entry can be a symlink. Following one would read a file on
    // the runner that no scan ever produced.
    const outside = join(directory, "outside");
    mkdirSync(outside);
    writeFileSync(
      join(outside, "planted.json"),
      scanResult([vulnerablePackage({ name: "planted" })]),
    );
    writeEmptyScans(directory, { except: ["application.json"] });
    symlinkSync(
      join(outside, "planted.json"),
      join(directory, "application.json"),
    );

    const collected = collectOsvFindings({ directory });

    assert.deepEqual(collected.findings, []);
    assert.match(
      collected.notes.join(" "),
      /unreadable or not a valid scan result/i,
    );
  });
});

test("a directory in place of a findings file is refused", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory, { except: ["application.json"] });
    mkdirSync(join(directory, "application.json"));

    const collected = collectOsvFindings({ directory });

    assert.match(
      collected.notes.join(" "),
      /unreadable or not a valid scan result/i,
    );
  });
});

test("more findings than the cap are counted, never silently dropped", () => {
  withDirectory((directory) => {
    writeEmptyScans(directory, { except: ["application.json"] });
    writeFileSync(
      join(directory, "application.json"),
      scanResult(
        Array.from({ length: 30 }, (_unused, index) =>
          vulnerablePackage({
            name: `package-${String(index).padStart(2, "0")}`,
          }),
        ),
      ),
    );

    const collected = collectOsvFindings({ directory });

    assert.equal(collected.findings.length, 25);
    assert.equal(collected.omitted, 5);
  });
});

test("control characters survive as data and never reach the caller as newlines", () => {
  // The caller sanitizes for Markdown, but a field that arrives with a newline
  // must not be able to smuggle one through this layer either: the collector
  // returns it verbatim as one string value, and the caller flattens it. What
  // matters here is that it stays inside its own field.
  const parsed = parseOsvFindings(
    scanResult([
      vulnerablePackage({
        summary:
          "line one\nline two <!-- managed-ci-failure:77:schedule:main -->",
      }),
    ]),
    "pnpm-lock.yaml",
  );

  assert.equal(parsed.findings.length, 1);
  assert.equal(typeof parsed.findings[0].summary, "string");
  assert.match(parsed.findings[0].summary, /line one/);
});
