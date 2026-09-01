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

// The App's active shape before the MGP-18 v2 retirement. Recognition-only:
// it lets the trusted controller classify open pre-retirement PR heads as
// GitHub-owned. It is never a reviewed or tracked configuration, and it is
// removed in the v3-normalization tighten step.
const TRANSITIONAL_PRE_RETIREMENT_APP_ACTIVE_VERCEL_CONFIGURATION =
  Object.freeze({
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

const PREVIEW_SHADOW_GITHUB_MAIN_VERCEL_CONFIGURATION = Object.freeze({
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: Object.freeze({
    deploymentEnabled: Object.freeze({
      "dependabot/**": false,
      main: false,
    }),
  }),
});

export function vercelConfigurationForOwnership({
  previewOwnershipMode,
  mainOwnershipMode,
  active,
  mainShadow,
  previewShadow,
  native,
}) {
  if (previewOwnershipMode === PREVIEW_OWNERSHIP_MODES.GITHUB) {
    if (mainOwnershipMode === MAIN_OWNERSHIP_MODES.GITHUB) {
      return active;
    }
    if (mainOwnershipMode === MAIN_OWNERSHIP_MODES.SHADOW) {
      return mainShadow;
    }
  }
  if (previewOwnershipMode === PREVIEW_OWNERSHIP_MODES.SHADOW) {
    if (mainOwnershipMode === MAIN_OWNERSHIP_MODES.GITHUB) {
      return previewShadow;
    }
    if (mainOwnershipMode === MAIN_OWNERSHIP_MODES.SHADOW) {
      return native;
    }
  }
  throw new Error(
    "Preview and main ownership modes must match a reviewed exact state",
  );
}

function targetConfiguration({
  logicalTarget,
  workspacePackage,
  expectedRootDirectory,
  projectVariable,
  ownershipMode,
  mainOwnershipMode,
  vercelConfigurationPath,
  activeVercelConfiguration,
  mainShadowVercelConfiguration,
  previewShadowVercelConfiguration,
  nativeVercelConfiguration,
  transitionalGithubVercelConfigurations = [],
}) {
  if (!Array.isArray(transitionalGithubVercelConfigurations)) {
    throw new Error(
      "Transitional GitHub Vercel configurations must be an exact reviewed list",
    );
  }
  return Object.freeze({
    logicalTarget,
    workspacePackage,
    expectedRootDirectory,
    projectVariable,
    ownershipMode,
    mainOwnershipMode,
    vercelConfigurationPath,
    activeVercelConfiguration,
    mainShadowVercelConfiguration,
    previewShadowVercelConfiguration,
    nativeVercelConfiguration,
    // Bounded, per-target list of additional exact GitHub-owned shapes the
    // trusted controller must recognize while a target migrates from one
    // reviewed configuration to another. It is empty unless a migration is in
    // flight, and each entry is removed once that migration completes.
    transitionalGithubVercelConfigurations: Object.freeze(
      transitionalGithubVercelConfigurations.map((configuration) =>
        Object.freeze(configuration),
      ),
    ),
    trackedVercelConfiguration: vercelConfigurationForOwnership({
      previewOwnershipMode: ownershipMode,
      mainOwnershipMode,
      active: activeVercelConfiguration,
      mainShadow: mainShadowVercelConfiguration,
      previewShadow: previewShadowVercelConfiguration,
      native: nativeVercelConfiguration,
    }),
  });
}

export const PREVIEW_TARGET_CONFIG = Object.freeze({
  app: targetConfiguration({
    logicalTarget: "app",
    workspacePackage: "app.mento.org",
    expectedRootDirectory: "apps/app.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_APP",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/app.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    previewShadowVercelConfiguration:
      PREVIEW_SHADOW_GITHUB_MAIN_VERCEL_CONFIGURATION,
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
    // Bounded transition for the MGP-18 v2 retirement. The App's reviewed
    // configurations are now the generic shapes, but open pull requests
    // branched before the retirement still carry the pre-retirement active
    // shape at their heads. The trusted controller runs the default branch's
    // constants, so it must keep recognizing that retired shape as
    // GitHub-owned until those heads are refreshed. Remove this entry in the
    // v3-normalization tighten step.
    transitionalGithubVercelConfigurations: [
      TRANSITIONAL_PRE_RETIREMENT_APP_ACTIVE_VERCEL_CONFIGURATION,
    ],
  }),
  governance: targetConfiguration({
    logicalTarget: "governance",
    workspacePackage: "governance.mento.org",
    expectedRootDirectory: "apps/governance.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_GOVERNANCE",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/governance.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    previewShadowVercelConfiguration:
      PREVIEW_SHADOW_GITHUB_MAIN_VERCEL_CONFIGURATION,
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  reserve: targetConfiguration({
    logicalTarget: "reserve",
    workspacePackage: "reserve.mento.org",
    expectedRootDirectory: "apps/reserve.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_RESERVE",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/reserve.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    previewShadowVercelConfiguration:
      PREVIEW_SHADOW_GITHUB_MAIN_VERCEL_CONFIGURATION,
    nativeVercelConfiguration: NATIVE_VERCEL_CONFIGURATION,
  }),
  ui: targetConfiguration({
    logicalTarget: "ui",
    workspacePackage: "ui.mento.org",
    expectedRootDirectory: "apps/ui.mento.org",
    projectVariable: "VERCEL_PROJECT_ID_UI",
    ownershipMode: PREVIEW_OWNERSHIP_MODES.GITHUB,
    mainOwnershipMode: MAIN_OWNERSHIP_MODES.GITHUB,
    vercelConfigurationPath: "apps/ui.mento.org/vercel.json",
    activeVercelConfiguration: ACTIVE_GITHUB_VERCEL_CONFIGURATION,
    mainShadowVercelConfiguration: MAIN_SHADOW_GITHUB_VERCEL_CONFIGURATION,
    previewShadowVercelConfiguration:
      PREVIEW_SHADOW_GITHUB_MAIN_VERCEL_CONFIGURATION,
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
