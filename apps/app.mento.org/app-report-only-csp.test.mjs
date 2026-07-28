import assert from "node:assert/strict";
import test from "node:test";
import { buildAppReportOnlyCsp } from "./app-report-only-csp.mjs";

function directiveSources(csp, directiveName) {
  const directive = csp
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${directiveName} `));

  assert.ok(directive, `missing ${directiveName}`);
  return directive.split(/\s+/).slice(1);
}

test("allows the reviewed app and bridge origins in their required directives", () => {
  const csp = buildAppReportOnlyCsp({
    reportUri: "https://sentry.example/security",
    rpcOverrideOrigins: ["https://rpc.example", "https://rpc.example"],
    storageHostname: "storage.example",
  });

  const connectSrc = new Set(directiveSources(csp, "connect-src"));
  const styleSrc = new Set(directiveSources(csp, "style-src"));
  const fontSrc = new Set(directiveSources(csp, "font-src"));
  const imgSrc = new Set(directiveSources(csp, "img-src"));

  for (const origin of [
    "https://li.quest",
    "https://explorer-api.mayan.finance",
    "https://executor.labsapis.com",
    "https://metamask-sdk.api.cx.metamask.io",
    "wss://metamask-sdk.api.cx.metamask.io",
    "https://rpc.example",
  ]) {
    assert.equal(
      connectSrc.has(origin),
      true,
      `${origin} must be in connect-src`,
    );
  }

  assert.equal(
    directiveSources(csp, "connect-src").filter(
      (source) => source === "https://rpc.example",
    ).length,
    1,
  );
  assert.equal(styleSrc.has("https://fonts.googleapis.com"), true);
  assert.equal(fontSrc.has("https://fonts.gstatic.com"), true);
  assert.equal(imgSrc.has("https://coin-images.coingecko.com"), true);
  assert.equal(connectSrc.has("https://coin-images.coingecko.com"), false);
  assert.equal(styleSrc.has("https://coin-images.coingecko.com"), false);
  assert.equal(fontSrc.has("https://coin-images.coingecko.com"), false);
  assert.ok(csp.endsWith("report-uri https://sentry.example/security"));
});

test("keeps unsupported chains and injected browser origins denied", () => {
  const csp = buildAppReportOnlyCsp({
    storageHostname: "storage.example",
  });
  const allSources = new Set(
    csp
      .split(";")
      .flatMap((directive) => directive.trim().split(/\s+/).slice(1)),
  );
  const directiveNames = new Set(
    csp.split(";").map((directive) => directive.trim().split(/\s+/, 1)[0]),
  );

  for (const deniedOrigin of [
    "https://ethereum-rpc.publicnode.com",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://scroll-rpc.publicnode.com",
    "https://jsonrpc-mezo.boar.network",
    "https://rpc-http.mezo.org",
    "https://wallet.binance.com",
    "https://api.trongrid.io",
    "https://frontend-cdn.perplexity.ai",
    "https://translate.google.com",
    "https://*.publicnode.com",
    "https://*.metamask.io",
  ]) {
    assert.equal(
      allSources.has(deniedOrigin),
      false,
      `${deniedOrigin} must stay out of the policy`,
    );
  }

  assert.equal(directiveNames.has("report-uri"), false);
});
