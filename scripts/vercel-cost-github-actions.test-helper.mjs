import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import {
  GITHUB_AUDIT_METADATA_SCHEMA,
  GITHUB_USAGE_METADATA_SCHEMA,
  buildGitHubActionsCostProof,
} from "./vercel-cost-github-actions.mjs";

const SYNTHETIC_START = "2026-07-16T00:00:00.000Z";
const SYNTHETIC_END = "2026-07-23T00:00:00.000Z";
const REPOSITORY = "mento-protocol/frontend-monorepo";
const USAGE_REPOSITORY = "frontend-monorepo";
const ALL_WORKFLOWS = [
  ".github/workflows/_vercel-prebuilt.yml",
  ".github/workflows/_vercel-preview-smoke.yml",
  ".github/workflows/vercel-main-deployment.yml",
  ".github/workflows/vercel-preview-controller.yml",
  ".github/workflows/vercel-preview-intake.yml",
  ".github/workflows/vercel-preview-worker.yml",
];
const RUN_WORKFLOWS = [
  ".github/workflows/vercel-main-deployment.yml",
  ".github/workflows/vercel-preview-controller.yml",
  ".github/workflows/vercel-preview-intake.yml",
  ".github/workflows/vercel-preview-worker.yml",
];
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

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

function screenshotPng() {
  const width = 800;
  const height = 600;
  const rowBytes = width * 3;
  const pixels = Buffer.alloc((rowBytes + 1) * height, 0xff);
  for (let row = 0; row < height; row += 1) {
    const start = row * (rowBytes + 1);
    pixels[start] = 0;
    if (row >= 80 && row < 180) {
      pixels.fill(0x20, start + 240, start + rowBytes - 240);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const VALID_SCREENSHOT_PNG = screenshotPng();

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function directory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function privateFile(path, value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : typeof value === "string"
      ? value
      : canonicalJson(value);
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
  return Buffer.from(bytes);
}

function csvRow(values) {
  return values
    .map((value) => {
      const text = String(value);
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    })
    .join(",");
}

function createObservation(evidenceRoot, { collectorMinutes, runnerLabels }) {
  const root = directory(join(evidenceRoot, "github-observation-v2"));
  directory(join(root, "boundary"));
  const boundary = {
    schema: "vercel-cost-observation-boundary:v2",
    repository: REPOSITORY,
    boundary: "start",
    timestampUtc: SYNTHETIC_START,
    endUtcExclusive: SYNTHETIC_END,
    recordedAtUtc: "2026-07-15T23:55:00.000Z",
    repositoryVisibility: {
      private: false,
      visibility: "public",
      publicAtCapture: true,
    },
    workflows: ALL_WORKFLOWS.map((path, index) => ({
      id: 100 + index,
      name: path.split("/").at(-1),
      path,
      state: "active",
      htmlUrl: `https://github.com/${REPOSITORY}/actions/workflows/${path.split("/").at(-1)}`,
    })),
    openPullRequestJournals: [],
    inFlightRuns: [],
  };
  const boundaryBytes = privateFile(
    join(root, "boundary", "start.json"),
    boundary,
  );
  const interval = {
    schema: "vercel-cost-github-observation-interval:v2",
    repository: REPOSITORY,
    startUtc: SYNTHETIC_START,
    endUtcExclusive: SYNTHETIC_END,
    createdAtUtc: boundary.recordedAtUtc,
    boundarySha256: sha256(boundaryBytes),
    intervalSemantics: "half-open-complete-utc-days",
    privateRoot: ".vercel-cost-evidence/github-observation-v2",
    cutoverProvenance: {
      complete: false,
      reason: "operator-must-bind-approved-cutover-evidence",
    },
  };
  const intervalBytes = privateFile(join(root, "interval.json"), interval);
  const samplesRoot = directory(join(root, "samples"));
  const sampleRoot = directory(join(samplesRoot, "2026-07-23T00-01-00.000Z"));
  const completeDays = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.parse(SYNTHETIC_START) + index * 86_400_000).toISOString(),
  );
  const collectorMinuteParts =
    collectorMinutes > 8_000
      ? [Math.floor(collectorMinutes / 2), Math.ceil(collectorMinutes / 2)]
      : [collectorMinutes];
  const collectorRunnerJobs = collectorMinuteParts.map((minutes, index) => ({
    runId: "1000",
    runAttempt: 1,
    jobId: String(2000 + index * 10),
    name: `Build deployment targets ${index + 1}`,
    status: "completed",
    conclusion: "success",
    labels: runnerLabels,
    startedAtUtc: "2026-07-17T01:00:00.000Z",
    completedAtUtc: new Date(
      Date.parse("2026-07-17T01:00:00.000Z") + minutes * 60_000,
    ).toISOString(),
  }));
  const sample = {
    schema: "vercel-cost-github-sample:v2",
    repository: REPOSITORY,
    capturedAtUtc: "2026-07-23T00:01:00.000Z",
    sampledThroughUtc: SYNTHETIC_END,
    repositoryVisibility: {
      private: false,
      visibility: "public",
      publicAtSample: true,
    },
    runJobCoverage: {
      schema: "vercel-cost-github-run-job-coverage:v2",
      startUtc: SYNTHETIC_START,
      endUtcExclusive: SYNTHETIC_END,
      completeUtcDayStarts: completeDays,
      workflowPaths: RUN_WORKFLOWS,
      complete: true,
    },
    startBoundaryRunCoverage: {
      schema: "vercel-cost-start-boundary-run-coverage:v1",
      recordedAtUtc: boundary.recordedAtUtc,
      startUtc: SYNTHETIC_START,
      complete: true,
      initialInFlightRunIds: [],
      discoveredPreStartRunIds: [],
      trackedRunIds: [],
    },
    startBoundaryRunStates: [],
    workflowRuns: ["100", "101", "102", "103"].map((id, index) => ({
      id,
      runAttempt: 1,
      path: ".github/workflows/vercel-main-deployment.yml",
      event: "workflow_run",
      status: "completed",
      conclusion: "success",
      createdAtUtc: `2026-07-${17 + index}T01:00:00.000Z`,
      updatedAtUtc: `2026-07-${17 + index}T01:05:00.000Z`,
      headSha: "a".repeat(40),
      headBranch: "main",
      displayTitle: "Vercel Main Deployment",
      htmlUrl: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
    })),
    pendingRunIds: [],
    runnerJobs: [
      ...collectorRunnerJobs,
      {
        runId: "1000",
        runAttempt: 1,
        jobId: "2001",
        name: "Skipped deployment branch",
        status: "completed",
        conclusion: "skipped",
        labels: ["ubuntu-latest"],
        startedAtUtc: "2026-07-17T01:00:01.000Z",
        completedAtUtc: "2026-07-17T01:00:00.000Z",
      },
      ...["100", "101", "102", "103"].map((runId, index) => ({
        runId,
        runAttempt: 1,
        jobId: String(2100 + index),
        name: "Verify exact successful CI attempt",
        status: "completed",
        conclusion: "success",
        labels: ["ubuntu-latest"],
        startedAtUtc: `2026-07-${17 + index}T01:00:00.000Z`,
        completedAtUtc: `2026-07-${17 + index}T01:00:00.000Z`,
      })),
    ],
    cacheSnapshot: { entryCount: 0, totalBytes: 0, entries: [] },
    artifactSnapshot: { entryCount: 0, totalBytes: 0, entries: [] },
    authoritativeBillingFieldsResolved: false,
    files: [],
  };
  const captureBytes = privateFile(join(sampleRoot, "capture.json"), sample);
  const captureSha256 = sha256(captureBytes);
  privateFile(join(sampleRoot, "seal.json"), {
    schema: "vercel-cost-capture-seal:v2",
    captureSchema: sample.schema,
    captureSha256,
    payloadFiles: [],
    treeSha256: sha256(canonicalJson({ captureSha256, payloadFiles: [] })),
  });
  privateFile(join(root, "freeze.json"), {
    schema: "vercel-cost-observation-freeze:v2",
    repository: REPOSITORY,
    startUtc: SYNTHETIC_START,
    endUtcExclusive: SYNTHETIC_END,
    intervalChainHeadSha256: sha256(intervalBytes),
    frozenAtUtc: "2026-07-23T00:02:00.000Z",
  });
  privateFile(join(root, "audit.json"), {
    schema: "vercel-cost-observation-audit:v2",
    repository: REPOSITORY,
    startUtc: SYNTHETIC_START,
    endUtcExclusive: SYNTHETIC_END,
    generatedAtUtc: "2026-07-23T00:02:00.000Z",
    completeUtcDays: 7,
    inventory: { requiredMainRunIds: ["100", "101", "102", "103"] },
    derived: {
      allSampledRepositoryVisibilityPublic: true,
      mainDeploymentObservationOpportunities: 4,
      observedUnknownRunnerJobIds:
        runnerLabels.length === 0
          ? collectorRunnerJobs.map(({ jobId }) => jobId)
          : [],
    },
    unresolved: ["githubAuthoritativeRunnerMinutes"],
    gaps: ["manual-provider-and-closeout-evidence-unresolved"],
    analyzerFragmentComplete: false,
    pass: false,
  });
  return root;
}

export function createSyntheticGitHubActionsEvidence(
  parent,
  {
    auditSource = "rest",
    auditEvents = [],
    collectorMinutes = 300,
    runnerLabels = ["ubuntu-latest"],
    usageMinutes = collectorMinutes,
  } = {},
) {
  const evidenceRoot = directory(join(parent, ".vercel-cost-evidence"));
  const observationRoot = createObservation(evidenceRoot, {
    collectorMinutes,
    runnerLabels,
  });
  const rawRoot = directory(join(evidenceRoot, "github", "raw"));
  const outputRoot = directory(join(evidenceRoot, "github"));
  const headers = [
    "date",
    "product",
    "sku",
    "quantity",
    "unit_type",
    "applied_cost_per_quantity",
    "gross_amount",
    "discount_amount",
    "net_amount",
    "username",
    "organization",
    "repository",
    "workflow_path",
    "cost_center_name",
  ];
  const rows = [
    [
      "2026-07-17",
      "actions",
      "actions_linux",
      String(usageMinutes),
      "minutes",
      "0.006",
      "1.8",
      "1.8",
      "0",
      "",
      "mento-protocol",
      USAGE_REPOSITORY,
      ".github/workflows/vercel-main-deployment.yml",
      "",
    ],
    [
      "2026-07-17",
      "actions",
      "actions_storage",
      "5",
      "GB-Hours",
      "0.000008",
      "0.04",
      "0.04",
      "0",
      "",
      "mento-protocol",
      USAGE_REPOSITORY,
      ".github/workflows/vercel-preview-worker.yml",
      "",
    ],
    [
      "2026-07-17",
      "actions",
      "actions_cache_storage",
      "50",
      "GB-Hours",
      "0.000008",
      "0.4",
      "0.4",
      "0",
      "",
      "mento-protocol",
      USAGE_REPOSITORY,
      ".github/workflows/vercel-preview-worker.yml",
      "",
    ],
  ];
  const csv = `${csvRow(headers)}\n${rows.map(csvRow).join("\n")}\n`;
  const usageCsv = join(rawRoot, "detailed-usage.csv");
  const csvBytes = privateFile(usageCsv, csv);
  const usageMetadata = join(rawRoot, "detailed-usage.metadata.json");
  privateFile(usageMetadata, {
    schema: GITHUB_USAGE_METADATA_SCHEMA,
    source: "github-detailed-usage-web-csv",
    reportType: "detailed",
    startUtc: SYNTHETIC_START,
    endUtcExclusive: SYNTHETIC_END,
    requestedAtUtc: "2026-07-23T12:00:00.000Z",
    complete: true,
    completenessBasis: "maintainer-attested-web-export-after-storage-lag",
    csvSha256: sha256(csvBytes),
  });
  const queryStartUtc = "2026-07-15T23:55:00.000Z";
  const queryEndUtcExclusive = "2026-07-23T00:02:00.000Z";
  const queryPhrase = `repo:${REPOSITORY} action:repo.access created:>=${queryStartUtc} created:<${queryEndUtcExclusive}`;
  const firstPage = new URL(
    "https://api.github.com/orgs/mento-protocol/audit-log",
  );
  firstPage.searchParams.set("phrase", queryPhrase);
  firstPage.searchParams.set("include", "web");
  firstPage.searchParams.set("order", "asc");
  firstPage.searchParams.set("per_page", "100");
  let auditEvidence;
  let auditInput;
  let auditMetadataValue;
  if (auditSource === "rest") {
    auditEvidence = join(rawRoot, "audit-log.transcript.txt");
    const transcriptBytes = privateFile(
      auditEvidence,
      `HTTP/2 200\ncontent-type: application/json\n\n${JSON.stringify(auditEvents)}\n`,
    );
    auditInput = { auditRestTranscript: auditEvidence };
    auditMetadataValue = {
      schema: GITHUB_AUDIT_METADATA_SCHEMA,
      source: "github-org-audit-log-rest-link-transcript",
      format: "http-link-transcript-json-array-pages",
      repository: REPOSITORY,
      startUtc: SYNTHETIC_START,
      endUtcExclusive: SYNTHETIC_END,
      queryStartUtc,
      queryEndUtcExclusive,
      capturedAtUtc: "2026-07-23T00:03:00.000Z",
      queryPhrase,
      include: "web",
      order: "asc",
      perPage: 100,
      pageUrls: [firstPage.toString()],
      complete: true,
      eventCount: auditEvents.length,
      transcriptByteLength: transcriptBytes.length,
      transcriptSha256: sha256(transcriptBytes),
    };
  } else if (auditSource === "web") {
    auditEvidence = join(rawRoot, "audit-log.web-export.json");
    const exportBytes = privateFile(auditEvidence, auditEvents);
    auditInput = { auditWebExport: auditEvidence };
    auditMetadataValue = {
      schema: GITHUB_AUDIT_METADATA_SCHEMA,
      source: "github-org-audit-log-owner-web-json-export",
      format: "json-array",
      repository: REPOSITORY,
      startUtc: SYNTHETIC_START,
      endUtcExclusive: SYNTHETIC_END,
      queryStartUtc,
      queryEndUtcExclusive,
      capturedAtUtc: "2026-07-23T00:03:00.000Z",
      queryPhrase,
      eventCount: auditEvents.length,
      exportByteLength: exportBytes.length,
      exportSha256: sha256(exportBytes),
      ownerAttestation: {
        role: "admin",
        exportCompleted: true,
        sizeLimitReached: false,
        processingTimeLimitReached: false,
        exportError: null,
        matchingEntryCount: auditEvents.length,
      },
    };
  } else if (auditSource === "zero-result") {
    auditEvidence = join(rawRoot, "audit-log.zero-results.png");
    const screenshotBytes = privateFile(auditEvidence, VALID_SCREENSHOT_PNG);
    auditInput = { auditWebZeroScreenshot: auditEvidence };
    const pageUrl = new URL(
      "https://github.com/organizations/mento-protocol/settings/audit-log",
    );
    pageUrl.searchParams.set("q", queryPhrase);
    auditMetadataValue = {
      schema: GITHUB_AUDIT_METADATA_SCHEMA,
      source: "github-org-audit-log-owner-web-zero-result-attestation",
      format: "browser-screenshot-png",
      repository: REPOSITORY,
      startUtc: SYNTHETIC_START,
      endUtcExclusive: SYNTHETIC_END,
      queryStartUtc,
      queryEndUtcExclusive,
      capturedAtUtc: "2026-07-23T00:03:00.000Z",
      queryPhrase,
      pageUrl: pageUrl.toString(),
      zeroResultText: "We couldn’t find any events matching your search.",
      eventCount: 0,
      screenshotByteLength: screenshotBytes.length,
      screenshotSha256: sha256(screenshotBytes),
      ownerAttestation: {
        role: "admin",
        zeroResultVisible: true,
        exportControlAvailable: false,
        pageError: null,
      },
    };
  } else {
    throw new Error(`Unsupported synthetic audit source: ${auditSource}`);
  }
  const auditMetadata = join(rawRoot, "audit-log.metadata.json");
  privateFile(auditMetadata, auditMetadataValue);
  const proofPath = join(outputRoot, "postcutover.github-actions.json");
  const options = {
    usageCsv,
    usageMetadata,
    ...auditInput,
    auditMetadata,
    observationRoot,
    output: proofPath,
  };
  const proof = buildGitHubActionsCostProof(options);
  const proofBytes = privateFile(proofPath, proof);
  return {
    ...options,
    evidenceRoot,
    auditEvidence,
    proof,
    proofPath,
    proofSha256: sha256(proofBytes),
  };
}
