import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildGitHubActionsCostProof,
  inspectGitHubActionsUsage,
  runGitHubActionsCostCli,
  validateGitHubActionsCostProof,
} from "./vercel-cost-github-actions.mjs";
import { createSyntheticGitHubActionsEvidence } from "./vercel-cost-github-actions.test-helper.mjs";

const scriptPath = fileURLToPath(
  new URL("./vercel-cost-github-actions.mjs", import.meta.url),
);

function workspace() {
  return mkdtempSync(join(tmpdir(), "vercel-github-cost-"));
}

function rewrite(path, transform) {
  const next = transform(readFileSync(path, "utf8"));
  writeFileSync(path, next, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function rewriteJson(path, transform) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  transform(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rebindUsageMetadata(evidence) {
  rewriteJson(evidence.usageMetadata, (metadata) => {
    metadata.csvSha256 = sha256(readFileSync(evidence.usageCsv));
  });
}

function rebindAuditMetadata(evidence) {
  rewriteJson(evidence.auditMetadata, (metadata) => {
    metadata.transcriptSha256 = sha256(readFileSync(evidence.auditTranscript));
  });
}

test("builds and revalidates a source-bound eligible proof", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
    assert.deepEqual(evidence.proof.analyzerFragment, {
      standardRunnerMinutes: 300,
      largerRunnerMinutes: 0,
      artifactStorageGbHours: 5,
      cacheStorageGbHours: 50,
      repositoryPublicEntireWindow: true,
    });
    assert.equal(
      validateGitHubActionsCostProof(evidence.proofPath).eligibleForAnalyzer,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parses quoted RFC4180 values, a UTF-8 BOM, and reordered exact headers", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    const lines = readFileSync(evidence.usageCsv, "utf8").trimEnd().split("\n");
    const headers = lines[0].split(",");
    const rows = lines.slice(1).map((line) => line.split(","));
    rows[0][12] =
      "mento-protocol/frontend-monorepo/.github/workflows/vercel-main-deployment.yml@refs/heads/main";
    const order = [2, 0, 1, ...headers.map((_, index) => index).slice(3)];
    const quoted = (value) => `"${value.replaceAll('"', '""')}"`;
    const csv = `\uFEFF${order.map((index) => quoted(headers[index])).join(",")}\r\n${rows
      .map((row) => order.map((index) => quoted(row[index])).join(","))
      .join("\r\n")}\r\n`;
    writeFileSync(evidence.usageCsv, csv, { mode: 0o600 });
    chmodSync(evidence.usageCsv, 0o600);
    rebindUsageMetadata(evidence);
    assert.equal(
      buildGitHubActionsCostProof(evidence).eligibleForAnalyzer,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed on unknown Actions SKUs and units", () => {
  for (const [from, to, expected] of [
    ["actions_linux", "actions_future_quantum", /unknown Actions SKU/],
    [",minutes,", ",seconds,", /runner unit is unsupported/],
  ]) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewrite(evidence.usageCsv, (value) => value.replace(from, to));
      rebindUsageMetadata(evidence);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("does not attribute nonzero blank-path repository storage to the migration", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replaceAll(".github/workflows/vercel-preview-worker.yml,", ","),
    );
    rebindUsageMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /nonzero storage without an attributable deployment workflow_path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses exact decimal arithmetic for amount reconciliation", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replace("1.8,1.8,0,", "0.3,0.1,0.19999999999999998,"),
    );
    rebindUsageMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /gross_amount - discount_amount = net_amount/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires a complete audit pagination chain and no visibility changes", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(
      evidence.auditTranscript,
      () =>
        'HTTP/2 200\nlink: <https://api.github.com/orgs/mento-protocol/audit-log?after=cursor>; rel="next"\n\n[]\n',
    );
    rebindAuditMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /pagination chain is incomplete/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const changedRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(changedRoot);
    rewrite(
      evidence.auditTranscript,
      () =>
        'HTTP/2 200\ncontent-type: application/json\n\n[{"_document_id":"one","action":"repo.access","repo":"mento-protocol/frontend-monorepo","created_at":"2026-07-15T23:57:00.000Z"}]\n',
    );
    rebindAuditMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.visibility.repositoryPublicEntireWindow, false);
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(changedRoot, { recursive: true, force: true });
  }
});

test("rejects duplicate audit page URLs and visibility changes in the floored boundary second", () => {
  const duplicateRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(duplicateRoot);
    rewriteJson(evidence.auditMetadata, (metadata) => {
      metadata.pageUrls.push(metadata.pageUrls[0]);
    });
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /pageUrls must be unique/,
    );
  } finally {
    rmSync(duplicateRoot, { recursive: true, force: true });
  }

  const visibilityRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(visibilityRoot);
    rewrite(
      evidence.auditTranscript,
      () =>
        'HTTP/2 200\ncontent-type: application/json\n\n[{"_document_id":"boundary-second","action":"repo.access","repo":"mento-protocol/frontend-monorepo","created_at":"2026-07-15T23:55:00.000Z"}]\n',
    );
    rebindAuditMetadata(evidence);
    assert.equal(
      buildGitHubActionsCostProof(evidence).eligibleForAnalyzer,
      false,
    );
  } finally {
    rmSync(visibilityRoot, { recursive: true, force: true });
  }
});

test("makes custom-image storage explicitly ineligible", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replace(
        "actions_cache_storage,50",
        "actions_custom_image_storage,50",
      ),
    );
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.reconciliation.customImageStorageZero, false);
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("binds collector tree integrity and runner-minute reconciliation", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    const samplePath = join(
      evidence.observationRoot,
      "samples",
      "2026-07-23T00-01-00.000Z",
      "capture.json",
    );
    rewriteJson(samplePath, (sample) => {
      sample.runnerJobs[0].name = "tampered";
    });
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /seal does not match capture\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const mismatchRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(mismatchRoot);
    rewrite(evidence.usageCsv, (value) =>
      value.replace(",300,minutes,", ",299,minutes,"),
    );
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(
      proof.reconciliation.standardRunnerMinutesMatchCollector,
      false,
    );
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(mismatchRoot, { recursive: true, force: true });
  }
});

test("requires a public start boundary and cumulative full-window terminal jobs", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    const boundaryPath = join(
      evidence.observationRoot,
      "boundary",
      "start.json",
    );
    rewriteJson(boundaryPath, (boundary) => {
      boundary.repositoryVisibility.publicAtCapture = false;
    });
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /start boundary was not public|start boundary conflicts with its interval digest/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const cumulativeRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(cumulativeRoot);
    const samplePath = join(
      evidence.observationRoot,
      "samples",
      "2026-07-23T00-01-00.000Z",
      "capture.json",
    );
    const sealPath = join(
      evidence.observationRoot,
      "samples",
      "2026-07-23T00-01-00.000Z",
      "seal.json",
    );
    const sample = JSON.parse(readFileSync(samplePath, "utf8"));
    sample.runnerJobs[0].startedAtUtc = "2026-07-15T23:59:59.000Z";
    const sampleBytes = Buffer.from(`${JSON.stringify(sample, null, 2)}\n`);
    writeFileSync(samplePath, sampleBytes, { mode: 0o600 });
    chmodSync(samplePath, 0o600);
    const captureSha256 = sha256(sampleBytes);
    writeFileSync(
      sealPath,
      `${JSON.stringify(
        {
          schema: "vercel-cost-capture-seal:v2",
          captureSchema: sample.schema,
          captureSha256,
          payloadFiles: [],
          treeSha256: sha256(
            `${JSON.stringify({ captureSha256, payloadFiles: [] }, null, 2)}\n`,
          ),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    chmodSync(sealPath, 0o600);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /crosses the half-open interval/,
    );
  } finally {
    rmSync(cumulativeRoot, { recursive: true, force: true });
  }
});

test("inspect writes private shape only and build stdout excludes financials", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    const inspection = join(
      evidence.evidenceRoot,
      "github",
      "usage-shape.json",
    );
    let output = "";
    runGitHubActionsCostCli(
      ["inspect", "--usage-csv", evidence.usageCsv, "--output", inspection],
      { stdout: { write: (value) => (output += value) } },
    );
    assert.match(output, /usage shape written/);
    assert.doesNotMatch(output, /gross|discount|net|0\.4|1\.8/);
    assert.equal(
      readFileSync(inspection, "utf8").includes("actions_linux"),
      true,
    );
    assert.equal(statSync(inspection).mode & 0o777, 0o600);

    rmSync(evidence.proofPath);
    output = "";
    const result = runGitHubActionsCostCli(
      [
        "build",
        "--usage-csv",
        evidence.usageCsv,
        "--usage-metadata",
        evidence.usageMetadata,
        "--audit-transcript",
        evidence.auditTranscript,
        "--audit-metadata",
        evidence.auditMetadata,
        "--observation-root",
        evidence.observationRoot,
        "--output",
        evidence.proofPath,
      ],
      { stdout: { write: (value) => (output += value) } },
    );
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(output, /gross|discount|net|0\.4|1\.8/);
    const stalePublication = `${evidence.proofPath}.tmp-${sha256(
      readFileSync(evidence.proofPath),
    )}`;
    linkSync(evidence.proofPath, stalePublication);
    assert.throws(
      () =>
        runGitHubActionsCostCli([
          "build",
          "--usage-csv",
          evidence.usageCsv,
          "--usage-metadata",
          evidence.usageMetadata,
          "--audit-transcript",
          evidence.auditTranscript,
          "--audit-metadata",
          evidence.auditMetadata,
          "--observation-root",
          evidence.observationRoot,
          "--output",
          evidence.proofPath,
        ]),
      /EEXIST/,
    );
    assert.equal(existsSync(stalePublication), false);
    assert.equal(statSync(evidence.proofPath).nlink, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovers a real SIGKILL between output link and staging unlink", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    const output = join(
      evidence.evidenceRoot,
      "github",
      "crash-inspection.json",
    );
    const childCode = `
      import { inspectGitHubActionsUsage } from ${JSON.stringify(
        pathToFileURL(scriptPath).href,
      )};
      inspectGitHubActionsUsage(
        { usageCsv: process.argv[1], output: process.argv[2] },
        { afterLink: () => process.kill(process.pid, "SIGKILL") },
      );
    `;
    const killed = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", childCode, evidence.usageCsv, output],
      {
        encoding: "utf8",
      },
    );
    assert.equal(killed.signal, "SIGKILL");
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(statSync(output).nlink, 2);
    const before = readFileSync(output);

    assert.throws(
      () => inspectGitHubActionsUsage({ usageCsv: evidence.usageCsv, output }),
      /EEXIST/,
    );
    assert.deepEqual(readFileSync(output), before);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(statSync(output).nlink, 1);
    assert.deepEqual(
      readdirSync(join(evidence.evidenceRoot, "github")).filter((name) =>
        name.startsWith("crash-inspection.json.tmp-"),
      ),
      [],
    );

    const operatorBytes = "operator-owned\n";
    const ambiguous = `${output}.tmp-${sha256(operatorBytes)}`;
    writeFileSync(ambiguous, operatorBytes, { mode: 0o600 });
    chmodSync(ambiguous, 0o600);
    assert.throws(
      () => inspectGitHubActionsUsage({ usageCsv: evidence.usageCsv, output }),
      /staging entry is ambiguous/,
    );
    assert.equal(readFileSync(ambiguous, "utf8"), operatorBytes);
    assert.deepEqual(readFileSync(output), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("proof validation catches raw source and proof tampering", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replace("actions_linux", "actions_windows"),
    );
    assert.throws(
      () => validateGitHubActionsCostProof(evidence.proofPath),
      /does not bind the CSV bytes/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const proofRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(proofRoot);
    rewriteJson(evidence.proofPath, (proof) => {
      proof.analyzerFragment.standardRunnerMinutes = 1;
    });
    assert.throws(
      () => validateGitHubActionsCostProof(evidence.proofPath),
      /does not reconcile to its bound sources/,
    );
  } finally {
    rmSync(proofRoot, { recursive: true, force: true });
  }
});

test("rejects symlinked files, hard-linked files, and nonprivate ancestors", () => {
  const symlinkRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(symlinkRoot);
    const linkPath = join(
      evidence.evidenceRoot,
      "github",
      "raw",
      "usage-link.csv",
    );
    symlinkSync(evidence.usageCsv, linkPath);
    assert.throws(
      () => buildGitHubActionsCostProof({ ...evidence, usageCsv: linkPath }),
      /regular non-symlink file/,
    );
  } finally {
    rmSync(symlinkRoot, { recursive: true, force: true });
  }

  const hardlinkRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(hardlinkRoot);
    linkSync(
      evidence.usageCsv,
      join(evidence.evidenceRoot, "github", "raw", "usage-hardlink.csv"),
    );
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /exactly one hard link/,
    );
  } finally {
    rmSync(hardlinkRoot, { recursive: true, force: true });
  }

  const modeRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(modeRoot);
    chmodSync(join(evidence.evidenceRoot, "github", "raw"), 0o755);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /parent directories must use mode 0700/,
    );
  } finally {
    rmSync(modeRoot, { recursive: true, force: true });
  }
});
