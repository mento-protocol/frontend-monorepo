export function productionShadowRequestHeaders({ existingHeaders = {} }) {
  const headers = { ...existingHeaders };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "x-vercel-protection-bypass") {
      throw new Error(
        "Production-shadow request contained a forbidden protection header",
      );
    }
  }
  return headers;
}

export async function fulfillProductionShadowRequest({ route }) {
  const response = await route.fetch({
    headers: productionShadowRequestHeaders({
      existingHeaders: route.request().headers(),
    }),
    // Fulfill each redirect response so Chromium creates a new request that
    // passes through the header-validation policy independently.
    maxRedirects: 0,
  });
  await route.fulfill({ response });
}

export async function drainProductionShadowRequestRoutes({ page }) {
  await page.unrouteAll({ behavior: "wait" });
  // route.fulfill() can resolve before Playwright dispatches the matching
  // page-level response event. A browser-protocol round trip orders those
  // events before the caller inspects its runtime-error ledger.
  await page.evaluate(() => undefined);
}

export function assertProductionShadowOrigin(value, allowedOrigin) {
  if (new URL(value).origin !== new URL(allowedOrigin).origin) {
    throw new Error("Production-shadow navigation left its immutable origin");
  }
  return true;
}
