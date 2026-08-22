#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  canonicalJson,
  gitSubprocessEnvironment,
  parseCanonicalJson,
  rawDigest,
  validateRepairPatch,
  validateValidatedRepairPlan,
  validateProcessorRepairPacket,
  validateRepairPlan,
} from "./dependabot-preparation-receipts.mjs";
import { assertVercelCliRuntimeContract } from "./vercel-cli-runtime-contract.mjs";

const PACKET_SCHEMA = "dependabot-repair-packet:v3";
const OPERATION_SCHEMA = "dependabot-protected-runtime-sync:v1";
const CONTRACT_SCHEMA = "vercel-cli-runtime-contract:v1";
const PLAN_SCHEMA = "dependabot-repair-plan:v1";
const EVIDENCE_SCHEMA = "dependabot-repair-evidence:v1";
const EXACT_PNPM_VERSION = "10.34.4";
const HEX_SHA = /^[0-9a-f]{40}$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_EVIDENCE_NAME = /^[a-z][a-z0-9-]{0,60}\.(?:json|patch|txt)$/u;
const STABLE_SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const REGISTRY_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_BLOBS_BYTES = 24 * 1024 * 1024;
const MAX_PATCH_BYTES = 8_192;
const MAX_NEXT_CATALOG_PATCH_BYTES = 48 * 1024;
const MAX_PLAN_BYTES = 64 * 1024;
const NEXT_SWC_PACKAGES = Object.freeze([
  "@next/swc-darwin-arm64",
  "@next/swc-darwin-x64",
  "@next/swc-linux-arm64-gnu",
  "@next/swc-linux-arm64-musl",
  "@next/swc-linux-x64-gnu",
  "@next/swc-linux-x64-musl",
  "@next/swc-win32-arm64-msvc",
  "@next/swc-win32-x64-msvc",
]);
const NEXT_REGISTRY_DEPENDENCIES = Object.freeze([
  "@next/env",
  "@swc/helpers",
  "baseline-browser-mapping",
  "caniuse-lite",
  "postcss",
  "styled-jsx",
]);
const NEXT_RANGED_DEPENDENCIES = new Set([
  "baseline-browser-mapping",
  "caniuse-lite",
]);

export const PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
]);

export const PROTECTED_RUNTIME_SYNC_INPUT_PATHS = Object.freeze([
  "apps/app.mento.org/package.json",
  "apps/governance.mento.org/package.json",
  "apps/reserve.mento.org/package.json",
  "apps/ui.mento.org/package.json",
  "package.json",
  "packages/eslint-config/package.json",
  "packages/typescript-config/package.json",
  "packages/ui/package.json",
  "packages/vitest-config/package.json",
  "packages/web3/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
]);

export const NEXT_CATALOG_SYNC_REQUIRED_PATHS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vercel-cli-runtime/contract.json",
  "scripts/vercel-cli-runtime/package.json",
  "scripts/vercel-cli-runtime/pnpm-lock.yaml",
]);

const CONTRACT_KEYS = Object.freeze([
  "lockfileSha256",
  "manifestSha256",
  "overridesSha256",
  "registryIntegrity",
  "runtimeDependenciesSha256",
  "schema",
  "vercelVersion",
]);

function fail(message) {
  throw new Error(`Protected runtime sync rejected: ${message}`);
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    fail(`${label} keys are invalid`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function canonicalStringMap(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([key, entry]) =>
        typeof key !== "string" ||
        key.length === 0 ||
        typeof entry !== "string" ||
        entry.length === 0,
    )
  ) {
    fail(`${label} is not an exact string map`);
  }
  return Object.fromEntries(
    Object.entries(value).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function canonicalOptionalPeerMeta(value, peers, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} is not an exact optional-peer map`);
  }
  const entries = Object.entries(value).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  const result = {};
  for (const [name, metadata] of entries) {
    if (
      !Object.hasOwn(peers, name) ||
      metadata === null ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      JSON.stringify(Object.keys(metadata)) !== JSON.stringify(["optional"]) ||
      metadata.optional !== true
    ) {
      fail(`${label} contains an unsupported peer: ${name}`);
    }
    result[name] = { optional: true };
  }
  return result;
}

function stringMapDigest(value, label) {
  return sha256(JSON.stringify(canonicalStringMap(value, label)));
}

function semverParts(value, label) {
  if (!STABLE_SEMVER.test(value ?? "")) fail(`${label} is not stable semver`);
  return value.split(".").map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function deriveUpdateType(fromVersion, targetVersion) {
  const from = semverParts(fromVersion, "fromVersion");
  const target = semverParts(targetVersion, "targetVersion");
  if (from[0] !== target[0] || compareSemver(target, from) <= 0) return null;
  if (target[1] > from[1]) return "minor";
  if (target[1] === from[1] && target[2] > from[2]) return "patch";
  return null;
}

function nextCatalogOperation(operation) {
  return (
    operation?.schema === OPERATION_SCHEMA &&
    operation.kind === "next-catalog-override-sync" &&
    operation.dependency === "next"
  );
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} is not JSON`);
  }
}

function decodePacket(packetBase64) {
  if (
    typeof packetBase64 !== "string" ||
    packetBase64.length < 4 ||
    packetBase64.length > 96 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      packetBase64,
    )
  ) {
    fail("packet base64 is invalid");
  }
  const bytes = Buffer.from(packetBase64, "base64");
  if (bytes.toString("base64") !== packetBase64) {
    fail("packet base64 is not canonical");
  }
  const packetText = bytes.toString("utf8");
  if (!Buffer.from(packetText, "utf8").equals(bytes)) {
    fail("packet is not strict UTF-8");
  }
  const packet = parseCanonicalJson(packetText, "typed repair packet");
  validateProcessorRepairPacket(packet);
  const operation = packet.operation;
  const protectedRuntimeOperation =
    operation?.schema === OPERATION_SCHEMA &&
    operation.kind === "vercel-cli-runtime-sync" &&
    operation.dependency === "vercel" &&
    JSON.stringify(operation.requiredPaths) ===
      JSON.stringify(PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS);
  const catalogOperation =
    nextCatalogOperation(operation) &&
    operation.fromSpecifier === `^${operation.fromVersion}` &&
    operation.targetSpecifier === `^${operation.targetVersion}` &&
    operation.resolutionMode === "lowest-direct" &&
    JSON.stringify(operation.requiredPaths) ===
      JSON.stringify(NEXT_CATALOG_SYNC_REQUIRED_PATHS);
  if (
    packet.schema !== PACKET_SCHEMA ||
    (!protectedRuntimeOperation && !catalogOperation) ||
    operation.pnpmVersion !== EXACT_PNPM_VERSION ||
    JSON.stringify(operation.inputPaths) !==
      JSON.stringify(PROTECTED_RUNTIME_SYNC_INPUT_PATHS)
  ) {
    fail("packet operation is not an exact typed dependency sync contract");
  }
  const derivedUpdateType = deriveUpdateType(
    operation.fromVersion,
    operation.targetVersion,
  );
  if (
    derivedUpdateType === null ||
    derivedUpdateType !== operation.updateType ||
    derivedUpdateType !== packet.updateType ||
    !HEX_SHA.test(operation.sourceSeedHeadSha ?? "")
  ) {
    fail(
      "packet version transition is not an authorized patch or minor update",
    );
  }
  return { packet, packetDigest: rawDigest(packetText), packetText };
}

function safeEvidencePath(root, name) {
  if (!SAFE_EVIDENCE_NAME.test(name ?? "")) {
    fail("evidence filename is invalid");
  }
  const candidate = resolve(root, name);
  if (
    relative(root, candidate).startsWith(`..${sep}`) ||
    relative(root, candidate) === ".."
  ) {
    fail("evidence file escapes its sealed root");
  }
  return candidate;
}

function loadEvidence({
  evidenceManifestPath,
  packet,
  packetDigest,
  processorCheckId,
}) {
  if (!isAbsolute(evidenceManifestPath)) {
    fail("evidence manifest path is not absolute");
  }
  const manifestPath = resolve(evidenceManifestPath);
  const manifestEntry = lstatSync(manifestPath);
  if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink()) {
    fail("evidence manifest is not a regular file");
  }
  const manifestBytes = readFileSync(manifestPath);
  if (manifestBytes.byteLength > 256 * 1024) {
    fail("evidence manifest is oversized");
  }
  const manifest = parseJsonBytes(manifestBytes, "evidence manifest");
  exactKeys(
    manifest,
    [
      "baseSha",
      "evidenceRoot",
      "files",
      "headSha",
      "packetDigest",
      "processorCheckId",
      "pullRequestNumber",
      "repository",
      "schema",
      "workflowRunAttempt",
      "workflowRunId",
      "workflowSha",
    ],
    "evidence manifest",
  );
  if (
    manifest.schema !== EVIDENCE_SCHEMA ||
    manifest.repository !== packet.repository ||
    manifest.pullRequestNumber !== packet.pullRequestNumber ||
    manifest.headSha !== packet.headSha ||
    manifest.baseSha !== packet.baseSha ||
    manifest.workflowSha !== packet.workflowSha ||
    manifest.workflowRunId !== packet.workflowRunId ||
    manifest.workflowRunAttempt !== packet.workflowRunAttempt ||
    manifest.packetDigest !== packetDigest ||
    manifest.processorCheckId !== processorCheckId
  ) {
    fail("evidence manifest identity does not match the packet");
  }
  const declaredRoot = resolve(manifest.evidenceRoot ?? "");
  if (
    !isAbsolute(manifest.evidenceRoot ?? "") ||
    join(declaredRoot, "manifest.json") !== manifestPath
  ) {
    fail("evidence manifest is not inside its exact sealed root");
  }
  const rootEntry = lstatSync(declaredRoot);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
    fail("evidence root is not a regular directory");
  }
  const root = realpathSync(declaredRoot);
  if (join(root, "manifest.json") !== realpathSync(manifestPath)) {
    fail("evidence manifest canonical path escaped its sealed root");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > 150) {
    fail("evidence inventory is invalid");
  }
  const expectedByPath = new Map(
    packet.expectedBlobs.map((entry) => [entry.path, entry]),
  );
  const blobs = new Map();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (entry?.kind !== "git-blob") continue;
    exactKeys(
      entry,
      ["bytes", "digest", "kind", "mediaType", "name", "source"],
      "Git blob evidence entry",
    );
    exactKeys(
      entry.source,
      ["gitBlobSha", "mode", "path", "treeSha"],
      "Git blob evidence source",
    );
    const expected = expectedByPath.get(entry.source.path);
    if (
      expected === undefined ||
      expected.sha !== entry.source.gitBlobSha ||
      expected.mode !== entry.source.mode ||
      entry.source.treeSha === undefined ||
      !HEX_SHA.test(entry.source.treeSha) ||
      blobs.has(entry.source.path) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > MAX_EVIDENCE_BLOB_BYTES ||
      !HEX_DIGEST.test(entry.digest ?? "")
    ) {
      fail(`Git blob evidence is not packet-bound: ${entry.source.path ?? ""}`);
    }
    const path = safeEvidencePath(root, entry.name);
    const fileEntry = lstatSync(path);
    if (
      !fileEntry.isFile() ||
      fileEntry.isSymbolicLink() ||
      realpathSync(path) !== path ||
      (fileEntry.mode & 0o022) !== 0
    ) {
      fail(`Git blob evidence file is unsafe: ${entry.name}`);
    }
    const bytes = readFileSync(path);
    totalBytes += bytes.byteLength;
    if (
      bytes.byteLength !== entry.bytes ||
      sha256(bytes) !== entry.digest ||
      totalBytes > MAX_EVIDENCE_BLOBS_BYTES
    ) {
      fail(`Git blob evidence bytes are invalid: ${entry.name}`);
    }
    blobs.set(entry.source.path, {
      bytes,
      expectedBlobSha: expected.sha,
      mode: expected.mode,
    });
  }
  if (
    blobs.size !== PROTECTED_RUNTIME_SYNC_INPUT_PATHS.length ||
    PROTECTED_RUNTIME_SYNC_INPUT_PATHS.some((path) => !blobs.has(path))
  ) {
    fail("evidence does not contain the exact protected-runtime input set");
  }
  return blobs;
}

function parseContract(bytes, label) {
  const contract = parseJsonBytes(bytes, label);
  exactKeys(contract, CONTRACT_KEYS, label);
  if (
    contract.schema !== CONTRACT_SCHEMA ||
    !STABLE_SEMVER.test(contract.vercelVersion ?? "") ||
    !HEX_DIGEST.test(contract.manifestSha256 ?? "") ||
    !HEX_DIGEST.test(contract.runtimeDependenciesSha256 ?? "") ||
    !HEX_DIGEST.test(contract.lockfileSha256 ?? "") ||
    !HEX_DIGEST.test(contract.overridesSha256 ?? "") ||
    !REGISTRY_INTEGRITY.test(contract.registryIntegrity ?? "")
  ) {
    fail(`${label} is invalid`);
  }
  return contract;
}

function assertNoPatchedDependencies(metadata, label) {
  if (metadata?.pnpm?.patchedDependencies !== undefined) {
    fail(`${label} admits patchedDependencies`);
  }
}

function validateCurrentInputs(blobs, operation) {
  const rootPackageBytes = blobs.get("package.json").bytes;
  const rootPackage = parseJsonBytes(rootPackageBytes, "root package manifest");
  const runtimePackageBytes = blobs.get(
    "scripts/vercel-cli-runtime/package.json",
  ).bytes;
  const runtimePackage = parseJsonBytes(
    runtimePackageBytes,
    "Vercel runtime manifest",
  );
  const runtimeLockBytes = blobs.get(
    "scripts/vercel-cli-runtime/pnpm-lock.yaml",
  ).bytes;
  const contract = parseContract(
    blobs.get("scripts/vercel-cli-runtime/contract.json").bytes,
    "Vercel runtime contract",
  );
  assertNoPatchedDependencies(rootPackage, "root package manifest");
  assertNoPatchedDependencies(runtimePackage, "Vercel runtime manifest");
  const protectedRuntimeOperation =
    operation.kind === "vercel-cli-runtime-sync";
  const allowedRootVercelVersions = protectedRuntimeOperation
    ? new Set([operation.fromVersion, operation.targetVersion])
    : new Set([contract.vercelVersion]);
  if (
    rootPackage.packageManager !== `pnpm@${EXACT_PNPM_VERSION}` ||
    !allowedRootVercelVersions.has(rootPackage.devDependencies?.vercel)
  ) {
    fail("root Vercel version is outside the typed operation contract");
  }
  if (
    contract.vercelVersion !==
      (protectedRuntimeOperation
        ? operation.fromVersion
        : rootPackage.devDependencies.vercel) ||
    runtimePackage.dependencies?.vercel !== contract.vercelVersion ||
    sha256(runtimePackageBytes) !== contract.manifestSha256 ||
    sha256(runtimeLockBytes) !== contract.lockfileSha256 ||
    stringMapDigest(
      runtimePackage.dependencies,
      "current runtime dependencies",
    ) !== contract.runtimeDependenciesSha256 ||
    stringMapDigest(rootPackage.pnpm?.overrides, "root overrides") !==
      contract.overridesSha256 ||
    !isDeepStrictEqual(
      runtimePackage.pnpm?.overrides,
      rootPackage.pnpm?.overrides,
    )
  ) {
    fail("current protected runtime does not match its sealed contract");
  }
  const currentLockText = runtimeLockBytes.toString("utf8");
  const currentVercelVersion = protectedRuntimeOperation
    ? operation.fromVersion
    : contract.vercelVersion;
  if (
    !currentLockText.includes(
      `\n  vercel@${currentVercelVersion}:\n    resolution: {integrity: ${contract.registryIntegrity}}`,
    ) ||
    /(?:specifier|version):\s*(?:workspace:|link:|file:|git\+|github:)|\btarball:|\brepo:|\btype:\s*git\b/u.test(
      currentLockText,
    )
  ) {
    fail("current standalone runtime lockfile is not registry-only");
  }
  const workspaceBytes = blobs.get("pnpm-workspace.yaml").bytes;
  const workspaceText = workspaceBytes.toString("utf8");
  if (
    !workspaceText.startsWith("packages:\n") ||
    !workspaceText.includes("  - apps/*\n") ||
    !workspaceText.includes("  - packages/*\n") ||
    /(?:^|\n)\s*(?:patchedDependencies|registries|registry|configDependencies|hooks):/u.test(
      workspaceText,
    )
  ) {
    fail("workspace manifest is outside the bound root-generation contract");
  }
  return { contract, rootPackage, runtimePackage };
}

export function validateRegistryTransition({
  currentRuntimeDependencies,
  fromVersion,
  sourceMetadata,
  targetMetadata,
  targetVersion,
  updateType,
}) {
  const validateMetadata = (metadata, version, label) => {
    if (
      metadata === null ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      metadata.name !== "vercel" ||
      metadata.version !== version ||
      metadata.dist?.tarball !==
        `https://registry.npmjs.org/vercel/-/vercel-${version}.tgz` ||
      !REGISTRY_INTEGRITY.test(metadata.dist?.integrity ?? "")
    ) {
      fail(`${label} registry metadata is not exact`);
    }
    return {
      bin: canonicalStringMap(metadata.bin ?? {}, `${label} Vercel bins`),
      dependencies: canonicalStringMap(
        metadata.dependencies,
        `${label} Vercel dependencies`,
      ),
      engines: canonicalStringMap(metadata.engines, `${label} Vercel engines`),
      integrity: metadata.dist.integrity,
      optionalDependencies: canonicalStringMap(
        metadata.optionalDependencies ?? {},
        `${label} Vercel optional dependencies`,
      ),
      peers: canonicalStringMap(
        metadata.peerDependencies,
        `${label} Vercel builder peers`,
      ),
      peerDependenciesMeta: metadata.peerDependenciesMeta ?? {},
    };
  };
  if (deriveUpdateType(fromVersion, targetVersion) !== updateType) {
    fail("registry metadata does not match the authorized Vercel transition");
  }
  const source = validateMetadata(sourceMetadata, fromVersion, "source");
  const target = validateMetadata(targetMetadata, targetVersion, "target");
  const current = canonicalStringMap(
    currentRuntimeDependencies,
    "current runtime dependencies",
  );
  if (current.vercel !== fromVersion) {
    fail("current runtime Vercel version does not match the packet source");
  }
  const currentPeerKeys = Object.keys(current)
    .filter((name) => name !== "vercel")
    .sort();
  if (
    JSON.stringify(Object.keys(source.peers)) !==
      JSON.stringify(currentPeerKeys) ||
    JSON.stringify(Object.keys(target.peers)) !==
      JSON.stringify(currentPeerKeys) ||
    !isDeepStrictEqual(
      source.peers,
      Object.fromEntries(currentPeerKeys.map((name) => [name, current[name]])),
    )
  ) {
    fail("target Vercel builder peer keyset changed");
  }
  for (const name of currentPeerKeys) {
    const currentParts = semverParts(current[name], `current builder ${name}`);
    const targetParts = semverParts(
      target.peers[name],
      `target builder ${name}`,
    );
    if (
      currentParts[0] !== targetParts[0] ||
      compareSemver(targetParts, currentParts) < 0 ||
      source.dependencies[name] !== source.peers[name] ||
      target.dependencies[name] !== target.peers[name]
    ) {
      fail(
        `target Vercel builder peer is not an exact same-major update: ${name}`,
      );
    }
  }
  const withoutBuilderPeers = (dependencies) =>
    Object.fromEntries(
      Object.entries(dependencies).filter(
        ([name]) => !currentPeerKeys.includes(name),
      ),
    );
  if (
    !isDeepStrictEqual(
      withoutBuilderPeers(source.dependencies),
      withoutBuilderPeers(target.dependencies),
    ) ||
    !isDeepStrictEqual(
      source.optionalDependencies,
      target.optionalDependencies,
    ) ||
    !isDeepStrictEqual(
      source.peerDependenciesMeta,
      target.peerDependenciesMeta,
    ) ||
    !isDeepStrictEqual(source.engines, target.engines) ||
    !isDeepStrictEqual(source.bin, target.bin)
  ) {
    fail("Vercel preserved metadata shape changed");
  }
  return {
    bin: target.bin,
    engines: target.engines,
    sourceIntegrity: source.integrity,
    sourcePeers: source.peers,
    targetIntegrity: target.integrity,
    targetPeers: target.peers,
  };
}

const REGISTRY_FETCH_SOURCE = String.raw`
  import https from "node:https";
  const target = process.argv[1];
  const request = https.request(target, {
    headers: { accept: "application/json", "user-agent": "mento-protected-runtime-sync/1" },
    method: "GET",
  }, (response) => {
    const contentType = response.headers["content-type"] ?? "";
    if (
      response.statusCode !== 200 ||
      response.headers.location !== undefined ||
      !/^application\/json(?:;|$)/i.test(contentType)
    ) process.exit(21);
    const chunks = [];
    let bytes = 0;
    response.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > ${MAX_METADATA_BYTES}) process.exit(22);
      chunks.push(chunk);
    });
    response.on("end", () => process.stdout.write(Buffer.concat(chunks)));
  });
  request.setTimeout(30_000, () => request.destroy(new Error("timeout")));
  request.on("error", () => process.exit(23));
  request.end();
`;

function sanitizedEnvironment(root, executableDirectories = []) {
  const home = join(root, "home");
  const cache = join(root, "cache");
  const config = join(root, "config");
  const data = join(root, "data");
  const pnpmHome = join(root, "pnpm-home");
  const temp = join(root, "tmp");
  for (const directory of [home, cache, config, data, pnpmHome, temp]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const npmrc = join(config, "npmrc");
  writeFileSync(
    npmrc,
    "registry=https://registry.npmjs.org/\nalways-auth=false\nmanage-package-manager-versions=false\n",
    { mode: 0o600 },
  );
  return {
    CI: "true",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NPM_CONFIG_ALWAYS_AUTH: "false",
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_USERCONFIG: npmrc,
    PATH: [
      ...executableDirectories,
      dirname(process.execPath),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":"),
    PNPM_HOME: pnpmHome,
    PNPM_PACKAGE_MANAGER_SELF_UPDATE_CHECK: "false",
    TMPDIR: temp,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
  };
}

function fetchExactPackageRegistryMetadata(
  packageName,
  targetVersion,
  temporaryRoot,
) {
  semverParts(targetVersion, "targetVersion");
  if (!/^[a-z][a-z0-9-]*$/u.test(packageName)) {
    fail("registry package name is invalid");
  }
  const url = `https://registry.npmjs.org/${packageName}/${targetVersion}`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", REGISTRY_FETCH_SOURCE, url],
    {
      encoding: "utf8",
      env: sanitizedEnvironment(join(temporaryRoot, "registry")),
      maxBuffer: MAX_METADATA_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 40_000,
    },
  );
  if (
    result.status !== 0 ||
    result.signal !== null ||
    Buffer.byteLength(result.stdout ?? "") > MAX_METADATA_BYTES
  ) {
    fail("exact public npm registry metadata fetch failed");
  }
  return parseJsonBytes(Buffer.from(result.stdout), "registry metadata");
}

export function fetchExactRegistryMetadata(targetVersion, temporaryRoot) {
  return fetchExactPackageRegistryMetadata(
    "vercel",
    targetVersion,
    temporaryRoot,
  );
}

export function fetchExactNextRegistryMetadata(targetVersion, temporaryRoot) {
  return fetchExactPackageRegistryMetadata(
    "next",
    targetVersion,
    temporaryRoot,
  );
}

function resolvePathCommand(name) {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- The standalone workflow resolves the exact PATH executable outside Turbo.
  for (const directory of (process.env.PATH ?? "").split(":")) {
    if (directory.length === 0) continue;
    const candidate = resolve(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the bounded PATH inventory.
    }
  }
  fail(`${name} is not in PATH`);
}

function resolveExactPnpm(verificationRoot) {
  const command = resolvePathCommand("pnpm");
  mkdirSync(verificationRoot, { recursive: true, mode: 0o700 });
  const version = spawnSync(command, ["--version"], {
    cwd: verificationRoot,
    encoding: "utf8",
    env: sanitizedEnvironment(join(verificationRoot, "environment"), [
      dirname(command),
    ]),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (version.status !== 0 || version.stdout.trim() !== EXACT_PNPM_VERSION) {
    fail(`pnpm ${EXACT_PNPM_VERSION} is not the exact PATH executable`);
  }
  return command;
}

function materializeInputs(root, blobs) {
  for (const path of PROTECTED_RUNTIME_SYNC_INPUT_PATHS) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, blobs.get(path).bytes, { mode: 0o600 });
  }
}

export function pnpmInstallArguments({
  frozenLockfile = false,
  ignoreWorkspace = false,
  resolutionMode,
  store,
}) {
  if (typeof store !== "string" || store.length === 0) {
    fail("pnpm store path is invalid");
  }
  const args = [
    "install",
    ...(frozenLockfile ? ["--frozen-lockfile"] : []),
    "--lockfile-only",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--registry=https://registry.npmjs.org/",
    "--store-dir",
    store,
  ];
  if (resolutionMode !== undefined) {
    if (resolutionMode !== "lowest-direct") {
      fail("pnpm resolution mode is invalid");
    }
    args.push(`--config.resolution-mode=${resolutionMode}`);
  }
  if (ignoreWorkspace) args.push("--ignore-workspace");
  return args;
}

export function nextCandidateInstallArguments({ store }) {
  if (typeof store !== "string" || store.length === 0) {
    fail("Next candidate store path is invalid");
  }
  return [
    "--filter",
    "app.mento.org",
    "install",
    "--prod",
    "--frozen-lockfile",
    "--ignore-pnpmfile",
    "--package-import-method",
    "copy",
    "--registry=https://registry.npmjs.org/",
    "--store-dir",
    store,
  ];
}

function runPnpmInstall({
  command,
  environmentRoot,
  ignoreWorkspace,
  resolutionMode,
  root,
}) {
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const args = pnpmInstallArguments({
    ignoreWorkspace,
    resolutionMode,
    store,
  });
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: sanitizedEnvironment(environmentRoot, [dirname(command)]),
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 4 * 60_000,
  });
  if (result.status !== 0 || result.signal !== null) {
    const diagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
      .trim()
      .slice(0, 1_000);
    fail(
      `pnpm lock regeneration failed (status=${String(result.status)}, signal=${String(result.signal)}): ${diagnostic}`,
    );
  }
}

function verifyFrozenRootLock({
  blobs,
  command,
  environmentRoot,
  lockfileBytes,
  packageBytes,
  resolutionMode,
  root,
  workspaceBytes,
}) {
  if ((workspaceBytes !== undefined) !== (resolutionMode === "lowest-direct")) {
    fail("Next root frozen verification resolution mode is invalid");
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  materializeInputs(root, blobs);
  writeFileSync(join(root, "package.json"), packageBytes, { mode: 0o600 });
  if (workspaceBytes !== undefined) {
    writeFileSync(join(root, "pnpm-workspace.yaml"), workspaceBytes, {
      mode: 0o600,
    });
  }
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfileBytes, { mode: 0o600 });
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const args = pnpmInstallArguments({
    frozenLockfile: true,
    resolutionMode,
    store,
  });
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: sanitizedEnvironment(environmentRoot, [dirname(command)]),
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 4 * 60_000,
  });
  if (result.status !== 0 || result.signal !== null) {
    fail(
      `surgically transformed root lockfile is not frozen-consistent: ${(result.stderr ?? "").slice(0, 500)}`,
    );
  }
  if (!readFileSync(join(root, "pnpm-lock.yaml")).equals(lockfileBytes)) {
    fail("frozen root consistency check changed the surgical lockfile");
  }
}

function targetRuntimePackage(
  currentRuntimePackage,
  rootOverrides,
  peers,
  targetVersion,
) {
  const currentPeerOrder = Object.keys(
    currentRuntimePackage.dependencies,
  ).filter((name) => name !== "vercel");
  const dependencies = Object.fromEntries([
    ...currentPeerOrder.map((name) => [name, peers[name]]),
    ["vercel", targetVersion],
  ]);
  return {
    ...currentRuntimePackage,
    dependencies,
    pnpm: { overrides: rootOverrides },
  };
}

export function rotateRootPackageBytes(rootPackageBytes, targetVersion) {
  semverParts(targetVersion, "target root Vercel version");
  const rootPackage = parseJsonBytes(rootPackageBytes, "root package");
  if (
    rootPackage.packageManager !== `pnpm@${EXACT_PNPM_VERSION}` ||
    typeof rootPackage.devDependencies?.vercel !== "string"
  ) {
    fail("root package is outside the exact pnpm and Vercel contract");
  }
  rootPackage.devDependencies.vercel = targetVersion;
  return Buffer.from(prettyJson(rootPackage));
}

function exactNextSpecifier(value, fromSpecifier, targetSpecifier, label) {
  if (value !== fromSpecifier && value !== targetSpecifier) {
    fail(`${label} is neither the packet source nor target specifier`);
  }
  return value;
}

export function rotateNextOverridePackageBytes(
  rootPackageBytes,
  { fromSpecifier, targetSpecifier },
) {
  const rootPackage = parseJsonBytes(rootPackageBytes, "root package");
  if (
    rootPackage.packageManager !== `pnpm@${EXACT_PNPM_VERSION}` ||
    rootPackage.pnpm === null ||
    typeof rootPackage.pnpm !== "object" ||
    Array.isArray(rootPackage.pnpm) ||
    rootPackage.pnpm.overrides === null ||
    typeof rootPackage.pnpm.overrides !== "object" ||
    Array.isArray(rootPackage.pnpm.overrides)
  ) {
    fail("root package is outside the exact pnpm override contract");
  }
  const current = exactNextSpecifier(
    rootPackage.pnpm.overrides.next,
    fromSpecifier,
    targetSpecifier,
    "root Next override",
  );
  if (current === targetSpecifier) return rootPackageBytes;
  rootPackage.pnpm.overrides.next = targetSpecifier;
  return Buffer.from(prettyJson(rootPackage));
}

export function rotateNextCatalogWorkspaceBytes(
  workspaceBytes,
  { fromSpecifier, targetSpecifier },
) {
  const workspaceText = workspaceBytes.toString("utf8");
  if (
    !Buffer.from(workspaceText, "utf8").equals(workspaceBytes) ||
    !workspaceText.endsWith("\n") ||
    workspaceText.includes("\r")
  ) {
    fail("workspace manifest is not canonical UTF-8 with LF endings");
  }
  const catalog = topLevelSection(workspaceText, "catalog");
  const sourceLine = `  next: ${fromSpecifier}\n`;
  const targetLine = `  next: ${targetSpecifier}\n`;
  const sourceOffsets = exactLineOffsets(
    workspaceText,
    sourceLine.slice(0, -1),
    catalog.start,
    catalog.end,
  );
  const targetOffsets = exactLineOffsets(
    workspaceText,
    targetLine.slice(0, -1),
    catalog.start,
    catalog.end,
  );
  if (sourceOffsets.length + targetOffsets.length !== 1) {
    fail("workspace Next catalog specifier is missing or ambiguous");
  }
  if (targetOffsets.length === 1) return workspaceBytes;
  return Buffer.from(
    workspaceText.slice(0, sourceOffsets[0]) +
      targetLine +
      workspaceText.slice(sourceOffsets[0] + sourceLine.length),
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exactLineOffsets(text, line, start, end) {
  const needle = `${line}\n`;
  const offsets = [];
  let cursor = start;
  while (cursor < end) {
    const offset = text.indexOf(needle, cursor);
    if (offset === -1 || offset >= end) break;
    if (offset === 0 || text[offset - 1] === "\n") offsets.push(offset);
    cursor = offset + needle.length;
  }
  return offsets;
}

function indentedBlock(text, { end, header, indent, label, start }) {
  const headerLine = `${" ".repeat(indent)}${header}`;
  const offsets = exactLineOffsets(text, headerLine, start, end);
  if (offsets.length !== 1) {
    fail(`${label} is missing or ambiguous`);
  }
  const blockStart = offsets[0];
  let blockEnd = end;
  let cursor = blockStart + headerLine.length + 1;
  while (cursor < end) {
    const lineEnd = text.indexOf("\n", cursor);
    if (lineEnd === -1 || lineEnd >= end) break;
    const line = text.slice(cursor, lineEnd);
    if (line.length > 0) {
      const leading = /^ */u.exec(line)[0].length;
      if (leading <= indent) {
        blockEnd = cursor;
        break;
      }
    }
    cursor = lineEnd + 1;
  }
  return { end: blockEnd, start: blockStart };
}

function topLevelSection(text, name) {
  return indentedBlock(text, {
    end: text.length,
    header: `${name}:`,
    indent: 0,
    label: `${name} lockfile section`,
    start: 0,
  });
}

function decodeYamlKey(value, label) {
  if (/^[A-Za-z0-9@/_.-]+$/u.test(value)) return value;
  if (/^'[^']+'$/u.test(value)) return value.slice(1, -1);
  fail(`${label} contains an unsupported YAML key`);
}

function decodeYamlScalar(value, label) {
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!/^'(?:[^']|'')*'$/u.test(value)) {
      fail(`${label} contains an invalid single-quoted scalar`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"') || value.endsWith('"')) {
    fail(`${label} contains an unsupported double-quoted scalar`);
  }
  return value;
}

function parseExactScalarMap(text, block, indent, label) {
  const headerEnd = text.indexOf("\n", block.start) + 1;
  const result = {};
  for (const line of text.slice(headerEnd, block.end).split("\n")) {
    if (line.length === 0) continue;
    const match = new RegExp(`^ {${indent}}([^:]+): (.+)$`, "u").exec(line);
    if (!match) fail(`${label} is not an exact scalar map`);
    const key = decodeYamlKey(match[1], label);
    if (Object.hasOwn(result, key)) fail(`${label} contains a duplicate key`);
    result[key] = decodeYamlScalar(match[2], label);
  }
  return canonicalStringMap(result, label);
}

function optionalIndentedBlock(text, { end, header, indent, label, start }) {
  const headerLine = `${" ".repeat(indent)}${header}`;
  const offsets = exactLineOffsets(text, headerLine, start, end);
  if (offsets.length > 1) fail(`${label} is ambiguous`);
  if (offsets.length === 0) return null;
  return indentedBlock(text, { end, header, indent, label, start });
}

function parseExactOptionalPeerMeta(text, entry, label) {
  const block = optionalIndentedBlock(text, {
    ...entry,
    header: "peerDependenciesMeta:",
    indent: 4,
    label,
  });
  if (block === null) return {};
  const lines = text
    .slice(text.indexOf("\n", block.start) + 1, block.end)
    .split("\n")
    .filter((line) => line.length > 0);
  const result = {};
  for (let index = 0; index < lines.length; index += 2) {
    const peer = /^ {6}([^:]+):$/u.exec(lines[index] ?? "");
    if (peer === null || lines[index + 1] !== "        optional: true") {
      fail(`${label} is not an exact optional-peer map`);
    }
    const name = decodeYamlKey(peer[1], label);
    if (Object.hasOwn(result, name)) fail(`${label} contains a duplicate peer`);
    result[name] = { optional: true };
  }
  return result;
}

function parseExactScalarSequence(text, entry, header, label) {
  const block = optionalIndentedBlock(text, {
    ...entry,
    header: `${header}:`,
    indent: 4,
    label,
  });
  if (block === null) return [];
  const values = text
    .slice(text.indexOf("\n", block.start) + 1, block.end)
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^ {6}- (.+)$/u.exec(line);
      if (match === null) fail(`${label} is not an exact scalar sequence`);
      const value = decodeYamlScalar(match[1], label);
      if (!/^[A-Za-z0-9@/_.-]+$/u.test(value)) {
        fail(`${label} contains an invalid package name`);
      }
      return value;
    });
  if (new Set(values).size !== values.length) {
    fail(`${label} contains a duplicate value`);
  }
  return values.toSorted();
}

function inspectRootVercelLock({
  bin,
  engines,
  integrity,
  lockfileText,
  peers,
  version,
}) {
  const importers = topLevelSection(lockfileText, "importers");
  const rootImporter = indentedBlock(lockfileText, {
    ...importers,
    header: ".:",
    indent: 2,
    label: "root importer",
  });
  const devDependencies = indentedBlock(lockfileText, {
    ...rootImporter,
    header: "devDependencies:",
    indent: 4,
    label: "root devDependencies",
  });
  const importer = indentedBlock(lockfileText, {
    ...devDependencies,
    header: "vercel:",
    indent: 6,
    label: "root importer Vercel block",
  });
  const importerText = lockfileText.slice(importer.start, importer.end);
  const importerMatch = new RegExp(
    `^      vercel:\n        specifier: ${escapeRegex(version)}\n        version: ${escapeRegex(version)}([^\n]*)\n$`,
    "u",
  ).exec(importerText);
  if (
    !importerMatch ||
    (importerMatch[1] !== "" && !/^\(.+\)$/u.test(importerMatch[1]))
  ) {
    fail("root importer Vercel block does not match registry metadata");
  }
  const peerSuffix = importerMatch[1];

  const packages = topLevelSection(lockfileText, "packages");
  const packageHeaders = [
    ...lockfileText
      .slice(packages.start, packages.end)
      .matchAll(/^ {2}vercel@([^:\n(]+):$/gmu),
  ];
  if (packageHeaders.length !== 1 || packageHeaders[0][1] !== version) {
    fail("root packages Vercel block is missing or ambiguous");
  }
  const packageBlock = indentedBlock(lockfileText, {
    ...packages,
    header: `vercel@${version}:`,
    indent: 2,
    label: "root packages Vercel block",
  });
  const packageText = lockfileText.slice(packageBlock.start, packageBlock.end);
  const resolution = `    resolution: {integrity: ${integrity}}\n`;
  if (
    packageText.split(resolution).length !== 2 ||
    !packageText.startsWith(`  vercel@${version}:\n`) ||
    Object.keys(engines).length !== 1 ||
    engines.node === undefined ||
    !packageText.includes(`    engines: {node: '${engines.node}'}\n`) ||
    packageText.includes("    hasBin: true\n") !== Object.keys(bin).length > 0
  ) {
    fail("root packages Vercel metadata does not match the registry");
  }
  const peerBlock = indentedBlock(lockfileText, {
    ...packageBlock,
    header: "peerDependencies:",
    indent: 4,
    label: "root packages Vercel peerDependencies",
  });
  const lockedPeers = parseExactScalarMap(
    lockfileText,
    peerBlock,
    6,
    "root packages Vercel peerDependencies",
  );
  if (!isDeepStrictEqual(lockedPeers, peers)) {
    fail("root packages Vercel peers do not match registry metadata");
  }

  const snapshots = topLevelSection(lockfileText, "snapshots");
  const snapshotHeaders = [
    ...lockfileText
      .slice(snapshots.start, snapshots.end)
      .matchAll(/^ {2}vercel@([^:\n(]+)([^:\n]*):$/gmu),
  ];
  if (
    snapshotHeaders.length !== 1 ||
    snapshotHeaders[0][1] !== version ||
    snapshotHeaders[0][2] !== peerSuffix
  ) {
    fail("root snapshots Vercel block is missing or ambiguous");
  }
  const snapshot = indentedBlock(lockfileText, {
    ...snapshots,
    header: `vercel@${version}${peerSuffix}:`,
    indent: 2,
    label: "root snapshots Vercel block",
  });
  return { importer, packageBlock, peerBlock, peerSuffix, snapshot };
}

export function rotateRootLockBytes({
  bin,
  currentVersion,
  engines,
  lockfileBytes,
  sourceIntegrity,
  sourcePeers,
  sourceVersion,
  targetIntegrity,
  targetPeers,
  targetVersion,
}) {
  const lockfileText = lockfileBytes.toString("utf8");
  if (
    !Buffer.from(lockfileText, "utf8").equals(lockfileBytes) ||
    !lockfileText.endsWith("\n") ||
    lockfileText.includes("\r")
  ) {
    fail("root lockfile is not canonical UTF-8 with LF endings");
  }
  if (currentVersion === targetVersion) {
    inspectRootVercelLock({
      bin,
      engines,
      integrity: targetIntegrity,
      lockfileText,
      peers: targetPeers,
      version: targetVersion,
    });
    return lockfileBytes;
  }
  if (currentVersion !== sourceVersion) {
    fail("root lockfile version is neither packet source nor target");
  }
  const source = inspectRootVercelLock({
    bin,
    engines,
    integrity: sourceIntegrity,
    lockfileText,
    peers: sourcePeers,
    version: sourceVersion,
  });
  const importerText = lockfileText
    .slice(source.importer.start, source.importer.end)
    .replace(`specifier: ${sourceVersion}\n`, `specifier: ${targetVersion}\n`)
    .replace(
      `version: ${sourceVersion}${source.peerSuffix}\n`,
      `version: ${targetVersion}${source.peerSuffix}\n`,
    );
  let packageText = lockfileText.slice(
    source.packageBlock.start,
    source.packageBlock.end,
  );
  packageText = packageText
    .replace(`  vercel@${sourceVersion}:\n`, `  vercel@${targetVersion}:\n`)
    .replace(
      `    resolution: {integrity: ${sourceIntegrity}}\n`,
      `    resolution: {integrity: ${targetIntegrity}}\n`,
    );
  const sourcePeerText = lockfileText.slice(
    source.peerBlock.start,
    source.peerBlock.end,
  );
  let targetPeerText = sourcePeerText;
  for (const name of Object.keys(sourcePeers)) {
    const yamlName = name.startsWith("@") ? `'${name}'` : name;
    const fromLine = `      ${yamlName}: ${sourcePeers[name]}\n`;
    const toLine = `      ${yamlName}: ${targetPeers[name]}\n`;
    if (!sourcePeerText.includes(fromLine)) {
      fail(`root packages Vercel peer line is missing: ${name}`);
    }
    targetPeerText = targetPeerText.replace(fromLine, toLine);
  }
  packageText = packageText.replace(sourcePeerText, targetPeerText);
  const snapshotText = lockfileText
    .slice(source.snapshot.start, source.snapshot.end)
    .replace(
      `  vercel@${sourceVersion}${source.peerSuffix}:\n`,
      `  vercel@${targetVersion}${source.peerSuffix}:\n`,
    );
  const replacements = [
    { ...source.importer, value: importerText },
    { ...source.packageBlock, value: packageText },
    { ...source.snapshot, value: snapshotText },
  ].toSorted((left, right) => right.start - left.start);
  let targetText = lockfileText;
  for (const replacement of replacements) {
    targetText =
      targetText.slice(0, replacement.start) +
      replacement.value +
      targetText.slice(replacement.end);
  }
  inspectRootVercelLock({
    bin,
    engines,
    integrity: targetIntegrity,
    lockfileText: targetText,
    peers: targetPeers,
    version: targetVersion,
  });
  return Buffer.from(targetText);
}

export function createRuntimeContract({
  integrity,
  lockfileBytes,
  manifestBytes,
  overrides,
  runtimeDependencies,
  targetVersion,
}) {
  return {
    lockfileSha256: sha256(lockfileBytes),
    manifestSha256: sha256(manifestBytes),
    overridesSha256: stringMapDigest(overrides, "target overrides"),
    registryIntegrity: integrity,
    runtimeDependenciesSha256: stringMapDigest(
      runtimeDependencies,
      "target runtime dependencies",
    ),
    schema: CONTRACT_SCHEMA,
    vercelVersion: targetVersion,
  };
}

function generateOnce({
  blobs,
  metadataContract,
  operation,
  pnpmCommand,
  runRoot,
}) {
  const root = join(runRoot, "root");
  const runtime = join(runRoot, "runtime");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const currentRootPackageBytes = blobs.get("package.json").bytes;
  const currentRootPackage = parseJsonBytes(
    currentRootPackageBytes,
    "current root package",
  );
  const rootPackageBytes =
    currentRootPackage.devDependencies.vercel === operation.targetVersion
      ? currentRootPackageBytes
      : rotateRootPackageBytes(
          currentRootPackageBytes,
          operation.targetVersion,
        );
  const rootPackage = parseJsonBytes(rootPackageBytes, "target root package");
  const rootLockBytes = rotateRootLockBytes({
    bin: metadataContract.bin,
    currentVersion: currentRootPackage.devDependencies.vercel,
    engines: metadataContract.engines,
    lockfileBytes: blobs.get("pnpm-lock.yaml").bytes,
    sourceIntegrity: metadataContract.sourceIntegrity,
    sourcePeers: metadataContract.sourcePeers,
    sourceVersion: operation.fromVersion,
    targetIntegrity: metadataContract.targetIntegrity,
    targetPeers: metadataContract.targetPeers,
    targetVersion: operation.targetVersion,
  });
  verifyFrozenRootLock({
    blobs,
    command: pnpmCommand,
    environmentRoot: join(runRoot, "root-frozen-env"),
    lockfileBytes: rootLockBytes,
    packageBytes: rootPackageBytes,
    root,
  });

  const currentRuntimePackage = parseJsonBytes(
    blobs.get("scripts/vercel-cli-runtime/package.json").bytes,
    "runtime package",
  );
  const runtimePackage = targetRuntimePackage(
    currentRuntimePackage,
    rootPackage.pnpm.overrides,
    metadataContract.targetPeers,
    operation.targetVersion,
  );
  const runtimePackageBytes = Buffer.from(prettyJson(runtimePackage));
  writeFileSync(join(runtime, "package.json"), runtimePackageBytes, {
    mode: 0o600,
  });
  runPnpmInstall({
    command: pnpmCommand,
    environmentRoot: join(runRoot, "runtime-env"),
    ignoreWorkspace: true,
    root: runtime,
  });
  const runtimeLockBytes = readFileSync(join(runtime, "pnpm-lock.yaml"));
  const contract = createRuntimeContract({
    integrity: metadataContract.targetIntegrity,
    lockfileBytes: runtimeLockBytes,
    manifestBytes: runtimePackageBytes,
    overrides: rootPackage.pnpm.overrides,
    runtimeDependencies: runtimePackage.dependencies,
    targetVersion: operation.targetVersion,
  });
  const contractBytes = Buffer.from(prettyJson(contract));
  const contractPath = join(runtime, "contract.json");
  writeFileSync(contractPath, contractBytes, { mode: 0o600 });
  const assertedRuntime = join(root, "scripts", "vercel-cli-runtime");
  mkdirSync(assertedRuntime, { recursive: true, mode: 0o700 });
  writeFileSync(join(assertedRuntime, "package.json"), runtimePackageBytes, {
    mode: 0o600,
  });
  writeFileSync(join(assertedRuntime, "pnpm-lock.yaml"), runtimeLockBytes, {
    mode: 0o600,
  });
  writeFileSync(join(assertedRuntime, "contract.json"), contractBytes, {
    mode: 0o600,
  });
  assertVercelCliRuntimeContract({
    contractPath: join(assertedRuntime, "contract.json"),
    lockfilePath: join(assertedRuntime, "pnpm-lock.yaml"),
    packageJsonPath: join(assertedRuntime, "package.json"),
    rootPackageJsonPath: join(root, "package.json"),
  });
  const escapedVersion = operation.targetVersion.replaceAll(".", "\\.");
  const escapedIntegrity = metadataContract.targetIntegrity.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  if (
    !new RegExp(
      `\\n  vercel@${escapedVersion}:\\n    resolution: \\{integrity: ${escapedIntegrity}\\}`,
      "u",
    ).test(rootLockBytes.toString("utf8"))
  ) {
    fail("regenerated root lockfile does not bind target registry integrity");
  }
  return new Map([
    ["package.json", rootPackageBytes],
    ["pnpm-lock.yaml", rootLockBytes],
    ["scripts/vercel-cli-runtime/contract.json", contractBytes],
    ["scripts/vercel-cli-runtime/package.json", runtimePackageBytes],
    ["scripts/vercel-cli-runtime/pnpm-lock.yaml", runtimeLockBytes],
  ]);
}

function canonicalLockfileText(lockfileBytes, label) {
  const lockfileText = lockfileBytes.toString("utf8");
  if (
    !Buffer.from(lockfileText, "utf8").equals(lockfileBytes) ||
    !lockfileText.endsWith("\n") ||
    lockfileText.includes("\r")
  ) {
    fail(`${label} is not canonical UTF-8 with LF endings`);
  }
  return lockfileText;
}

function lockSectionEntries(lockfileText, sectionName) {
  const section = topLevelSection(lockfileText, sectionName);
  const entries = [];
  let cursor = lockfileText.indexOf("\n", section.start) + 1;
  while (cursor < section.end) {
    const lineEnd = lockfileText.indexOf("\n", cursor);
    if (lineEnd === -1 || lineEnd >= section.end) break;
    const line = lockfileText.slice(cursor, lineEnd);
    const match = /^ {2}('[^']+'|.+):(?: .*)?$/u.exec(line);
    if (match) {
      if (match[1].startsWith('"')) {
        fail(`${sectionName} contains an unsupported double-quoted key`);
      }
      const key = match[1].startsWith("'") ? match[1].slice(1, -1) : match[1];
      let end = section.end;
      let next = lineEnd + 1;
      while (next < section.end) {
        const nextLineEnd = lockfileText.indexOf("\n", next);
        if (nextLineEnd === -1 || nextLineEnd >= section.end) break;
        const nextLine = lockfileText.slice(next, nextLineEnd);
        if (/^ {2}\S/u.test(nextLine)) {
          end = next;
          break;
        }
        next = nextLineEnd + 1;
      }
      entries.push({ end, key, start: cursor });
      cursor = end;
      continue;
    }
    cursor = lineEnd + 1;
  }
  return { entries, section };
}

function exactLockEntry(lockfileText, sectionName, key, label) {
  const matches = lockSectionEntries(lockfileText, sectionName).entries.filter(
    (entry) => entry.key === key,
  );
  if (matches.length !== 1) fail(`${label} is missing or ambiguous`);
  return matches[0];
}

function versionedLockEntries(lockfileText, sectionName, packageName, version) {
  const exact = `${packageName}@${version}`;
  return lockSectionEntries(lockfileText, sectionName).entries.filter(
    ({ key }) => key === exact || key.startsWith(`${exact}(`),
  );
}

function canonicalEntryBytes(lockfileText, entry) {
  return `${lockfileText.slice(entry.start, entry.end).trimEnd()}\n\n`;
}

function replaceTextRanges(text, replacements) {
  let next = text;
  let previousStart = text.length;
  for (const replacement of replacements.toSorted(
    (left, right) => right.start - left.start,
  )) {
    if (
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > previousStart
    ) {
      fail("surgical lockfile replacement ranges overlap");
    }
    next =
      next.slice(0, replacement.start) +
      replacement.value +
      next.slice(replacement.end);
    previousStart = replacement.start;
  }
  return next;
}

function replaceVersionedLockEntry({
  lockfileText,
  oracleText,
  packageName,
  sectionName,
  sourceVersion,
  targetVersion,
}) {
  const source = versionedLockEntries(
    lockfileText,
    sectionName,
    packageName,
    sourceVersion,
  );
  const target = versionedLockEntries(
    lockfileText,
    sectionName,
    packageName,
    targetVersion,
  );
  const oracleTarget = versionedLockEntries(
    oracleText,
    sectionName,
    packageName,
    targetVersion,
  );
  if (
    source.length > 1 ||
    target.length > 1 ||
    source.length + target.length < 1 ||
    oracleTarget.length !== 1
  ) {
    fail(
      `${sectionName} ${packageName} source and target blocks are ambiguous`,
    );
  }
  const oracleBlock = canonicalEntryBytes(oracleText, oracleTarget[0]);
  if (target.length === 1) {
    const currentTarget = canonicalEntryBytes(lockfileText, target[0]);
    if (currentTarget !== oracleBlock) {
      fail(`${sectionName} ${packageName} target block differs from oracle`);
    }
    if (source.length === 0) return lockfileText;
    return replaceTextRanges(lockfileText, [{ ...source[0], value: "" }]);
  }
  return replaceTextRanges(lockfileText, [
    { ...source[0], value: oracleBlock },
  ]);
}

function insertExactOracleEntry({
  key,
  lockfileText,
  oracleText,
  sectionName,
}) {
  const current = lockSectionEntries(lockfileText, sectionName);
  const matches = current.entries.filter((entry) => entry.key === key);
  if (matches.length > 1) fail(`${sectionName} ${key} block is ambiguous`);
  const oracle = exactLockEntry(
    oracleText,
    sectionName,
    key,
    `oracle ${sectionName} ${key} block`,
  );
  const oracleBlock = canonicalEntryBytes(oracleText, oracle);
  if (matches.length === 1) {
    if (canonicalEntryBytes(lockfileText, matches[0]) !== oracleBlock) {
      fail(`${sectionName} ${key} block differs from oracle`);
    }
    return lockfileText;
  }
  const successor = current.entries.find(
    ({ key: candidate }) => candidate > key,
  );
  const offset = successor?.start ?? current.section.end;
  return `${lockfileText.slice(0, offset)}${oracleBlock}${lockfileText.slice(offset)}`;
}

function dependencyReferenceVersion(value, label) {
  const match = /^([0-9]+\.[0-9]+\.[0-9]+)(?:\(|$)/u.exec(value ?? "");
  if (!match) fail(`${label} is not an exact registry reference`);
  semverParts(match[1], label);
  return match[1];
}

function satisfiesCaret(version, specifier) {
  const match = /^\^([0-9]+\.[0-9]+\.[0-9]+)$/u.exec(specifier);
  if (!match) return false;
  const candidate = semverParts(version, "locked Next dependency");
  const minimum = semverParts(match[1], "Next dependency range");
  if (compareSemver(candidate, minimum) < 0) return false;
  if (minimum[0] > 0) return candidate[0] === minimum[0];
  if (minimum[1] > 0) {
    return candidate[0] === 0 && candidate[1] === minimum[1];
  }
  return candidate[0] === 0 && candidate[1] === 0;
}

function validateNextTargetMetadata(metadata, operation) {
  const bin = canonicalStringMap(metadata?.bin, "target Next bins");
  const dependencies = canonicalStringMap(
    metadata?.dependencies,
    "target Next dependencies",
  );
  const engines = canonicalStringMap(metadata?.engines, "target Next engines");
  const optionalDependencies = canonicalStringMap(
    metadata?.optionalDependencies,
    "target Next optional dependencies",
  );
  const peerDependencies = canonicalStringMap(
    metadata?.peerDependencies,
    "target Next peer dependencies",
  );
  const peerDependenciesMeta = canonicalOptionalPeerMeta(
    metadata?.peerDependenciesMeta ?? {},
    peerDependencies,
    "target Next peer metadata",
  );
  if (
    metadata?.name !== "next" ||
    metadata.version !== operation.targetVersion ||
    metadata.dist?.integrity === undefined ||
    !REGISTRY_INTEGRITY.test(metadata.dist.integrity) ||
    metadata.dist.tarball !==
      `https://registry.npmjs.org/next/-/next-${operation.targetVersion}.tgz` ||
    JSON.stringify(Object.keys(dependencies)) !==
      JSON.stringify([...NEXT_REGISTRY_DEPENDENCIES].sort()) ||
    JSON.stringify(Object.keys(optionalDependencies)) !==
      JSON.stringify([...NEXT_SWC_PACKAGES, "sharp"].sort()) ||
    JSON.stringify(bin) !== JSON.stringify({ next: "dist/bin/next" }) ||
    JSON.stringify(Object.keys(engines)) !== JSON.stringify(["node"]) ||
    !/[0-9]/u.test(engines.node) ||
    Object.keys(peerDependencies).length < 1 ||
    dependencies["@next/env"] !== operation.targetVersion ||
    NEXT_SWC_PACKAGES.some(
      (name) => optionalDependencies[name] !== operation.targetVersion,
    )
  ) {
    fail("target Next registry metadata is outside the surgical contract");
  }
  for (const name of NEXT_REGISTRY_DEPENDENCIES) {
    const specifier = dependencies[name];
    if (NEXT_RANGED_DEPENDENCIES.has(name)) {
      if (!/^\^[0-9]+\.[0-9]+\.[0-9]+$/u.test(specifier)) {
        fail(`target Next dependency range is invalid: ${name}`);
      }
    } else {
      semverParts(specifier, `target Next dependency ${name}`);
    }
  }
  if (!/^\^[0-9]+\.[0-9]+\.[0-9]+$/u.test(optionalDependencies.sharp)) {
    fail("target Next sharp dependency range is invalid");
  }
  return {
    bin,
    dependencies,
    engines,
    integrity: metadata.dist.integrity,
    optionalDependencies,
    peerDependencies,
    peerDependenciesMeta,
  };
}

function validateOracleNextPackageMetadata({
  entry,
  lockfileText,
  metadataContract,
}) {
  const peerBlock = indentedBlock(lockfileText, {
    ...entry,
    header: "peerDependencies:",
    indent: 4,
    label: "oracle target Next peer dependencies",
  });
  const peers = parseExactScalarMap(
    lockfileText,
    peerBlock,
    6,
    "oracle target Next peer dependencies",
  );
  const peerMetadata = canonicalOptionalPeerMeta(
    parseExactOptionalPeerMeta(
      lockfileText,
      entry,
      "oracle target Next peer metadata",
    ),
    peers,
    "oracle target Next peer metadata",
  );
  const blockText = lockfileText.slice(entry.start, entry.end);
  const engines = [
    ...blockText.matchAll(/^ {4}engines: \{node: '([^'\n]+)'\}$/gmu),
  ];
  const hasBin = [...blockText.matchAll(/^ {4}hasBin: ([^\n]+)$/gmu)];
  if (!isDeepStrictEqual(peers, metadataContract.peerDependencies)) {
    fail("oracle target Next peer dependencies differ from registry metadata");
  }
  if (!isDeepStrictEqual(peerMetadata, metadataContract.peerDependenciesMeta)) {
    fail("oracle target Next peer metadata differs from registry metadata");
  }
  if (engines.length !== 1 || engines[0][1] !== metadataContract.engines.node) {
    fail("oracle target Next engines differ from registry metadata");
  }
  if (hasBin.length !== 1 || hasBin[0][1] !== "true") {
    fail("oracle target Next bin shape differs from registry metadata");
  }
}

function nextSnapshotMaps(lockfileText, entry, label) {
  const dependencies = indentedBlock(lockfileText, {
    ...entry,
    header: "dependencies:",
    indent: 4,
    label: `${label} dependencies`,
  });
  const optionalDependencies = indentedBlock(lockfileText, {
    ...entry,
    header: "optionalDependencies:",
    indent: 4,
    label: `${label} optional dependencies`,
  });
  return {
    dependencies: parseExactScalarMap(
      lockfileText,
      dependencies,
      6,
      `${label} dependencies`,
    ),
    optionalDependencies: parseExactScalarMap(
      lockfileText,
      optionalDependencies,
      6,
      `${label} optional dependencies`,
    ),
  };
}

function snapshotDependencyReferences(lockfileText, entry, label) {
  const references = new Map();
  for (const [header, mapLabel] of [
    ["dependencies:", "dependencies"],
    ["optionalDependencies:", "optional dependencies"],
  ]) {
    const blockText = lockfileText.slice(entry.start, entry.end);
    const matches = [
      ...blockText.matchAll(new RegExp(`^ {4}${header}$`, "gmu")),
    ];
    if (matches.length > 1) {
      fail(`${label} ${mapLabel} are ambiguous`);
    }
    if (matches.length === 0) continue;
    const block = indentedBlock(lockfileText, {
      ...entry,
      header,
      indent: 4,
      label: `${label} ${mapLabel}`,
    });
    const values = parseExactScalarMap(
      lockfileText,
      block,
      6,
      `${label} ${mapLabel}`,
    );
    for (const [name, reference] of Object.entries(values)) {
      if (references.has(name)) {
        fail(`${label} repeats a dependency reference: ${name}`);
      }
      references.set(name, reference);
    }
  }
  return references;
}

function validateOracleClosureAvailableInSource({
  oracleText,
  rootSnapshotKeys,
  sourceText,
}) {
  const queue = [];
  for (const key of rootSnapshotKeys) {
    const root = exactLockEntry(
      oracleText,
      "snapshots",
      key,
      `oracle copied snapshot ${key}`,
    );
    queue.push(
      ...snapshotDependencyReferences(
        oracleText,
        root,
        `oracle copied snapshot ${key}`,
      ),
    );
  }
  const visited = new Set();
  while (queue.length > 0) {
    const [name, reference] = queue.shift();
    const snapshotKey = `${name}@${reference}`;
    if (visited.has(snapshotKey)) continue;
    visited.add(snapshotKey);
    const version = dependencyReferenceVersion(
      reference,
      `oracle closure ${name}`,
    );
    const packageKey = `${name}@${version}`;
    const sourcePackage = exactLockEntry(
      sourceText,
      "packages",
      packageKey,
      `source closure package ${packageKey}`,
    );
    const oraclePackage = exactLockEntry(
      oracleText,
      "packages",
      packageKey,
      `oracle closure package ${packageKey}`,
    );
    if (
      exactResolutionIntegrity(
        sourceText,
        sourcePackage,
        `source closure package ${packageKey}`,
      ) !==
      exactResolutionIntegrity(
        oracleText,
        oraclePackage,
        `oracle closure package ${packageKey}`,
      )
    ) {
      fail(`oracle closure package differs from the source: ${packageKey}`);
    }
    const sourceSnapshot = exactLockEntry(
      sourceText,
      "snapshots",
      snapshotKey,
      `source closure snapshot ${snapshotKey}`,
    );
    const oracleSnapshot = exactLockEntry(
      oracleText,
      "snapshots",
      snapshotKey,
      `oracle closure snapshot ${snapshotKey}`,
    );
    if (
      canonicalEntryBytes(sourceText, sourceSnapshot) !==
      canonicalEntryBytes(oracleText, oracleSnapshot)
    ) {
      fail(`oracle closure snapshot differs from the source: ${snapshotKey}`);
    }
    queue.push(
      ...snapshotDependencyReferences(
        oracleText,
        oracleSnapshot,
        `oracle closure snapshot ${snapshotKey}`,
      ),
    );
  }
}

function rotateImporterNextDeclarations(importersText, operation) {
  const pattern =
    /(^ {6}next:\n {8}specifier: )([^\n]+)(\n {8}version: )([^\n]+)(\n)/gmu;
  let count = 0;
  const target = importersText.replace(
    pattern,
    (block, prefix, specifier, middle, reference, newline) => {
      count += 1;
      const referenceVersion = dependencyReferenceVersion(
        reference,
        "root importer Next reference",
      );
      if (
        ![operation.fromSpecifier, operation.targetSpecifier].includes(
          specifier,
        ) ||
        ![operation.fromVersion, operation.targetVersion].includes(
          referenceVersion,
        ) ||
        (specifier === operation.fromSpecifier) !==
          (referenceVersion === operation.fromVersion)
      ) {
        fail("root importer Next declaration is outside the packet transition");
      }
      if (specifier === operation.targetSpecifier) return block;
      return `${prefix}${operation.targetSpecifier}${middle}${operation.targetVersion}${reference.slice(operation.fromVersion.length)}${newline}`;
    },
  );
  if (count < 1) fail("root importer Next declarations are missing");
  return target;
}

function rotateRuntimeNextReferences(sectionText, operation) {
  const peerReference = new RegExp(
    `(^|[^A-Za-z0-9_@/-])next@${escapeRegex(operation.fromVersion)}(?=\\()`,
    "gmu",
  );
  let target = sectionText.replace(
    peerReference,
    `$1next@${operation.targetVersion}`,
  );
  const scalarReference = new RegExp(
    `^( +next: )(?:${escapeRegex(operation.fromSpecifier)}|${escapeRegex(operation.fromVersion)})(?=$|\\()`,
    "gmu",
  );
  target = target.replace(scalarReference, (line, prefix) => {
    const source = line.slice(prefix.length);
    const specifier = source.startsWith("^")
      ? operation.targetSpecifier
      : operation.targetVersion;
    const suffix = source.slice(
      source.startsWith("^")
        ? operation.fromSpecifier.length
        : operation.fromVersion.length,
    );
    return `${prefix}${specifier}${suffix}`;
  });
  return target;
}

function transformLockSection(lockfileText, sectionName, transform) {
  const section = topLevelSection(lockfileText, sectionName);
  const source = lockfileText.slice(section.start, section.end);
  return replaceTextRanges(lockfileText, [
    { ...section, value: transform(source) },
  ]);
}

function exactResolutionIntegrity(lockfileText, entry, label) {
  const block = lockfileText.slice(entry.start, entry.end);
  const matches = [
    ...block.matchAll(
      /^ {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/]{86}==)\}$/gmu,
    ),
  ];
  if (matches.length !== 1 || !REGISTRY_INTEGRITY.test(matches[0][1])) {
    fail(`${label} does not bind one registry integrity`);
  }
  return matches[0][1];
}

function replaceExactSnapshotScalar(block, name, source, target, label) {
  const yamlName = name.startsWith("@") ? `'${name}'` : name;
  const sourceLine = `      ${yamlName}: ${source}\n`;
  const targetLine = `      ${yamlName}: ${target}\n`;
  if (block.split(sourceLine).length !== 2) {
    fail(`${label} source reference is missing or ambiguous`);
  }
  return block.replace(sourceLine, targetLine);
}

function nextSnapshotContext(entry, version, label) {
  const prefix = `next@${version}`;
  if (!entry.key.startsWith(prefix)) fail(`${label} header is invalid`);
  return entry.key.slice(prefix.length);
}

function snapshotPeerReference(maps, name, label) {
  const dependency = maps.dependencies[name];
  const optionalDependency = maps.optionalDependencies[name];
  if (dependency !== undefined && optionalDependency !== undefined) {
    fail(`${label} is duplicated`);
  }
  if (dependency !== undefined) {
    return { kind: "dependency", reference: dependency };
  }
  if (optionalDependency !== undefined) {
    return { kind: "optional", reference: optionalDependency };
  }
  return null;
}

function validateNextSnapshotPeerShape({
  currentEntry,
  currentMaps,
  metadataContract,
  operation,
  oracleEntry,
  oracleMaps,
  lockfileText,
  oracleText,
}) {
  const registryNames = new Set([
    ...NEXT_REGISTRY_DEPENDENCIES,
    ...NEXT_SWC_PACKAGES,
    "sharp",
  ]);
  const peerNames = new Set(Object.keys(metadataContract.peerDependencies));
  for (const [label, maps] of [
    ["current", currentMaps],
    ["oracle", oracleMaps],
  ]) {
    for (const name of [
      ...Object.keys(maps.dependencies),
      ...Object.keys(maps.optionalDependencies),
    ]) {
      if (!registryNames.has(name) && !peerNames.has(name)) {
        fail(`${label} Next snapshot contains an unexpected peer: ${name}`);
      }
    }
  }
  for (const name of peerNames) {
    const current = snapshotPeerReference(
      currentMaps,
      name,
      `current Next snapshot peer ${name}`,
    );
    const oracle = snapshotPeerReference(
      oracleMaps,
      name,
      `oracle Next snapshot peer ${name}`,
    );
    const optional = Object.hasOwn(metadataContract.peerDependenciesMeta, name);
    if (
      (optional
        ? oracle !== null && oracle.kind !== "optional"
        : oracle?.kind !== "dependency") ||
      !isDeepStrictEqual(current, oracle)
    ) {
      fail(`Next snapshot peer shape differs from the target oracle: ${name}`);
    }
  }
  if (
    nextSnapshotContext(
      currentEntry,
      currentEntry.key.startsWith(`next@${operation.fromVersion}`)
        ? operation.fromVersion
        : operation.targetVersion,
      "current Next snapshot",
    ) !==
      nextSnapshotContext(
        oracleEntry,
        operation.targetVersion,
        "oracle Next snapshot",
      ) ||
    JSON.stringify(
      parseExactScalarSequence(
        lockfileText,
        currentEntry,
        "transitivePeerDependencies",
        "current Next snapshot transitive peers",
      ),
    ) !==
      JSON.stringify(
        parseExactScalarSequence(
          oracleText,
          oracleEntry,
          "transitivePeerDependencies",
          "oracle Next snapshot transitive peers",
        ),
      )
  ) {
    fail("Next snapshot peer context differs from the target oracle");
  }
}

function constructNextSnapshotBlock({
  lockfileText,
  metadataContract,
  operation,
  oracleText,
}) {
  const sourceEntries = versionedLockEntries(
    lockfileText,
    "snapshots",
    "next",
    operation.fromVersion,
  );
  const targetEntries = versionedLockEntries(
    lockfileText,
    "snapshots",
    "next",
    operation.targetVersion,
  );
  const oracleEntries = versionedLockEntries(
    oracleText,
    "snapshots",
    "next",
    operation.targetVersion,
  );
  if (
    sourceEntries.length > 1 ||
    targetEntries.length > 1 ||
    sourceEntries.length + targetEntries.length < 1 ||
    oracleEntries.length !== 1
  ) {
    fail("snapshots Next source and target blocks are ambiguous");
  }
  const currentEntry = sourceEntries[0] ?? targetEntries[0];
  const currentMaps = nextSnapshotMaps(
    lockfileText,
    currentEntry,
    "current Next snapshot",
  );
  const oracleMaps = nextSnapshotMaps(
    oracleText,
    oracleEntries[0],
    "oracle Next snapshot",
  );
  if (
    JSON.stringify(Object.keys(currentMaps.dependencies)) !==
      JSON.stringify(Object.keys(oracleMaps.dependencies)) ||
    JSON.stringify(Object.keys(currentMaps.optionalDependencies)) !==
      JSON.stringify(Object.keys(oracleMaps.optionalDependencies))
  ) {
    fail("Next snapshot dependency keysets changed");
  }
  validateNextSnapshotPeerShape({
    currentEntry,
    currentMaps,
    lockfileText,
    metadataContract,
    operation,
    oracleEntry: oracleEntries[0],
    oracleMaps,
    oracleText,
  });
  for (const name of NEXT_REGISTRY_DEPENDENCIES) {
    const sourceReference = currentMaps.dependencies[name];
    const oracleReference = oracleMaps.dependencies[name];
    if (sourceReference === undefined || oracleReference === undefined) {
      fail(`Next snapshot dependency is missing: ${name}`);
    }
    const sourceVersion = dependencyReferenceVersion(
      sourceReference,
      `current Next snapshot ${name}`,
    );
    const oracleVersion = dependencyReferenceVersion(
      oracleReference,
      `oracle Next snapshot ${name}`,
    );
    const specifier = metadataContract.dependencies[name];
    if (NEXT_RANGED_DEPENDENCIES.has(name)) {
      if (
        !satisfiesCaret(sourceVersion, specifier) ||
        !satisfiesCaret(oracleVersion, specifier)
      ) {
        fail(`Next snapshot does not satisfy the target range: ${name}`);
      }
    } else if (
      oracleVersion !== specifier ||
      (name !== "@next/env" &&
        name !== "@swc/helpers" &&
        sourceVersion !== specifier)
    ) {
      fail(`Next snapshot does not bind the target exact dependency: ${name}`);
    }
  }
  for (const name of NEXT_SWC_PACKAGES) {
    const sourceVersion = dependencyReferenceVersion(
      currentMaps.optionalDependencies[name],
      `current Next snapshot ${name}`,
    );
    const oracleVersion = dependencyReferenceVersion(
      oracleMaps.optionalDependencies[name],
      `oracle Next snapshot ${name}`,
    );
    if (
      ![operation.fromVersion, operation.targetVersion].includes(
        sourceVersion,
      ) ||
      oracleVersion !== operation.targetVersion
    ) {
      fail(
        `Next snapshot optional dependency is outside the transition: ${name}`,
      );
    }
  }
  for (const [label, reference] of [
    ["current", currentMaps.optionalDependencies.sharp],
    ["oracle", oracleMaps.optionalDependencies.sharp],
  ]) {
    if (
      !satisfiesCaret(
        dependencyReferenceVersion(reference, `${label} Next snapshot sharp`),
        metadataContract.optionalDependencies.sharp,
      )
    ) {
      fail(`${label} Next snapshot sharp does not satisfy the target range`);
    }
  }
  if (targetEntries.length === 1 && sourceEntries.length === 0) {
    const current = canonicalEntryBytes(lockfileText, targetEntries[0]);
    let expected = current;
    for (const name of NEXT_REGISTRY_DEPENDENCIES) {
      if (NEXT_RANGED_DEPENDENCIES.has(name)) continue;
      const currentReference = currentMaps.dependencies[name];
      const expectedReference = oracleMaps.dependencies[name];
      if (currentReference !== expectedReference) {
        expected = replaceExactSnapshotScalar(
          expected,
          name,
          currentReference,
          expectedReference,
          `target Next snapshot ${name}`,
        );
      }
    }
    for (const name of NEXT_SWC_PACKAGES) {
      const currentReference = currentMaps.optionalDependencies[name];
      const expectedReference = oracleMaps.optionalDependencies[name];
      if (currentReference !== expectedReference) {
        expected = replaceExactSnapshotScalar(
          expected,
          name,
          currentReference,
          expectedReference,
          `target Next snapshot ${name}`,
        );
      }
    }
    if (current !== expected) {
      fail("existing target Next snapshot is not exact");
    }
    return { block: current, sourceEntries, targetEntries };
  }
  let block = canonicalEntryBytes(lockfileText, sourceEntries[0]);
  block = block.replace(
    `  next@${operation.fromVersion}`,
    `  next@${operation.targetVersion}`,
  );
  block = replaceExactSnapshotScalar(
    block,
    "@next/env",
    currentMaps.dependencies["@next/env"],
    oracleMaps.dependencies["@next/env"],
    "Next snapshot @next/env",
  );
  block = replaceExactSnapshotScalar(
    block,
    "@swc/helpers",
    currentMaps.dependencies["@swc/helpers"],
    oracleMaps.dependencies["@swc/helpers"],
    "Next snapshot @swc/helpers",
  );
  for (const name of NEXT_SWC_PACKAGES) {
    block = replaceExactSnapshotScalar(
      block,
      name,
      currentMaps.optionalDependencies[name],
      oracleMaps.optionalDependencies[name],
      `Next snapshot ${name}`,
    );
  }
  if (
    targetEntries.length === 1 &&
    canonicalEntryBytes(lockfileText, targetEntries[0]) !== block
  ) {
    fail("existing target Next snapshot differs from the surgical target");
  }
  return { block, sourceEntries, targetEntries };
}

function replaceNextSnapshotEntry(lockfileText, snapshot) {
  if (snapshot.targetEntries.length === 1) {
    if (snapshot.sourceEntries.length === 0) return lockfileText;
    return replaceTextRanges(lockfileText, [
      { ...snapshot.sourceEntries[0], value: "" },
    ]);
  }
  return replaceTextRanges(lockfileText, [
    { ...snapshot.sourceEntries[0], value: snapshot.block },
  ]);
}

function rotateNextLockOverride(lockfileText, operation) {
  const overrides = topLevelSection(lockfileText, "overrides");
  const sourceLine = `  next: ${operation.fromSpecifier}`;
  const targetLine = `  next: ${operation.targetSpecifier}`;
  const source = exactLineOffsets(
    lockfileText,
    sourceLine,
    overrides.start,
    overrides.end,
  );
  const target = exactLineOffsets(
    lockfileText,
    targetLine,
    overrides.start,
    overrides.end,
  );
  if (source.length + target.length !== 1) {
    fail("root lockfile Next override is missing or ambiguous");
  }
  if (target.length === 1) return lockfileText;
  return replaceTextRanges(lockfileText, [
    {
      end: source[0] + sourceLine.length,
      start: source[0],
      value: targetLine,
    },
  ]);
}

function assertNoSourceNextBindings(lockfileText, operation) {
  for (const sectionName of ["importers", "packages", "snapshots"]) {
    const section = topLevelSection(lockfileText, sectionName);
    const text = lockfileText.slice(section.start, section.end);
    const peerReference = new RegExp(
      `(^|[^A-Za-z0-9_@/-])next@${escapeRegex(operation.fromVersion)}(?=\\()`,
      "mu",
    );
    const scalarReference = new RegExp(
      `^ +next: (?:${escapeRegex(operation.fromSpecifier)}|${escapeRegex(operation.fromVersion)})(?=$|\\()`,
      "mu",
    );
    if (peerReference.test(text) || scalarReference.test(text)) {
      fail(`${sectionName} retains a source Next runtime reference`);
    }
  }
  for (const packageName of ["next", "@next/env", ...NEXT_SWC_PACKAGES]) {
    for (const sectionName of ["packages", "snapshots"]) {
      if (
        versionedLockEntries(
          lockfileText,
          sectionName,
          packageName,
          operation.fromVersion,
        ).length !== 0 ||
        versionedLockEntries(
          lockfileText,
          sectionName,
          packageName,
          operation.targetVersion,
        ).length !== 1
      ) {
        fail(`${sectionName} ${packageName} did not rotate exactly once`);
      }
    }
  }
}

export function rotateNextRootLockBytes({
  lockfileBytes,
  operation,
  oracleLockfileBytes,
  targetMetadata,
}) {
  const sourceText = canonicalLockfileText(
    lockfileBytes,
    "authenticated source root lockfile",
  );
  const oracleText = canonicalLockfileText(
    oracleLockfileBytes,
    "target Next oracle lockfile",
  );
  const metadataContract = validateNextTargetMetadata(
    targetMetadata,
    operation,
  );
  inspectNextOverride(oracleText, operation, "target Next oracle lockfile");
  const oracleNextPackage = exactLockEntry(
    oracleText,
    "packages",
    `next@${operation.targetVersion}`,
    "oracle target Next package",
  );
  if (
    exactResolutionIntegrity(
      oracleText,
      oracleNextPackage,
      "oracle target Next package",
    ) !== metadataContract.integrity
  ) {
    fail("oracle target Next integrity differs from registry metadata");
  }
  validateOracleNextPackageMetadata({
    entry: oracleNextPackage,
    lockfileText: oracleText,
    metadataContract,
  });
  for (const packageName of ["@next/env", ...NEXT_SWC_PACKAGES]) {
    const entry = exactLockEntry(
      oracleText,
      "packages",
      `${packageName}@${operation.targetVersion}`,
      `oracle target ${packageName} package`,
    );
    exactResolutionIntegrity(
      oracleText,
      entry,
      `oracle target ${packageName} package`,
    );
  }
  const helperVersion = metadataContract.dependencies["@swc/helpers"];
  const oracleHelperPackage = exactLockEntry(
    oracleText,
    "packages",
    `@swc/helpers@${helperVersion}`,
    "oracle target @swc/helpers package",
  );
  exactResolutionIntegrity(
    oracleText,
    oracleHelperPackage,
    "oracle target @swc/helpers package",
  );
  validateOracleClosureAvailableInSource({
    oracleText,
    rootSnapshotKeys: [
      `@next/env@${operation.targetVersion}`,
      ...NEXT_SWC_PACKAGES.map(
        (packageName) => `${packageName}@${operation.targetVersion}`,
      ),
      `@swc/helpers@${helperVersion}`,
    ],
    sourceText,
  });

  const nextSnapshot = constructNextSnapshotBlock({
    lockfileText: sourceText,
    metadataContract,
    operation,
    oracleText,
  });
  let targetText = replaceNextSnapshotEntry(sourceText, nextSnapshot);
  targetText = rotateNextLockOverride(targetText, operation);
  targetText = replaceVersionedLockEntry({
    lockfileText: targetText,
    oracleText,
    packageName: "next",
    sectionName: "packages",
    sourceVersion: operation.fromVersion,
    targetVersion: operation.targetVersion,
  });
  for (const packageName of ["@next/env", ...NEXT_SWC_PACKAGES]) {
    for (const sectionName of ["packages", "snapshots"]) {
      targetText = replaceVersionedLockEntry({
        lockfileText: targetText,
        oracleText,
        packageName,
        sectionName,
        sourceVersion: operation.fromVersion,
        targetVersion: operation.targetVersion,
      });
    }
  }
  for (const sectionName of ["packages", "snapshots"]) {
    targetText = insertExactOracleEntry({
      key: `@swc/helpers@${helperVersion}`,
      lockfileText: targetText,
      oracleText,
      sectionName,
    });
  }
  targetText = transformLockSection(targetText, "importers", (section) =>
    rotateRuntimeNextReferences(
      rotateImporterNextDeclarations(section, operation),
      operation,
    ),
  );
  for (const sectionName of ["packages", "snapshots"]) {
    targetText = transformLockSection(targetText, sectionName, (section) =>
      rotateRuntimeNextReferences(section, operation),
    );
  }
  inspectGeneratedNextLock(Buffer.from(targetText), operation);
  assertNoSourceNextBindings(targetText, operation);
  return Buffer.from(targetText);
}

function inspectNextOverride(lockfileText, operation, label) {
  const overrides = topLevelSection(lockfileText, "overrides");
  const nextOverrides = [
    ...lockfileText
      .slice(overrides.start, overrides.end)
      .matchAll(/^ {2}next: ([^\n]+)$/gmu),
  ];
  if (
    nextOverrides.length !== 1 ||
    nextOverrides[0][1] !== operation.targetSpecifier
  ) {
    fail(`${label} does not bind the target Next override`);
  }
}

function anchoredNextVersions(lockfileText, sectionName) {
  const versions = [];
  for (const { key } of lockSectionEntries(lockfileText, sectionName).entries) {
    if (!key.startsWith("next@")) continue;
    const match = /^next@([^:(]+)(?:\(.*\))?$/u.exec(key);
    if (!match) fail(`${sectionName} contains a malformed Next lock entry`);
    versions.push(match[1]);
  }
  return versions;
}

function inspectGeneratedNextLock(lockfileBytes, operation) {
  const lockfileText = canonicalLockfileText(
    lockfileBytes,
    "generated root lockfile",
  );
  inspectNextOverride(lockfileText, operation, "generated root lockfile");
  const nextPackages = anchoredNextVersions(lockfileText, "packages");
  if (
    nextPackages.length !== 1 ||
    nextPackages[0] !== operation.targetVersion
  ) {
    fail("generated root lockfile does not resolve the exact target Next");
  }
  const nextSnapshots = anchoredNextVersions(lockfileText, "snapshots");
  if (
    nextSnapshots.length < 1 ||
    nextSnapshots.some((version) => version !== operation.targetVersion)
  ) {
    fail("generated root lockfile snapshots do not use the exact target Next");
  }
}

export function inspectGeneratedNextRuntimeLock(lockfileBytes, operation) {
  const lockfileText = canonicalLockfileText(
    lockfileBytes,
    "generated standalone runtime lockfile",
  );
  inspectNextOverride(
    lockfileText,
    operation,
    "generated standalone runtime lockfile",
  );
  const versions = [
    ...anchoredNextVersions(lockfileText, "packages"),
    ...anchoredNextVersions(lockfileText, "snapshots"),
  ];
  if (versions.length !== 0) {
    fail("standalone runtime lockfile unexpectedly resolves Next");
  }
}

export function rotateNextStandaloneRuntimeLockBytes({
  lockfileBytes,
  operation,
}) {
  const sourceText = canonicalLockfileText(
    lockfileBytes,
    "authenticated standalone runtime lockfile",
  );
  for (const sectionName of ["packages", "snapshots"]) {
    if (anchoredNextVersions(sourceText, sectionName).length !== 0) {
      fail("standalone runtime lockfile unexpectedly resolves Next");
    }
  }
  const targetBytes = Buffer.from(
    rotateNextLockOverride(sourceText, operation),
  );
  inspectGeneratedNextRuntimeLock(targetBytes, operation);
  return targetBytes;
}

function verifyFrozenStandaloneLock({
  command,
  environmentRoot,
  lockfileBytes,
  packageBytes,
  root,
}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "package.json"), packageBytes, { mode: 0o600 });
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfileBytes, { mode: 0o600 });
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const result = spawnSync(
    command,
    pnpmInstallArguments({
      frozenLockfile: true,
      ignoreWorkspace: true,
      store,
    }),
    {
      cwd: root,
      encoding: "utf8",
      env: sanitizedEnvironment(environmentRoot, [dirname(command)]),
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 4 * 60_000,
    },
  );
  if (result.status !== 0 || result.signal !== null) {
    fail(
      `surgically transformed standalone lockfile is not frozen-consistent: ${(result.stderr ?? "").slice(0, 500)}`,
    );
  }
  if (!readFileSync(join(root, "pnpm-lock.yaml")).equals(lockfileBytes)) {
    fail("frozen standalone consistency check changed the surgical lockfile");
  }
}

function runtimePackageWithOverrides(runtimePackage, overrides) {
  return {
    ...runtimePackage,
    pnpm: {
      ...runtimePackage.pnpm,
      overrides,
    },
  };
}

function generateNextCatalogOracleLock({
  blobs,
  operation,
  pnpmCommand,
  runRoot,
}) {
  const root = join(runRoot, "root");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rootPackageBytes = rotateNextOverridePackageBytes(
    blobs.get("package.json").bytes,
    operation,
  );
  const workspaceBytes = rotateNextCatalogWorkspaceBytes(
    blobs.get("pnpm-workspace.yaml").bytes,
    operation,
  );
  materializeInputs(root, blobs);
  writeFileSync(join(root, "package.json"), rootPackageBytes, { mode: 0o600 });
  writeFileSync(join(root, "pnpm-workspace.yaml"), workspaceBytes, {
    mode: 0o600,
  });
  runPnpmInstall({
    command: pnpmCommand,
    environmentRoot: join(runRoot, "root-env"),
    ignoreWorkspace: false,
    resolutionMode: operation.resolutionMode,
    root,
  });
  if (
    !readFileSync(join(root, "package.json")).equals(rootPackageBytes) ||
    !readFileSync(join(root, "pnpm-workspace.yaml")).equals(workspaceBytes)
  ) {
    fail("pnpm changed a typed Next manifest during lock regeneration");
  }
  const oracleLockfileBytes = readFileSync(join(root, "pnpm-lock.yaml"));
  inspectGeneratedNextLock(oracleLockfileBytes, operation);
  return oracleLockfileBytes;
}

function generateNextCatalogOnce({
  blobs,
  operation,
  pnpmCommand,
  rootLockBytes,
  runRoot,
}) {
  const root = join(runRoot, "root");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const current = validateCurrentInputs(blobs, operation);
  const rootPackageBytes = rotateNextOverridePackageBytes(
    blobs.get("package.json").bytes,
    operation,
  );
  const workspaceBytes = rotateNextCatalogWorkspaceBytes(
    blobs.get("pnpm-workspace.yaml").bytes,
    operation,
  );
  writeFileSync(join(root, "package.json"), rootPackageBytes, { mode: 0o600 });
  inspectGeneratedNextLock(rootLockBytes, operation);
  verifyFrozenRootLock({
    blobs,
    command: pnpmCommand,
    environmentRoot: join(runRoot, "root-frozen-env"),
    lockfileBytes: rootLockBytes,
    packageBytes: rootPackageBytes,
    resolutionMode: operation.resolutionMode,
    root: join(runRoot, "root-frozen"),
    workspaceBytes,
  });

  const rootPackage = parseJsonBytes(rootPackageBytes, "target root package");
  const runtimePackage = runtimePackageWithOverrides(
    current.runtimePackage,
    rootPackage.pnpm.overrides,
  );
  const runtimePackageBytes = Buffer.from(prettyJson(runtimePackage));
  const runtimeLockBytes = rotateNextStandaloneRuntimeLockBytes({
    lockfileBytes: blobs.get("scripts/vercel-cli-runtime/pnpm-lock.yaml").bytes,
    operation,
  });
  verifyFrozenStandaloneLock({
    command: pnpmCommand,
    environmentRoot: join(runRoot, "runtime-frozen-env"),
    lockfileBytes: runtimeLockBytes,
    packageBytes: runtimePackageBytes,
    root: join(runRoot, "runtime-frozen"),
  });
  const contractBytes = Buffer.from(
    prettyJson(
      createRuntimeContract({
        integrity: current.contract.registryIntegrity,
        lockfileBytes: runtimeLockBytes,
        manifestBytes: runtimePackageBytes,
        overrides: rootPackage.pnpm.overrides,
        runtimeDependencies: runtimePackage.dependencies,
        targetVersion: current.contract.vercelVersion,
      }),
    ),
  );
  const assertedRuntime = join(root, "scripts", "vercel-cli-runtime");
  mkdirSync(assertedRuntime, { recursive: true, mode: 0o700 });
  writeFileSync(join(assertedRuntime, "package.json"), runtimePackageBytes, {
    mode: 0o600,
  });
  writeFileSync(join(assertedRuntime, "pnpm-lock.yaml"), runtimeLockBytes, {
    mode: 0o600,
  });
  writeFileSync(join(assertedRuntime, "contract.json"), contractBytes, {
    mode: 0o600,
  });
  assertVercelCliRuntimeContract({
    contractPath: join(assertedRuntime, "contract.json"),
    lockfilePath: join(assertedRuntime, "pnpm-lock.yaml"),
    packageJsonPath: join(assertedRuntime, "package.json"),
    rootPackageJsonPath: join(root, "package.json"),
  });
  return new Map([
    ["package.json", rootPackageBytes],
    ["pnpm-lock.yaml", rootLockBytes],
    ["pnpm-workspace.yaml", workspaceBytes],
    ["scripts/vercel-cli-runtime/contract.json", contractBytes],
    ["scripts/vercel-cli-runtime/package.json", runtimePackageBytes],
    ["scripts/vercel-cli-runtime/pnpm-lock.yaml", runtimeLockBytes],
  ]);
}

function verifyFrozenStandaloneRuntime({
  generated,
  pnpmCommand,
  targetVersion,
  verificationRoot,
}) {
  const runtimeRoot = join(verificationRoot, "runtime");
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  for (const path of [
    "scripts/vercel-cli-runtime/contract.json",
    "scripts/vercel-cli-runtime/package.json",
    "scripts/vercel-cli-runtime/pnpm-lock.yaml",
  ]) {
    writeFileSync(
      runtimeRoot + sep + path.split("/").at(-1),
      generated.get(path),
      {
        mode: 0o600,
      },
    );
  }
  const environmentRoot = join(verificationRoot, "environment");
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const install = spawnSync(
    pnpmCommand,
    [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--ignore-workspace",
      "--package-import-method",
      "copy",
      "--registry=https://registry.npmjs.org/",
      "--store-dir",
      store,
    ],
    {
      cwd: runtimeRoot,
      encoding: "utf8",
      env: sanitizedEnvironment(environmentRoot, [dirname(pnpmCommand)]),
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 8 * 60_000,
    },
  );
  if (install.status !== 0 || install.signal !== null) {
    fail(
      `frozen standalone runtime installation failed: ${(install.stderr ?? "").slice(0, 500)}`,
    );
  }
  const modulesRoot = realpathSync(join(runtimeRoot, "node_modules"));
  const cliPath = realpathSync(
    join(runtimeRoot, "node_modules", "vercel", "dist", "index.js"),
  );
  const cliRelative = relative(modulesRoot, cliPath);
  const cliEntry = lstatSync(cliPath);
  if (
    cliRelative === ".." ||
    cliRelative.startsWith(`..${sep}`) ||
    !cliEntry.isFile() ||
    cliEntry.isSymbolicLink()
  ) {
    fail("installed Vercel CLI escaped the frozen standalone runtime");
  }
  const version = spawnSync(process.execPath, [cliPath, "--version"], {
    cwd: runtimeRoot,
    encoding: "utf8",
    env: sanitizedEnvironment(join(verificationRoot, "cli-environment")),
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (
    version.status !== 0 ||
    version.signal !== null ||
    version.stdout.trim() !== targetVersion
  ) {
    fail("installed Vercel CLI does not execute the exact target version");
  }
}

export function verifySecretlessNextCandidateBuild({
  blobs,
  generated,
  operation,
  pnpmCommand,
  verificationRoot,
}) {
  if (!nextCatalogOperation(operation)) {
    fail("secretless Next build requires the exact Next operation");
  }
  if (
    !(blobs instanceof Map) ||
    blobs.size !== PROTECTED_RUNTIME_SYNC_INPUT_PATHS.length ||
    PROTECTED_RUNTIME_SYNC_INPUT_PATHS.some(
      (path) => !Buffer.isBuffer(blobs.get(path)?.bytes),
    ) ||
    !(generated instanceof Map) ||
    generated.size !== NEXT_CATALOG_SYNC_REQUIRED_PATHS.length ||
    NEXT_CATALOG_SYNC_REQUIRED_PATHS.some(
      (path) => !Buffer.isBuffer(generated.get(path)),
    ) ||
    typeof pnpmCommand !== "string" ||
    pnpmCommand.length === 0 ||
    !isAbsolute(verificationRoot)
  ) {
    fail("secretless Next build inputs are incomplete");
  }

  const candidateRoot = join(verificationRoot, "candidate");
  mkdirSync(candidateRoot, { recursive: true, mode: 0o700 });
  materializeInputs(candidateRoot, blobs);
  for (const path of NEXT_CATALOG_SYNC_REQUIRED_PATHS) {
    const destination = join(candidateRoot, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, generated.get(path), { mode: 0o600 });
  }

  const appRoot = join(candidateRoot, "apps", "app.mento.org");
  const appSourceRoot = join(appRoot, "app");
  mkdirSync(appSourceRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(appSourceRoot, "layout.js"),
    'import { createElement } from "react";\n\nexport default function RootLayout({ children }) {\n  return createElement("html", null, createElement("body", null, children));\n}\n',
    { mode: 0o600 },
  );
  writeFileSync(
    join(appSourceRoot, "page.js"),
    'export default function Page() {\n  return "secretless Next candidate smoke";\n}\n',
    { mode: 0o600 },
  );

  const environmentRoot = join(verificationRoot, "environment");
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const install = spawnSync(
    pnpmCommand,
    nextCandidateInstallArguments({ store }),
    {
      cwd: candidateRoot,
      encoding: "utf8",
      env: sanitizedEnvironment(environmentRoot, [dirname(pnpmCommand)]),
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 12 * 60_000,
    },
  );
  if (install.status !== 0 || install.signal !== null) {
    const diagnostic = `${install.stderr ?? ""}\n${install.stdout ?? ""}`
      .trim()
      .slice(0, 1_000);
    fail(
      `secretless Next candidate install failed (status=${String(install.status)}, signal=${String(install.signal)}): ${diagnostic}`,
    );
  }
  if (
    !readFileSync(join(candidateRoot, "pnpm-lock.yaml")).equals(
      generated.get("pnpm-lock.yaml"),
    )
  ) {
    fail("secretless Next candidate install changed the validated lockfile");
  }

  const modulesRoot = realpathSync(join(candidateRoot, "node_modules"));
  const cliPath = realpathSync(
    join(appRoot, "node_modules", "next", "dist", "bin", "next"),
  );
  const cliRelative = relative(modulesRoot, cliPath);
  const cliEntry = lstatSync(cliPath);
  if (
    cliRelative === ".." ||
    cliRelative.startsWith(`..${sep}`) ||
    !cliEntry.isFile() ||
    cliEntry.isSymbolicLink()
  ) {
    fail("installed Next CLI escaped the secretless candidate root");
  }
  const installedPackage = parseJsonBytes(
    readFileSync(resolve(dirname(cliPath), "..", "..", "package.json")),
    "installed Next candidate package",
  );
  if (
    installedPackage.name !== "next" ||
    installedPackage.version !== operation.targetVersion ||
    !isDeepStrictEqual(installedPackage.bin, { next: "./dist/bin/next" })
  ) {
    fail("installed Next candidate package does not match the target");
  }

  const candidateEnvironment = {
    ...sanitizedEnvironment(join(verificationRoot, "build-environment")),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const version = spawnSync(process.execPath, [cliPath, "--version"], {
    cwd: appRoot,
    encoding: "utf8",
    env: candidateEnvironment,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  if (
    version.status !== 0 ||
    version.signal !== null ||
    version.stdout.trim() !== `Next.js v${operation.targetVersion}`
  ) {
    fail("installed Next CLI does not execute the exact target version");
  }
  const build = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: appRoot,
    encoding: "utf8",
    env: candidateEnvironment,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 8 * 60_000,
  });
  if (
    build.status !== 0 ||
    build.signal !== null ||
    !existsSync(join(appRoot, ".next", "BUILD_ID"))
  ) {
    const diagnostic = `${build.stderr ?? ""}\n${build.stdout ?? ""}`
      .trim()
      .slice(0, 1_000);
    fail(
      `secretless Next candidate build failed (status=${String(build.status)}, signal=${String(build.signal)}): ${diagnostic}`,
    );
  }
}

function assertGeneratedRuntimeContract({ generated, verificationRoot }) {
  const rootPackagePath = join(verificationRoot, "package.json");
  const runtimeRoot = join(verificationRoot, "scripts", "vercel-cli-runtime");
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  writeFileSync(rootPackagePath, generated.get("package.json"), {
    mode: 0o600,
  });
  for (const name of ["contract.json", "package.json", "pnpm-lock.yaml"]) {
    writeFileSync(
      join(runtimeRoot, name),
      generated.get(`scripts/vercel-cli-runtime/${name}`),
      { mode: 0o600 },
    );
  }
  assertVercelCliRuntimeContract({
    contractPath: join(runtimeRoot, "contract.json"),
    lockfilePath: join(runtimeRoot, "pnpm-lock.yaml"),
    packageJsonPath: join(runtimeRoot, "package.json"),
    rootPackageJsonPath: rootPackagePath,
  });
  return parseContract(
    generated.get("scripts/vercel-cli-runtime/contract.json"),
    "generated runtime contract",
  );
}

function assertSameOutputs(first, second, requiredPaths) {
  for (const path of requiredPaths) {
    if (!first.get(path)?.equals(second.get(path))) {
      fail(`isolated regeneration is not byte-identical: ${path}`);
    }
  }
}

export function createUnifiedPatch({
  maxBytes = MAX_PATCH_BYTES,
  oldBytes,
  newBytes,
  path,
  temporaryRoot,
}) {
  const oldPath = join(temporaryRoot, "old");
  const newPath = join(temporaryRoot, "new");
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  writeFileSync(oldPath, oldBytes, { mode: 0o600 });
  writeFileSync(newPath, newBytes, { mode: 0o600 });
  const diff = spawnSync(
    "/usr/bin/diff",
    [
      "-U",
      "1",
      "--label",
      `a/${path}`,
      "--label",
      `b/${path}`,
      oldPath,
      newPath,
    ],
    {
      encoding: "utf8",
      env: sanitizedEnvironment(join(temporaryRoot, "diff-env")),
      maxBuffer: maxBytes + 1,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (diff.status !== 1 || diff.signal !== null || diff.stderr !== "") {
    fail(`contextual diff failed for ${path}`);
  }
  const patch = diff.stdout;
  if (
    !patch.startsWith(`--- a/${path}\n+++ b/${path}\n`) ||
    Buffer.byteLength(patch) > maxBytes ||
    !/^@@ -[0-9]+(?:,[0-9]+)? \+[0-9]+(?:,[0-9]+)? @@/mu.test(patch)
  ) {
    fail(`contextual U1 patch is invalid or oversized: ${path}`);
  }
  return patch;
}

function buildPlan({
  blobs,
  generated,
  packet,
  packetDigest,
  processorCheckId,
  temporaryRoot,
}) {
  const catalogOperation = nextCatalogOperation(packet.operation);
  const requiredPaths = catalogOperation
    ? NEXT_CATALOG_SYNC_REQUIRED_PATHS
    : PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS;
  const edits = [];
  for (const path of requiredPaths) {
    const old = blobs.get(path);
    const next = generated.get(path);
    if (old.bytes.equals(next)) continue;
    edits.push({
      expectedBlobSha: old.expectedBlobSha,
      patch: createUnifiedPatch({
        maxBytes: catalogOperation
          ? MAX_NEXT_CATALOG_PATCH_BYTES
          : MAX_PATCH_BYTES,
        newBytes: next,
        oldBytes: old.bytes,
        path,
        temporaryRoot: join(temporaryRoot, `diff-${edits.length}`),
      }),
      path,
    });
  }
  if (edits.length === 0) fail("regeneration produced no required-path edits");
  const plan = {
    attempt: packet.attemptNumber,
    baseSha: packet.baseSha,
    edits,
    packetDigest,
    parentHeadSha: packet.headSha,
    processorCheckId,
    pullRequestNumber: packet.pullRequestNumber,
    repository: packet.repository,
    schema: PLAN_SCHEMA,
    summary: catalogOperation
      ? `Synchronize the Next catalog and root override from ${packet.operation.fromVersion} to ${packet.operation.targetVersion}, rotate both sealed lockfiles, and update the protected runtime contract with pnpm ${EXACT_PNPM_VERSION}.`
      : `Synchronize the protected Vercel CLI runtime from ${packet.operation.fromVersion} to ${packet.operation.targetVersion} with exact registry-derived builder peers and pnpm ${EXACT_PNPM_VERSION}.`,
  };
  validateRepairPlan(plan, { packet, packetDigest, processorCheckId });
  if (Buffer.byteLength(canonicalJson(plan)) > MAX_PLAN_BYTES) {
    fail("canonical repair plan is oversized");
  }
  return plan;
}

export function generateProtectedRuntimeRepairPlan({
  evidenceManifestPath,
  fetchMetadata = fetchExactRegistryMetadata,
  fetchNextMetadata = fetchExactNextRegistryMetadata,
  packetBase64,
  processorCheckId,
}) {
  if (!Number.isSafeInteger(processorCheckId) || processorCheckId < 1) {
    fail("processor check ID is invalid");
  }
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "dependabot-protected-runtime-sync-"),
  );
  try {
    const { packet, packetDigest } = decodePacket(packetBase64);
    const blobs = loadEvidence({
      evidenceManifestPath,
      packet,
      packetDigest,
      processorCheckId,
    });
    const pnpmCommand = resolveExactPnpm(
      join(temporaryRoot, "pnpm-version-proof"),
    );
    let first;
    let second;
    if (nextCatalogOperation(packet.operation)) {
      validateCurrentInputs(blobs, packet.operation);
      const oracleLockfileBytes = generateNextCatalogOracleLock({
        blobs,
        operation: packet.operation,
        pnpmCommand,
        runRoot: join(temporaryRoot, "oracle"),
      });
      const nextMetadata = fetchNextMetadata(
        packet.operation.targetVersion,
        join(temporaryRoot, "next-metadata"),
      );
      const rootLockBytes = rotateNextRootLockBytes({
        lockfileBytes: blobs.get("pnpm-lock.yaml").bytes,
        operation: packet.operation,
        oracleLockfileBytes,
        targetMetadata: nextMetadata,
      });
      first = generateNextCatalogOnce({
        blobs,
        operation: packet.operation,
        pnpmCommand,
        rootLockBytes,
        runRoot: join(temporaryRoot, "generation-1"),
      });
      second = first;
    } else {
      const current = validateCurrentInputs(blobs, packet.operation);
      const sourceMetadata = fetchMetadata(
        packet.operation.fromVersion,
        join(temporaryRoot, "source-metadata"),
      );
      const targetMetadata = fetchMetadata(
        packet.operation.targetVersion,
        join(temporaryRoot, "target-metadata"),
      );
      const metadataContract = validateRegistryTransition({
        currentRuntimeDependencies: current.runtimePackage.dependencies,
        fromVersion: packet.operation.fromVersion,
        sourceMetadata,
        targetMetadata,
        targetVersion: packet.operation.targetVersion,
        updateType: packet.operation.updateType,
      });
      if (
        metadataContract.sourceIntegrity !== current.contract.registryIntegrity
      ) {
        fail(
          "source registry integrity does not match the sealed runtime contract",
        );
      }
      first = generateOnce({
        blobs,
        metadataContract,
        operation: packet.operation,
        pnpmCommand,
        runRoot: join(temporaryRoot, "generation-1"),
      });
      second = generateOnce({
        blobs,
        metadataContract,
        operation: packet.operation,
        pnpmCommand,
        runRoot: join(temporaryRoot, "generation-2"),
      });
    }
    assertSameOutputs(first, second, packet.operation.requiredPaths);
    const plan = buildPlan({
      blobs,
      generated: first,
      packet,
      packetDigest,
      processorCheckId,
      temporaryRoot: join(temporaryRoot, "patches"),
    });
    return plan;
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function decodeCanonicalBase64(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > 96 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    fail(`${label} base64 is invalid`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail(`${label} base64 is not canonical`);
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    fail(`${label} is not strict UTF-8`);
  }
  return text;
}

function decodeValidatedPlanBinding({
  packetBase64,
  processorCheckId,
  validatedPlanBase64,
  validatedPlanDigest,
}) {
  if (!HEX_DIGEST.test(validatedPlanDigest ?? "")) {
    fail("validated plan digest is invalid");
  }
  const validatedText = decodeCanonicalBase64(
    validatedPlanBase64,
    "validated plan",
  );
  if (rawDigest(validatedText) !== validatedPlanDigest) {
    fail("validated plan digest does not match its canonical bytes");
  }
  const { packet, packetDigest } = decodePacket(packetBase64);
  const validated = parseCanonicalJson(validatedText, "validated repair plan");
  validateValidatedRepairPlan(validated, {
    packet,
    packetDigest,
    processorCheckId,
  });
  return { packet, packetDigest, validated };
}

function runCredentiallessGit(args, root) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
    env: gitSubprocessEnvironment(root),
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.signal !== null) {
    fail(
      `terminal-smoke git ${args[0]} failed: ${(result.stderr ?? "").slice(0, 500)}`,
    );
  }
}

export function applyValidatedPlanToEvidence({
  blobs,
  packet,
  temporaryRoot,
  validated,
}) {
  const requiredPaths = nextCatalogOperation(packet.operation)
    ? NEXT_CATALOG_SYNC_REQUIRED_PATHS
    : PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS;
  const generated = new Map();
  mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  runCredentiallessGit(["init", "--quiet"], temporaryRoot);
  for (const path of requiredPaths) {
    const blob = blobs.get(path);
    if (blob === undefined) {
      fail(`terminal-smoke evidence is missing a required path: ${path}`);
    }
    generated.set(path, blob.bytes);
  }
  for (const [index, edit] of validated.edits.entries()) {
    validateRepairPatch(edit);
    const blob = blobs.get(edit.path);
    if (
      blob === undefined ||
      blob.expectedBlobSha !== edit.expectedBlobSha ||
      blob.mode !== edit.mode ||
      edit.type !== "blob"
    ) {
      fail(`validated terminal-smoke edit is not evidence-bound: ${edit.path}`);
    }
    const destination = join(temporaryRoot, edit.path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, blob.bytes, {
      mode: edit.mode === "100755" ? 0o700 : 0o600,
    });
    const patchPath = join(temporaryRoot, `.validated-patch-${index}`);
    writeFileSync(patchPath, edit.patch, { mode: 0o600 });
    runCredentiallessGit(
      ["apply", "--check", "--whitespace=error-all", patchPath],
      temporaryRoot,
    );
    runCredentiallessGit(
      ["apply", "--whitespace=error-all", patchPath],
      temporaryRoot,
    );
    const entry = lstatSync(destination);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail(
        `validated terminal-smoke result is not a regular file: ${edit.path}`,
      );
    }
    const content = readFileSync(destination);
    if (rawDigest(content) !== edit.contentDigest) {
      fail(`validated plan content digest changed before smoke: ${edit.path}`);
    }
    generated.set(edit.path, content);
  }
  return generated;
}

function argsMap(values) {
  if (values.length % 2 !== 0)
    fail("CLI arguments must be exact name/value pairs");
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name.startsWith("--") || result.has(name)) {
      fail("CLI arguments contain an unknown shape or duplicate");
    }
    result.set(name, value);
  }
  return result;
}

function exactArgs(args, expected) {
  if (
    JSON.stringify([...args.keys()].sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    fail("CLI arguments are not the exact command contract");
  }
}

function requiredArg(args, name) {
  const value = args.get(name);
  if (value === undefined || value.length === 0) fail(`${name} is required`);
  return value;
}

function checkIdArg(args) {
  const raw = requiredArg(args, "--processor-check-id");
  if (!/^[1-9][0-9]{0,15}$/u.test(raw)) fail("processor check ID is invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail("processor check ID is invalid");
  return value;
}

function writeStructuredOutput(path, canonicalPlan) {
  if (
    !isAbsolute(path) ||
    canonicalPlan.includes("\nDEPENDABOT_SYNC_PLAN_EOF\n")
  ) {
    fail("GitHub output path or payload is invalid");
  }
  appendFileSync(
    path,
    `structured_output<<DEPENDABOT_SYNC_PLAN_EOF\n${canonicalPlan}\nDEPENDABOT_SYNC_PLAN_EOF\n`,
    { encoding: "utf8" },
  );
}

function commandGeneratePlan(args) {
  exactArgs(args, [
    "--evidence-manifest",
    "--github-output",
    "--packet-base64",
    "--processor-check-id",
  ]);
  const plan = generateProtectedRuntimeRepairPlan({
    evidenceManifestPath: requiredArg(args, "--evidence-manifest"),
    packetBase64: requiredArg(args, "--packet-base64"),
    processorCheckId: checkIdArg(args),
  });
  writeStructuredOutput(
    requiredArg(args, "--github-output"),
    canonicalJson(plan),
  );
}

function commandVerifyPlan(args) {
  exactArgs(args, [
    "--evidence-manifest",
    "--packet-base64",
    "--plan-json",
    "--processor-check-id",
  ]);
  const suppliedText = requiredArg(args, "--plan-json");
  const supplied = parseCanonicalJson(suppliedText, "supplied repair plan");
  const regenerated = generateProtectedRuntimeRepairPlan({
    evidenceManifestPath: requiredArg(args, "--evidence-manifest"),
    packetBase64: requiredArg(args, "--packet-base64"),
    processorCheckId: checkIdArg(args),
  });
  if (canonicalJson(regenerated) !== canonicalJson(supplied)) {
    fail("supplied repair plan is not the exact independent regeneration");
  }
}

function commandCandidateCliSmoke(args) {
  exactArgs(args, [
    "--evidence-manifest",
    "--packet-base64",
    "--processor-check-id",
    "--validated-plan-base64",
    "--validated-plan-digest",
  ]);
  const packetBase64 = requiredArg(args, "--packet-base64");
  const processorCheckId = checkIdArg(args);
  const { packet, packetDigest, validated } = decodeValidatedPlanBinding({
    packetBase64,
    processorCheckId,
    validatedPlanBase64: requiredArg(args, "--validated-plan-base64"),
    validatedPlanDigest: requiredArg(args, "--validated-plan-digest"),
  });
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "dependabot-protected-runtime-smoke-"),
  );
  try {
    const blobs = loadEvidence({
      evidenceManifestPath: requiredArg(args, "--evidence-manifest"),
      packet,
      packetDigest,
      processorCheckId,
    });
    validateCurrentInputs(blobs, packet.operation);
    const generated = applyValidatedPlanToEvidence({
      blobs,
      packet,
      temporaryRoot: join(temporaryRoot, "validated-plan"),
      validated,
    });
    const pnpmCommand = resolveExactPnpm(
      join(temporaryRoot, "pnpm-version-proof"),
    );
    const contract = assertGeneratedRuntimeContract({
      generated,
      verificationRoot: join(temporaryRoot, "contract-verification"),
    });
    if (nextCatalogOperation(packet.operation)) {
      inspectGeneratedNextLock(
        generated.get("pnpm-lock.yaml"),
        packet.operation,
      );
      inspectGeneratedNextRuntimeLock(
        generated.get("scripts/vercel-cli-runtime/pnpm-lock.yaml"),
        packet.operation,
      );
      verifyFrozenRootLock({
        blobs,
        command: pnpmCommand,
        environmentRoot: join(temporaryRoot, "frozen-verification", "root-env"),
        lockfileBytes: generated.get("pnpm-lock.yaml"),
        packageBytes: generated.get("package.json"),
        resolutionMode: packet.operation.resolutionMode,
        root: join(temporaryRoot, "frozen-verification", "root"),
        workspaceBytes: generated.get("pnpm-workspace.yaml"),
      });
    }
    verifyFrozenStandaloneRuntime({
      generated,
      pnpmCommand,
      targetVersion: nextCatalogOperation(packet.operation)
        ? contract.vercelVersion
        : packet.operation.targetVersion,
      verificationRoot: join(temporaryRoot, "frozen-verification", "runtime"),
    });
    if (nextCatalogOperation(packet.operation)) {
      verifySecretlessNextCandidateBuild({
        blobs,
        generated,
        operation: packet.operation,
        pnpmCommand,
        verificationRoot: join(temporaryRoot, "candidate-next-build"),
      });
    }
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = argsMap(rest);
  if (command === "generate-plan") return commandGeneratePlan(args);
  if (command === "verify-plan") return commandVerifyPlan(args);
  if (command === "candidate-cli-smoke") return commandCandidateCliSmoke(args);
  fail(`unknown command: ${command ?? ""}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
