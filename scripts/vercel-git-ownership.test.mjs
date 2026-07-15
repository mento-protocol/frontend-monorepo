import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SCHEMA = "https://openapi.vercel.sh/vercel.json";

const ROLLBACK_CONFIGURATION = {
  $schema: SCHEMA,
  git: {
    deploymentEnabled: {
      "dependabot/**": false,
    },
  },
};

const CUTOVER_CONFIGURATION = {
  $schema: SCHEMA,
  git: {
    deploymentEnabled: {
      "**": false,
      main: true,
    },
  },
};

function configuration(app) {
  return JSON.parse(
    readFileSync(
      new URL(`../apps/${app}/vercel.json`, import.meta.url),
      "utf8",
    ),
  );
}

function assertExactOwnership(value, expected) {
  assert.deepEqual(value, expected);
  assert.deepEqual(Object.keys(value), ["$schema", "git"]);
  assert.deepEqual(Object.keys(value.git), ["deploymentEnabled"]);
}

test("Phase A preserves the exact rollback-safe native UI ownership", () => {
  assertExactOwnership(configuration("ui.mento.org"), ROLLBACK_CONFIGURATION);
});

test("cutover and rollback ownership fixtures are exact and mutually exclusive", () => {
  assert.notDeepEqual(CUTOVER_CONFIGURATION, ROLLBACK_CONFIGURATION);
  assertExactOwnership(
    structuredClone(CUTOVER_CONFIGURATION),
    CUTOVER_CONFIGURATION,
  );
  assertExactOwnership(
    structuredClone(ROLLBACK_CONFIGURATION),
    ROLLBACK_CONFIGURATION,
  );
  assert.equal(CUTOVER_CONFIGURATION.git.deploymentEnabled["**"], false);
  assert.equal(CUTOVER_CONFIGURATION.git.deploymentEnabled.main, true);
  assert.equal(
    ROLLBACK_CONFIGURATION.git.deploymentEnabled["dependabot/**"],
    false,
  );
});

test("Phase A and Phase B never change another application's Vercel Git ownership", () => {
  for (const app of [
    "app.mento.org",
    "governance.mento.org",
    "reserve.mento.org",
  ]) {
    assertExactOwnership(configuration(app), ROLLBACK_CONFIGURATION);
  }
});
