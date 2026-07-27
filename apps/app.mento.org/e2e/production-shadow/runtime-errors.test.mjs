import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRuntimeErrorLedger,
  displayUrl,
  formatConsoleError,
  formatCriticalRequestFailure,
  hasAuthoritativeRuntimeErrors,
  recordCrossOriginFrame,
  recordRuntimeResponse,
  sanitizeDiagnosticText,
} from "./runtime-errors.mjs";

function credentialedUrl(path, { scheme = "https", prefix = "" } = {}) {
  return [
    prefix,
    scheme,
    "://",
    "alice",
    ":",
    "secret",
    "@reserve.example.invalid",
    path,
  ].join("");
}

test("URL diagnostics expose only the safe origin", () => {
  assert.equal(
    displayUrl(
      credentialedUrl(":8443/api/reserve?token=abc&signature=def#private"),
    ),
    "https://reserve.example.invalid:8443",
  );
});

test("URL diagnostics replace malformed, non-HTTP, and oversized URLs without echoing them", () => {
  for (const value of [
    "not a url?token=secret",
    "javascript:alert('secret')",
    `https://reserve.example.invalid/${"secret".repeat(2_000)}`,
  ]) {
    assert.equal(displayUrl(value), "[invalid URL]");
  }
});

test("console diagnostics include a source URL when Chromium provides one", () => {
  assert.equal(
    formatConsoleError({
      text: () => "Failed to load resource",
      location: () => ({ url: "https://reserve.example.invalid/api/reserve" }),
    }),
    "Failed to load resource (https://reserve.example.invalid)",
  );
});

test("console source diagnostics use the sanitized URL display", () => {
  const diagnostic = formatConsoleError({
    text: () => "Failed to load resource",
    location: () => ({
      url: credentialedUrl("/api?token=abc#private"),
    }),
  });

  assert.equal(
    diagnostic,
    "Failed to load resource (https://reserve.example.invalid)",
  );
  assert.doesNotMatch(diagnostic, /secret|token|private/);
});

test("console diagnostics remain useful when Chromium omits a source URL", () => {
  assert.equal(
    formatConsoleError({
      text: () => "Failed to load resource",
      location: () => ({}),
    }),
    "Failed to load resource",
  );
});

test("console text diagnostics redact credential-bearing URL substrings", () => {
  const diagnostic = formatConsoleError({
    text: () =>
      `Fetch failed at ${credentialedUrl("/private?token=abc#fragment")}`,
    location: () => ({}),
  });

  assert.equal(diagnostic, "Fetch failed at https://reserve.example.invalid");
  assert.doesNotMatch(diagnostic, /alice|secret|private|token|fragment/);
});

test("page error diagnostics redact URL substrings before ledger insertion", () => {
  const diagnostic = sanitizeDiagnosticText(
    "Unhandled rejection from https://reserve.example.invalid/private?bypass=secret",
  );

  assert.equal(
    diagnostic,
    "Unhandled rejection from https://reserve.example.invalid",
  );
  assert.doesNotMatch(diagnostic, /private|bypass|secret/);
});

test("arbitrary URL schemes and prefixed protocols cannot bypass redaction", () => {
  for (const value of [
    credentialedUrl("/private?token=abc", { prefix: "prefix" }),
    credentialedUrl("/private?token=abc", { scheme: "ftp" }),
    "mailto:alice@reserve.example.invalid?token=abc",
  ]) {
    const diagnostic = sanitizeDiagnosticText(`Failed at ${value}`);
    assert.equal(diagnostic, "Failed at [invalid URL]");
    assert.doesNotMatch(diagnostic, /alice|secret|private|token/);
  }
});

test("a fetch 429 is retained as diagnostics without becoming authoritative", () => {
  const ledger = createRuntimeErrorLedger();
  recordRuntimeResponse(ledger, {
    status: () => 429,
    url: () => "https://reserve.example.invalid/api/reserve",
    request: () => ({ resourceType: () => "fetch" }),
  });

  assert.deepEqual(ledger.responseDiagnostics, [
    "fetch https://reserve.example.invalid HTTP 429",
  ]);
  assert.deepEqual(ledger.responses, []);
  assert.equal(hasAuthoritativeRuntimeErrors(ledger), false);
});

test("HTTP response diagnostics use the sanitized URL display", () => {
  const ledger = createRuntimeErrorLedger();
  recordRuntimeResponse(ledger, {
    status: () => 429,
    url: () => credentialedUrl("/api/reserve?token=abc#private"),
    request: () => ({ resourceType: () => "fetch" }),
  });

  assert.deepEqual(ledger.responseDiagnostics, [
    "fetch https://reserve.example.invalid HTTP 429",
  ]);
});

test("frame and request ledgers use the bounded URL display", () => {
  const ledger = createRuntimeErrorLedger();
  const secretUrl = credentialedUrl("/private-token?signature=abc#fragment");
  recordCrossOriginFrame(ledger, secretUrl);
  ledger.requests.push(
    formatCriticalRequestFailure({
      resourceType: () => "script",
      url: () => secretUrl,
      failure: () => ({ errorText: "net::ERR_FAILED" }),
    }),
  );

  assert.deepEqual(ledger.origins, ["https://reserve.example.invalid"]);
  assert.deepEqual(ledger.requests, [
    "script https://reserve.example.invalid net::ERR_FAILED",
  ]);
  assert.doesNotMatch(
    JSON.stringify(ledger),
    /secret|token|signature|fragment/,
  );
});

test("request error text cannot bypass URL redaction", () => {
  const diagnostic = formatCriticalRequestFailure({
    resourceType: () => "script",
    url: () => "https://reserve.example.invalid/app.js",
    failure: () => ({
      errorText: `net::ERR_FAILED ${credentialedUrl("/private?token=abc")}`,
    }),
  });

  assert.equal(
    diagnostic,
    "script https://reserve.example.invalid net::ERR_FAILED https://reserve.example.invalid",
  );
  assert.doesNotMatch(diagnostic, /alice|secret|private|token/);
});

test("a script 429 remains an authoritative smoke failure", () => {
  const ledger = createRuntimeErrorLedger();
  recordRuntimeResponse(ledger, {
    status: () => 429,
    url: () => "https://reserve.example.invalid/_next/static/app.js",
    request: () => ({ resourceType: () => "script" }),
  });

  assert.deepEqual(ledger.responses, [
    "script https://reserve.example.invalid HTTP 429",
  ]);
  assert.equal(hasAuthoritativeRuntimeErrors(ledger), true);
});
