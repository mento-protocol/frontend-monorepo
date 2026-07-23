import { assertBrowserDeploymentIdentity } from "../../../ui.mento.org/e2e/vercel-preview-browser-smoke.mjs";
import { assertHtmlDocumentDeploymentIdentity } from "../../../../scripts/vercel-html-deployment-identity.mjs";

const TARGETS = new Set(["governance", "reserve", "ui"]);

function requireTarget(target) {
  if (!TARGETS.has(target)) {
    throw new Error("Unknown production-shadow browser target");
  }
}

export function assertProductionShadowServerIdentity(
  html,
  expectedDeploymentId,
) {
  assertHtmlDocumentDeploymentIdentity(
    html,
    expectedDeploymentId,
    "Production-shadow server HTML does not carry only the expected build deployment ID",
  );
}

export function assertProductionShadowHydratedIdentity({
  target,
  expectedDeploymentId,
  renderedDeploymentId,
  assetReferences,
  expectedOrigin,
}) {
  requireTarget(target);
  assertBrowserDeploymentIdentity(
    {
      htmlDeploymentId: renderedDeploymentId,
      assetReferences,
    },
    expectedDeploymentId,
    expectedOrigin,
  );
}
