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
    observedMaxRouteGzipBytes: 1_602_714,
    maxRouteGzipBytes: 1_760_000,
  },
  {
    name: "governance.mento.org",
    appDirectory: "apps/governance.mento.org",
    observedMaxRouteGzipBytes: 1_198_702,
    maxRouteGzipBytes: 1_300_000,
  },
  {
    name: "reserve.mento.org",
    appDirectory: "apps/reserve.mento.org",
    observedMaxRouteGzipBytes: 687_703,
    maxRouteGzipBytes: 740_000,
  },
  {
    name: "ui.mento.org",
    appDirectory: "apps/ui.mento.org",
    observedMaxRouteGzipBytes: 486_905,
    maxRouteGzipBytes: 510_000,
  },
];

function parseRouteBundleStats(statsPath) {
  let rows;

  try {
    rows = JSON.parse(readFileSync(statsPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read ${statsPath}. Run a Turbopack production build before checking bundle budgets.`,
      { cause: error },
    );
  }

  if (!Array.isArray(rows)) {
    throw new Error(`${statsPath} does not contain a valid route stats array.`);
  }

  for (const [index, row] of rows.entries()) {
    if (
      row === null ||
      typeof row !== "object" ||
      typeof row.route !== "string" ||
      row.route.length === 0 ||
      typeof row.firstLoadUncompressedJsBytes !== "number" ||
      !Number.isFinite(row.firstLoadUncompressedJsBytes) ||
      row.firstLoadUncompressedJsBytes < 0 ||
      !Array.isArray(row.firstLoadChunkPaths) ||
      !row.firstLoadChunkPaths.every((path) => typeof path === "string")
    ) {
      throw new Error(
        `${statsPath} contains an invalid route at index ${index}.`,
      );
    }
  }

  return rows;
}

function resolveBuildAsset(appDirectory, buildDirectory, relativePath) {
  const assetPath = resolve(appDirectory, relativePath);
  const buildPrefix = `${resolve(buildDirectory)}${sep}`;

  if (!assetPath.startsWith(buildPrefix)) {
    throw new Error(
      `Bundle stats asset escapes the build directory: ${relativePath}`,
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
  const appDirectory = resolve(repoRoot, budget.appDirectory);
  const buildDirectory = resolve(appDirectory, ".next");
  const routeStats = parseRouteBundleStats(
    resolve(buildDirectory, "diagnostics", "route-bundle-stats.json"),
  );
  const gzipSizes = new Map();
  const routes = [];

  for (const { route, firstLoadChunkPaths: assets } of routeStats) {
    const javascriptAssets = [
      ...new Set(assets.filter((asset) => asset.endsWith(".js"))),
    ];
    if (javascriptAssets.length === 0) continue;

    const gzipBytes = javascriptAssets.reduce(
      (total, asset) =>
        total +
        gzipFileSize(
          resolveBuildAsset(appDirectory, buildDirectory, asset),
          gzipSizes,
        ),
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
