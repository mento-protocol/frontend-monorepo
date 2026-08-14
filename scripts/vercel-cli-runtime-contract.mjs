import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const CONTRACT_SCHEMA = "vercel-cli-runtime-contract:v1";
const CONTRACT_KEYS = Object.freeze([
  "lockfileSha256",
  "manifestSha256",
  "overridesSha256",
  "registryIntegrity",
  "runtimeDependenciesSha256",
  "schema",
  "vercelVersion",
]);
const DEFAULT_CONTRACT_PATH = new URL(
  "./vercel-cli-runtime/contract.json",
  import.meta.url,
);
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const STABLE_SEMVER =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const REGISTRY_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const MAX_CONTRACT_BYTES = 64 * 1024;
const MAX_ROOT_MANIFEST_BYTES = 1024 * 1024;
const MAX_RUNTIME_MANIFEST_BYTES = 256 * 1024;
const MAX_RUNTIME_LOCKFILE_BYTES = 8 * 1024 * 1024;

function hasExactObjectKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys
      .toSorted()
      .every((expectedKey, index) => actualKeys[index] === expectedKey)
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalStringMapSha256(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([name, entry]) =>
        typeof name !== "string" ||
        name.length === 0 ||
        typeof entry !== "string" ||
        entry.length === 0,
    )
  ) {
    throw new Error(`${label} is invalid`);
  }
  const canonical = Object.fromEntries(
    Object.entries(value).toSorted(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return sha256(JSON.stringify(canonical));
}

function filesystemPath(value) {
  return value instanceof URL ? fileURLToPath(value) : value;
}

function readBoundedRegularFile(filePath, { label, maximumBytes, rootPath }) {
  try {
    const resolvedPath = resolve(filesystemPath(filePath));
    const entry = lstatSync(resolvedPath);
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.size < 1 ||
      entry.size > maximumBytes
    ) {
      throw new Error("unsafe file");
    }
    if (rootPath !== undefined) {
      const requestedRoot = resolve(filesystemPath(rootPath));
      const rootEntry = lstatSync(requestedRoot);
      if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
        throw new Error("unsafe root");
      }
      const requestedRelative = relative(requestedRoot, resolvedPath);
      if (
        requestedRelative === ".." ||
        requestedRelative.startsWith(`..${sep}`) ||
        requestedRelative.length === 0
      ) {
        throw new Error("escaped root");
      }
      const resolvedRoot = realpathSync(requestedRoot);
      const canonicalPath = realpathSync(resolvedPath);
      const fromRoot = relative(resolvedRoot, canonicalPath);
      if (
        canonicalPath !== resolve(resolvedRoot, requestedRelative) ||
        fromRoot === ".." ||
        fromRoot.startsWith(`..${sep}`) ||
        fromRoot.length === 0
      ) {
        throw new Error("escaped root");
      }
    }
    const contents = readFileSync(resolvedPath);
    if (contents.byteLength !== entry.size) throw new Error("file changed");
    return contents;
  } catch {
    throw new Error(`${label} is unreadable or unsafe`);
  }
}

function readContract(contractPath = DEFAULT_CONTRACT_PATH, rootPath) {
  let contract;
  try {
    contract = JSON.parse(
      readBoundedRegularFile(contractPath, {
        label: "Trusted Vercel CLI runtime contract",
        maximumBytes: MAX_CONTRACT_BYTES,
        rootPath,
      }).toString("utf8"),
    );
  } catch {
    throw new Error("Trusted Vercel CLI runtime contract is unreadable");
  }
  if (
    !hasExactObjectKeys(contract, CONTRACT_KEYS) ||
    contract.schema !== CONTRACT_SCHEMA ||
    !STABLE_SEMVER.test(contract.vercelVersion ?? "") ||
    !HEX_DIGEST.test(contract.manifestSha256 ?? "") ||
    !HEX_DIGEST.test(contract.runtimeDependenciesSha256 ?? "") ||
    !HEX_DIGEST.test(contract.lockfileSha256 ?? "") ||
    !HEX_DIGEST.test(contract.overridesSha256 ?? "") ||
    !REGISTRY_INTEGRITY.test(contract.registryIntegrity ?? "")
  ) {
    throw new Error("Trusted Vercel CLI runtime contract is invalid");
  }
  return Object.freeze(contract);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function yamlDependencyKey(name) {
  return name.startsWith("@") ? `'${name}'` : name;
}

function yamlResolutionKey(name, resolution) {
  const value = `${name}@${resolution}`;
  return name.startsWith("@") ? `'${value}'` : value;
}

function exactIndentedBlock(text, header, label) {
  const needle = `${header}\n`;
  const starts = [];
  let cursor = 0;
  while (cursor < text.length) {
    const offset = text.indexOf(needle, cursor);
    if (offset === -1) break;
    if (offset === 0 || text[offset - 1] === "\n") starts.push(offset);
    cursor = offset + needle.length;
  }
  if (starts.length !== 1) throw new Error(`${label} is missing or ambiguous`);
  const indent = /^ */u.exec(header)[0].length;
  const start = starts[0];
  let end = text.length;
  cursor = start + needle.length;
  while (cursor < text.length) {
    const lineEnd = text.indexOf("\n", cursor);
    if (lineEnd === -1) break;
    const line = text.slice(cursor, lineEnd);
    if (line.length > 0 && /^ */u.exec(line)[0].length <= indent) {
      end = cursor;
      break;
    }
    cursor = lineEnd + 1;
  }
  return text.slice(start, end);
}

function assertExactSnapshot(text, header, label) {
  const inline = `${header} {}`;
  const inlineMatches = text
    .split("\n")
    .filter((line) => line === inline).length;
  if (inlineMatches === 1 && !text.includes(`${header}\n`)) return;
  if (inlineMatches !== 0) throw new Error(`${label} is missing or ambiguous`);
  exactIndentedBlock(text, header, label);
}

function assertExactRuntimeDependencyLock(lockfileText, dependencies) {
  const importersStart = lockfileText.indexOf("\nimporters:\n");
  const packagesStart = lockfileText.indexOf("\npackages:\n");
  const snapshotsStart = lockfileText.indexOf("\nsnapshots:\n");
  if (
    importersStart < 0 ||
    packagesStart <= importersStart ||
    snapshotsStart <= packagesStart ||
    lockfileText.indexOf("\nimporters:\n", importersStart + 1) !== -1 ||
    lockfileText.indexOf("\npackages:\n", packagesStart + 1) !== -1 ||
    lockfileText.indexOf("\nsnapshots:\n", snapshotsStart + 1) !== -1
  ) {
    throw new Error("Trusted Vercel CLI runtime lockfile sections are invalid");
  }
  const importerText = lockfileText.slice(importersStart, packagesStart);
  const packagesText = lockfileText.slice(packagesStart, snapshotsStart);
  const snapshotsText = lockfileText.slice(snapshotsStart);
  const importerNames = [
    ...importerText.matchAll(/^ {6}('[^']+'|[A-Za-z0-9@/_.-]+):$/gmu),
  ].map((match) =>
    match[1].startsWith("'") ? match[1].slice(1, -1) : match[1],
  );
  if (
    new Set(importerNames).size !== importerNames.length ||
    !isDeepStrictEqual(
      importerNames.toSorted(),
      Object.keys(dependencies).toSorted(),
    )
  ) {
    throw new Error(
      "Trusted Vercel CLI runtime lockfile importer dependencies are not exact",
    );
  }
  for (const [name, version] of Object.entries(dependencies)) {
    if (!STABLE_SEMVER.test(version)) {
      throw new Error(
        "Trusted Vercel CLI runtime dependency is not exact semver",
      );
    }
    const importerKey = escapeRegex(yamlDependencyKey(name));
    const escapedVersion = escapeRegex(version);
    const matches = [
      ...importerText.matchAll(
        new RegExp(
          `^      ${importerKey}:\\n        specifier: ${escapedVersion}\\n        version: (${escapedVersion}(?:\\([^\\n]+\\))?)$`,
          "gmu",
        ),
      ),
    ];
    if (matches.length !== 1) {
      throw new Error(
        `Trusted Vercel CLI runtime lockfile importer is stale: ${name}`,
      );
    }
    const resolution = matches[0][1];
    const packageBlock = exactIndentedBlock(
      packagesText,
      `  ${yamlResolutionKey(name, version)}:`,
      `Trusted Vercel CLI runtime package ${name}`,
    );
    if (
      !/^ {4}resolution: \{integrity: sha512-[A-Za-z0-9+/]{86}==\}$/mu.test(
        packageBlock,
      )
    ) {
      throw new Error(
        `Trusted Vercel CLI runtime package resolution is invalid: ${name}`,
      );
    }
    assertExactSnapshot(
      snapshotsText,
      `  ${yamlResolutionKey(name, resolution)}:`,
      `Trusted Vercel CLI runtime snapshot ${name}`,
    );
  }
}

const ACTIVE_CONTRACT = readContract();

export const PINNED_VERCEL_CLI_VERSION = ACTIVE_CONTRACT.vercelVersion;

export function assertVercelCliRuntimeContract({
  rootPackageJsonPath,
  packageJsonPath,
  lockfilePath,
  contractPath = DEFAULT_CONTRACT_PATH,
  runtimeRootPath,
}) {
  const repositoryRoot = dirname(resolve(filesystemPath(rootPackageJsonPath)));
  const runtimeFilesRoot = runtimeRootPath ?? repositoryRoot;
  const contract = readContract(
    contractPath,
    contractPath === DEFAULT_CONTRACT_PATH ? undefined : runtimeFilesRoot,
  );
  const rootPackageMetadata = JSON.parse(
    readBoundedRegularFile(rootPackageJsonPath, {
      label: "Trusted root package manifest",
      maximumBytes: MAX_ROOT_MANIFEST_BYTES,
      rootPath: repositoryRoot,
    }).toString("utf8"),
  );
  const packageContents = readBoundedRegularFile(packageJsonPath, {
    label: "Trusted Vercel CLI runtime manifest",
    maximumBytes: MAX_RUNTIME_MANIFEST_BYTES,
    rootPath: runtimeFilesRoot,
  });
  const packageMetadata = JSON.parse(packageContents.toString("utf8"));
  const lockfileContents = readBoundedRegularFile(lockfilePath, {
    label: "Trusted Vercel CLI runtime lockfile",
    maximumBytes: MAX_RUNTIME_LOCKFILE_BYTES,
    rootPath: runtimeFilesRoot,
  });
  const rootPnpm = rootPackageMetadata.pnpm;
  const rootOverrides = rootPnpm?.overrides;
  if (rootPackageMetadata.devDependencies?.vercel !== contract.vercelVersion) {
    throw new Error("Trusted root Vercel CLI contract is invalid");
  }
  let rootOverridesSha256;
  try {
    rootOverridesSha256 = canonicalStringMapSha256(
      rootOverrides,
      "Trusted root Vercel CLI overrides",
    );
  } catch {
    throw new Error("Trusted root Vercel CLI contract is invalid");
  }
  const lockfileDigest = sha256(lockfileContents);
  if (lockfileDigest !== contract.lockfileSha256) {
    throw new Error("Trusted Vercel CLI runtime lockfile is not exact");
  }
  if (sha256(packageContents) !== contract.manifestSha256) {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }
  if (
    !hasExactObjectKeys(packageMetadata, [
      "dependencies",
      "description",
      "name",
      "pnpm",
      "private",
      "version",
    ]) ||
    packageMetadata.name !== "@mento-protocol/vercel-cli-runtime" ||
    packageMetadata.version !== "0.0.0" ||
    packageMetadata.private !== true ||
    packageMetadata.description !==
      "Standalone pinned Vercel CLI runtime for protected GitHub Actions deployments" ||
    !hasExactObjectKeys(packageMetadata.pnpm, ["overrides"]) ||
    !isDeepStrictEqual(packageMetadata.pnpm.overrides, rootOverrides) ||
    packageMetadata.pnpm.patchedDependencies !== undefined ||
    rootPnpm.patchedDependencies !== undefined ||
    packageMetadata.dependencies?.vercel !== contract.vercelVersion
  ) {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }
  let runtimeDependenciesSha256;
  try {
    runtimeDependenciesSha256 = canonicalStringMapSha256(
      packageMetadata.dependencies,
      "Trusted Vercel CLI runtime dependencies",
    );
  } catch {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }
  if (runtimeDependenciesSha256 !== contract.runtimeDependenciesSha256) {
    throw new Error("Trusted Vercel CLI runtime manifest is not exact");
  }
  if (rootOverridesSha256 !== contract.overridesSha256) {
    throw new Error(
      "Trusted Vercel CLI runtime lockfile and overrides are not an approved pair",
    );
  }
  const lockfileText = lockfileContents.toString("utf8");
  const escapedVersion = contract.vercelVersion.replaceAll(".", "\\.");
  const escapedIntegrity = contract.registryIntegrity.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  assertExactRuntimeDependencyLock(lockfileText, packageMetadata.dependencies);
  if (
    !lockfileText.startsWith("lockfileVersion: '9.0'\n") ||
    !new RegExp(
      `\\n      vercel:\\n        specifier: ${escapedVersion}\\n        version: ${escapedVersion}(?:\\(|\\n)`,
      "u",
    ).test(lockfileText) ||
    !new RegExp(
      `\\n  vercel@${escapedVersion}:\\n    resolution: \\{integrity: ${escapedIntegrity}\\}`,
      "u",
    ).test(lockfileText) ||
    /(?:specifier|version):\s*(?:workspace:|link:|file:|git\+|github:)|\btarball:|\brepo:|\btype:\s*git\b/u.test(
      lockfileText,
    )
  ) {
    throw new Error("Trusted Vercel CLI runtime lockfile structure is invalid");
  }

  return {
    lockfileSha256: lockfileDigest,
    vercel: contract.vercelVersion,
  };
}
