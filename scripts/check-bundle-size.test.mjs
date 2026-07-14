import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  mkdirSync(join(buildDirectory, "diagnostics"), { recursive: true });

  writeFileSync(join(chunksDirectory, "shared.js"), "shared".repeat(2_000));
  writeFileSync(join(chunksDirectory, "small.js"), "small".repeat(500));
  writeFileSync(
    join(chunksDirectory, "large.js"),
    Array.from({ length: 4_000 }, (_, index) => `${index};`).join(""),
  );
  writeFileSync(
    join(buildDirectory, "diagnostics/route-bundle-stats.json"),
    JSON.stringify([
      {
        route: "/small",
        firstLoadUncompressedJsBytes: 1,
        firstLoadChunkPaths: [
          ".next/static/chunks/shared.js",
          ".next/static/chunks/shared.js",
          ".next/static/chunks/small.js",
          ".next/static/chunks/styles.css",
        ],
      },
      {
        route: "/large",
        firstLoadUncompressedJsBytes: 1,
        firstLoadChunkPaths: [
          ".next/static/chunks/shared.js",
          ".next/static/chunks/large.js",
        ],
      },
      {
        route: "/api/route",
        firstLoadUncompressedJsBytes: 0,
        firstLoadChunkPaths: [],
      },
    ]),
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

test("requires Turbopack builds for every budgeted app", () => {
  for (const budget of BUNDLE_BUDGETS) {
    const packageJson = JSON.parse(
      readFileSync(
        new URL(`../${budget.appDirectory}/package.json`, import.meta.url),
        "utf8",
      ),
    );
    const buildScript = packageJson.scripts?.build;

    assert.equal(typeof buildScript, "string");
    assert.match(
      buildScript,
      /(?:^|\s)--turbopack(?:\s|$)/,
      `${budget.name} must use Turbopack so route bundle stats are generated`,
    );
  }
});

test("measures unique gzip-compressed JavaScript per production route", () => {
  const { repoRoot, budget } = fixture();
  const measurement = measureAppBundle(repoRoot, budget);

  assert.equal(measurement.largestRoute.route, "/large");
  assert.deepEqual(
    measurement.routes.map(({ route }) => route),
    ["/large", "/small"],
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

test("rejects route stats assets outside the Next build directory", () => {
  const { repoRoot, budget } = fixture();
  const statsPath = join(
    repoRoot,
    "apps/example/.next/diagnostics/route-bundle-stats.json",
  );
  writeFileSync(
    statsPath,
    JSON.stringify([
      {
        route: "/",
        firstLoadUncompressedJsBytes: 1,
        firstLoadChunkPaths: [".next/../outside.js"],
      },
    ]),
  );

  assert.throws(
    () => measureAppBundle(repoRoot, budget),
    /escapes the build directory/,
  );
});

test("explains that a production build is required when output is absent", () => {
  const { repoRoot, budget } = fixture();
  rmSync(
    join(repoRoot, "apps/example/.next/diagnostics/route-bundle-stats.json"),
  );

  assert.throws(
    () => measureAppBundle(repoRoot, budget),
    /Run a Turbopack production build before checking bundle budgets/,
  );
});

test("rejects malformed route bundle stats", () => {
  const { repoRoot, budget } = fixture();
  const statsPath = join(
    repoRoot,
    "apps/example/.next/diagnostics/route-bundle-stats.json",
  );

  writeFileSync(statsPath, JSON.stringify({ route: "/" }));
  assert.throws(
    () => measureAppBundle(repoRoot, budget),
    /does not contain a valid route stats array/,
  );

  writeFileSync(
    statsPath,
    JSON.stringify([
      {
        route: "/",
        firstLoadUncompressedJsBytes: "unknown",
        firstLoadChunkPaths: [],
      },
    ]),
  );
  assert.throws(
    () => measureAppBundle(repoRoot, budget),
    /contains an invalid route at index 0/,
  );
});
