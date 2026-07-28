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

  const connectSrc = directiveSources(csp, "connect-src");
  const styleSrc = directiveSources(csp, "style-src");
  const fontSrc = directiveSources(csp, "font-src");
  const imgSrc = directiveSources(csp, "img-src");

  for (const origin of [
    "https://li.quest",
    "https://explorer-api.mayan.finance",
    "https://executor.labsapis.com",
    "https://metamask-sdk.api.cx.metamask.io",
    "wss://metamask-sdk.api.cx.metamask.io",
    "https://rpc.example",
  ]) {
    assert.ok(connectSrc.includes(origin), `${origin} must be in connect-src`);
  }

  assert.equal(
    connectSrc.filter((source) => source === "https://rpc.example").length,
    1,
  );
  assert.ok(styleSrc.includes("https://fonts.googleapis.com"));
  assert.ok(fontSrc.includes("https://fonts.gstatic.com"));
  assert.ok(imgSrc.includes("https://coin-images.coingecko.com"));
  assert.ok(csp.endsWith("report-uri https://sentry.example/security"));
});

test("keeps unsupported chains and injected browser origins denied", () => {
  const csp = buildAppReportOnlyCsp({
    storageHostname: "storage.example",
  });

  for (const deniedOrigin of [
    "ethereum-rpc.publicnode.com",
    "arbitrum-one-rpc.publicnode.com",
    "scroll-rpc.publicnode.com",
    "rpc-http.mezo.org",
    "wallet.binance.com",
    "api.trongrid.io",
    "frontend-cdn.perplexity.ai",
    "translate.google.com",
  ]) {
    assert.doesNotMatch(csp, new RegExp(deniedOrigin.replaceAll(".", "\\.")));
  }

  assert.doesNotMatch(csp, /https:\/\/\*\.publicnode\.com/);
  assert.doesNotMatch(csp, /https:\/\/\*\.metamask\.io/);
  assert.doesNotMatch(csp, /report-uri/);
});
