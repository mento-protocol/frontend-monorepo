import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";
import {
  MAIN_OWNERSHIP_MODES,
  PREVIEW_OWNERSHIP_MODES,
  PREVIEW_TARGET_CONFIG,
  PREVIEW_TARGETS,
  vercelConfigurationForOwnership,
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

const mainDeployment = parse(
  readFileSync(
    new URL("../.github/workflows/vercel-main-deployment.yml", import.meta.url),
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

function ownershipConfiguration(
  targetConfiguration,
  previewOwnershipMode = targetConfiguration.ownershipMode,
  mainOwnershipMode = targetConfiguration.mainOwnershipMode,
) {
  return vercelConfigurationForOwnership({
    previewOwnershipMode,
    mainOwnershipMode,
    active: targetConfiguration.activeVercelConfiguration,
    mainShadow: targetConfiguration.mainShadowVercelConfiguration,
    previewShadow: targetConfiguration.previewShadowVercelConfiguration,
    native: targetConfiguration.nativeVercelConfiguration,
  });
}

function assertMainWorkflowOwnershipModes(workflowMode, targetConfigurations) {
  if (!["active", "shadow"].includes(workflowMode)) {
    throw new Error("Main workflow mode must match a reviewed exact state");
  }
  if (
    workflowMode === "shadow" &&
    targetConfigurations.some(
      ({ mainOwnershipMode }) =>
        mainOwnershipMode !== MAIN_OWNERSHIP_MODES.SHADOW,
    )
  ) {
    throw new Error("Shadow workflow requires every main owner to be native");
  }
}

test("repository pairs every target with its canonical exact ownership configuration", () => {
  assertControllerMode(controller.env.VERCEL_PREVIEW_CONTROLLER_MODE);
  for (const target of PREVIEW_TARGETS) {
    const targetConfiguration = PREVIEW_TARGET_CONFIG[target];
    const expected = ownershipConfiguration(targetConfiguration);
    assert.equal(targetConfiguration.trackedVercelConfiguration, expected);
    assertExactOwnership(configuration(target), expected);
  }
});

test("main workflow mode and both per-target Git owners change atomically", () => {
  const workflowMainOwnership = JSON.parse(
    mainDeployment.env.MAIN_OWNERSHIP_MODE_JSON,
  );
  const modeledMainOwnership = Object.fromEntries(
    PREVIEW_TARGETS.map((target) => [
      target,
      PREVIEW_TARGET_CONFIG[target].mainOwnershipMode,
    ]),
  );
  assert.deepEqual(Object.keys(workflowMainOwnership), PREVIEW_TARGETS);
  assert.deepEqual(workflowMainOwnership, modeledMainOwnership);
  assertMainWorkflowOwnershipModes(
    mainDeployment.env.VERCEL_MAIN_MODE,
    Object.values(PREVIEW_TARGET_CONFIG),
  );
  for (const target of PREVIEW_TARGETS) {
    const targetConfiguration = PREVIEW_TARGET_CONFIG[target];
    const expectedTrackedConfiguration =
      ownershipConfiguration(targetConfiguration);
    assert.equal(
      targetConfiguration.trackedVercelConfiguration,
      expectedTrackedConfiguration,
    );
    assertExactOwnership(configuration(target), expectedTrackedConfiguration);
  }
  assert.throws(
    () =>
      ownershipConfiguration(
        PREVIEW_TARGET_CONFIG.app,
        PREVIEW_OWNERSHIP_MODES.GITHUB,
        "active",
      ),
    /Preview and main ownership modes must match a reviewed exact state/,
  );
  assert.doesNotThrow(() =>
    assertMainWorkflowOwnershipModes("active", [
      {
        mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
      },
      {
        mainOwnershipMode: MAIN_OWNERSHIP_MODES.SHADOW,
      },
    ]),
  );
  assert.doesNotThrow(() =>
    assertMainWorkflowOwnershipModes("shadow", [
      {
        mainOwnershipMode: MAIN_OWNERSHIP_MODES.SHADOW,
      },
    ]),
  );
  assert.throws(
    () =>
      assertMainWorkflowOwnershipModes("shadow", [
        {
          mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
        },
      ]),
    /Shadow workflow requires every main owner to be native/,
  );
  assert.throws(
    () => assertMainWorkflowOwnershipModes("observe-only", []),
    /Main workflow mode must match a reviewed exact state/,
  );
});

test("every target exposes four distinct exact preview and main ownership states", () => {
  for (const target of PREVIEW_TARGETS) {
    const {
      activeVercelConfiguration,
      mainShadowVercelConfiguration,
      previewShadowVercelConfiguration,
      nativeVercelConfiguration,
    } = PREVIEW_TARGET_CONFIG[target];
    const exactStates = [
      activeVercelConfiguration,
      mainShadowVercelConfiguration,
      previewShadowVercelConfiguration,
      nativeVercelConfiguration,
    ];
    assert.equal(
      new Set(exactStates.map((state) => JSON.stringify(state))).size,
      exactStates.length,
    );
    for (const exactState of exactStates) {
      assertExactOwnership(structuredClone(exactState), exactState);
    }
    assert.equal(
      ownershipConfiguration(
        PREVIEW_TARGET_CONFIG[target],
        PREVIEW_OWNERSHIP_MODES.GITHUB,
        MAIN_OWNERSHIP_MODES.GITHUB,
      ),
      activeVercelConfiguration,
    );
    assert.equal(
      ownershipConfiguration(
        PREVIEW_TARGET_CONFIG[target],
        PREVIEW_OWNERSHIP_MODES.GITHUB,
        MAIN_OWNERSHIP_MODES.SHADOW,
      ),
      mainShadowVercelConfiguration,
    );
    assert.equal(
      ownershipConfiguration(
        PREVIEW_TARGET_CONFIG[target],
        PREVIEW_OWNERSHIP_MODES.SHADOW,
        MAIN_OWNERSHIP_MODES.GITHUB,
      ),
      previewShadowVercelConfiguration,
    );
    assert.equal(
      ownershipConfiguration(
        PREVIEW_TARGET_CONFIG[target],
        PREVIEW_OWNERSHIP_MODES.SHADOW,
        MAIN_OWNERSHIP_MODES.SHADOW,
      ),
      nativeVercelConfiguration,
    );
  }
  assert.throws(
    () => assertControllerMode("disabled"),
    /Preview controller mode must match a reviewed exact state/,
  );
});

test("active ownership disables every native branch except App v2", () => {
  assert.deepEqual(
    PREVIEW_TARGET_CONFIG.app.activeVercelConfiguration.git.deploymentEnabled,
    { "**": false, v2: true },
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.equal(
      PREVIEW_TARGET_CONFIG[target].activeVercelConfiguration.git
        .deploymentEnabled,
      false,
    );
  }
});

test("main-shadow rollback keeps previews GitHub-owned and main native", () => {
  assert.deepEqual(
    PREVIEW_TARGET_CONFIG.app.mainShadowVercelConfiguration.git
      .deploymentEnabled,
    { "**": false, main: true, v2: true },
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].mainShadowVercelConfiguration.git
        .deploymentEnabled,
      { "**": false, main: true },
    );
  }
});

test("preview-shadow rollback keeps native previews and GitHub-owned main independent", () => {
  assert.deepEqual(
    PREVIEW_TARGET_CONFIG.app.previewShadowVercelConfiguration.git
      .deploymentEnabled,
    { "dependabot/**": false, main: false, v2: true },
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].previewShadowVercelConfiguration.git
        .deploymentEnabled,
      { "dependabot/**": false, main: false },
    );
  }
});

test("full native rollback keeps the Dependabot exclusion and App v2", () => {
  assert.deepEqual(
    PREVIEW_TARGET_CONFIG.app.nativeVercelConfiguration.git.deploymentEnabled,
    { "dependabot/**": false, v2: true },
  );
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].nativeVercelConfiguration.git
        .deploymentEnabled,
      { "dependabot/**": false },
    );
  }
});

test("current rollout keeps every branch-preview target GitHub-only", () => {
  assert.deepEqual(
    PREVIEW_TARGETS.filter(
      (target) =>
        PREVIEW_TARGET_CONFIG[target].ownershipMode ===
        PREVIEW_OWNERSHIP_MODES.SHADOW,
    ),
    [],
  );
  assert.deepEqual(
    PREVIEW_TARGETS.filter(
      (target) =>
        PREVIEW_TARGET_CONFIG[target].ownershipMode ===
        PREVIEW_OWNERSHIP_MODES.GITHUB,
    ),
    PREVIEW_TARGETS,
  );
  assert.deepEqual(
    PREVIEW_TARGETS.filter(
      (target) =>
        PREVIEW_TARGET_CONFIG[target].mainOwnershipMode ===
        MAIN_OWNERSHIP_MODES.SHADOW,
    ),
    [],
  );
  assert.deepEqual(
    PREVIEW_TARGETS.filter(
      (target) =>
        PREVIEW_TARGET_CONFIG[target].mainOwnershipMode ===
        MAIN_OWNERSHIP_MODES.GITHUB,
    ),
    PREVIEW_TARGETS,
  );
  assert.equal(controller.env.VERCEL_PREVIEW_CONTROLLER_MODE, "active");
});
