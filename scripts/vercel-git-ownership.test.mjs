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

// Active permits a mixed map for target-local rollback. The main planner
// partitions GitHub-owned targets for mutation and native-owned targets for
// shadow preparation; shadow mode requires every target to remain native-owned.
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

test("main ownership stays paired with config; active permits target-local rollback", () => {
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

test("active ownership disables every native branch for every target", () => {
  for (const target of PREVIEW_TARGETS) {
    assert.equal(
      PREVIEW_TARGET_CONFIG[target].activeVercelConfiguration.git
        .deploymentEnabled,
      false,
    );
  }
  assert.equal(
    PREVIEW_TARGET_CONFIG.app.activeVercelConfiguration,
    PREVIEW_TARGET_CONFIG.governance.activeVercelConfiguration,
  );
});

test("main-shadow rollback keeps previews GitHub-owned and main native", () => {
  for (const target of PREVIEW_TARGETS) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].mainShadowVercelConfiguration.git
        .deploymentEnabled,
      { "**": false, main: true },
    );
  }
  assert.equal(
    PREVIEW_TARGET_CONFIG.app.mainShadowVercelConfiguration,
    PREVIEW_TARGET_CONFIG.governance.mainShadowVercelConfiguration,
  );
});

test("preview-shadow rollback keeps native previews and GitHub-owned main independent", () => {
  for (const target of PREVIEW_TARGETS) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].previewShadowVercelConfiguration.git
        .deploymentEnabled,
      { "dependabot/**": false, main: false },
    );
  }
  assert.equal(
    PREVIEW_TARGET_CONFIG.app.previewShadowVercelConfiguration,
    PREVIEW_TARGET_CONFIG.governance.previewShadowVercelConfiguration,
  );
});

test("full native rollback keeps only the Dependabot exclusion", () => {
  for (const target of PREVIEW_TARGETS) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].nativeVercelConfiguration.git
        .deploymentEnabled,
      { "dependabot/**": false },
    );
  }
  assert.equal(
    PREVIEW_TARGET_CONFIG.app.nativeVercelConfiguration,
    PREVIEW_TARGET_CONFIG.governance.nativeVercelConfiguration,
  );
});

// The retired legacy App deployment was the only reviewed state that ever
// enabled a native Git branch build. No ownership state may re-admit one.
test("no reviewed ownership state re-enables the retired legacy branch", () => {
  for (const target of PREVIEW_TARGETS) {
    const targetConfiguration = PREVIEW_TARGET_CONFIG[target];
    for (const exactState of [
      targetConfiguration.activeVercelConfiguration,
      targetConfiguration.mainShadowVercelConfiguration,
      targetConfiguration.previewShadowVercelConfiguration,
      targetConfiguration.nativeVercelConfiguration,
      targetConfiguration.trackedVercelConfiguration,
    ]) {
      const { deploymentEnabled } = exactState.git;
      if (deploymentEnabled === false) {
        continue;
      }
      assert.ok(
        !Object.hasOwn(deploymentEnabled, "v2"),
        `${target} must not re-enable the retired legacy branch`,
      );
      assert.deepEqual(
        Object.keys(deploymentEnabled).filter((branch) => branch !== "main"),
        Object.keys(deploymentEnabled).filter(
          (branch) => branch !== "main" && deploymentEnabled[branch] === false,
        ),
        `${target} must not enable any branch other than main`,
      );
    }
    assert.equal(
      JSON.stringify(configuration(target)).includes('"v2"'),
      false,
      `${target} vercel.json must not re-enable the retired legacy branch`,
    );
  }
});

test("every target configuration exposes the exact reviewed field set", () => {
  for (const target of PREVIEW_TARGETS) {
    assert.deepEqual(Object.keys(PREVIEW_TARGET_CONFIG[target]), [
      "logicalTarget",
      "workspacePackage",
      "expectedRootDirectory",
      "projectVariable",
      "ownershipMode",
      "mainOwnershipMode",
      "vercelConfigurationPath",
      "activeVercelConfiguration",
      "mainShadowVercelConfiguration",
      "previewShadowVercelConfiguration",
      "nativeVercelConfiguration",
      "transitionalGithubVercelConfigurations",
      "trackedVercelConfiguration",
    ]);
    assert.ok(Object.isFrozen(PREVIEW_TARGET_CONFIG[target]));
  }
});

// Transitional entries let the default-branch controller recognize a shape a
// PR is about to adopt. They must stay deliberate: only App carries one, for
// the MGP-18 v2 retirement, and it is removed once that migration completes.
test("only App carries a bounded transitional GitHub-owned configuration", () => {
  const transitional =
    PREVIEW_TARGET_CONFIG.app.transitionalGithubVercelConfigurations;
  assert.ok(Object.isFrozen(transitional));
  assert.equal(transitional.length, 1);
  assertExactOwnership(structuredClone(transitional[0]), transitional[0]);
  // The entry is the retired pre-MGP-18 active shape, kept recognition-only
  // so open pull requests branched before the retirement stay classified as
  // GitHub-owned until their heads refresh. It is the single place the
  // retired `v2` branch key may still appear.
  assert.deepEqual(transitional[0], {
    $schema: "https://openapi.vercel.sh/vercel.json",
    git: { deploymentEnabled: { "**": false, v2: true } },
  });
  // The transitional shape must not collide with any of App's four exact
  // states, or the recognizer would classify one candidate two ways.
  for (const exactState of [
    PREVIEW_TARGET_CONFIG.app.activeVercelConfiguration,
    PREVIEW_TARGET_CONFIG.app.mainShadowVercelConfiguration,
    PREVIEW_TARGET_CONFIG.app.previewShadowVercelConfiguration,
    PREVIEW_TARGET_CONFIG.app.nativeVercelConfiguration,
  ]) {
    assert.notDeepEqual(transitional[0], exactState);
  }
  // The tracked file is the generic active shape, never the retired one.
  assert.notDeepEqual(configuration("app"), transitional[0]);
  for (const target of ["governance", "reserve", "ui"]) {
    assert.deepEqual(
      PREVIEW_TARGET_CONFIG[target].transitionalGithubVercelConfigurations,
      [],
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
