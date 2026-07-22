#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  sharpRuntimePlatform,
  SHARP_RUNTIME_VERSION,
} from "./next-sharp-output-tracing.mjs";

const LIBVIPS_BINARY_PATTERN =
  /^libvips-cpp(?:\.[0-9.]+)?\.(?:dylib|so)(?:\.[0-9.]+)?$/;
const MAX_TRACE_FILES = 10_000;
const MAX_FILES_PER_TRACE = 100_000;

function traceFiles(buildDirectory) {
  const pending = [buildDirectory];
  const traces = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
        traces.push(path);
        if (traces.length > MAX_TRACE_FILES) {
          throw new Error("Next build emitted too many output trace files");
        }
      }
    }
  }
  return traces;
}

function readTrace(path) {
  let trace;
  try {
    trace = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Invalid Next output trace: ${path}`);
  }
  if (
    !Array.isArray(trace.files) ||
    trace.files.length > MAX_FILES_PER_TRACE ||
    trace.files.some((file) => typeof file !== "string")
  ) {
    throw new Error(`Invalid Next output trace file list: ${path}`);
  }
  return trace.files.map((file) => resolve(dirname(path), file));
}

function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function packageVersion(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).version;
  } catch {
    return undefined;
  }
}

function libvipsVersion(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8")).vips;
  } catch {
    return undefined;
  }
}

export function isSharpManifestPath(path) {
  return /(?:^|[\\/])node_modules[\\/]sharp[\\/]package\.json$/.test(path);
}

export function assertSharpOutputTrace(
  buildDirectory,
  { runtimePlatform = sharpRuntimePlatform() } = {},
) {
  const root = resolve(buildDirectory);
  if (!existsSync(root)) {
    throw new Error(`Next build output does not exist: ${root}`);
  }
  const traces = traceFiles(root);
  if (traces.length === 0) {
    throw new Error(`Next build emitted no output traces: ${root}`);
  }

  for (const tracePath of traces) {
    const files = readTrace(tracePath);
    const sharpManifest = files.find(
      (file) =>
        isSharpManifestPath(file) &&
        packageVersion(file) === SHARP_RUNTIME_VERSION,
    );
    if (!sharpManifest) continue;

    for (const nativeAddon of files) {
      if (
        basename(nativeAddon) !==
          `sharp-${runtimePlatform}-${SHARP_RUNTIME_VERSION}.node` ||
        !isRegularFile(nativeAddon)
      ) {
        continue;
      }

      // Windows sharp binaries statically include libvips. Darwin and Linux
      // load a separate shared library that must be present in the same trace.
      if (runtimePlatform.startsWith("win32-")) {
        return { nativeAddon, sharpManifest, tracePath };
      }

      const libvipsPackageSegment = `sharp-libvips-${runtimePlatform}`;
      const sharedLibrary = files.find(
        (file) =>
          file.includes(libvipsPackageSegment) &&
          LIBVIPS_BINARY_PATTERN.test(basename(file)) &&
          isRegularFile(file),
      );
      const versionsManifest = files.find(
        (file) =>
          file.includes(libvipsPackageSegment) &&
          basename(file) === "versions.json" &&
          libvipsVersion(file) === "8.18.3",
      );
      if (sharedLibrary && versionsManifest) {
        return {
          libvipsVersion: "8.18.3",
          nativeAddon,
          sharpManifest,
          sharedLibrary,
          tracePath,
          versionsManifest,
        };
      }
    }
  }

  throw new Error(
    `No single Next output trace contains sharp ${SHARP_RUNTIME_VERSION}'s ${runtimePlatform} native addon and its matching libvips 8.18.3 shared library`,
  );
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const result = assertSharpOutputTrace(process.argv[2] ?? ".next");
  process.stdout.write(
    `Verified sharp runtime trace: ${basename(result.nativeAddon)}${
      result.sharedLibrary ? ` + ${basename(result.sharedLibrary)}` : ""
    }\n`,
  );
}
