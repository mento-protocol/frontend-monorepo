import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildSecurityHeaders,
  originOf,
  sentryCspReportUri,
} from "./security-headers.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function reportOnlyHeader(reportOnlyCsp) {
  return buildSecurityHeaders({ reportOnlyCsp }).find(
    ({ key }) => key === "Content-Security-Policy-Report-Only",
  )?.value;
}

test("allows the Vercel toolbar only for the standard preview target", () => {
  const originalTargetEnvironment = process.env.VERCEL_TARGET_ENV;
  const originalVercelEnvironment = process.env.VERCEL_ENV;
  const csp = "default-src 'self'; script-src 'self'";

  try {
    process.env.VERCEL_TARGET_ENV = "preview";
    process.env.VERCEL_ENV = "preview";
    const previewCsp = reportOnlyHeader(csp);
    assert.match(previewCsp, /script-src 'self' https:\/\/vercel\.live/);
    assert.match(previewCsp, /connect-src 'self' https:\/\/vercel\.live/);
    assert.match(previewCsp, /frame-src 'self' https:\/\/vercel\.live/);

    process.env.VERCEL_TARGET_ENV = "v3";
    assert.equal(reportOnlyHeader(csp), csp);

    process.env.VERCEL_TARGET_ENV = "production";
    process.env.VERCEL_ENV = "production";
    assert.equal(reportOnlyHeader(csp), csp);

    delete process.env.VERCEL_TARGET_ENV;
    process.env.VERCEL_ENV = "preview";
    assert.equal(reportOnlyHeader(csp), csp);
  } finally {
    if (originalTargetEnvironment === undefined) {
      delete process.env.VERCEL_TARGET_ENV;
    } else {
      process.env.VERCEL_TARGET_ENV = originalTargetEnvironment;
    }
    if (originalVercelEnvironment === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnvironment;
    }
  }
});

test("does not duplicate an existing toolbar origin", () => {
  const originalTargetEnvironment = process.env.VERCEL_TARGET_ENV;
  process.env.VERCEL_TARGET_ENV = "preview";
  try {
    const csp = reportOnlyHeader(
      "script-src 'self' https://vercel.live; connect-src https://vercel.live; frame-src 'self'",
    );
    assert.equal(csp.match(/https:\/\/vercel\.live/g)?.length, 3);
  } finally {
    if (originalTargetEnvironment === undefined) {
      delete process.env.VERCEL_TARGET_ENV;
    } else {
      process.env.VERCEL_TARGET_ENV = originalTargetEnvironment;
    }
  }
});

test("keeps the enforced CSP limited to anti-framing", () => {
  const headers = buildSecurityHeaders();
  assert.deepEqual(
    headers.find(({ key }) => key === "Content-Security-Policy"),
    {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'",
    },
  );
  assert.equal(
    headers.some(({ key }) => key === "Content-Security-Policy-Report-Only"),
    false,
  );
});

test("derives Sentry report endpoints and configured origins safely", () => {
  assert.equal(
    sentryCspReportUri("https://public-key@o123.ingest.us.sentry.io/456789"),
    "https://o123.ingest.us.sentry.io/api/456789/security/?sentry_key=public-key",
  );
  assert.equal(sentryCspReportUri("not-a-dsn"), "");
  assert.equal(originOf("https://rpc.example/path"), "https://rpc.example");
  assert.equal(originOf("not-a-url"), "");
});

test("declares VERCEL_TARGET_ENV as an input for every app build", async () => {
  const rootTurboConfig = JSON.parse(
    await readFile(path.join(repositoryRoot, "turbo.json"), "utf8"),
  );
  assert.ok(
    rootTurboConfig.globalPassThroughEnv.includes("VERCEL_TARGET_ENV"),
    "the root task graph must pass VERCEL_TARGET_ENV through",
  );

  const appNames = [
    "app.mento.org",
    "governance.mento.org",
    "reserve.mento.org",
    "ui.mento.org",
  ];

  for (const appName of appNames) {
    const turboConfig = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "apps", appName, "turbo.json"),
        "utf8",
      ),
    );
    assert.ok(
      turboConfig.tasks.build.env.includes("VERCEL_TARGET_ENV"),
      `${appName} must hash VERCEL_TARGET_ENV`,
    );
  }
});
