import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRuntimeErrorLedger,
  displayUrl,
  formatConsoleError,
  hasAuthoritativeRuntimeErrors,
  recordRuntimeResponse,
} from "./runtime-errors.mjs";

test("URL diagnostics remove credentials, query tokens, and fragments", () => {
  assert.equal(
    displayUrl(
      "https://alice:secret@reserve.example.invalid:8443/api/reserve?token=abc&signature=def#private",
    ),
    "https://reserve.example.invalid:8443/api/reserve",
  );
});

test("URL diagnostics replace malformed or non-HTTP URLs without echoing them", () => {
  for (const value of [
    "not a url?token=secret",
    "javascript:alert('secret')",
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
    "Failed to load resource (https://reserve.example.invalid/api/reserve)",
  );
});

test("console source diagnostics use the sanitized URL display", () => {
  const diagnostic = formatConsoleError({
    text: () => "Failed to load resource",
    location: () => ({
      url: "https://alice:secret@reserve.example.invalid/api?token=abc#private",
    }),
  });

  assert.equal(
    diagnostic,
    "Failed to load resource (https://reserve.example.invalid/api)",
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

test("a fetch 429 is retained as diagnostics without becoming authoritative", () => {
  const ledger = createRuntimeErrorLedger();
  recordRuntimeResponse(ledger, {
    status: () => 429,
    url: () => "https://reserve.example.invalid/api/reserve",
    request: () => ({ resourceType: () => "fetch" }),
  });

  assert.deepEqual(ledger.responseDiagnostics, [
    "fetch https://reserve.example.invalid/api/reserve HTTP 429",
  ]);
  assert.deepEqual(ledger.responses, []);
  assert.equal(hasAuthoritativeRuntimeErrors(ledger), false);
});

test("HTTP response diagnostics use the sanitized URL display", () => {
  const ledger = createRuntimeErrorLedger();
  recordRuntimeResponse(ledger, {
    status: () => 429,
    url: () =>
      "https://alice:secret@reserve.example.invalid/api/reserve?token=abc#private",
    request: () => ({ resourceType: () => "fetch" }),
  });

  assert.deepEqual(ledger.responseDiagnostics, [
    "fetch https://reserve.example.invalid/api/reserve HTTP 429",
  ]);
});

test("a script 429 remains an authoritative smoke failure", () => {
  const ledger = createRuntimeErrorLedger();
  recordRuntimeResponse(ledger, {
    status: () => 429,
    url: () => "https://reserve.example.invalid/_next/static/app.js",
    request: () => ({ resourceType: () => "script" }),
  });

  assert.deepEqual(ledger.responses, [
    "script https://reserve.example.invalid/_next/static/app.js HTTP 429",
  ]);
  assert.equal(hasAuthoritativeRuntimeErrors(ledger), true);
});
