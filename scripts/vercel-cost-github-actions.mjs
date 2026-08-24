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
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import {
  GITHUB_BILLING_WORKFLOW_PATHS,
  validateGitHubBillingObservation,
} from "./vercel-cost-observation.mjs";

export const GITHUB_ACTIONS_PROOF_SCHEMA =
  "vercel-cost-github-actions-proof:v4";
export const GITHUB_USAGE_METADATA_SCHEMA =
  "vercel-cost-github-usage-export-metadata:v1";
export const GITHUB_AUDIT_METADATA_SCHEMA =
  "vercel-cost-github-audit-export-metadata:v3";

const REPOSITORY = "mento-protocol/frontend-monorepo";
const ORGANIZATION = "mento-protocol";
const USAGE_PRODUCT = "actions";
const USAGE_REPOSITORY = "frontend-monorepo";
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
const AUDIT_WEB_ZERO_SOURCE =
  "github-org-audit-log-owner-web-zero-result-attestation";
const AUDIT_WEB_ZERO_TEXT = "We couldn’t find any events matching your search.";
const COLLECTOR_MINUTES_PER_TOLERANCE_MINUTE = 1_000;
const COLLECTOR_TOLERANCE_CAP_MINUTES = 10;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const SCREENSHOT_MIN_WIDTH = 640;
const SCREENSHOT_MIN_HEIGHT = 480;
const SCREENSHOT_MAX_DIMENSION = 16_384;
const SCREENSHOT_MAX_PIXELS = 16_000_000;
const SCREENSHOT_MAX_BYTES = 25 * 1_024 * 1_024;
const PNG_MAX_CHUNKS = 1_024;
const PNG_MAX_IDAT_CHUNKS = 256;
const AUDIT_WEB_ZERO_FORMAT = "browser-screenshot-png";

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

function readPrivateFile(path, privateRoot, label, { maxBytes } = {}) {
  invariant(
    maxBytes === undefined || (Number.isSafeInteger(maxBytes) && maxBytes >= 0),
    `${label} byte limit is invalid`,
  );
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
    maxBytes === undefined || requestedStats.size <= maxBytes,
    `${label} exceeds ${maxBytes} bytes`,
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
        (opened.mode & 0o777) === 0o600 &&
        opened.size === requestedStats.size,
      `${label} changed while opening`,
    );
    if (maxBytes !== undefined) {
      invariant(opened.size <= maxBytes, `${label} exceeds ${maxBytes} bytes`);
      const bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(
          descriptor,
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        invariant(count > 0, `${label} changed while reading`);
        offset += count;
      }
      invariant(
        readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length) === 0,
        `${label} changed while reading`,
      );
      return bytes;
    }
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

function canonicalGitRef(value) {
  if (!/^refs\/(?:heads|pull|tags)\/[A-Za-z0-9._/-]+$/.test(value))
    return false;
  const components = value.split("/");
  return (
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    components.every(
      (component) =>
        component.length > 0 &&
        !component.startsWith(".") &&
        !component.endsWith(".lock"),
    )
  );
}

function canonicalWorkflowPath(value) {
  const workflow =
    /^(?:mento-protocol\/frontend-monorepo\/)?(\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml)(?:@([A-Za-z0-9._/-]+))?$/.exec(
      value,
    );
  if (
    workflow &&
    (workflow[2] === undefined ||
      /^[a-f0-9]{40}$/.test(workflow[2]) ||
      canonicalGitRef(workflow[2]))
  )
    return workflow[1];
  const dynamic =
    /^(?:mento-protocol\/frontend-monorepo\/)?(dynamic\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+))$/.exec(
      value,
    );
  return dynamic &&
    ![dynamic[2], dynamic[3]].includes(".") &&
    ![dynamic[2], dynamic[3]].includes("..")
    ? dynamic[1]
    : null;
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
  let repositoryActionsRowCount = 0;
  let targetRowCount = 0;
  let ignoredNonDeploymentRowCount = 0;
  let repositoryLevelStorageRowCount = 0;
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    if (
      row.product !== USAGE_PRODUCT ||
      row.organization !== ORGANIZATION ||
      row.repository !== USAGE_REPOSITORY
    )
      continue;
    repositoryActionsRowCount += 1;
    const parsedWorkflowPath = canonicalWorkflowPath(row.workflow_path);
    invariant(
      row.workflow_path === "" || parsedWorkflowPath !== null,
      `GitHub usage CSV row ${rowNumber} workflow_path is malformed`,
    );
    const selectedWorkflowPath = GITHUB_BILLING_WORKFLOW_PATHS.includes(
      parsedWorkflowPath,
    )
      ? parsedWorkflowPath
      : null;
    if (row.workflow_path === "") {
      invariant(
        STORAGE_SKUS.includes(row.sku),
        `GitHub usage CSV row ${rowNumber} has a blank workflow_path for a non-storage or unknown SKU: ${row.sku}`,
      );
    }
    const repositoryLevelStorage =
      row.workflow_path === "" && STORAGE_SKUS.includes(row.sku);
    if (!selectedWorkflowPath && !repositoryLevelStorage) {
      ignoredNonDeploymentRowCount += 1;
      continue;
    }
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
        selectedWorkflowPath,
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
      invariant(
        row.workflow_path === "" || selectedWorkflowPath,
        `GitHub usage CSV row ${rowNumber} storage workflow_path is outside the deployment allowlist`,
      );
      if (repositoryLevelStorage) repositoryLevelStorageRowCount += 1;
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
    repositoryActionsRowCount,
    targetRowCount,
    ignoredNonDeploymentRowCount,
    repositoryLevelStorageRowCount,
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
    const rawPageUrl = metadata.pageUrls[index];
    const pageUrl = new URL(rawPageUrl);
    invariant(
      rawPageUrl.startsWith(
        `https://api.github.com/orgs/${ORGANIZATION}/audit-log?`,
      ) &&
        pageUrl.origin === "https://api.github.com" &&
        pageUrl.username === "" &&
        pageUrl.password === "" &&
        pageUrl.port === "" &&
        pageUrl.hash === "" &&
        pageUrl.pathname === `/orgs/${ORGANIZATION}/audit-log`,
      `GitHub audit metadata page ${index + 1} URL is unsupported`,
    );
    const queryKeys = [...pageUrl.searchParams.keys()];
    const allowedQueryKeys = new Set([
      "phrase",
      "include",
      "order",
      "per_page",
      "after",
      "before",
    ]);
    invariant(
      queryKeys.every((key) => allowedQueryKeys.has(key)) &&
        ["phrase", "include", "order", "per_page"].every(
          (key) =>
            queryKeys.filter((candidate) => candidate === key).length === 1,
        ) &&
        queryKeys.filter((key) => key === "after").length <= 1 &&
        queryKeys.filter((key) => key === "before").length <= 1 &&
        pageUrl.searchParams.get("phrase") === metadata.queryPhrase &&
        pageUrl.searchParams.get("include") === metadata.include &&
        pageUrl.searchParams.get("order") === metadata.order &&
        pageUrl.searchParams.get("per_page") === String(metadata.perPage),
      `GitHub audit metadata page ${index + 1} URL does not bind the query`,
    );
    const after = pageUrl.searchParams.get("after");
    const before = pageUrl.searchParams.get("before");
    invariant(
      index !== 0 || (after === null && before === null),
      "GitHub audit metadata first page must be cursor-free",
    );
    invariant(
      index === 0 ||
        ((after !== null) !== (before !== null) &&
          (after ?? before).length > 0),
      `GitHub audit metadata page ${index + 1} must have exactly one nonempty cursor`,
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

function validateScreenshotDimensions(width, height) {
  invariant(
    Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width >= SCREENSHOT_MIN_WIDTH &&
      height >= SCREENSHOT_MIN_HEIGHT &&
      width <= SCREENSHOT_MAX_DIMENSION &&
      height <= SCREENSHOT_MAX_DIMENSION &&
      width * height <= SCREENSHOT_MAX_PIXELS,
    `GitHub zero-result audit screenshot dimensions must be between ${SCREENSHOT_MIN_WIDTH}x${SCREENSHOT_MIN_HEIGHT} and ${SCREENSHOT_MAX_DIMENSION}x${SCREENSHOT_MAX_DIMENSION} with at most ${SCREENSHOT_MAX_PIXELS} pixels`,
  );
  return { width, height };
}

function validatePngScreenshot(bytes) {
  invariant(
    bytes.length >= 45 &&
      bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    "GitHub zero-result audit screenshot is not a complete PNG",
  );
  let offset = PNG_SIGNATURE.length;
  let image = null;
  let channels = null;
  let sawIdat = false;
  let idatEnded = false;
  let sawIend = false;
  let chunkCount = 0;
  const idatChunks = [];
  while (offset < bytes.length) {
    chunkCount += 1;
    invariant(
      chunkCount <= PNG_MAX_CHUNKS,
      `GitHub zero-result audit PNG exceeds ${PNG_MAX_CHUNKS} chunks`,
    );
    invariant(
      offset + 12 <= bytes.length,
      "GitHub zero-result audit PNG has a truncated chunk",
    );
    const length = bytes.readUInt32BE(offset);
    invariant(
      length <= bytes.length - offset - 12,
      "GitHub zero-result audit PNG chunk length is invalid",
    );
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    invariant(
      [...typeBytes].every(
        (byte) =>
          (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a),
      ),
      "GitHub zero-result audit PNG chunk type is invalid",
    );
    invariant(
      (typeBytes[2] & 0x20) === 0,
      "GitHub zero-result audit PNG chunk reserved bit is invalid",
    );
    const type = typeBytes.toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    invariant(
      bytes.readUInt32BE(dataEnd) ===
        crc32(bytes.subarray(offset + 4, dataEnd)),
      `GitHub zero-result audit PNG ${type} checksum is invalid`,
    );
    invariant(
      offset !== PNG_SIGNATURE.length || type === "IHDR",
      "GitHub zero-result audit PNG must start with IHDR",
    );
    if (type === "IHDR") {
      invariant(
        image === null && length === 13,
        "GitHub zero-result audit PNG has an invalid IHDR",
      );
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const channelCount = new Map([
        [0, 1],
        [2, 3],
        [4, 2],
        [6, 4],
      ]).get(colorType);
      invariant(
        bitDepth === 8 && channelCount !== undefined,
        "GitHub zero-result audit PNG must use 8-bit non-indexed pixels",
      );
      invariant(
        bytes[dataStart + 10] === 0 &&
          bytes[dataStart + 11] === 0 &&
          bytes[dataStart + 12] === 0,
        "GitHub zero-result audit PNG compression, filtering, or interlace method is unsupported",
      );
      image = validateScreenshotDimensions(width, height);
      channels = channelCount;
    } else if (type === "IDAT") {
      invariant(
        image !== null &&
          !idatEnded &&
          length > 0 &&
          idatChunks.length < PNG_MAX_IDAT_CHUNKS,
        "GitHub zero-result audit PNG has misplaced IDAT data",
      );
      sawIdat = true;
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
    } else {
      if (sawIdat) idatEnded = true;
      invariant(
        type === "IEND" || (typeBytes[0] & 0x20) !== 0,
        `GitHub zero-result audit PNG has an unsupported critical chunk: ${type}`,
      );
      if (type === "IEND") {
        invariant(
          length === 0 && dataEnd + 4 === bytes.length,
          "GitHub zero-result audit PNG has an invalid IEND",
        );
        sawIend = true;
      }
    }
    offset = dataEnd + 4;
  }
  invariant(
    image !== null && sawIdat && sawIend,
    "GitHub zero-result audit PNG is incomplete",
  );
  const rowBytes = image.width * channels;
  const expectedInflatedLength = (rowBytes + 1) * image.height;
  const compressedPixels = Buffer.concat(idatChunks);
  let inflated;
  try {
    inflated = inflateSync(compressedPixels, {
      info: true,
      maxOutputLength: expectedInflatedLength,
    });
  } catch {
    throw new Error("GitHub zero-result audit PNG pixel data is invalid");
  }
  invariant(
    inflated.engine.bytesWritten === compressedPixels.length,
    "GitHub zero-result audit PNG has trailing compressed data",
  );
  const pixels = inflated.buffer;
  invariant(
    pixels.length === expectedInflatedLength,
    "GitHub zero-result audit PNG pixel length is invalid",
  );
  for (let row = 0; row < image.height; row += 1) {
    invariant(
      pixels[row * (rowBytes + 1)] <= 4,
      `GitHub zero-result audit PNG row ${row + 1} has an invalid filter`,
    );
  }
  return image;
}

function validateScreenshot(bytes) {
  invariant(
    bytes.length <= SCREENSHOT_MAX_BYTES,
    `GitHub zero-result audit screenshot exceeds ${SCREENSHOT_MAX_BYTES} bytes`,
  );
  return validatePngScreenshot(bytes);
}

function validateWebZeroAuditEvidence(screenshotBytes, metadata, observation) {
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
      "pageUrl",
      "zeroResultText",
      "eventCount",
      "screenshotByteLength",
      "screenshotSha256",
      "ownerAttestation",
    ],
    "GitHub audit metadata",
  );
  invariant(
    metadata.source === AUDIT_WEB_ZERO_SOURCE &&
      metadata.format === AUDIT_WEB_ZERO_FORMAT,
    "GitHub zero-result audit metadata source or format is unsupported",
  );
  validateAuditMetadataCommon(metadata, observation);
  invariant(
    metadata.eventCount === 0,
    "GitHub zero-result audit metadata eventCount must be zero",
  );
  invariant(
    Number.isSafeInteger(metadata.screenshotByteLength) &&
      metadata.screenshotByteLength === screenshotBytes.length,
    "GitHub audit metadata does not bind the zero-result screenshot byte length",
  );
  invariant(
    DIGEST_PATTERN.test(metadata.screenshotSha256) &&
      metadata.screenshotSha256 === sha256(screenshotBytes),
    "GitHub audit metadata does not bind the zero-result screenshot bytes",
  );
  const screenshot = validateScreenshot(screenshotBytes);
  const pageUrl = new URL(metadata.pageUrl);
  const expectedPageUrl = new URL(
    `https://github.com/organizations/${ORGANIZATION}/settings/audit-log`,
  );
  expectedPageUrl.searchParams.set("q", metadata.queryPhrase);
  invariant(
    metadata.pageUrl === expectedPageUrl.toString() &&
      pageUrl.origin === "https://github.com" &&
      pageUrl.username === "" &&
      pageUrl.password === "" &&
      pageUrl.port === "" &&
      pageUrl.hash === "" &&
      pageUrl.pathname ===
        `/organizations/${ORGANIZATION}/settings/audit-log` &&
      [...pageUrl.searchParams.keys()].length === 1 &&
      pageUrl.searchParams.get("q") === metadata.queryPhrase,
    "GitHub zero-result audit page URL does not bind the exact query",
  );
  invariant(
    metadata.zeroResultText === AUDIT_WEB_ZERO_TEXT,
    "GitHub zero-result audit text is unsupported",
  );
  const attestation = exactKeys(
    metadata.ownerAttestation,
    ["role", "zeroResultVisible", "exportControlAvailable", "pageError"],
    "GitHub audit ownerAttestation",
  );
  invariant(
    attestation.role === "admin",
    "GitHub zero-result audit page must be attested by an organization admin owner",
  );
  invariant(
    attestation.zeroResultVisible === true &&
      attestation.exportControlAvailable === false &&
      attestation.pageError === null,
    "GitHub zero-result audit page attestation is incomplete",
  );
  return {
    source: metadata.source,
    format: metadata.format,
    pageCount: 1,
    eventCount: 0,
    repositoryAccessEventCount: 0,
    screenshot,
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
  if (metadata.source === AUDIT_WEB_ZERO_SOURCE) {
    return validateWebZeroAuditEvidence(evidenceBytes, metadata, observation);
  }
  throw new Error("GitHub audit metadata source is unsupported");
}

function collectorRunnerMinutes(observation) {
  let minutes = 0;
  let jobCount = 0;
  for (const job of observation.runnerJobs) {
    // GitHub assigns synthetic timestamps to skipped jobs. The timestamps can
    // be inverted, and skipped jobs do not consume runner minutes.
    if (job.conclusion === "skipped") continue;
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
  return {
    minutes,
    jobCount,
    rounding:
      "ceil-each-non-skipped-job-from-second-resolution-rest-timestamps",
  };
}

function numberFromDecimal(value, label) {
  const number = Number(value);
  invariant(
    Number.isFinite(number) && number >= 0,
    `${label} is outside the analyzer number range`,
  );
  const [mantissa, exponentText = "0"] = String(number).split("e");
  const [integer, fraction = ""] = mantissa.split(".");
  const exponent = Number(exponentText);
  let scale = fraction.length - exponent;
  let coefficient = BigInt(`${integer}${fraction}`);
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  invariant(
    normalizeDecimal({ coefficient, scale }) === value,
    `${label} loses precision in the analyzer number range`,
  );
  return number;
}

function safeIntegerFromDecimal(value, label) {
  invariant(
    /^(?:0|[1-9][0-9]*)$/.test(value),
    `${label} must be a whole number`,
  );
  const number = Number(value);
  invariant(
    Number.isSafeInteger(number),
    `${label} is outside the analyzer safe-integer range`,
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
  const auditMetadataRead = readPrivateJson(
    auditMetadataPath,
    privateRoot,
    "GitHub audit metadata",
  );
  const auditEvidenceBytes = readPrivateFile(
    auditEvidencePath,
    privateRoot,
    "GitHub audit evidence",
    {
      maxBytes:
        expectedAuditSource === AUDIT_WEB_ZERO_SOURCE ||
        auditMetadataRead.value?.source === AUDIT_WEB_ZERO_SOURCE
          ? SCREENSHOT_MAX_BYTES
          : undefined,
    },
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
  const standardRunnerMinutes = safeIntegerFromDecimal(
    usage.standardRunner.quantity,
    "Standard runner minutes",
  );
  const largerRunnerMinutes = safeIntegerFromDecimal(
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
  const standardNetZero = usage.standardRunner.netAmountUsd === "0";
  const largerRunnerNetZero = usage.largerRunner.netAmountUsd === "0";
  const artifactStorageNetZero = usage.artifactStorage.netAmountUsd === "0";
  const cacheStorageNetZero = usage.cacheStorage.netAmountUsd === "0";
  const customImageStorageNetZero =
    usage.customImageStorage.netAmountUsd === "0";
  const runnerMinutesMatch =
    Number.isSafeInteger(standardRunnerMinutes) &&
    standardRunnerMinutes === collector.minutes;
  const collectorMinusUsageRunnerMinutes = Number.isSafeInteger(
    standardRunnerMinutes,
  )
    ? collector.minutes - standardRunnerMinutes
    : null;
  const runnerMinuteTolerance = Math.min(
    COLLECTOR_TOLERANCE_CAP_MINUTES,
    Math.floor(collector.minutes / COLLECTOR_MINUTES_PER_TOLERANCE_MINUTE),
  );
  const runnerMinutesWithinCollectorTolerance =
    collectorMinusUsageRunnerMinutes !== null &&
    collectorMinusUsageRunnerMinutes >= 0 &&
    collectorMinusUsageRunnerMinutes <= runnerMinuteTolerance;
  const repositoryPublicEntireWindow =
    observation.repositoryPublicAtEverySample &&
    audit.repositoryAccessEventCount === 0;
  const largerRunnerMinutesZero = usage.largerRunner.quantity === "0";
  const customImageStorageZero = usage.customImageStorage.quantity === "0";
  const eligibleForAnalyzer =
    runnerMinutesWithinCollectorTolerance &&
    standardNetZero &&
    largerRunnerNetZero &&
    artifactStorageNetZero &&
    cacheStorageNetZero &&
    customImageStorageNetZero &&
    largerRunnerMinutesZero &&
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
      product: USAGE_PRODUCT,
      repository: USAGE_REPOSITORY,
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
      auditScreenshotPixelWidth: audit.screenshot?.width ?? null,
      auditScreenshotPixelHeight: audit.screenshot?.height ?? null,
      repositoryAccessEventCount: audit.repositoryAccessEventCount,
      repositoryPublicEntireWindow,
    },
    reconciliation: {
      standardRunnerMinutesMatchCollector: runnerMinutesMatch,
      collectorMinusUsageStandardRunnerMinutes:
        collectorMinusUsageRunnerMinutes,
      standardRunnerMinuteTolerance: runnerMinuteTolerance,
      standardRunnerMinutesWithinCollectorTolerance:
        runnerMinutesWithinCollectorTolerance,
      publicStandardRunnerNetAmountZero: standardNetZero,
      largerRunnerNetAmountZero: largerRunnerNetZero,
      artifactStorageNetAmountZero: artifactStorageNetZero,
      cacheStorageNetAmountZero: cacheStorageNetZero,
      customImageStorageNetAmountZero: customImageStorageNetZero,
      largerRunnerMinutesZero,
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
        "workflow-attributed storage uses the deployment allowlist; blank-path storage uses the complete repository total as a conservative upper bound and is not claimed as migration-only",
      csvCompleteness:
        "GitHub detailed web CSV has no machine-verifiable completion marker; the bound metadata is a maintainer attestation after the documented storage lag",
      collectorReconciliation:
        "the detailed usage CSV is the billing source of record; the complete second-resolution REST job collector may exceed it by at most one minute per 1,000 reconstructed minutes, capped at 10 minutes; a CSV total above the collector fails closed",
      auditCompleteness:
        audit.source === AUDIT_REST_SOURCE
          ? "REST evidence binds a cursor-free first page and the complete exact Link next chain"
          : audit.source === AUDIT_WEB_SOURCE
            ? "owner web JSON export completeness is maintainer-attested; GitHub provides no pagination proof or provider signature, and hard-limits exports at 100 MB compressed or 10 minutes processing time"
            : "owner web zero-result completeness is maintainer-attested and bound to the exact query URL, visible zero-result text, and screenshot bytes; GitHub renders no export control for an empty result",
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
    options.auditWebZeroScreenshot,
  ].filter((value) => typeof value === "string" && value.length > 0);
  invariant(
    auditInputs.length === 1,
    "Exactly one audit evidence input is required",
  );
  return buildProofData({
    proofPath,
    usageCsvPath: resolve(options.usageCsv),
    usageMetadataPath: resolve(options.usageMetadata),
    auditEvidencePath: resolve(auditInputs[0]),
    expectedAuditSource: options.auditRestTranscript
      ? AUDIT_REST_SOURCE
      : options.auditWebExport
        ? AUDIT_WEB_SOURCE
        : AUDIT_WEB_ZERO_SOURCE,
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
    expectedAuditSource: proof.visibility?.auditSource,
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
  return "Usage: vercel-cost-github-actions.mjs inspect --usage-csv <private.csv> --output <inspection.json> | build --usage-csv <private.csv> --usage-metadata <metadata.json> (--audit-rest-transcript <transcript.txt> | --audit-web-export <export.json> | --audit-web-zero-screenshot <screenshot.png>) --audit-metadata <metadata.json> --observation-root <root> --output <proof.json>";
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
    const auditInputs = [
      "auditRestTranscript",
      "auditWebExport",
      "auditWebZeroScreenshot",
    ].filter((key) => Object.hasOwn(options, key));
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
