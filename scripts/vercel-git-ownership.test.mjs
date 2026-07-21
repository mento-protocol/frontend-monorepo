import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { parse } from "yaml";

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

const ACTIVE_CONTROLLER_MODE = "active";
const OBSERVE_ONLY_CONTROLLER_MODE = "observe-only";

const controller = parse(
  readFileSync(
    new URL(
      "../.github/workflows/vercel-preview-controller.yml",
      import.meta.url,
    ),
    "utf8",
  ),
);

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

function assertSinglePreviewOwner(value, controllerMode) {
  assert.ok(
    isDeepStrictEqual(value, CUTOVER_CONFIGURATION) ||
      isDeepStrictEqual(value, ROLLBACK_CONFIGURATION),
    "UI Vercel Git ownership must match a reviewed exact state",
  );
  assert.ok(
    [ACTIVE_CONTROLLER_MODE, OBSERVE_ONLY_CONTROLLER_MODE].includes(
      controllerMode,
    ),
    "Preview controller mode must match a reviewed exact state",
  );
  const githubActionsOwnsBranchPreviews =
    controllerMode === ACTIVE_CONTROLLER_MODE;
  const nativeVercelOwnsBranchPreviews = isDeepStrictEqual(
    value,
    ROLLBACK_CONFIGURATION,
  );
  assert.notEqual(
    githubActionsOwnsBranchPreviews,
    nativeVercelOwnsBranchPreviews,
    "Exactly one of GitHub Actions or native Vercel must own UI branch previews",
  );
}

test("repository has exactly one canonical UI branch-preview owner", () => {
  const uiConfiguration = configuration("ui.mento.org");
  assertSinglePreviewOwner(
    uiConfiguration,
    controller.env.VERCEL_PREVIEW_CONTROLLER_MODE,
  );
});

test("cutover and rollback pair controller and native ownership atomically", () => {
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
  assertSinglePreviewOwner(CUTOVER_CONFIGURATION, ACTIVE_CONTROLLER_MODE);
  assertSinglePreviewOwner(
    ROLLBACK_CONFIGURATION,
    OBSERVE_ONLY_CONTROLLER_MODE,
  );
  assert.throws(
    () =>
      assertSinglePreviewOwner(ROLLBACK_CONFIGURATION, ACTIVE_CONTROLLER_MODE),
    /Exactly one/,
  );
  assert.throws(
    () =>
      assertSinglePreviewOwner(
        CUTOVER_CONFIGURATION,
        OBSERVE_ONLY_CONTROLLER_MODE,
      ),
    /Exactly one/,
  );
  assert.throws(
    () => assertSinglePreviewOwner(CUTOVER_CONFIGURATION, "disabled"),
    /Preview controller mode must match a reviewed exact state/,
  );
});

test("Phase B does not change another application's Vercel Git ownership", () => {
  for (const app of [
    "app.mento.org",
    "governance.mento.org",
    "reserve.mento.org",
  ]) {
    assertExactOwnership(configuration(app), ROLLBACK_CONFIGURATION);
  }
});
