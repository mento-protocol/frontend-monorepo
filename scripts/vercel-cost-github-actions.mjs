#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  GITHUB_BILLING_WORKFLOW_PATHS,
  validateGitHubBillingObservation,
} from "./vercel-cost-observation.mjs";

export const GITHUB_ACTIONS_PROOF_SCHEMA =
  "vercel-cost-github-actions-proof:v3";
export const GITHUB_USAGE_METADATA_SCHEMA =
  "vercel-cost-github-usage-export-metadata:v1";
export const GITHUB_AUDIT_METADATA_SCHEMA =
  "vercel-cost-github-audit-export-metadata:v2";

const REPOSITORY = "mento-protocol/frontend-monorepo";
const ORGANIZATION = "mento-protocol";
const CATALOG_VERSION = "github-actions-skus:2026-08-13";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const CSV_HEADERS = [
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
const STANDARD_RUNNER_SKUS = [
  "actions_linux",
  "actions_linux_arm",
  "actions_linux_slim",
  "actions_macos",
  "actions_windows",
  "actions_windows_arm",
];
const LARGER_RUNNER_SKUS = [
  "actions_linux_2_core_advanced",
  "actions_linux_2_core_arm",
  "actions_linux_32_core",
  "actions_linux_32_core_arm",
  "actions_linux_4_core",
  "actions_linux_4_core_arm",
  "actions_linux_4_core_gpu",
  "actions_linux_64_core",
  "actions_linux_64_core_arm",
  "actions_linux_8_core",
  "actions_linux_8_core_arm",
  "actions_linux_96_core",
  "actions_macos_l",
  "actions_macos_xl",
  "actions_windows_16_core",
  "actions_windows_2_core",
  "actions_windows_2_core_advanced",
  "actions_windows_2_core_arm",
  "actions_windows_32_core",
  "actions_windows_32_core_arm",
  "actions_windows_4_core",
  "actions_windows_4_core_arm",
  "actions_windows_4_core_gpu",
  "actions_windows_64_core",
  "actions_windows_64_core_arm",
  "actions_windows_8_core",
  "actions_windows_8_core_arm",
];
const STORAGE_SKUS = [
  "actions_storage",
  "actions_cache_storage",
  "actions_custom_image_storage",
];
const KNOWN_ACTIONS_SKUS = new Set([
  ...STANDARD_RUNNER_SKUS,
  ...LARGER_RUNNER_SKUS,
  ...STORAGE_SKUS,
]);
const MINUTE_UNITS = new Set(["minutes"]);
const STORAGE_UNITS = new Set(["GB-Hours", "GigabyteHours", "gigabyte-hours"]);
const TRANSCRIPT_SEPARATOR = "\n--- github-audit-page ---\n";
const AUDIT_REST_SOURCE = "github-org-audit-log-rest-link-transcript";
const AUDIT_REST_FORMAT = "http-link-transcript-json-array-pages";
const AUDIT_WEB_SOURCE = "github-org-audit-log-owner-web-json-export";
const AUDIT_WEB_FORMAT = "json-array";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys, label) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} must contain exactly: ${expected.join(", ")}`,
  );
  return value;
}

function exactUtc(value, label) {
  invariant(typeof value === "string", `${label} must be an ISO UTC timestamp`);
  const milliseconds = Date.parse(value);
  invariant(
    Number.isFinite(milliseconds),
    `${label} must be an ISO UTC timestamp`,
  );
  invariant(
    new Date(milliseconds).toISOString() === value,
    `${label} must be canonical ISO UTC`,
  );
  return value;
}

function exactDate(value, label) {
  invariant(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    `${label} must be YYYY-MM-DD`,
  );
  invariant(
    new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value),
    `${label} is not a calendar date`,
  );
  return value;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function locatePrivatePath(path) {
  const requested = resolve(path);
  let current = requested;
  while (dirname(current) !== current) {
    if (basename(current) === ".vercel-cost-evidence") {
      const rootStats = lstatSync(current);
      invariant(
        rootStats.isDirectory() && !rootStats.isSymbolicLink(),
        ".vercel-cost-evidence must be a real directory",
      );
      invariant(
        (rootStats.mode & 0o777) === 0o700,
        ".vercel-cost-evidence must use mode 0700",
      );
      const privateRoot = realpathSync(current);
      const relativePath = relative(current, requested);
      invariant(
        relativePath === "" ||
          (relativePath !== ".." && !relativePath.startsWith(`..${sep}`)),
        "GitHub cost evidence escapes .vercel-cost-evidence",
      );
      return { privateRoot, path: resolve(privateRoot, relativePath) };
    }
    current = dirname(current);
  }
  throw new Error(
    "GitHub cost evidence must remain below .vercel-cost-evidence",
  );
}

function findPrivateRoot(path) {
  return locatePrivatePath(path).privateRoot;
}

function assertPrivateDirectoryChain(path, privateRoot, label) {
  const chain = [];
  let current = resolve(path);
  while (current !== privateRoot) {
    invariant(
      isWithin(privateRoot, current),
      `${label} escapes the private root`,
    );
    chain.push(current);
    current = dirname(current);
  }
  chain.push(privateRoot);
  for (const directory of chain.reverse()) {
    const stats = lstatSync(directory);
    invariant(
      stats.isDirectory() && !stats.isSymbolicLink(),
      `${label} parent must be a real directory`,
    );
    invariant(
      (stats.mode & 0o777) === 0o700,
      `${label} parent directories must use mode 0700`,
    );
  }
}

function isWithin(parent, child, { allowEqual = false } = {}) {
  const path = relative(parent, child);
  return (
    (allowEqual && path === "") ||
    (path !== "" && path !== ".." && !path.startsWith(`..${sep}`))
  );
}

function readPrivateFile(path, privateRoot, label) {
  const requested = resolve(path);
  const located = locatePrivatePath(requested);
  invariant(
    located.privateRoot === privateRoot,
    `${label} is outside the proof's private root`,
  );
  const requestedStats = lstatSync(requested);
  invariant(
    requestedStats.isFile() && !requestedStats.isSymbolicLink(),
    `${label} must be a regular non-symlink file`,
  );
  const canonical = located.path;
  assertPrivateDirectoryChain(dirname(canonical), privateRoot, label);
  invariant(
    requestedStats.nlink === 1,
    `${label} must have exactly one hard link`,
  );
  invariant(
    (requestedStats.mode & 0o777) === 0o600,
    `${label} must use mode 0600`,
  );
  invariant(
    isWithin(privateRoot, canonical),
    `${label} escapes the private root`,
  );
  const descriptor = openSync(
    requested,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(descriptor);
    invariant(
      opened.isFile() &&
        opened.dev === requestedStats.dev &&
        opened.ino === requestedStats.ino &&
        opened.nlink === 1 &&
        (opened.mode & 0o777) === 0o600,
      `${label} changed while opening`,
    );
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readPrivateJson(path, privateRoot, label) {
  const bytes = readPrivateFile(path, privateRoot, label);
  const value = parseJson(bytes, label);
  invariant(
    bytes.equals(Buffer.from(canonicalJson(value))),
    `${label} must be canonical JSON`,
  );
  return { bytes, value };
}

function resolveSource(proofPath, sourcePath, privateRoot, label) {
  invariant(
    typeof sourcePath === "string" && sourcePath.length > 0,
    `${label} must be a relative path`,
  );
  invariant(!sourcePath.startsWith("/"), `${label} must be a relative path`);
  const absolute = resolve(dirname(proofPath), sourcePath);
  invariant(
    isWithin(privateRoot, absolute),
    `${label} escapes the private root`,
  );
  return absolute;
}

function relativeSource(proofPath, sourcePath, privateRoot, label) {
  const absolute = realpathSync(resolve(sourcePath));
  invariant(
    isWithin(privateRoot, absolute),
    `${label} escapes the private root`,
  );
  const path = relative(dirname(proofPath), absolute);
  invariant(path !== "", `${label} must not be the proof itself`);
  return path;
}

function parseCsv(bytes) {
  const decoded = bytes.toString("utf8");
  const text = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      invariant(field.length === 0, "GitHub usage CSV has an invalid quote");
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  invariant(!quoted, "GitHub usage CSV has an unterminated quoted field");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  while (records.at(-1)?.every((entry) => entry === "")) records.pop();
  invariant(records.length >= 1, "GitHub usage CSV is empty");
  const headers = records.shift();
  invariant(
    new Set(headers).size === headers.length &&
      JSON.stringify([...headers].sort()) ===
        JSON.stringify([...CSV_HEADERS].sort()),
    `GitHub usage CSV headers must be exactly: ${CSV_HEADERS.join(", ")}`,
  );
  return {
    headers,
    rows: records.map((values, index) => {
      invariant(
        values.length === headers.length,
        `GitHub usage CSV row ${index + 2} has the wrong field count`,
      );
      return Object.fromEntries(
        headers.map((header, column) => [header, values[column]]),
      );
    }),
  };
}

function decimal(value, label) {
  invariant(
    typeof value === "string" && DECIMAL_PATTERN.test(value),
    `${label} must be a nonnegative decimal`,
  );
  const [integer, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${integer}${fraction}`),
    scale: fraction.length,
  };
}

function normalizeDecimal(value) {
  const text = String(value.coefficient).padStart(value.scale + 1, "0");
  if (value.scale === 0) return text;
  const integer = text.slice(0, -value.scale);
  const fraction = text.slice(-value.scale).replace(/0+$/, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function alignDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

function addDecimals(left, right) {
  const [a, b, scale] = alignDecimals(left, right);
  return { coefficient: a + b, scale };
}

function subtractDecimals(left, right, label) {
  const [a, b, scale] = alignDecimals(left, right);
  invariant(a >= b, `${label} must not be negative`);
  return { coefficient: a - b, scale };
}

function decimalsEqual(left, right) {
  const [a, b] = alignDecimals(left, right);
  return a === b;
}

function zeroDecimal() {
  return { coefficient: 0n, scale: 0 };
}

function addMetric(metrics, key, row, rowNumber) {
  const quantity = decimal(
    row.quantity,
    `GitHub usage CSV row ${rowNumber} quantity`,
  );
  const gross = decimal(
    row.gross_amount,
    `GitHub usage CSV row ${rowNumber} gross_amount`,
  );
  const discount = decimal(
    row.discount_amount,
    `GitHub usage CSV row ${rowNumber} discount_amount`,
  );
  const net = decimal(
    row.net_amount,
    `GitHub usage CSV row ${rowNumber} net_amount`,
  );
  decimal(
    row.applied_cost_per_quantity,
    `GitHub usage CSV row ${rowNumber} applied_cost_per_quantity`,
  );
  invariant(
    decimalsEqual(
      subtractDecimals(
        gross,
        discount,
        `GitHub usage CSV row ${rowNumber} discount`,
      ),
      net,
    ),
    `GitHub usage CSV row ${rowNumber} must satisfy gross_amount - discount_amount = net_amount`,
  );
  const current = metrics[key];
  current.quantity = addDecimals(current.quantity, quantity);
  current.grossAmount = addDecimals(current.grossAmount, gross);
  current.discountAmount = addDecimals(current.discountAmount, discount);
  current.netAmount = addDecimals(current.netAmount, net);
  current.rowCount += 1;
}

function emptyMetric() {
  return {
    quantity: zeroDecimal(),
    grossAmount: zeroDecimal(),
    discountAmount: zeroDecimal(),
    netAmount: zeroDecimal(),
    rowCount: 0,
  };
}

function serializeMetric(metric, unit) {
  return {
    unit,
    quantity: normalizeDecimal(metric.quantity),
    grossAmountUsd: normalizeDecimal(metric.grossAmount),
    discountAmountUsd: normalizeDecimal(metric.discountAmount),
    netAmountUsd: normalizeDecimal(metric.netAmount),
    rowCount: metric.rowCount,
  };
}

function parseUsageMetadata(bytes, observation) {
  const metadata = parseJson(bytes, "GitHub usage metadata");
  exactKeys(
    metadata,
    [
      "schema",
      "source",
      "reportType",
      "startUtc",
      "endUtcExclusive",
      "requestedAtUtc",
      "complete",
      "completenessBasis",
      "csvSha256",
    ],
    "GitHub usage metadata",
  );
  invariant(
    metadata.schema === GITHUB_USAGE_METADATA_SCHEMA,
    "GitHub usage metadata schema is unsupported",
  );
  invariant(
    metadata.source === "github-detailed-usage-web-csv",
    "GitHub usage metadata source is unsupported",
  );
  invariant(
    metadata.reportType === "detailed",
    "GitHub usage metadata must describe a detailed report",
  );
  invariant(
    metadata.startUtc === observation.startUtc &&
      metadata.endUtcExclusive === observation.endUtcExclusive,
    "GitHub usage metadata interval conflicts with the collector",
  );
  exactUtc(metadata.requestedAtUtc, "GitHub usage report request time");
  invariant(
    Date.parse(metadata.requestedAtUtc) >=
      Date.parse(observation.endUtcExclusive) + 12 * 60 * 60 * 1_000,
    "GitHub usage report must be requested at least 12 hours after the interval for storage ingestion",
  );
  invariant(
    metadata.complete === true,
    "GitHub usage metadata must attest a complete export",
  );
  invariant(
    metadata.completenessBasis ===
      "maintainer-attested-web-export-after-storage-lag",
    "GitHub usage metadata completeness basis is unsupported",
  );
  invariant(
    DIGEST_PATTERN.test(metadata.csvSha256),
    "GitHub usage metadata csvSha256 is invalid",
  );
  return metadata;
}

function workflowPath(value) {
  const withoutRef = value.replace(
    /@(?:refs\/(?:heads|pull|tags)\/[A-Za-z0-9._/-]+|[a-f0-9]{40})$/,
    "",
  );
  if (GITHUB_BILLING_WORKFLOW_PATHS.includes(withoutRef)) return withoutRef;
  const prefix = `${REPOSITORY}/`;
  if (withoutRef.startsWith(prefix)) {
    const path = withoutRef.slice(prefix.length);
    if (GITHUB_BILLING_WORKFLOW_PATHS.includes(path)) return path;
  }
  return null;
}

function aggregateUsage(csvBytes, metadata) {
  const { rows } = parseCsv(csvBytes);
  const metrics = {
    standardRunner: emptyMetric(),
    largerRunner: emptyMetric(),
    artifactStorage: emptyMetric(),
    cacheStorage: emptyMetric(),
    customImageStorage: emptyMetric(),
  };
  let targetRowCount = 0;
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    if (
      row.product !== "Actions" ||
      row.organization !== ORGANIZATION ||
      row.repository !== REPOSITORY
    )
      continue;
    targetRowCount += 1;
    invariant(
      KNOWN_ACTIONS_SKUS.has(row.sku),
      `GitHub usage CSV row ${rowNumber} has unknown Actions SKU: ${row.sku}`,
    );
    exactDate(row.date, `GitHub usage CSV row ${rowNumber} date`);
    invariant(
      `${row.date}T00:00:00.000Z` >= metadata.startUtc &&
        `${row.date}T00:00:00.000Z` < metadata.endUtcExclusive,
      `GitHub usage CSV row ${rowNumber} is outside the half-open interval`,
    );
    if (
      STANDARD_RUNNER_SKUS.includes(row.sku) ||
      LARGER_RUNNER_SKUS.includes(row.sku)
    ) {
      invariant(
        MINUTE_UNITS.has(row.unit_type),
        `GitHub usage CSV row ${rowNumber} runner unit is unsupported: ${row.unit_type}`,
      );
      invariant(
        workflowPath(row.workflow_path),
        `GitHub usage CSV row ${rowNumber} workflow_path is outside the deployment allowlist`,
      );
      addMetric(
        metrics,
        STANDARD_RUNNER_SKUS.includes(row.sku)
          ? "standardRunner"
          : "largerRunner",
        row,
        rowNumber,
      );
    } else {
      invariant(
        STORAGE_UNITS.has(row.unit_type),
        `GitHub usage CSV row ${rowNumber} storage unit is unsupported: ${row.unit_type}`,
      );
      const storageQuantity = decimal(
        row.quantity,
        `GitHub usage CSV row ${rowNumber} quantity`,
      );
      invariant(
        storageQuantity.coefficient === 0n || workflowPath(row.workflow_path),
        `GitHub usage CSV row ${rowNumber} has nonzero storage without an attributable deployment workflow_path`,
      );
      invariant(
        row.workflow_path === "" || workflowPath(row.workflow_path),
        `GitHub usage CSV row ${rowNumber} storage workflow_path is outside the deployment allowlist`,
      );
      const key =
        row.sku === "actions_storage"
          ? "artifactStorage"
          : row.sku === "actions_cache_storage"
            ? "cacheStorage"
            : "customImageStorage";
      addMetric(metrics, key, row, rowNumber);
    }
  }
  invariant(
    targetRowCount > 0,
    "GitHub usage CSV has no Actions rows for the repository",
  );
  invariant(
    metadata.csvSha256 === sha256(csvBytes),
    "GitHub usage metadata does not bind the CSV bytes",
  );
  return {
    sourceRowCount: rows.length,
    targetRowCount,
    standardRunner: serializeMetric(metrics.standardRunner, "minutes"),
    largerRunner: serializeMetric(metrics.largerRunner, "minutes"),
    artifactStorage: serializeMetric(metrics.artifactStorage, "GB-hours"),
    cacheStorage: serializeMetric(metrics.cacheStorage, "GB-hours"),
    customImageStorage: serializeMetric(metrics.customImageStorage, "GB-hours"),
  };
}

function parseLinkNext(value) {
  if (value === undefined) return null;
  const next = value
    .split(",")
    .map((entry) => /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(entry))
    .filter(Boolean)
    .filter((match) => match[2].split(/\s+/).includes("next"));
  invariant(
    next.length <= 1,
    "GitHub audit transcript page has multiple next links",
  );
  return next[0]?.[1] ?? null;
}

function parseAuditTranscript(bytes) {
  const text = bytes.toString("utf8").replaceAll("\r\n", "\n").trimEnd();
  invariant(text.length > 0, "GitHub audit transcript is empty");
  return text.split(TRANSCRIPT_SEPARATOR).map((part, index) => {
    const separator = part.indexOf("\n\n");
    invariant(
      separator > 0,
      `GitHub audit transcript page ${index + 1} has no header/body separator`,
    );
    const headerLines = part.slice(0, separator).split("\n");
    invariant(
      /^HTTP\/(?:1\.1|2(?:\.0)?) 200(?: |$)/.test(headerLines.shift()),
      `GitHub audit transcript page ${index + 1} did not return HTTP 200`,
    );
    const headers = {};
    for (const line of headerLines) {
      const match = /^([^:]+):\s*(.*)$/.exec(line);
      invariant(
        match,
        `GitHub audit transcript page ${index + 1} has a malformed header`,
      );
      const name = match[1].toLowerCase();
      invariant(
        !Object.hasOwn(headers, name),
        `GitHub audit transcript page ${index + 1} repeats a header`,
      );
      headers[name] = match[2];
    }
    const events = parseJson(
      Buffer.from(part.slice(separator + 2)),
      `GitHub audit transcript page ${index + 1} body`,
    );
    invariant(
      Array.isArray(events),
      `GitHub audit transcript page ${index + 1} body must be an array`,
    );
    return { events, nextUrl: parseLinkNext(headers.link) };
  });
}

function auditEventTime(value, label) {
  if (Number.isSafeInteger(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1_000 : value;
    return new Date(milliseconds).toISOString();
  }
  return exactUtc(value, label);
}

function validateAuditMetadataCommon(metadata, observation) {
  invariant(
    metadata.schema === GITHUB_AUDIT_METADATA_SCHEMA,
    "GitHub audit metadata schema is unsupported",
  );
  invariant(
    metadata.repository === REPOSITORY,
    "GitHub audit metadata repository conflicts",
  );
  invariant(
    metadata.startUtc === observation.startUtc &&
      metadata.endUtcExclusive === observation.endUtcExclusive,
    "GitHub audit metadata interval conflicts with the collector",
  );
  invariant(
    metadata.queryStartUtc === observation.visibilityEvidenceStartUtc,
    "GitHub audit query must start at the floored pre-window boundary capture",
  );
  exactUtc(metadata.queryEndUtcExclusive, "GitHub audit query end");
  invariant(
    Date.parse(metadata.queryEndUtcExclusive) >
      Date.parse(observation.visibilityEvidenceEndMinimumUtc),
    "GitHub audit query must cover the post-window terminal sample",
  );
  exactUtc(metadata.capturedAtUtc, "GitHub audit capture time");
  invariant(
    Date.parse(metadata.capturedAtUtc) >=
      Date.parse(observation.endUtcExclusive),
    "GitHub audit evidence was captured before the interval ended",
  );
  invariant(
    Date.parse(metadata.capturedAtUtc) >=
      Date.parse(metadata.queryEndUtcExclusive),
    "GitHub audit evidence was captured before its query range ended",
  );
  invariant(
    metadata.queryPhrase ===
      `repo:${REPOSITORY} action:repo.access created:>=${metadata.queryStartUtc} created:<${metadata.queryEndUtcExclusive}`,
    "GitHub audit metadata query is not exact",
  );
  invariant(
    Number.isSafeInteger(metadata.eventCount) && metadata.eventCount >= 0,
    "GitHub audit metadata eventCount must be a nonnegative safe integer",
  );
}

function validateAuditEvents(events, metadata, label, eventIds = new Set()) {
  invariant(Array.isArray(events), `${label} must be a JSON array`);
  for (const [index, event] of events.entries()) {
    invariant(
      event !== null && typeof event === "object" && !Array.isArray(event),
      `${label} row ${index + 1} must be an object`,
    );
    invariant(
      event.action === "repo.access",
      `${label} row ${index + 1} action is outside the visibility query`,
    );
    invariant(
      event.repo === REPOSITORY,
      `${label} row ${index + 1} repository is outside the visibility query`,
    );
    const timestamp = auditEventTime(
      event.created_at,
      `${label} row ${index + 1} created_at`,
    );
    invariant(
      timestamp >= metadata.queryStartUtc &&
        timestamp < metadata.queryEndUtcExclusive,
      `${label} row ${index + 1} is outside the covering half-open query`,
    );
    invariant(
      typeof event._document_id === "string" &&
        event._document_id.length > 0 &&
        !eventIds.has(event._document_id),
      `${label} row ${index + 1} _document_id is missing or duplicated`,
    );
    eventIds.add(event._document_id);
  }
  return eventIds;
}

function validateRestAuditEvidence(transcriptBytes, metadata, observation) {
  exactKeys(
    metadata,
    [
      "schema",
      "source",
      "format",
      "repository",
      "startUtc",
      "endUtcExclusive",
      "queryStartUtc",
      "queryEndUtcExclusive",
      "capturedAtUtc",
      "queryPhrase",
      "include",
      "order",
      "perPage",
      "pageUrls",
      "complete",
      "eventCount",
      "transcriptByteLength",
      "transcriptSha256",
    ],
    "GitHub audit metadata",
  );
  invariant(
    metadata.source === AUDIT_REST_SOURCE &&
      metadata.format === AUDIT_REST_FORMAT,
    "GitHub REST audit metadata source or format is unsupported",
  );
  validateAuditMetadataCommon(metadata, observation);
  invariant(
    metadata.include === "web" &&
      metadata.order === "asc" &&
      metadata.perPage === 100,
    "GitHub audit metadata pagination parameters are unsupported",
  );
  invariant(
    metadata.complete === true,
    "GitHub audit metadata must attest a complete export",
  );
  invariant(
    Number.isSafeInteger(metadata.transcriptByteLength) &&
      metadata.transcriptByteLength === transcriptBytes.length,
    "GitHub audit metadata does not bind the transcript byte length",
  );
  invariant(
    DIGEST_PATTERN.test(metadata.transcriptSha256) &&
      metadata.transcriptSha256 === sha256(transcriptBytes),
    "GitHub audit metadata does not bind the transcript bytes",
  );
  invariant(
    Array.isArray(metadata.pageUrls) && metadata.pageUrls.length > 0,
    "GitHub audit metadata pageUrls must not be empty",
  );
  invariant(
    new Set(metadata.pageUrls).size === metadata.pageUrls.length,
    "GitHub audit metadata pageUrls must be unique",
  );
  const pages = parseAuditTranscript(transcriptBytes);
  invariant(
    pages.length === metadata.pageUrls.length,
    "GitHub audit transcript page count conflicts with metadata",
  );
  let eventIds = new Set();
  for (const [index, page] of pages.entries()) {
    invariant(
      page.events.length <= metadata.perPage,
      `GitHub audit transcript page ${index + 1} exceeds perPage`,
    );
    const pageUrl = new URL(metadata.pageUrls[index]);
    invariant(
      pageUrl.protocol === "https:" &&
        pageUrl.hostname === "api.github.com" &&
        pageUrl.pathname === `/orgs/${ORGANIZATION}/audit-log`,
      `GitHub audit metadata page ${index + 1} URL is unsupported`,
    );
    invariant(
      pageUrl.searchParams.get("phrase") === metadata.queryPhrase &&
        pageUrl.searchParams.get("include") === metadata.include &&
        pageUrl.searchParams.get("order") === metadata.order &&
        pageUrl.searchParams.get("per_page") === String(metadata.perPage),
      `GitHub audit metadata page ${index + 1} URL does not bind the query`,
    );
    invariant(
      index !== 0 ||
        (!pageUrl.searchParams.has("after") &&
          !pageUrl.searchParams.has("before")),
      "GitHub audit metadata first page must be cursor-free",
    );
    const expectedNext = metadata.pageUrls[index + 1] ?? null;
    invariant(
      page.nextUrl === expectedNext,
      `GitHub audit transcript page ${index + 1} pagination chain is incomplete`,
    );
    eventIds = validateAuditEvents(
      page.events,
      metadata,
      `GitHub audit transcript page ${index + 1}`,
      eventIds,
    );
  }
  invariant(
    metadata.eventCount === eventIds.size,
    "GitHub audit metadata eventCount conflicts with the transcript",
  );
  return {
    source: metadata.source,
    format: metadata.format,
    pageCount: pages.length,
    eventCount: eventIds.size,
    repositoryAccessEventCount: eventIds.size,
  };
}

function validateWebAuditEvidence(exportBytes, metadata, observation) {
  exactKeys(
    metadata,
    [
      "schema",
      "source",
      "format",
      "repository",
      "startUtc",
      "endUtcExclusive",
      "queryStartUtc",
      "queryEndUtcExclusive",
      "capturedAtUtc",
      "queryPhrase",
      "eventCount",
      "exportByteLength",
      "exportSha256",
      "ownerAttestation",
    ],
    "GitHub audit metadata",
  );
  invariant(
    metadata.source === AUDIT_WEB_SOURCE &&
      metadata.format === AUDIT_WEB_FORMAT,
    "GitHub web audit metadata source or format is unsupported",
  );
  validateAuditMetadataCommon(metadata, observation);
  invariant(
    Number.isSafeInteger(metadata.exportByteLength) &&
      metadata.exportByteLength === exportBytes.length,
    "GitHub audit metadata does not bind the web export byte length",
  );
  invariant(
    DIGEST_PATTERN.test(metadata.exportSha256) &&
      metadata.exportSha256 === sha256(exportBytes),
    "GitHub audit metadata does not bind the web export bytes",
  );
  const attestation = exactKeys(
    metadata.ownerAttestation,
    [
      "role",
      "exportCompleted",
      "sizeLimitReached",
      "processingTimeLimitReached",
      "exportError",
      "matchingEntryCount",
    ],
    "GitHub audit ownerAttestation",
  );
  invariant(
    attestation.role === "admin",
    "GitHub audit web export must be attested by an organization admin owner",
  );
  invariant(
    attestation.exportCompleted === true,
    "GitHub audit web export must attest successful completion",
  );
  invariant(
    attestation.sizeLimitReached === false &&
      attestation.processingTimeLimitReached === false,
    "GitHub audit web export must attest that no provider limit was reached",
  );
  invariant(
    attestation.exportError === null,
    "GitHub audit web export must attest that no export error occurred",
  );
  invariant(
    Number.isSafeInteger(attestation.matchingEntryCount) &&
      attestation.matchingEntryCount >= 0,
    "GitHub audit ownerAttestation matchingEntryCount must be a nonnegative safe integer",
  );
  const events = parseJson(exportBytes, "GitHub audit web export");
  const eventIds = validateAuditEvents(
    events,
    metadata,
    "GitHub audit web export",
  );
  invariant(
    metadata.eventCount === eventIds.size,
    "GitHub audit metadata eventCount conflicts with the web export",
  );
  invariant(
    attestation.matchingEntryCount === eventIds.size,
    "GitHub audit ownerAttestation matchingEntryCount conflicts with the web export",
  );
  return {
    source: metadata.source,
    format: metadata.format,
    pageCount: 1,
    eventCount: eventIds.size,
    repositoryAccessEventCount: eventIds.size,
  };
}

function validateAuditEvidence(evidenceBytes, metadataBytes, observation) {
  const metadata = parseJson(metadataBytes, "GitHub audit metadata");
  invariant(
    metadata !== null &&
      typeof metadata === "object" &&
      !Array.isArray(metadata),
    "GitHub audit metadata must be an object",
  );
  if (metadata.source === AUDIT_REST_SOURCE) {
    return validateRestAuditEvidence(evidenceBytes, metadata, observation);
  }
  if (metadata.source === AUDIT_WEB_SOURCE) {
    return validateWebAuditEvidence(evidenceBytes, metadata, observation);
  }
  throw new Error("GitHub audit metadata source is unsupported");
}

function collectorRunnerMinutes(observation) {
  let minutes = 0;
  let jobCount = 0;
  for (const job of observation.runnerJobs) {
    if (!job.startedAtUtc && !job.completedAtUtc) continue;
    invariant(
      job.startedAtUtc && job.completedAtUtc,
      `Collector runner job ${job.jobId} is not terminal`,
    );
    const started = Date.parse(job.startedAtUtc);
    const completed = Date.parse(job.completedAtUtc);
    invariant(
      Number.isFinite(started) &&
        Number.isFinite(completed) &&
        completed >= started,
      `Collector runner job ${job.jobId} has invalid timestamps`,
    );
    invariant(
      started >= Date.parse(observation.startUtc) &&
        completed < Date.parse(observation.endUtcExclusive),
      `Collector runner job ${job.jobId} crosses the half-open interval`,
    );
    minutes += Math.ceil((completed - started) / 60_000);
    jobCount += 1;
  }
  return { minutes, jobCount, rounding: "ceil-each-job-to-whole-minute" };
}

function numberFromDecimal(value, label) {
  const number = Number(value);
  invariant(
    Number.isFinite(number) && number >= 0,
    `${label} is outside the analyzer number range`,
  );
  return number;
}

function buildProofData({
  proofPath,
  usageCsvPath,
  usageMetadataPath,
  auditEvidencePath,
  expectedAuditSource,
  auditMetadataPath,
  observationRoot,
}) {
  const privateRoot = findPrivateRoot(proofPath);
  const observationAbsolute = realpathSync(resolve(observationRoot));
  invariant(
    isWithin(privateRoot, observationAbsolute),
    "GitHub observation root escapes the private root",
  );
  const observation = validateGitHubBillingObservation(observationAbsolute);
  const usageCsvBytes = readPrivateFile(
    usageCsvPath,
    privateRoot,
    "GitHub usage CSV",
  );
  const usageMetadataRead = readPrivateJson(
    usageMetadataPath,
    privateRoot,
    "GitHub usage metadata",
  );
  const auditEvidenceBytes = readPrivateFile(
    auditEvidencePath,
    privateRoot,
    "GitHub audit evidence",
  );
  const auditMetadataRead = readPrivateJson(
    auditMetadataPath,
    privateRoot,
    "GitHub audit metadata",
  );
  const usageMetadata = parseUsageMetadata(
    usageMetadataRead.bytes,
    observation,
  );
  const usage = aggregateUsage(usageCsvBytes, usageMetadata);
  const audit = validateAuditEvidence(
    auditEvidenceBytes,
    auditMetadataRead.bytes,
    observation,
  );
  invariant(
    expectedAuditSource === undefined || audit.source === expectedAuditSource,
    "GitHub audit evidence source conflicts with the selected CLI option",
  );
  const collector = collectorRunnerMinutes(observation);
  const standardRunnerMinutes = numberFromDecimal(
    usage.standardRunner.quantity,
    "Standard runner minutes",
  );
  const largerRunnerMinutes = numberFromDecimal(
    usage.largerRunner.quantity,
    "Larger runner minutes",
  );
  const artifactStorageGbHours = numberFromDecimal(
    usage.artifactStorage.quantity,
    "Artifact storage GB-hours",
  );
  const cacheStorageGbHours = numberFromDecimal(
    usage.cacheStorage.quantity,
    "Cache storage GB-hours",
  );
  const customImageStorageGbHours = numberFromDecimal(
    usage.customImageStorage.quantity,
    "Custom image storage GB-hours",
  );
  const standardNetZero = usage.standardRunner.netAmountUsd === "0";
  const runnerMinutesMatch =
    Number.isSafeInteger(standardRunnerMinutes) &&
    standardRunnerMinutes === collector.minutes;
  const repositoryPublicEntireWindow =
    observation.repositoryPublicAtEverySample &&
    audit.repositoryAccessEventCount === 0;
  const customImageStorageZero = customImageStorageGbHours === 0;
  const eligibleForAnalyzer =
    runnerMinutesMatch &&
    standardNetZero &&
    largerRunnerMinutes === 0 &&
    customImageStorageZero &&
    repositoryPublicEntireWindow;
  return {
    schema: GITHUB_ACTIONS_PROOF_SCHEMA,
    repository: REPOSITORY,
    interval: {
      startUtc: observation.startUtc,
      endUtcExclusive: observation.endUtcExclusive,
      semantics: "half-open-complete-utc-days",
    },
    sources: {
      usageCsv: {
        path: relativeSource(
          proofPath,
          usageCsvPath,
          privateRoot,
          "GitHub usage CSV",
        ),
        sha256: sha256(usageCsvBytes),
      },
      usageMetadata: {
        path: relativeSource(
          proofPath,
          usageMetadataPath,
          privateRoot,
          "GitHub usage metadata",
        ),
        sha256: sha256(usageMetadataRead.bytes),
      },
      auditEvidence: {
        path: relativeSource(
          proofPath,
          auditEvidencePath,
          privateRoot,
          "GitHub audit evidence",
        ),
        sha256: sha256(auditEvidenceBytes),
      },
      auditMetadata: {
        path: relativeSource(
          proofPath,
          auditMetadataPath,
          privateRoot,
          "GitHub audit metadata",
        ),
        sha256: sha256(auditMetadataRead.bytes),
      },
      observation: {
        path: relativeSource(
          proofPath,
          observationAbsolute,
          privateRoot,
          "GitHub observation root",
        ),
        treeSha256: observation.observationTreeSha256,
      },
    },
    catalog: {
      version: CATALOG_VERSION,
      product: "Actions",
      standardRunnerSkus: STANDARD_RUNNER_SKUS,
      largerRunnerSkus: LARGER_RUNNER_SKUS,
      storageSkus: STORAGE_SKUS,
      workflowPaths: GITHUB_BILLING_WORKFLOW_PATHS,
    },
    usage,
    collector: {
      standardRunnerMinutes: collector.minutes,
      runnerJobCount: collector.jobCount,
      rounding: collector.rounding,
      terminalSampleCapturedAtUtc: observation.terminalSampleCapturedAtUtc,
    },
    visibility: {
      publicAtEveryCollectorSample: observation.repositoryPublicAtEverySample,
      auditSource: audit.source,
      auditFormat: audit.format,
      auditEvidenceUnitCount: audit.pageCount,
      repositoryAccessEventCount: audit.repositoryAccessEventCount,
      repositoryPublicEntireWindow,
    },
    reconciliation: {
      standardRunnerMinutesMatchCollector: runnerMinutesMatch,
      publicStandardRunnerNetAmountZero: standardNetZero,
      largerRunnerMinutesZero: largerRunnerMinutes === 0,
      customImageStorageZero,
    },
    billingSemantics: {
      currency: "USD",
      amountEquation: "gross_amount - discount_amount = net_amount",
      standardRunnerCost:
        "net amount must be zero while the repository remains public",
      storageAccrual:
        "billing CSV quantities are hourly GB-hours and may differ from point-in-time snapshots",
      cacheScope:
        "actions_cache_storage is billable cache usage after GitHub allowances, not physical cache size",
      storageAttribution:
        "nonzero storage is accepted only when the detailed report assigns it to one allowlisted deployment workflow; repository-level blank-path storage is not attributed to the migration",
      csvCompleteness:
        "GitHub detailed web CSV has no machine-verifiable completion marker; the bound metadata is a maintainer attestation after the documented storage lag",
      auditCompleteness:
        audit.source === AUDIT_REST_SOURCE
          ? "REST evidence binds a cursor-free first page and the complete exact Link next chain"
          : "owner web JSON export completeness is maintainer-attested; GitHub provides no pagination proof or provider signature, and hard-limits exports at 100 MB compressed or 10 minutes processing time",
    },
    analyzerFragment: {
      standardRunnerMinutes,
      largerRunnerMinutes,
      artifactStorageGbHours,
      cacheStorageGbHours,
      repositoryPublicEntireWindow,
      mainDeploymentObservationOpportunities:
        observation.mainDeploymentObservationOpportunities,
    },
    eligibleForAnalyzer,
  };
}

export function buildGitHubActionsCostProof(options) {
  const proofPath = locatePrivatePath(options.output).path;
  const auditInputs = [
    options.auditRestTranscript,
    options.auditWebExport,
  ].filter((value) => typeof value === "string" && value.length > 0);
  invariant(
    auditInputs.length === 1,
    "Exactly one of auditRestTranscript or auditWebExport is required",
  );
  return buildProofData({
    proofPath,
    usageCsvPath: resolve(options.usageCsv),
    usageMetadataPath: resolve(options.usageMetadata),
    auditEvidencePath: resolve(auditInputs[0]),
    expectedAuditSource: options.auditRestTranscript
      ? AUDIT_REST_SOURCE
      : AUDIT_WEB_SOURCE,
    auditMetadataPath: resolve(options.auditMetadata),
    observationRoot: resolve(options.observationRoot),
  });
}

export function validateGitHubActionsCostProof(proofPath) {
  const absoluteProof = locatePrivatePath(proofPath).path;
  const privateRoot = findPrivateRoot(absoluteProof);
  const proofBytes = readPrivateFile(
    absoluteProof,
    privateRoot,
    "GitHub Actions proof",
  );
  const proof = parseJson(proofBytes, "GitHub Actions proof");
  invariant(
    proofBytes.equals(Buffer.from(canonicalJson(proof))),
    "GitHub Actions proof must be canonical JSON",
  );
  invariant(
    proof.schema === GITHUB_ACTIONS_PROOF_SCHEMA,
    "GitHub Actions proof schema is unsupported",
  );
  invariant(
    proof.eligibleForAnalyzer === true,
    "GitHub Actions proof is not eligible for analyzer use",
  );
  const expected = buildProofData({
    proofPath: absoluteProof,
    usageCsvPath: resolveSource(
      absoluteProof,
      proof.sources.usageCsv.path,
      privateRoot,
      "GitHub usage CSV path",
    ),
    usageMetadataPath: resolveSource(
      absoluteProof,
      proof.sources.usageMetadata.path,
      privateRoot,
      "GitHub usage metadata path",
    ),
    auditEvidencePath: resolveSource(
      absoluteProof,
      proof.sources.auditEvidence.path,
      privateRoot,
      "GitHub audit evidence path",
    ),
    auditMetadataPath: resolveSource(
      absoluteProof,
      proof.sources.auditMetadata.path,
      privateRoot,
      "GitHub audit metadata path",
    ),
    observationRoot: resolveSource(
      absoluteProof,
      proof.sources.observation.path,
      privateRoot,
      "GitHub observation root path",
    ),
  });
  invariant(
    canonicalJson(proof) === canonicalJson(expected),
    "GitHub Actions proof does not reconcile to its bound sources",
  );
  return proof;
}

function inspectCsv(inputPath, outputPath, publication = {}) {
  const absoluteOutput = locatePrivatePath(outputPath).path;
  const privateRoot = findPrivateRoot(absoluteOutput);
  const bytes = readPrivateFile(inputPath, privateRoot, "GitHub usage CSV");
  const parsed = parseCsv(bytes);
  const distinct = (key) =>
    [...new Set(parsed.rows.map((row) => row[key]))].sort();
  const report = {
    schema: "vercel-cost-github-usage-inspection:v1",
    csvSha256: sha256(bytes),
    rowCount: parsed.rows.length,
    headers: parsed.headers,
    products: distinct("product"),
    skus: distinct("sku"),
    units: distinct("unit_type"),
    repositories: distinct("repository"),
    workflowPaths: distinct("workflow_path"),
  };
  writePrivateOutput(absoluteOutput, report, privateRoot, publication);
  return report;
}

export function inspectGitHubActionsUsage(
  { usageCsv, output },
  { afterLink = () => {} } = {},
) {
  return inspectCsv(usageCsv, output, { afterLink });
}

function writePrivateOutput(
  path,
  value,
  privateRoot,
  { afterLink = () => {} } = {},
) {
  invariant(
    isWithin(privateRoot, path),
    "GitHub cost output escapes the private root",
  );
  assertPrivateDirectoryChain(dirname(path), privateRoot, "GitHub cost output");
  recoverPrivateOutputPublication(path, privateRoot);
  const bytes = canonicalJson(value);
  const temporary = `${path}.tmp-${sha256(bytes)}`;
  writeFileSync(temporary, bytes, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  const descriptor = openSync(temporary, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    // The link publication is exclusive: an existing proof is never replaced.
    linkSync(temporary, path);
    afterLink({ path, temporary });
    unlinkSync(temporary);
    const directoryDescriptor = openSync(dirname(path), "r");
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {
        throw new AggregateError(
          [error, cleanupError],
          "GitHub cost output publication and cleanup both failed",
        );
      }
    }
    throw error;
  }
}

function recoverPrivateOutputPublication(path, privateRoot) {
  const directory = dirname(path);
  const prefix = `${basename(path)}.tmp-`;
  let changed = false;
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(prefix)) continue;
    const match = /^.+\.tmp-([a-f0-9]{64})$/.exec(name);
    invariant(match, "GitHub cost output staging name is malformed");
    const temporary = resolve(directory, name);
    invariant(
      isWithin(privateRoot, temporary),
      "GitHub cost output staging escapes",
    );
    const temporaryStats = lstatSync(temporary);
    invariant(
      temporaryStats.isFile() &&
        !temporaryStats.isSymbolicLink() &&
        (temporaryStats.mode & 0o777) === 0o600,
      "GitHub cost output staging entry is unsafe",
    );
    invariant(
      sha256(readFileSync(temporary)) === match[1],
      "GitHub cost output staging digest is ambiguous",
    );
    let recoverable = false;
    try {
      const outputStats = lstatSync(path);
      recoverable =
        temporaryStats.nlink === 2 &&
        outputStats.isFile() &&
        !outputStats.isSymbolicLink() &&
        outputStats.dev === temporaryStats.dev &&
        outputStats.ino === temporaryStats.ino;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    invariant(recoverable, "GitHub cost output staging entry is ambiguous");
    unlinkSync(temporary);
    changed = true;
  }
  if (changed) {
    const descriptor = openSync(directory, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}

function usage() {
  return "Usage: vercel-cost-github-actions.mjs inspect --usage-csv <private.csv> --output <inspection.json> | build --usage-csv <private.csv> --usage-metadata <metadata.json> (--audit-rest-transcript <transcript.txt> | --audit-web-export <export.json>) --audit-metadata <metadata.json> --observation-root <root> --output <proof.json>";
}

function parseArguments(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const [command, ...rest] = normalized;
  invariant(command === "inspect" || command === "build", usage());
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    invariant(rest[index]?.startsWith("--") && rest[index + 1], usage());
    const key = rest[index]
      .slice(2)
      .replaceAll(/-([a-z])/g, (_, character) => character.toUpperCase());
    invariant(!Object.hasOwn(options, key), `Duplicate option: ${rest[index]}`);
    options[key] = rest[index + 1];
  }
  if (command === "inspect") {
    invariant(
      JSON.stringify(Object.keys(options).sort()) ===
        JSON.stringify(["usageCsv", "output"].sort()),
      usage(),
    );
  } else {
    const required = [
      "usageCsv",
      "usageMetadata",
      "auditMetadata",
      "observationRoot",
      "output",
    ];
    invariant(
      required.every((key) => Object.hasOwn(options, key)),
      usage(),
    );
    const auditInputs = ["auditRestTranscript", "auditWebExport"].filter(
      (key) => Object.hasOwn(options, key),
    );
    invariant(auditInputs.length === 1, usage());
    invariant(
      Object.keys(options).every(
        (key) => required.includes(key) || auditInputs.includes(key),
      ),
      usage(),
    );
  }
  return { command, options };
}

export function runGitHubActionsCostCli(
  argv,
  { stdout = process.stdout } = {},
) {
  const { command, options } = parseArguments(argv);
  if (command === "inspect") {
    inspectGitHubActionsUsage(options);
    stdout.write(`GitHub usage shape written to ${options.output}\n`);
    return { exitCode: 0 };
  }
  const proof = buildGitHubActionsCostProof(options);
  const absoluteOutput = locatePrivatePath(options.output).path;
  writePrivateOutput(absoluteOutput, proof, findPrivateRoot(absoluteOutput));
  stdout.write(
    `GitHub Actions proof written to ${options.output}; eligible=${proof.eligibleForAnalyzer}\n`,
  );
  return { exitCode: proof.eligibleForAnalyzer ? 0 : 2 };
}

function isDirectExecution() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isDirectExecution()) {
  try {
    const result = runGitHubActionsCostCli(process.argv.slice(2));
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
