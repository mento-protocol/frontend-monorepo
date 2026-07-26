export const PREVIEW_OWNERSHIP_MODES = Object.freeze({
  GITHUB: "github",
  SHADOW: "shadow",
});

export const MAIN_OWNERSHIP_MODES = Object.freeze({
  GITHUB: "github",
  SHADOW: "shadow",
});

const NATIVE_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "dependabot/**": false }),
  }),
});

const ACTIVE_GITHUB_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: false,
  }),
});

const APP_ACTIVE_GITHUB_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "**": false, v2: true }),
  }),
});

const MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "**": false, main: true }),
  }),
});

const APP_MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "**": false, main: true, v2: true }),
  }),
});

function githubVercelConfiguration(mainOwnershipMode, active, mainShadow) {
  if (mainOwnershipMode === MAIN_OWNERSHIP_MODES.GITHUB) {
    return active;
  }
  if (mainOwnershipMode === MAIN_OWNERSHIP_MODES.SHADOW) {
    return mainShadow;
  }
  throw new Error("Main ownership mode must match a reviewed exact state");
}

export const PREVIEW_TARGET_CONFIG = Object.freeze({
  app: Object.freeze({
    logicalTarget: "app",
    workspacePackage: "app.mento.org",
    expectedRootDirectory: "apps/app.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_APP",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/app.mento.org/vercel.json",
    activeVercelConfiguration: APP_ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: APP_MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    githubVercelConfiguration: githubVercelConfiguration(
      MAIN_OWNERSHIP_MODES.GITHUB,
      APP_ACTIVE_GITHUB_VERCEL_CONFIGURATION,
      APP_MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    ),
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  governance: Object.freeze({
    logicalTarget: "governance",
    workspacePackage: "governance.mento.org",
    expectedRootDirectory: "apps/governance.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_GOVERNANCE",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/governance.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    githubVercelConfiguration: githubVercelConfiguration(
      MAIN_OWNERSHIP_MODES.GITHUB,
      ACTIVE_GITHUB_VERCEL_CONFIGURATION,
      MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    ),
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  reserve: Object.freeze({
    logicalTarget: "reserve",
    workspacePackage: "reserve.mento.org",
    expectedRootDirectory: "apps/reserve.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_RESERVE",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/reserve.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    githubVercelConfiguration: githubVercelConfiguration(
      MAIN_OWNERSHIP_MODES.GITHUB,
      ACTIVE_GITHUB_VERCEL_CONFIGURATION,
      MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    ),
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  ui: Object.freeze({
    logicalTarget: "ui",
    workspacePackage: "ui.mento.org",
    expectedRootDirectory: "apps/ui.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_UI",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/ui.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    githubVercelConfiguration: githubVercelConfiguration(
      MAIN_OWNERSHIP_MODES.GITHUB,
      ACTIVE_GITHUB_VERCEL_CONFIGURATION,
      MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    ),
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
});

export const PREVIEW_TARGETS = Object.freeze(
  Object.keys(PREVIEW_TARGET_CONFIG),
);

export function previewTarget(value, label = "Preview target") {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(PREVIEW_TARGET_CONFIG, value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function previewTargetConfig(value, label = "Preview target") {
  return PREVIEW_TARGET_CONFIG[previewTarget(value, label)];
}
