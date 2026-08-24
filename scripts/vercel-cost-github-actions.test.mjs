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
  truncateSync,
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function rebindUsageMetadata(evidence) {
  rewriteJson(evidence.usageMetadata, (metadata) => {
    metadata.csvSha256 = sha256(readFileSync(evidence.usageCsv));
  });
}

function rebindAuditMetadata(evidence) {
  rewriteJson(evidence.auditMetadata, (metadata) => {
    const bytes = readFileSync(evidence.auditEvidence);
    if (metadata.source === "github-org-audit-log-rest-link-transcript") {
      metadata.transcriptByteLength = bytes.length;
      metadata.transcriptSha256 = sha256(bytes);
      metadata.eventCount =
        bytes.toString("utf8").match(/"action"\s*:\s*"repo\.access"/g)
          ?.length ?? 0;
    } else if (
      metadata.source === "github-org-audit-log-owner-web-json-export"
    ) {
      metadata.exportByteLength = bytes.length;
      metadata.exportSha256 = sha256(bytes);
      const events = JSON.parse(bytes);
      metadata.eventCount = events.length;
      metadata.ownerAttestation.matchingEntryCount = events.length;
    } else {
      metadata.screenshotByteLength = bytes.length;
      metadata.screenshotSha256 = sha256(bytes);
    }
  });
}

function rewriteTerminalSample(evidence, transform) {
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
  transform(sample);
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
}

function rewriteWebAuditEvents(evidence, events) {
  writeFileSync(
    evidence.auditEvidence,
    `${JSON.stringify(events, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  chmodSync(evidence.auditEvidence, 0o600);
  rebindAuditMetadata(evidence);
}

function visibilityEvent(
  createdAt = "2026-07-16T00:00:00.000Z",
  documentId = "visibility-event",
) {
  return {
    _document_id: documentId,
    action: "repo.access",
    repo: "mento-protocol/frontend-monorepo",
    created_at: createdAt,
  };
}

test("builds and revalidates a source-bound eligible proof", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
    assert.equal(evidence.proof.catalog.product, "actions");
    assert.equal(evidence.proof.catalog.repository, "frontend-monorepo");
    assert.equal(evidence.proof.usage.repositoryActionsRowCount, 3);
    assert.equal(evidence.proof.usage.targetRowCount, 3);
    assert.equal(evidence.proof.usage.ignoredNonDeploymentRowCount, 0);
    assert.equal(evidence.proof.usage.repositoryLevelStorageRowCount, 0);
    assert.equal(evidence.proof.collector.runnerJobCount, 5);
    assert.equal(
      evidence.proof.reconciliation
        .standardRunnerMinutesWithinCollectorTolerance,
      true,
    );
    assert.equal(
      evidence.proof.reconciliation.collectorMinusUsageStandardRunnerMinutes,
      0,
    );
    assert.deepEqual(evidence.proof.analyzerFragment, {
      standardRunnerMinutes: 300,
      largerRunnerMinutes: 0,
      artifactStorageGbHours: 5,
      cacheStorageGbHours: 50,
      repositoryPublicEntireWindow: true,
      mainDeploymentObservationOpportunities: 4,
    });
    assert.equal(
      validateGitHubActionsCostProof(evidence.proofPath).eligibleForAnalyzer,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses detailed billing SKUs when terminal jobs have empty labels", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      runnerLabels: [],
    });
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
    assert.equal(
      evidence.proof.reconciliation.standardRunnerMinutesMatchCollector,
      true,
    );
    assert.equal(evidence.proof.reconciliation.largerRunnerMinutesZero, true);
    assert.equal(
      validateGitHubActionsCostProof(evidence.proofPath).eligibleForAnalyzer,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("builds and revalidates an eligible empty owner web JSON export", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "web",
    });
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
    assert.equal(
      evidence.proof.visibility.auditSource,
      "github-org-audit-log-owner-web-json-export",
    );
    assert.equal(evidence.proof.visibility.auditFormat, "json-array");
    assert.equal(evidence.proof.visibility.repositoryAccessEventCount, 0);
    assert.equal(
      validateGitHubActionsCostProof(evidence.proofPath).eligibleForAnalyzer,
      true,
    );

    rmSync(evidence.proofPath);
    const result = runGitHubActionsCostCli([
      "build",
      "--usage-csv",
      evidence.usageCsv,
      "--usage-metadata",
      evidence.usageMetadata,
      "--audit-web-export",
      evidence.auditEvidence,
      "--audit-metadata",
      evidence.auditMetadata,
      "--observation-root",
      evidence.observationRoot,
      "--output",
      evidence.proofPath,
    ]);
    assert.equal(result.exitCode, 0);
    assert.throws(
      () =>
        runGitHubActionsCostCli([
          "build",
          "--usage-csv",
          evidence.usageCsv,
          "--usage-metadata",
          evidence.usageMetadata,
          "--audit-rest-transcript",
          evidence.auditEvidence,
          "--audit-web-export",
          evidence.auditEvidence,
          "--audit-metadata",
          evidence.auditMetadata,
          "--observation-root",
          evidence.observationRoot,
          "--output",
          evidence.proofPath,
        ]),
      /Usage:/,
    );
    assert.throws(
      () =>
        buildGitHubActionsCostProof({
          ...evidence,
          auditWebExport: undefined,
          auditRestTranscript: evidence.auditEvidence,
        }),
      /source conflicts with the selected CLI option/,
    );
    assert.throws(
      () =>
        runGitHubActionsCostCli([
          "build",
          "--usage-csv",
          evidence.usageCsv,
          "--usage-metadata",
          evidence.usageMetadata,
          "--audit-metadata",
          evidence.auditMetadata,
          "--observation-root",
          evidence.observationRoot,
          "--output",
          evidence.proofPath,
        ]),
      /Usage:/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("builds and revalidates an eligible owner web zero-result attestation", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "zero-result",
    });
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
    assert.equal(
      evidence.proof.visibility.auditSource,
      "github-org-audit-log-owner-web-zero-result-attestation",
    );
    assert.equal(
      evidence.proof.visibility.auditFormat,
      "browser-screenshot-png",
    );
    assert.equal(evidence.proof.visibility.auditScreenshotPixelWidth, 800);
    assert.equal(evidence.proof.visibility.auditScreenshotPixelHeight, 600);
    assert.equal(evidence.proof.visibility.repositoryAccessEventCount, 0);
    assert.equal(
      validateGitHubActionsCostProof(evidence.proofPath).eligibleForAnalyzer,
      true,
    );

    rmSync(evidence.proofPath);
    const result = runGitHubActionsCostCli([
      "build",
      "--usage-csv",
      evidence.usageCsv,
      "--usage-metadata",
      evidence.usageMetadata,
      "--audit-web-zero-screenshot",
      evidence.auditEvidence,
      "--audit-metadata",
      evidence.auditMetadata,
      "--observation-root",
      evidence.observationRoot,
      "--output",
      evidence.proofPath,
    ]);
    assert.equal(result.exitCode, 0);

    rewriteJson(evidence.auditMetadata, (metadata) => {
      metadata.pageUrl = metadata.pageUrl.replace(
        "action%3Arepo.access",
        "action%3Arepo.create",
      );
    });
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /page URL does not bind the exact query/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects zero-result audit URLs with alternate authority or fragments", () => {
  const cases = [
    (metadata) => {
      const url = new URL(metadata.pageUrl);
      url.username = "attacker";
      url.password = "secret";
      metadata.pageUrl = url.toString();
    },
    (metadata) => {
      const url = new URL(metadata.pageUrl);
      url.port = "444";
      metadata.pageUrl = url.toString();
    },
    (metadata) => {
      const url = new URL(metadata.pageUrl);
      url.hash = "not-the-page";
      metadata.pageUrl = url.toString();
    },
    (metadata) =>
      (metadata.pageUrl = metadata.pageUrl.replace(
        "https://github.com/",
        "https://github.com:443/",
      )),
  ];
  for (const mutate of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "zero-result",
      });
      rewriteJson(evidence.auditMetadata, mutate);
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /page URL does not bind the exact query/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects JPEG, incomplete PNG, and undersized PNG zero-result screenshots", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "zero-result",
    });
    writeFileSync(
      evidence.auditEvidence,
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]),
      { mode: 0o600 },
    );
    rewriteJson(evidence.auditMetadata, (metadata) => {
      metadata.format = "browser-screenshot-jpeg";
    });
    rebindAuditMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /metadata source or format is unsupported/,
    );

    writeFileSync(
      evidence.auditEvidence,
      Buffer.from("iVBORw0KGgo=", "base64"),
      { mode: 0o600 },
    );
    rewriteJson(evidence.auditMetadata, (metadata) => {
      metadata.format = "browser-screenshot-png";
    });
    rebindAuditMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /not a complete PNG/,
    );

    writeFileSync(
      evidence.auditEvidence,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      { mode: 0o600 },
    );
    rebindAuditMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /screenshot dimensions must be between/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an oversized zero-result screenshot before reading it", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "zero-result",
    });
    truncateSync(evidence.auditEvidence, 25 * 1_024 * 1_024 + 1);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /audit evidence exceeds 26214400 bytes/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects PNG palette and empty IDAT chunks after image data", () => {
  for (const [chunk, expected] of [
    [pngChunk("PLTE", Buffer.alloc(0)), /unsupported critical chunk: PLTE/],
    [pngChunk("IDAT", Buffer.alloc(0)), /misplaced IDAT data/],
  ]) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "zero-result",
      });
      const original = readFileSync(evidence.auditEvidence);
      const iendOffset = original.length - 12;
      writeFileSync(
        evidence.auditEvidence,
        Buffer.concat([
          original.subarray(0, iendOffset),
          chunk,
          original.subarray(iendOffset),
        ]),
        { mode: 0o600 },
      );
      rebindAuditMetadata(evidence);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects non-ASCII and reserved PNG chunk type bytes", () => {
  const mutations = [
    (original) => {
      const invalid = Buffer.from(original);
      const typeStart = invalid.length - 8;
      invalid[typeStart] = 0xc9;
      invalid.writeUInt32BE(
        crc32(invalid.subarray(typeStart, typeStart + 4)),
        invalid.length - 4,
      );
      return invalid;
    },
    (original) => {
      const iendOffset = original.length - 12;
      return Buffer.concat([
        original.subarray(0, iendOffset),
        pngChunk("text", Buffer.alloc(0)),
        original.subarray(iendOffset),
      ]);
    },
  ];
  const errors = [/chunk type is invalid/, /chunk reserved bit is invalid/];
  for (const [index, mutate] of mutations.entries()) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "zero-result",
      });
      writeFileSync(
        evidence.auditEvidence,
        mutate(readFileSync(evidence.auditEvidence)),
        { mode: 0o600 },
      );
      rebindAuditMetadata(evidence);
      assert.throws(() => buildGitHubActionsCostProof(evidence), errors[index]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects trailing bytes after the PNG zlib stream", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "zero-result",
    });
    const original = readFileSync(evidence.auditEvidence);
    let offset = 8;
    let rewritten = null;
    while (offset < original.length) {
      const length = original.readUInt32BE(offset);
      const type = original.subarray(offset + 4, offset + 8).toString("ascii");
      const end = offset + 12 + length;
      if (type === "IDAT") {
        const data = original.subarray(offset + 8, offset + 8 + length);
        rewritten = Buffer.concat([
          original.subarray(0, offset),
          pngChunk("IDAT", Buffer.concat([data, Buffer.from([1, 2, 3])])),
          original.subarray(end),
        ]);
        break;
      }
      offset = end;
    }
    assert.notEqual(rewritten, null);
    writeFileSync(evidence.auditEvidence, rewritten, { mode: 0o600 });
    rebindAuditMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /trailing compressed data/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects PNG chunk storms before allocating unbounded views", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "zero-result",
    });
    const original = readFileSync(evidence.auditEvidence);
    const iendOffset = original.length - 12;
    const ancillary = pngChunk("tEXt", Buffer.alloc(0));
    writeFileSync(
      evidence.auditEvidence,
      Buffer.concat([
        original.subarray(0, iendOffset),
        ...Array.from({ length: 1_024 }, () => ancillary),
        original.subarray(iendOffset),
      ]),
      { mode: 0o600 },
    );
    rebindAuditMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /PNG exceeds 1024 chunks/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects wrong web export source, format, query, repository, and window metadata", () => {
  const cases = [
    [
      (metadata) =>
        (metadata.schema = "vercel-cost-github-audit-export-metadata:v2"),
      /metadata schema is unsupported/,
    ],
    [
      (metadata) => (metadata.source = "github-org-audit-log-rest"),
      /source is unsupported/,
    ],
    [(metadata) => (metadata.format = "ndjson"), /source or format/],
    [
      (metadata) => (metadata.queryPhrase += " actor:someone"),
      /query is not exact/,
    ],
    [
      (metadata) => (metadata.repository = "other/repository"),
      /repository conflicts/,
    ],
    [
      (metadata) => (metadata.queryStartUtc = "2026-07-15T23:55:01.000Z"),
      /floored pre-window boundary/,
    ],
    [
      (metadata) => (metadata.startUtc = "2026-07-17T00:00:00.000Z"),
      /interval conflicts/,
    ],
    [
      (metadata) =>
        (metadata.queryEndUtcExclusive = "2026-07-23T00:01:00.000Z"),
      /must cover the post-window terminal sample/,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "web",
      });
      rewriteJson(evidence.auditMetadata, mutate);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("binds web export digest, byte length, event count, and owner matching count", () => {
  const cases = [
    [
      (metadata) => (metadata.exportSha256 = "f".repeat(64)),
      /web export bytes/,
    ],
    [(metadata) => (metadata.exportByteLength += 1), /web export byte length/],
    [(metadata) => (metadata.eventCount = 1), /eventCount conflicts/],
    [
      (metadata) => (metadata.ownerAttestation.matchingEntryCount = 1),
      /matchingEntryCount conflicts/,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "web",
      });
      rewriteJson(evidence.auditMetadata, mutate);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("requires an admin owner attestation with successful unlimited export", () => {
  const cases = [
    [(metadata) => delete metadata.ownerAttestation, /must contain exactly/],
    [
      (metadata) => (metadata.ownerAttestation.role = "member"),
      /organization admin owner/,
    ],
    [
      (metadata) => (metadata.ownerAttestation.exportCompleted = false),
      /successful completion/,
    ],
    [
      (metadata) => (metadata.ownerAttestation.sizeLimitReached = true),
      /no provider limit/,
    ],
    [
      (metadata) =>
        (metadata.ownerAttestation.processingTimeLimitReached = true),
      /no provider limit/,
    ],
    [
      (metadata) => (metadata.ownerAttestation.exportError = "timed out"),
      /no export error/,
    ],
  ];
  for (const [mutate, expected] of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "web",
      });
      rewriteJson(evidence.auditMetadata, mutate);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("requires the web export to be one strict JSON array rather than malformed JSON or NDJSON", () => {
  for (const raw of ["{", "{}\n{}\n", '{"events":[]}\n']) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "web",
      });
      writeFileSync(evidence.auditEvidence, raw, { mode: 0o600 });
      chmodSync(evidence.auditEvidence, 0o600);
      rewriteJson(evidence.auditMetadata, (metadata) => {
        const bytes = readFileSync(evidence.auditEvidence);
        metadata.exportByteLength = bytes.length;
        metadata.exportSha256 = sha256(bytes);
      });
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /must be valid JSON|must be a JSON array/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("requires exact action, repository, query window, and unique document IDs in web rows", () => {
  const cases = [
    [[{ ...visibilityEvent(), action: "repo.rename" }], /action is outside/],
    [
      [{ ...visibilityEvent(), repo: "other/repository" }],
      /repository is outside/,
    ],
    [
      [
        visibilityEvent("2026-07-16T00:00:00.000Z", "same"),
        visibilityEvent("2026-07-17T00:00:00.000Z", "same"),
      ],
      /_document_id is missing or duplicated/,
    ],
    [
      [{ ...visibilityEvent(), _document_id: undefined }],
      /_document_id is missing/,
    ],
    [
      [visibilityEvent("2026-07-15T23:54:59.999Z")],
      /outside the covering half-open query/,
    ],
    [
      [visibilityEvent("2026-07-23T00:02:00.000Z")],
      /outside the covering half-open query/,
    ],
  ];
  for (const [events, expected] of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root, {
        auditSource: "web",
      });
      rewriteWebAuditEvents(evidence, events);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("includes the floored start second and the instant before the exclusive query end", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "web",
    });
    rewriteWebAuditEvents(evidence, [
      visibilityEvent("2026-07-15T23:55:00.000Z", "start-second"),
      visibilityEvent("2026-07-23T00:01:59.999Z", "end-minus"),
    ]);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.visibility.repositoryAccessEventCount, 2);
    assert.equal(proof.visibility.repositoryPublicEntireWindow, false);
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts GitHub web export created_at timestamps in documented epoch milliseconds", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "web",
    });
    const event = visibilityEvent();
    event.created_at = Date.parse(event.created_at);
    rewriteWebAuditEvents(evidence, [event]);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.visibility.repositoryAccessEventCount, 1);
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a valid nonzero web visibility event makes the proof ineligible", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root, {
      auditSource: "web",
    });
    rewriteWebAuditEvents(evidence, [visibilityEvent()]);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.visibility.repositoryAccessEventCount, 1);
    assert.equal(proof.eligibleForAnalyzer, false);
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

test("requires exact lowercase product and short repository source tokens", () => {
  for (const [from, to] of [
    [",actions,", ",Actions,"],
    [",frontend-monorepo,", ",mento-protocol/frontend-monorepo,"],
  ]) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewrite(evidence.usageCsv, (value) => value.replaceAll(from, to));
      rebindUsageMetadata(evidence);
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /no Actions rows for the repository/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("ignores other products and nondeployment workflow rows", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) => {
      const extraRows = [
        "2026-07-17,git_lfs,git_lfs_storage,1,gigabyte-hours,0,0,0,0,,mento-protocol,frontend-monorepo,,",
        "2026-07-17,actions,actions_linux,90,minutes,0.006,0.54,0.54,0,,mento-protocol,frontend-monorepo,.github/workflows/ci.yml,",
        "2026-07-17,actions,actions_storage,9,gigabyte-hours,0,0,0,0,,mento-protocol,frontend-monorepo,.github/workflows/ci.yml,",
        "2026-07-17,actions,actions_linux,1,minutes,0.006,0.006,0.006,0,,mento-protocol,frontend-monorepo,dynamic/dependabot/dependabot-updates,",
      ];
      return `${value.trimEnd()}\n${extraRows.join("\n")}\n`;
    });
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.usage.repositoryActionsRowCount, 6);
    assert.equal(proof.usage.targetRowCount, 3);
    assert.equal(proof.usage.ignoredNonDeploymentRowCount, 3);
    assert.equal(proof.usage.standardRunner.quantity, "300");
    assert.equal(proof.usage.artifactStorage.quantity, "5");
    assert.equal(proof.eligibleForAnalyzer, true);
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

test("rejects blank workflow paths for runner and unknown Actions SKUs", () => {
  for (const row of [
    "2026-07-17,actions,actions_linux_2_core_advanced,1,minutes,1,1,0,1,,mento-protocol,frontend-monorepo,,",
    "2026-07-17,actions,actions_future_storage,1,gigabyte-hours,1,1,0,1,,mento-protocol,frontend-monorepo,,",
  ]) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewrite(evidence.usageCsv, (value) => `${value.trimEnd()}\n${row}\n`);
      rebindUsageMetadata(evidence);
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /blank workflow_path for a non-storage or unknown SKU/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects whitespace and malformed workflow paths", () => {
  for (const workflowPath of [
    " ",
    "ci.yml",
    "https://github.com/workflow.yml",
    ".github/workflows/vercel-main-deployment.yml@refs/heads/../evil",
    ".github/workflows/vercel-main-deployment.yml@refs/heads/.hidden",
    ".github/workflows/vercel-main-deployment.yml@refs/heads/locked.lock",
    ".github/workflows/vercel-main-deployment.yml@refs/heads/double//slash",
    "dynamic/./dependabot-updates",
    "dynamic/dependabot/..",
  ]) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewrite(evidence.usageCsv, (value) => {
        const row = `2026-07-17,actions,actions_linux_2_core_advanced,1,minutes,1,1,0,1,,mento-protocol,frontend-monorepo,${workflowPath},`;
        return `${value.trimEnd()}\n${row}\n`;
      });
      rebindUsageMetadata(evidence);
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /workflow_path is malformed/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("retains blank-path repository storage as a conservative upper bound", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replaceAll(".github/workflows/vercel-preview-worker.yml,", ","),
    );
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.usage.repositoryLevelStorageRowCount, 2);
    assert.equal(proof.usage.artifactStorage.quantity, "5");
    assert.equal(proof.usage.cacheStorage.quantity, "50");
    assert.equal(proof.eligibleForAnalyzer, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("makes nonzero storage net cost ineligible", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replace("0.04,0.04,0,", "0.04,0,0.04,"),
    );
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.reconciliation.artifactStorageNetAmountZero, false);
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("makes nonzero larger-runner net cost ineligible", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) => {
      const row =
        "2026-07-17,actions,actions_linux_2_core_advanced,0,minutes,1,1,0,1,,mento-protocol,frontend-monorepo,.github/workflows/vercel-main-deployment.yml,";
      return `${value.trimEnd()}\n${row}\n`;
    });
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.reconciliation.largerRunnerMinutesZero, true);
    assert.equal(proof.reconciliation.largerRunnerNetAmountZero, false);
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects fractional runner quantities before analyzer reconciliation", () => {
  const cases = [
    (value) =>
      value.replace(
        "actions_linux,300,",
        "actions_linux,299.99999999999999999,",
      ),
    (value) => {
      const tiny = `0.${"0".repeat(400)}1`;
      const row = `2026-07-17,actions,actions_linux_2_core_advanced,${tiny},minutes,0,0,0,0,,mento-protocol,frontend-monorepo,.github/workflows/vercel-main-deployment.yml,`;
      return `${value.trimEnd()}\n${row}\n`;
    },
  ];
  for (const mutate of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewrite(evidence.usageCsv, mutate);
      rebindUsageMetadata(evidence);
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /runner minutes must be a whole number/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects runner quantities above the analyzer safe-integer range", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replace("actions_linux,300,", "actions_linux,9007199254740992,"),
    );
    rebindUsageMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /outside the analyzer safe-integer range/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts storage quantities that round-trip through exponent notation", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value
        .replace("actions_storage,5,", "actions_storage,0.0000001,")
        .replace(
          "actions_cache_storage,50,",
          "actions_cache_storage,1000000000000000000000,",
        ),
    );
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.analyzerFragment.artifactStorageGbHours, 0.0000001);
    assert.equal(
      proof.analyzerFragment.cacheStorageGbHours,
      1_000_000_000_000_000_000_000,
    );
    assert.equal(proof.eligibleForAnalyzer, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects lossy storage quantities before analyzer publication", () => {
  const cases = [
    ["actions_storage,5,", "actions_storage,0.10000000000000000001,"],
    [
      "actions_cache_storage,50,",
      `actions_cache_storage,0.${"0".repeat(400)}1,`,
    ],
  ];
  for (const [before, after] of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewrite(evidence.usageCsv, (value) => value.replace(before, after));
      rebindUsageMetadata(evidence);
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /loses precision in the analyzer number range/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects storage quantities outside the analyzer number range", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(evidence.usageCsv, (value) =>
      value.replace(
        "actions_storage,5,",
        `actions_storage,1${"0".repeat(400)},`,
      ),
    );
    rebindUsageMetadata(evidence);
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /outside the analyzer number range/,
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
  const completeRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(completeRoot);
    const metadata = JSON.parse(readFileSync(evidence.auditMetadata, "utf8"));
    const nextPage = new URL(metadata.pageUrls[0]);
    nextPage.searchParams.set("after", "cursor");
    const nextPageUrl = nextPage.toString();
    rewriteJson(evidence.auditMetadata, (value) => {
      value.pageUrls.push(nextPageUrl);
    });
    rewrite(
      evidence.auditEvidence,
      () =>
        `HTTP/2 200\nlink: <${nextPageUrl}>; rel="next"\ncontent-type: application/json\n\n[]\n--- github-audit-page ---\nHTTP/2 200\ncontent-type: application/json\n\n[]\n`,
    );
    rebindAuditMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.visibility.auditEvidenceUnitCount, 2);
    assert.equal(proof.eligibleForAnalyzer, true);
  } finally {
    rmSync(completeRoot, { recursive: true, force: true });
  }

  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewrite(
      evidence.auditEvidence,
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
      evidence.auditEvidence,
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

test("retains REST source, format, byte-length, digest, and event-count binding", () => {
  const cases = [
    [(metadata) => (metadata.format = "json-array"), /source or format/],
    [
      (metadata) => (metadata.transcriptByteLength += 1),
      /transcript byte length/,
    ],
    [
      (metadata) => (metadata.transcriptSha256 = "f".repeat(64)),
      /transcript bytes/,
    ],
    [(metadata) => (metadata.eventCount = 1), /eventCount conflicts/],
  ];
  for (const [mutate, expected] of cases) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewriteJson(evidence.auditMetadata, mutate);
      assert.throws(() => buildGitHubActionsCostProof(evidence), expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects alternate authority and fragments on every REST audit page", () => {
  const mutations = [
    (value) => {
      const url = new URL(value);
      url.username = "attacker";
      url.password = "secret";
      return url.toString();
    },
    (value) => {
      const url = new URL(value);
      url.port = "444";
      return url.toString();
    },
    (value) => `${value}#not-the-page`,
    (value) =>
      value.replace("https://api.github.com/", "https://api.github.com:443/"),
  ];
  for (const pageIndex of [0, 1]) {
    for (const mutate of mutations) {
      const root = workspace();
      try {
        const evidence = createSyntheticGitHubActionsEvidence(root);
        const metadata = JSON.parse(
          readFileSync(evidence.auditMetadata, "utf8"),
        );
        const nextPage = new URL(metadata.pageUrls[0]);
        nextPage.searchParams.set("after", "cursor");
        const validNext = nextPage.toString();
        const first =
          pageIndex === 0 ? mutate(metadata.pageUrls[0]) : metadata.pageUrls[0];
        const next = pageIndex === 1 ? mutate(validNext) : validNext;
        rewriteJson(evidence.auditMetadata, (value) => {
          value.pageUrls = [first, next];
        });
        rewrite(
          evidence.auditEvidence,
          () =>
            `HTTP/2 200\nlink: <${next}>; rel="next"\ncontent-type: application/json\n\n[]\n--- github-audit-page ---\nHTTP/2 200\ncontent-type: application/json\n\n[]\n`,
        );
        rebindAuditMetadata(evidence);
        assert.throws(
          () => buildGitHubActionsCostProof(evidence),
          /URL is unsupported/,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test("rejects unknown and duplicated REST audit query parameters", () => {
  const mutations = [
    (url) => url.searchParams.set("unexpected", "value"),
    (url) => url.searchParams.append("phrase", "duplicate"),
  ];
  for (const mutate of mutations) {
    const root = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(root);
      rewriteJson(evidence.auditMetadata, (metadata) => {
        const url = new URL(metadata.pageUrls[0]);
        mutate(url);
        metadata.pageUrls[0] = url.toString();
      });
      assert.throws(
        () => buildGitHubActionsCostProof(evidence),
        /URL does not bind the query/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  const cursorRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(cursorRoot);
    rewriteJson(evidence.auditMetadata, (metadata) => {
      const firstPage = new URL(metadata.pageUrls[0]);
      firstPage.searchParams.set("after", "omitted-earlier-results");
      metadata.pageUrls[0] = firstPage.toString();
    });
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /first page must be cursor-free/,
    );
  } finally {
    rmSync(cursorRoot, { recursive: true, force: true });
  }

  const visibilityRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(visibilityRoot);
    rewrite(
      evidence.auditEvidence,
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

test("keeps a microscopic custom-image quantity nonzero", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    const tiny = `0.${"0".repeat(400)}1`;
    rewrite(evidence.usageCsv, (value) =>
      value.replace(
        "actions_cache_storage,50,",
        `actions_custom_image_storage,${tiny},`,
      ),
    );
    rebindUsageMetadata(evidence);
    const proof = buildGitHubActionsCostProof(evidence);
    assert.equal(proof.usage.customImageStorage.quantity, tiny);
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
    assert.equal(
      proof.reconciliation.standardRunnerMinutesWithinCollectorTolerance,
      false,
    );
    assert.equal(proof.eligibleForAnalyzer, false);
  } finally {
    rmSync(mismatchRoot, { recursive: true, force: true });
  }

  const boundedRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(boundedRoot, {
      collectorMinutes: 1_200,
      usageMinutes: 1_199,
    });
    assert.equal(
      evidence.proof.reconciliation.standardRunnerMinutesMatchCollector,
      false,
    );
    assert.equal(
      evidence.proof.reconciliation.collectorMinusUsageStandardRunnerMinutes,
      1,
    );
    assert.equal(
      evidence.proof.reconciliation.standardRunnerMinuteTolerance,
      1,
    );
    assert.equal(
      evidence.proof.reconciliation
        .standardRunnerMinutesWithinCollectorTolerance,
      true,
    );
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
  } finally {
    rmSync(boundedRoot, { recursive: true, force: true });
  }

  for (const testCase of [
    {
      name: "rejects one minute above the proportional limit",
      collectorMinutes: 1_200,
      usageMinutes: 1_198,
      expectedTolerance: 1,
    },
    {
      name: "rejects a CSV total above the complete collector",
      collectorMinutes: 1_200,
      usageMinutes: 1_201,
      expectedTolerance: 1,
    },
    {
      name: "rejects one minute above the capped limit",
      collectorMinutes: 12_000,
      usageMinutes: 11_989,
      expectedTolerance: 10,
    },
  ]) {
    const caseRoot = workspace();
    try {
      const evidence = createSyntheticGitHubActionsEvidence(caseRoot, {
        collectorMinutes: testCase.collectorMinutes,
        usageMinutes: testCase.usageMinutes,
      });
      assert.equal(
        evidence.proof.reconciliation.standardRunnerMinuteTolerance,
        testCase.expectedTolerance,
        testCase.name,
      );
      assert.equal(
        evidence.proof.reconciliation
          .standardRunnerMinutesWithinCollectorTolerance,
        false,
        testCase.name,
      );
      assert.equal(evidence.proof.eligibleForAnalyzer, false, testCase.name);
    } finally {
      rmSync(caseRoot, { recursive: true, force: true });
    }
  }

  const cappedRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(cappedRoot, {
      collectorMinutes: 12_000,
      usageMinutes: 11_990,
    });
    assert.equal(
      evidence.proof.reconciliation.standardRunnerMinuteTolerance,
      10,
    );
    assert.equal(
      evidence.proof.reconciliation
        .standardRunnerMinutesWithinCollectorTolerance,
      true,
    );
    assert.equal(evidence.proof.eligibleForAnalyzer, true);
  } finally {
    rmSync(cappedRoot, { recursive: true, force: true });
  }
});

test("still rejects inverted timestamps for a non-skipped runner job", () => {
  const root = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(root);
    rewriteTerminalSample(evidence, (sample) => {
      sample.runnerJobs[0].completedAtUtc = "2026-07-17T00:59:59.000Z";
    });
    assert.throws(
      () => buildGitHubActionsCostProof(evidence),
      /runner job 2000 has invalid timestamps/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
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
        "--audit-rest-transcript",
        evidence.auditEvidence,
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
          "--audit-rest-transcript",
          evidence.auditEvidence,
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

  const reconciliationProofRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(
      reconciliationProofRoot,
    );
    rewriteJson(evidence.proofPath, (proof) => {
      proof.reconciliation.collectorMinusUsageStandardRunnerMinutes = 1;
    });
    assert.throws(
      () => validateGitHubActionsCostProof(evidence.proofPath),
      /does not reconcile to its bound sources/,
    );
  } finally {
    rmSync(reconciliationProofRoot, { recursive: true, force: true });
  }

  const legacyProofRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(legacyProofRoot);
    rewriteJson(evidence.proofPath, (proof) => {
      proof.schema = "vercel-cost-github-actions-proof:v3";
    });
    assert.throws(
      () => validateGitHubActionsCostProof(evidence.proofPath),
      /proof schema is unsupported/,
    );
  } finally {
    rmSync(legacyProofRoot, { recursive: true, force: true });
  }

  const webSourceRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(webSourceRoot, {
      auditSource: "web",
    });
    rewrite(evidence.auditEvidence, (value) => `${value.trimEnd()} `);
    assert.throws(
      () => validateGitHubActionsCostProof(evidence.proofPath),
      /web export byte length|web export bytes/,
    );
  } finally {
    rmSync(webSourceRoot, { recursive: true, force: true });
  }

  const webProofRoot = workspace();
  try {
    const evidence = createSyntheticGitHubActionsEvidence(webProofRoot, {
      auditSource: "web",
    });
    rewriteJson(evidence.proofPath, (proof) => {
      proof.visibility.auditSource =
        "github-org-audit-log-rest-link-transcript";
    });
    assert.throws(
      () => validateGitHubActionsCostProof(evidence.proofPath),
      /source conflicts with the selected CLI option/,
    );
  } finally {
    rmSync(webProofRoot, { recursive: true, force: true });
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
