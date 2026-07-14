#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const BUNDLE_BUDGETS = [
  {
    name: "app.mento.org",
    appDirectory: "apps/app.mento.org",
    observedMaxRouteGzipBytes: 1_600_000,
    maxRouteGzipBytes: 1_760_000,
  },
  {
    name: "governance.mento.org",
    appDirectory: "apps/governance.mento.org",
    observedMaxRouteGzipBytes: 1_180_000,
    maxRouteGzipBytes: 1_300_000,
  },
  {
    name: "reserve.mento.org",
    appDirectory: "apps/reserve.mento.org",
    observedMaxRouteGzipBytes: 670_000,
    maxRouteGzipBytes: 740_000,
  },
  {
    name: "ui.mento.org",
    appDirectory: "apps/ui.mento.org",
    observedMaxRouteGzipBytes: 461_000,
    maxRouteGzipBytes: 510_000,
  },
];

function parseManifest(manifestPath) {
  let manifest;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read ${manifestPath}. Run a production build before checking bundle budgets.`,
      { cause: error },
    );
  }

  if (
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.pages === null ||
    typeof manifest.pages !== "object" ||
    Array.isArray(manifest.pages)
  ) {
    throw new Error(`${manifestPath} does not contain a valid pages manifest.`);
  }

  return manifest.pages;
}

function resolveBuildAsset(buildDirectory, relativePath) {
  const assetPath = resolve(buildDirectory, relativePath);
  const buildPrefix = `${resolve(buildDirectory)}${sep}`;

  if (!assetPath.startsWith(buildPrefix)) {
    throw new Error(
      `Bundle manifest asset escapes the build directory: ${relativePath}`,
    );
  }

  return assetPath;
}

function gzipFileSize(path, cache) {
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  statSync(path);
  const size = gzipSync(readFileSync(path), { level: 9 }).length;
  cache.set(path, size);
  return size;
}

export function measureAppBundle(repoRoot, budget) {
  const buildDirectory = resolve(repoRoot, budget.appDirectory, ".next");
  const pages = parseManifest(
    resolve(buildDirectory, "app-build-manifest.json"),
  );
  const gzipSizes = new Map();
  const routes = [];

  for (const [route, assets] of Object.entries(pages)) {
    if (!Array.isArray(assets)) {
      throw new Error(
        `Bundle manifest route ${route} does not contain an asset list.`,
      );
    }

    const javascriptAssets = [
      ...new Set(assets.filter((asset) => asset.endsWith(".js"))),
    ];
    if (javascriptAssets.length === 0) continue;

    const gzipBytes = javascriptAssets.reduce(
      (total, asset) =>
        total +
        gzipFileSize(resolveBuildAsset(buildDirectory, asset), gzipSizes),
      0,
    );
    routes.push({ route, gzipBytes, javascriptAssets });
  }

  if (routes.length === 0) {
    throw new Error(
      `${budget.name} has no client JavaScript routes to measure.`,
    );
  }

  routes.sort(
    (left, right) =>
      right.gzipBytes - left.gzipBytes || left.route.localeCompare(right.route),
  );

  return {
    ...budget,
    routes,
    largestRoute: routes[0],
  };
}

export function evaluateBundleBudget(measurement) {
  const overBudgetBytes =
    measurement.largestRoute.gzipBytes - measurement.maxRouteGzipBytes;

  return {
    ok: overBudgetBytes <= 0,
    overBudgetBytes: Math.max(0, overBudgetBytes),
    measurement,
  };
}

export function formatBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export function checkBundleBudgets(repoRoot, budgets = BUNDLE_BUDGETS) {
  return budgets.map((budget) =>
    evaluateBundleBudget(measureAppBundle(repoRoot, budget)),
  );
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));

  try {
    const results = checkBundleBudgets(repoRoot);
    let failed = false;

    for (const result of results) {
      const { measurement } = result;
      const summary =
        `${measurement.name}: ${measurement.largestRoute.route} is ` +
        `${formatBytes(measurement.largestRoute.gzipBytes)} gzip ` +
        `(budget ${formatBytes(measurement.maxRouteGzipBytes)}, ` +
        `measured baseline ~${formatBytes(measurement.observedMaxRouteGzipBytes)})`;

      if (result.ok) {
        console.log(`PASS ${summary}`);
      } else {
        failed = true;
        console.error(
          `FAIL ${summary}; over by ${formatBytes(result.overBudgetBytes)}`,
        );
      }
    }

    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
