import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";
import {
  PREVIEW_OWNERSHIP_MODES,
  PREVIEW_TARGET_CONFIG,
  PREVIEW_TARGETS,
} from "./vercel-preview-targets.mjs";

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

function configuration(target) {
  return JSON.parse(
    readFileSync(
      new URL(
        `../${PREVIEW_TARGET_CONFIG[target].vercelConfigurationPath}`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

function assertExactOwnership(value, expected) {
  assert.deepEqual(value, expected);
  assert.deepEqual(Object.keys(value), ["$schema", "git"]);
  assert.deepEqual(Object.keys(value.git), ["deploymentEnabled"]);
}

function assertControllerMode(controllerMode) {
  assert.ok(
    [ACTIVE_CONTROLLER_MODE, OBSERVE_ONLY_CONTROLLER_MODE].includes(
      controllerMode,
    ),
    "Preview controller mode must match a reviewed exact state",
  );
}

test("repository pairs every target with its canonical exact ownership configuration", () => {
  assertControllerMode(controller.env.VERCEL_PREVIEW_CONTROLLER_MODE);
  for (const target of PREVIEW_TARGETS) {
    const targetConfiguration = PREVIEW_TARGET_CONFIG[target];
    const expected =
      targetConfiguration.ownershipMode === PREVIEW_OWNERSHIP_MODES.GITHUB
        ? targetConfiguration.githubVercelConfiguration
        : targetConfiguration.nativeVercelConfiguration;
    assertExactOwnership(configuration(target), expected);
  }
});

test("every target exposes reviewed, distinct native and GitHub ownership states", () => {
  for (const target of PREVIEW_TARGETS) {
    const { githubVercelConfiguration, nativeVercelConfiguration } =
      PREVIEW_TARGET_CONFIG[target];
    assert.notDeepEqual(githubVercelConfiguration, nativeVercelConfiguration);
    assertExactOwnership(
      structuredClone(githubVercelConfiguration),
      githubVercelConfiguration,
    );
    assertExactOwnership(
      structuredClone(nativeVercelConfiguration),
      nativeVercelConfiguration,
    );
    assert.equal(githubVercelConfiguration.git.deploymentEnabled["**"], false);
    assert.equal(githubVercelConfiguration.git.deploymentEnabled.main, true);
    assert.equal(
      nativeVercelConfiguration.git.deploymentEnabled["dependabot/**"],
      false,
    );
  }
  assert.throws(
    () => assertControllerMode("disabled"),
    /Preview controller mode must match a reviewed exact state/,
  );
});

test("ownership configurations keep only their reviewed branch exceptions", () => {
  assert.deepEqual(
    PREVIEW_TARGET_CONFIG.app.githubVercelConfiguration.git.deploymentEnabled,
    { "**": false, main: true, v2: true },
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].githubVercelConfiguration.git
        .deploymentEnabled,
      { "**": false, main: true },
    );
  }
  for (const target of PREVIEW_TARGETS) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].nativeVercelConfiguration.git
        .deploymentEnabled,
      { "dependabot/**": false },
    );
  }
});

test("initial rollout shadows three native owners while UI remains GitHub-only", () => {
  assert.deepEqual(
    PREVIEW_TARGETS.filter(
      (target) =>
        PREVIEW_TARGET_CONFIG[target].ownershipMode ===
        PREVIEW_OWNERSHIP_MODES.SHADOW,
    ),
    ["app", "governance", "reserve"],
  );
  assert.equal(
    PREVIEW_TARGET_CONFIG.ui.ownershipMode,
    PREVIEW_OWNERSHIP_MODES.GITHUB,
  );
  assert.equal(controller.env.VERCEL_PREVIEW_CONTROLLER_MODE, "active");
});
