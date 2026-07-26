import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRuntimeErrorLedger,
  formatConsoleError,
  hasAuthoritativeRuntimeErrors,
  recordRuntimeResponse,
} from "./runtime-errors.mjs";

test("console diagnostics include a source URL when Chromium provides one", () => {
  assert.equal(
    formatConsoleError({
      text: () => "Failed to load resource",
      location: () => ({ url: "https://reserve.example.invalid/api/reserve" }),
    }),
    "Failed to load resource (https://reserve.example.invalid/api/reserve)",
  );
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
