export const PREVIEW_OWNERSHIP_MODES = Object.freeze({
  GITHUB: "github",
  SHADOW: "shadow",
});

const NATIVE_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "dependabot/**": false }),
  }),
});

const GITHUB_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "**": false, main: true }),
  }),
});

const APP_GITHUB_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({ "**": false, main: true, v2: true }),
  }),
});

export const PREVIEW_TARGET_CONFIG = Object.freeze({
  app: Object.freeze({
    logicalTarget: "app",
    workspacePackage: "app.mento.org",
    expectedRootDirectory: "apps/app.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_APP",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/app.mento.org/vercel.json",
    githubVercelConfiguration: APP_GITHUB_VERCEL_CONFIGURATION,
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  governance: Object.freeze({
    logicalTarget: "governance",
    workspacePackage: "governance.mento.org",
    expectedRootDirectory: "apps/governance.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_GOVERNANCE",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/governance.mento.org/vercel.json",
    githubVercelConfiguration: GITHUB_VERCEL_CONFIGURATION,
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  reserve: Object.freeze({
    logicalTarget: "reserve",
    workspacePackage: "reserve.mento.org",
    expectedRootDirectory: "apps/reserve.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_RESERVE",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/reserve.mento.org/vercel.json",
    githubVercelConfiguration: GITHUB_VERCEL_CONFIGURATION,
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  ui: Object.freeze({
    logicalTarget: "ui",
    workspacePackage: "ui.mento.org",
    expectedRootDirectory: "apps/ui.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_UI",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/ui.mento.org/vercel.json",
    githubVercelConfiguration: GITHUB_VERCEL_CONFIGURATION,
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
