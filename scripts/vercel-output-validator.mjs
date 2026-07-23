import { Buffer } from "node:buffer";
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";

const MAX_PREBUILT_CONFIG_BYTES = 1_024 * 1_024;
const MAX_PREBUILT_FILE_BYTES = 250 * 1_024 * 1_024;
const MAX_PREBUILT_TOTAL_BYTES = 1_024 * 1_024 * 1_024;

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function numericIdentity(value, label) {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`${label} is invalid`);
  }
  return numeric;
}

export function isStrictDescendant(root, path) {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export function findPhysicalFunctionDirectory(outputDirectory, sourceParts) {
  for (let index = sourceParts.length - 2; index > 0; index -= 1) {
    if (!sourceParts[index].endsWith(".func")) continue;
    const functionDirectory = join(
      outputDirectory,
      ...sourceParts.slice(0, index + 1),
    );
    try {
      const functionEntry = lstatSync(functionDirectory);
      const configEntry = lstatSync(join(functionDirectory, ".vc-config.json"));
      if (
        !functionEntry.isSymbolicLink() &&
        functionEntry.isDirectory() &&
        !configEntry.isSymbolicLink() &&
        configEntry.isFile()
      ) {
        return functionDirectory;
      }
    } catch {
      // A route directory may itself end in .func without being a function.
    }
  }
  return undefined;
}

function assertContainedFunctionDependencyLink(
  physicalFunctionDirectory,
  path,
  lexicalTarget,
) {
  let canonicalFunctionDirectory;
  try {
    canonicalFunctionDirectory = realpathSync(physicalFunctionDirectory);
  } catch {
    throw new Error("Prebuilt function symbolic link target is invalid");
  }
  const lexicalTargetFromFunction = relative(
    physicalFunctionDirectory,
    lexicalTarget,
  );
  if (
    !isStrictDescendant(physicalFunctionDirectory, lexicalTarget) ||
    isStrictDescendant(lexicalTarget, path) ||
    isStrictDescendant(path, lexicalTarget)
  ) {
    throw new Error("Prebuilt function symbolic link escaped its scope");
  }
  const targetParts = lexicalTargetFromFunction.split(sep);
  let current = physicalFunctionDirectory;
  let targetEntry;
  for (const [index, part] of targetParts.entries()) {
    current = join(current, part);
    try {
      targetEntry = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw new Error("Prebuilt function symbolic link target is invalid");
    }
    const final = index === targetParts.length - 1;
    if (
      targetEntry.isSymbolicLink() ||
      (final
        ? !targetEntry.isDirectory() && !targetEntry.isFile()
        : !targetEntry.isDirectory())
    ) {
      throw new Error("Prebuilt function symbolic link escaped its scope");
    }
  }
  let canonicalTarget;
  try {
    canonicalTarget = realpathSync(lexicalTarget);
  } catch {
    throw new Error("Prebuilt function symbolic link target is invalid");
  }
  if (
    relative(canonicalFunctionDirectory, canonicalTarget) !==
    lexicalTargetFromFunction
  ) {
    throw new Error("Prebuilt function symbolic link escaped its scope");
  }
}

function assertSafeOutputSymlink(
  outputDirectory,
  canonicalOutputDirectory,
  path,
) {
  if (basename(path) === ".vc-config.json") {
    throw new Error("Prebuilt output contains a linked Vercel function config");
  }
  const target = readlinkSync(path);
  const functionsDirectory = join(outputDirectory, "functions");
  const sourceFromRoot = relative(outputDirectory, path);
  const sourceParts = sourceFromRoot.split(sep);
  const physicalFunctionDirectory = findPhysicalFunctionDirectory(
    outputDirectory,
    sourceParts,
  );
  if (
    target.length === 0 ||
    Buffer.byteLength(target, "utf8") > 4_096 ||
    hasControlCharacters(target) ||
    isAbsolute(target) ||
    !isStrictDescendant(outputDirectory, path) ||
    !sourceFromRoot.startsWith(`functions${sep}`) ||
    (!physicalFunctionDirectory && !sourceFromRoot.endsWith(".func"))
  ) {
    throw new Error("Prebuilt output contains an unsupported symbolic link");
  }
  const lexicalTarget = resolve(dirname(path), target);
  if (physicalFunctionDirectory) {
    assertContainedFunctionDependencyLink(
      physicalFunctionDirectory,
      path,
      lexicalTarget,
    );
    return;
  }
  const lexicalTargetFromRoot = relative(outputDirectory, lexicalTarget);
  if (
    !isStrictDescendant(functionsDirectory, lexicalTarget) ||
    !lexicalTargetFromRoot.endsWith(".func") ||
    isStrictDescendant(lexicalTarget, path)
  ) {
    throw new Error("Prebuilt output symbolic link target escaped its scope");
  }
  let canonicalTarget;
  let targetConfigEntry;
  let targetEntry;
  try {
    canonicalTarget = realpathSync(lexicalTarget);
    targetEntry = lstatSync(lexicalTarget);
    targetConfigEntry = lstatSync(join(lexicalTarget, ".vc-config.json"));
  } catch {
    throw new Error("Prebuilt output symbolic link target is invalid");
  }
  if (
    !targetEntry.isDirectory() ||
    targetConfigEntry.isSymbolicLink() ||
    !targetConfigEntry.isFile()
  ) {
    throw new Error(
      "Prebuilt output symbolic link target is not a function directory",
    );
  }
  if (
    relative(canonicalOutputDirectory, canonicalTarget) !==
    lexicalTargetFromRoot
  ) {
    throw new Error("Prebuilt output symbolic link target escaped its root");
  }
}

export function assertStandaloneVercelConfig(path, entry) {
  if (basename(path) !== ".vc-config.json") return;
  if (entry.size > MAX_PREBUILT_CONFIG_BYTES) {
    throw new Error("Prebuilt output contains an oversized function config");
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Prebuilt output contains an invalid function config");
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Prebuilt output contains an invalid function config");
  }
  if (!Object.hasOwn(config, "filePathMap")) return;
  const { filePathMap } = config;
  if (
    !filePathMap ||
    typeof filePathMap !== "object" ||
    Array.isArray(filePathMap) ||
    Object.keys(filePathMap).length > 0
  ) {
    throw new Error(
      "Prebuilt output contains external function file references",
    );
  }
}

export function assertSafeOutputTree(
  outputDirectory,
  { expectedUid = process.getuid?.(), expectedGid = process.getgid?.() } = {},
) {
  const uid = numericIdentity(expectedUid, "Expected output UID");
  const gid = numericIdentity(expectedGid, "Expected output GID");
  const canonicalOutputDirectory = realpathSync(outputDirectory);
  const pending = [outputDirectory];
  let entries = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const path = pending.pop();
    const entry = lstatSync(path);
    entries += 1;
    if (entries > 250_000) {
      throw new Error("Prebuilt output contains too many filesystem entries");
    }
    if (entry.uid !== uid || entry.gid !== gid) {
      throw new Error(
        "Prebuilt output contains an entry with unsafe ownership",
      );
    }
    const symbolicLink = entry.isSymbolicLink();
    if (
      basename(path) === ".vc-config.json" &&
      (symbolicLink || !entry.isFile())
    ) {
      throw new Error("Prebuilt output contains an invalid function config");
    }
    if (!entry.isDirectory()) {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
        throw new Error("Prebuilt output contains an invalid entry size");
      }
      totalBytes += entry.size;
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > MAX_PREBUILT_TOTAL_BYTES
      ) {
        throw new Error("Prebuilt output exceeds its total size limit");
      }
    }
    if (
      uid === process.getuid?.() &&
      !symbolicLink &&
      ((entry.mode & 0o022) !== 0 || (entry.mode & 0o7000) !== 0)
    ) {
      throw new Error("Runner-owned prebuilt output has unsafe permissions");
    }
    if (symbolicLink) {
      assertSafeOutputSymlink(outputDirectory, canonicalOutputDirectory, path);
      continue;
    }
    if (entry.isDirectory()) {
      for (const child of readdirSync(path)) pending.push(join(path, child));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("Prebuilt output contains a special filesystem node");
    }
    if (entry.size > MAX_PREBUILT_FILE_BYTES) {
      throw new Error("Prebuilt output contains an oversized file");
    }
    if (uid === process.getuid?.() && entry.nlink !== 1) {
      throw new Error("Prebuilt output contains a hard-linked file");
    }
    assertStandaloneVercelConfig(path, entry);
  }
  return outputDirectory;
}
