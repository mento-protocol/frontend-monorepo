#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  constants,
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
  parseCanonicalJson,
  rawDigest,
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
const MAX_PLAN_BYTES = 64 * 1024;

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
  const packet = parseCanonicalJson(packetText, "protected runtime packet");
  validateProcessorRepairPacket(packet);
  if (
    packet.schema !== PACKET_SCHEMA ||
    packet.operation?.schema !== OPERATION_SCHEMA ||
    packet.operation.kind !== "vercel-cli-runtime-sync" ||
    packet.operation.dependency !== "vercel" ||
    packet.operation.pnpmVersion !== EXACT_PNPM_VERSION ||
    JSON.stringify(packet.operation.requiredPaths) !==
      JSON.stringify(PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS) ||
    JSON.stringify(packet.operation.inputPaths) !==
      JSON.stringify(PROTECTED_RUNTIME_SYNC_INPUT_PATHS)
  ) {
    fail("packet operation is not the exact Vercel runtime sync contract");
  }
  const derivedUpdateType = deriveUpdateType(
    packet.operation.fromVersion,
    packet.operation.targetVersion,
  );
  if (
    derivedUpdateType === null ||
    derivedUpdateType !== packet.operation.updateType ||
    derivedUpdateType !== packet.updateType ||
    !HEX_SHA.test(packet.operation.sourceSeedHeadSha ?? "")
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
  if (
    rootPackage.packageManager !== `pnpm@${EXACT_PNPM_VERSION}` ||
    (rootPackage.devDependencies?.vercel !== operation.fromVersion &&
      rootPackage.devDependencies?.vercel !== operation.targetVersion)
  ) {
    fail("root Vercel version is neither the packet source nor target");
  }
  if (
    contract.vercelVersion !== operation.fromVersion ||
    runtimePackage.dependencies?.vercel !== operation.fromVersion ||
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
  if (
    !currentLockText.includes(
      `\n  vercel@${operation.fromVersion}:\n    resolution: {integrity: ${contract.registryIntegrity}}`,
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

export function fetchExactRegistryMetadata(targetVersion, temporaryRoot) {
  semverParts(targetVersion, "targetVersion");
  const url = `https://registry.npmjs.org/vercel/${targetVersion}`;
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

function runPnpmInstall({ command, root, ignoreWorkspace, environmentRoot }) {
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const args = [
    "install",
    "--lockfile-only",
    "--ignore-scripts",
    "--ignore-pnpmfile",
    "--registry=https://registry.npmjs.org/",
    "--store-dir",
    store,
  ];
  if (ignoreWorkspace) args.push("--ignore-workspace");
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
  root,
}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  materializeInputs(root, blobs);
  writeFileSync(join(root, "package.json"), packageBytes, { mode: 0o600 });
  writeFileSync(join(root, "pnpm-lock.yaml"), lockfileBytes, { mode: 0o600 });
  const store = join(environmentRoot, "store");
  mkdirSync(store, { recursive: true, mode: 0o700 });
  const result = spawnSync(
    command,
    [
      "install",
      "--frozen-lockfile",
      "--lockfile-only",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--registry=https://registry.npmjs.org/",
      "--store-dir",
      store,
    ],
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

function parseExactScalarMap(text, block, indent, label) {
  const headerEnd = text.indexOf("\n", block.start) + 1;
  const result = {};
  for (const line of text.slice(headerEnd, block.end).split("\n")) {
    if (line.length === 0) continue;
    const match = new RegExp(`^ {${indent}}([^:]+): (.+)$`, "u").exec(line);
    if (!match) fail(`${label} is not an exact scalar map`);
    const key = decodeYamlKey(match[1], label);
    if (Object.hasOwn(result, key)) fail(`${label} contains a duplicate key`);
    result[key] = match[2];
  }
  return canonicalStringMap(result, label);
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

function assertSameOutputs(first, second) {
  for (const path of PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS) {
    if (!first.get(path)?.equals(second.get(path))) {
      fail(`isolated regeneration is not byte-identical: ${path}`);
    }
  }
}

export function createUnifiedPatch({
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
      maxBuffer: MAX_PATCH_BYTES + 1,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (diff.status !== 1 || diff.signal !== null || diff.stderr !== "") {
    fail(`contextual diff failed for ${path}`);
  }
  const patch = diff.stdout;
  if (
    !patch.startsWith(`--- a/${path}\n+++ b/${path}\n`) ||
    Buffer.byteLength(patch) > MAX_PATCH_BYTES ||
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
  const edits = [];
  for (const path of PROTECTED_RUNTIME_SYNC_REQUIRED_PATHS) {
    const old = blobs.get(path);
    const next = generated.get(path);
    if (old.bytes.equals(next)) continue;
    edits.push({
      expectedBlobSha: old.expectedBlobSha,
      patch: createUnifiedPatch({
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
    summary: `Synchronize the protected Vercel CLI runtime from ${packet.operation.fromVersion} to ${packet.operation.targetVersion} with exact registry-derived builder peers and pnpm ${EXACT_PNPM_VERSION}.`,
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
  inspectArtifacts,
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
    const pnpmCommand = resolveExactPnpm(
      join(temporaryRoot, "pnpm-version-proof"),
    );
    const first = generateOnce({
      blobs,
      metadataContract,
      operation: packet.operation,
      pnpmCommand,
      runRoot: join(temporaryRoot, "generation-1"),
    });
    const second = generateOnce({
      blobs,
      metadataContract,
      operation: packet.operation,
      pnpmCommand,
      runRoot: join(temporaryRoot, "generation-2"),
    });
    assertSameOutputs(first, second);
    const plan = buildPlan({
      blobs,
      generated: first,
      packet,
      packetDigest,
      processorCheckId,
      temporaryRoot: join(temporaryRoot, "patches"),
    });
    if (inspectArtifacts !== undefined) {
      if (typeof inspectArtifacts !== "function") {
        fail("artifact inspection callback is invalid");
      }
      inspectArtifacts({
        generated: first,
        packet,
        packetDigest,
        plan,
        pnpmCommand,
        temporaryRoot,
      });
    }
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

export function assertValidatedPlanMatchesRegeneration({
  generated,
  packetBase64,
  processorCheckId,
  regeneratedPlan,
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
  const projectedPlan = {
    ...validated,
    edits: validated.edits.map((edit) => ({
      expectedBlobSha: edit.expectedBlobSha,
      patch: edit.patch,
      path: edit.path,
    })),
    schema: PLAN_SCHEMA,
  };
  if (canonicalJson(projectedPlan) !== canonicalJson(regeneratedPlan)) {
    fail("validated plan is not the exact terminal-smoke regeneration");
  }
  for (const edit of validated.edits) {
    const content = generated.get(edit.path);
    if (content === undefined || rawDigest(content) !== edit.contentDigest) {
      fail(`validated plan content digest changed before smoke: ${edit.path}`);
    }
  }
  return validated;
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
  generateProtectedRuntimeRepairPlan({
    evidenceManifestPath: requiredArg(args, "--evidence-manifest"),
    packetBase64: requiredArg(args, "--packet-base64"),
    processorCheckId: checkIdArg(args),
    inspectArtifacts: ({
      generated,
      packet,
      plan,
      pnpmCommand,
      temporaryRoot,
    }) => {
      assertValidatedPlanMatchesRegeneration({
        generated,
        packetBase64: requiredArg(args, "--packet-base64"),
        processorCheckId: checkIdArg(args),
        regeneratedPlan: plan,
        validatedPlanBase64: requiredArg(args, "--validated-plan-base64"),
        validatedPlanDigest: requiredArg(args, "--validated-plan-digest"),
      });
      verifyFrozenStandaloneRuntime({
        generated,
        pnpmCommand,
        targetVersion: packet.operation.targetVersion,
        verificationRoot: join(temporaryRoot, "frozen-verification"),
      });
    },
  });
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
