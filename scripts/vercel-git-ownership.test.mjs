import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";
import {
  MAIN_OWNERSHIP_MODES,
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

function mainOwnershipConfiguration(targetConfiguration) {
  if (targetConfiguration.mainOwnershipMode === MAIN_OWNERSHIP_MODES.GITHUB) {
    return targetConfiguration.activeVercelConfiguration;
  }
  if (targetConfiguration.mainOwnershipMode === MAIN_OWNERSHIP_MODES.SHADOW) {
    return targetConfiguration.mainShadowVercelConfiguration;
  }
  throw new Error("Main ownership mode must match a reviewed exact state");
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
    const expected =
      targetConfiguration.ownershipMode === PREVIEW_OWNERSHIP_MODES.GITHUB
        ? targetConfiguration.githubVercelConfiguration
        : targetConfiguration.nativeVercelConfiguration;
    assertExactOwnership(configuration(target), expected);
  }
});

test("main workflow mode and per-target Git ownership change atomically", () => {
  assertMainWorkflowOwnershipModes(
    mainDeployment.env.VERCEL_MAIN_MODE,
    Object.values(PREVIEW_TARGET_CONFIG),
  );
  for (const target of PREVIEW_TARGETS) {
    const targetConfiguration = PREVIEW_TARGET_CONFIG[target];
    const expectedGitHubConfiguration =
      mainOwnershipConfiguration(targetConfiguration);
    assert.equal(
      targetConfiguration.githubVercelConfiguration,
      expectedGitHubConfiguration,
    );
    const expectedTrackedConfiguration =
      targetConfiguration.ownershipMode === PREVIEW_OWNERSHIP_MODES.GITHUB
        ? expectedGitHubConfiguration
        : targetConfiguration.nativeVercelConfiguration;
    assertExactOwnership(configuration(target), expectedTrackedConfiguration);
  }
  assert.throws(
    () =>
      mainOwnershipConfiguration({
        ...PREVIEW_TARGET_CONFIG.app,
        mainOwnershipMode: "active",
      }),
    /Main ownership mode must match a reviewed exact state/,
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

test("every target exposes reviewed active, main-shadow, and native ownership states", () => {
  for (const target of PREVIEW_TARGETS) {
    const {
      activeVercelConfiguration,
      mainShadowVercelConfiguration,
      nativeVercelConfiguration,
    } = PREVIEW_TARGET_CONFIG[target];
    assert.notDeepEqual(
      activeVercelConfiguration,
      mainShadowVercelConfiguration,
    );
    assert.notDeepEqual(activeVercelConfiguration, nativeVercelConfiguration);
    assert.notDeepEqual(
      mainShadowVercelConfiguration,
      nativeVercelConfiguration,
    );
    assertExactOwnership(
      structuredClone(activeVercelConfiguration),
      activeVercelConfiguration,
    );
    assertExactOwnership(
      structuredClone(mainShadowVercelConfiguration),
      mainShadowVercelConfiguration,
    );
    assertExactOwnership(
      structuredClone(nativeVercelConfiguration),
      nativeVercelConfiguration,
    );
    if (target === "app") {
      assert.equal(
        activeVercelConfiguration.git.deploymentEnabled["**"],
        false,
      );
    } else {
      assert.equal(activeVercelConfiguration.git.deploymentEnabled, false);
    }
    assert.equal(
      mainShadowVercelConfiguration.git.deploymentEnabled["**"],
      false,
    );
    assert.equal(
      mainShadowVercelConfiguration.git.deploymentEnabled.main,
      true,
    );
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

test("full native rollback keeps only the Dependabot exclusion", () => {
  for (const target of PREVIEW_TARGETS) {
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
