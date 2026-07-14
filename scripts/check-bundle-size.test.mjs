import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  BUNDLE_BUDGETS,
  evaluateBundleBudget,
  measureAppBundle,
} from "./check-bundle-size.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "bundle-budget-"));
  temporaryDirectories.push(repoRoot);
  const buildDirectory = join(repoRoot, "apps/example/.next");
  const chunksDirectory = join(buildDirectory, "static/chunks");
  mkdirSync(chunksDirectory, { recursive: true });

  writeFileSync(join(chunksDirectory, "shared.js"), "shared".repeat(2_000));
  writeFileSync(join(chunksDirectory, "small.js"), "small".repeat(500));
  writeFileSync(
    join(chunksDirectory, "large.js"),
    Array.from({ length: 4_000 }, (_, index) => `${index};`).join(""),
  );
  writeFileSync(
    join(buildDirectory, "app-build-manifest.json"),
    JSON.stringify({
      pages: {
        "/small/page": [
          "static/chunks/shared.js",
          "static/chunks/shared.js",
          "static/chunks/small.js",
          "static/chunks/styles.css",
        ],
        "/large/page": ["static/chunks/shared.js", "static/chunks/large.js"],
        "/api/route": [],
      },
    }),
  );

  return {
    repoRoot,
    budget: {
      name: "example",
      appDirectory: "apps/example",
      observedMaxRouteGzipBytes: 1,
      maxRouteGzipBytes: Number.MAX_SAFE_INTEGER,
    },
  };
}

test("defines a bounded production-route budget for every Next app", () => {
  assert.deepEqual(
    BUNDLE_BUDGETS.map(({ name }) => name),
    [
      "app.mento.org",
      "governance.mento.org",
      "reserve.mento.org",
      "ui.mento.org",
    ],
  );

  for (const budget of BUNDLE_BUDGETS) {
    assert.ok(budget.maxRouteGzipBytes > budget.observedMaxRouteGzipBytes);
    assert.ok(
      budget.maxRouteGzipBytes <= budget.observedMaxRouteGzipBytes * 1.11,
      `${budget.name} must not carry more than 11% baseline headroom`,
    );
  }
});

test("measures unique gzip-compressed JavaScript per production route", () => {
  const { repoRoot, budget } = fixture();
  const measurement = measureAppBundle(repoRoot, budget);

  assert.equal(measurement.largestRoute.route, "/large/page");
  assert.deepEqual(
    measurement.routes.map(({ route }) => route),
    ["/large/page", "/small/page"],
  );
  assert.equal(measurement.routes[1].javascriptAssets.length, 2);
});

test("fails only when the largest route exceeds its configured budget", () => {
  const { repoRoot, budget } = fixture();
  const measurement = measureAppBundle(repoRoot, budget);

  assert.equal(
    evaluateBundleBudget({
      ...measurement,
      maxRouteGzipBytes: measurement.largestRoute.gzipBytes,
    }).ok,
    true,
  );

  const failure = evaluateBundleBudget({
    ...measurement,
    maxRouteGzipBytes: measurement.largestRoute.gzipBytes - 1,
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.overBudgetBytes, 1);
});

test("rejects manifest assets outside the Next build directory", () => {
  const { repoRoot, budget } = fixture();
  const manifestPath = join(
    repoRoot,
    "apps/example/.next/app-build-manifest.json",
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({ pages: { "/page": ["../../outside.js"] } }),
  );

  assert.throws(
    () => measureAppBundle(repoRoot, budget),
    /escapes the build directory/,
  );
});

test("explains that a production build is required when output is absent", () => {
  const { repoRoot, budget } = fixture();
  rmSync(join(repoRoot, "apps/example/.next/app-build-manifest.json"));

  assert.throws(
    () => measureAppBundle(repoRoot, budget),
    /Run a production build before checking bundle budgets/,
  );
});
