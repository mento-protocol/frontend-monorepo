import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUILD_VARIABLE_CLASSIFICATIONS,
  getVercelBuildRequirements,
  loadVercelPulledEnvironment,
  validateVercelBuildCredentialBoundary,
  validateVercelBuildEnvironment,
} from "./vercel-build-environment.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(
  new URL("./vercel-build-environment.mjs", import.meta.url),
);

const TARGET_ENVIRONMENTS = {
  app: ["preview", "v3", "production"],
  governance: ["preview", "production"],
  reserve: ["preview", "production"],
  ui: ["preview", "production"],
};

function validValues(target, environment) {
  return Object.fromEntries(
    getVercelBuildRequirements(target, environment).map((requirement) => [
      requirement.name,
      requirement.expectedValue ?? `${requirement.name}-fixture`,
    ]),
  );
}

test("every target/environment has classified required build variables", () => {
  for (const [target, environments] of Object.entries(TARGET_ENVIRONMENTS)) {
    for (const environment of environments) {
      const requirements = getVercelBuildRequirements(target, environment);
      assert.ok(requirements.length >= 4, `${target}/${environment}`);
      assert.equal(
        new Set(requirements.map((requirement) => requirement.name)).size,
        requirements.length,
      );
      for (const requirement of requirements) {
        assert.ok(
          BUILD_VARIABLE_CLASSIFICATIONS.includes(
            requirement.platformClassification,
          ),
        );
        assert.ok(
          BUILD_VARIABLE_CLASSIFICATIONS.includes(requirement.ciClassification),
        );
      }
      assert.doesNotThrow(() =>
        validateVercelBuildEnvironment({
          target,
          environment,
          values: validValues(target, environment),
        }),
      );
    }
  }
});

test("system semantics preserve app v3 as preview", () => {
  const requirements = getVercelBuildRequirements("app", "v3");
  const constants = Object.fromEntries(
    requirements
      .filter((requirement) => requirement.expectedValue !== undefined)
      .map((requirement) => [requirement.name, requirement.expectedValue]),
  );
  assert.deepEqual(constants, {
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "v3",
    NEXT_PUBLIC_VERCEL_ENV: "preview",
  });
  assert.equal(
    requirements.some(
      (requirement) => requirement.name === "SENTRY_AUTH_TOKEN",
    ),
    false,
  );
});

test("Sensitive variables have explicit #517 GitHub mappings", () => {
  const governancePreview = getVercelBuildRequirements("governance", "preview");
  const governanceProduction = getVercelBuildRequirements(
    "governance",
    "production",
  );
  const reserveProduction = getVercelBuildRequirements("reserve", "production");

  assert.deepEqual(
    governancePreview
      .filter((item) => item.ciClassification === "sensitive-non-exportable")
      .map((item) => item.name),
    ["ETHERSCAN_API_KEY"],
  );
  assert.deepEqual(
    governanceProduction
      .filter((item) => item.ciClassification === "sensitive-non-exportable")
      .map((item) => item.name),
    ["ETHERSCAN_API_KEY", "SENTRY_AUTH_TOKEN"],
  );
  assert.deepEqual(
    reserveProduction
      .filter((item) => item.ciClassification === "sensitive-non-exportable")
      .map((item) => item.name),
    ["SENTRY_AUTH_TOKEN"],
  );
  for (const requirement of [
    ...governancePreview,
    ...governanceProduction,
    ...reserveProduction,
  ].filter((item) => item.ciClassification === "sensitive-non-exportable")) {
    assert.equal(requirement.githubSecret, requirement.name);
    assert.ok(requirement.githubScope);
  }
});

test("production Sentry auth is required only for production semantics", () => {
  for (const target of ["app", "governance", "reserve"]) {
    assert.equal(
      getVercelBuildRequirements(target, "production").some(
        (item) => item.name === "SENTRY_AUTH_TOKEN",
      ),
      true,
    );
    assert.equal(
      getVercelBuildRequirements(target, "preview").some(
        (item) => item.name === "SENTRY_AUTH_TOKEN",
      ),
      false,
    );
  }
});

test("runtime-critical application variables reject empty values", () => {
  const governance = validValues("governance", "preview");
  governance.NEXT_PUBLIC_GRAPH_API_KEY = "";
  assert.throws(
    () =>
      validateVercelBuildEnvironment({
        target: "governance",
        environment: "preview",
        values: governance,
      }),
    /NEXT_PUBLIC_GRAPH_API_KEY/,
  );

  const reserveRequirements = getVercelBuildRequirements("reserve", "preview");
  assert.ok(
    reserveRequirements.some(
      (item) => item.name === "NEXT_PUBLIC_ANALYTICS_API_URL",
    ),
  );
  const reserve = validValues("reserve", "preview");
  delete reserve.NEXT_PUBLIC_ANALYTICS_API_URL;
  assert.throws(
    () =>
      validateVercelBuildEnvironment({
        target: "reserve",
        environment: "preview",
        values: reserve,
      }),
    /NEXT_PUBLIC_ANALYTICS_API_URL/,
  );
});

test("Vercel-pulled files are loaded before explicit workflow values", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-env-"));
  try {
    mkdirSync(join(directory, ".vercel"));
    writeFileSync(
      join(directory, ".vercel", ".env.preview.local"),
      [
        "NEXT_PUBLIC_STORAGE_URL=https://pulled.example",
        "NEXT_PUBLIC_WALLET_CONNECT_ID=pulled-wallet",
        "VERCEL_ENV=pulled-wrong-value",
      ].join("\n"),
    );
    assert.deepEqual(
      loadVercelPulledEnvironment({
        target: "app",
        projectDirectory: directory,
        environment: "preview",
        values: { VERCEL_ENV: "preview" },
      }),
      {
        NEXT_PUBLIC_STORAGE_URL: "https://pulled.example",
        NEXT_PUBLIC_WALLET_CONNECT_ID: "pulled-wallet",
        VERCEL_ENV: "preview",
      },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("missing Vercel-pulled files fail closed without exposing values", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-env-"));
  try {
    assert.throws(
      () =>
        loadVercelPulledEnvironment({
          target: "app",
          projectDirectory: directory,
          environment: "v3",
          values: { SECRET_VALUE: "do-not-print-this-secret-value" },
        }),
      (error) => {
        assert.match(error.message, /.env.v3.local/);
        assert.doesNotMatch(error.message, /do-not-print-this-secret-value/);
        return true;
      },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("root CLI validates the exact linked project directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "vercel-env-cli-"));
  const projectDirectory = join(directory, "apps", "ui.mento.org");
  try {
    mkdirSync(join(projectDirectory, ".vercel"), { recursive: true });
    writeFileSync(
      join(projectDirectory, ".vercel", ".env.preview.local"),
      "NEXT_PUBLIC_STORAGE_URL=https://pulled.example\n",
    );
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        "check",
        "--target",
        "ui",
        "--environment",
        "preview",
        "--project-directory",
        projectDirectory,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          NEXT_PUBLIC_VERCEL_ENV: "preview",
          VERCEL_ENV: "preview",
          VERCEL_TARGET_ENV: "preview",
        },
      },
    );
    assert.match(output, /verified for ui\/preview/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("missing-variable failures reveal names but never values", () => {
  const secretValue = "do-not-print-this-secret-value";
  const values = validValues("governance", "production");
  values.ETHERSCAN_API_KEY = secretValue;
  delete values.SENTRY_AUTH_TOKEN;

  assert.throws(
    () =>
      validateVercelBuildEnvironment({
        target: "governance",
        environment: "production",
        values,
      }),
    (error) => {
      assert.match(error.message, /SENTRY_AUTH_TOKEN/);
      assert.doesNotMatch(error.message, new RegExp(secretValue));
      return true;
    },
  );
});

test("sensitive build variables come only from the exact explicit target scope", () => {
  assert.deepEqual(
    validateVercelBuildCredentialBoundary({
      target: "governance",
      environment: "preview",
      pulledValues: {},
      explicitValues: { ETHERSCAN_API_KEY: "governance-secret" },
    }),
    { target: "governance", environment: "preview", checked: 2 },
  );
  assert.deepEqual(
    validateVercelBuildCredentialBoundary({
      target: "reserve",
      environment: "preview",
      pulledValues: {},
      explicitValues: {},
    }),
    { target: "reserve", environment: "preview", checked: 2 },
  );
  assert.deepEqual(
    validateVercelBuildCredentialBoundary({
      target: "app",
      environment: "production",
      pulledValues: {},
      explicitValues: { SENTRY_AUTH_TOKEN: "app-production-secret" },
    }),
    { target: "app", environment: "production", checked: 2 },
  );
});

test("preview credential boundaries reject pulled sensitive values and cross-target secrets by name", () => {
  const secretValue = "do-not-print-this-sensitive-value";
  for (const fixture of [
    {
      target: "governance",
      pulledValues: { ETHERSCAN_API_KEY: secretValue },
      explicitValues: { ETHERSCAN_API_KEY: secretValue },
      expectedName: "ETHERSCAN_API_KEY",
    },
    {
      target: "app",
      pulledValues: { SENTRY_AUTH_TOKEN: secretValue },
      explicitValues: {},
      expectedName: "SENTRY_AUTH_TOKEN",
    },
    {
      target: "reserve",
      pulledValues: {},
      explicitValues: { ETHERSCAN_API_KEY: secretValue },
      expectedName: "ETHERSCAN_API_KEY",
    },
    {
      target: "ui",
      pulledValues: {},
      explicitValues: { SENTRY_AUTH_TOKEN: secretValue },
      expectedName: "SENTRY_AUTH_TOKEN",
    },
  ]) {
    assert.throws(
      () =>
        validateVercelBuildCredentialBoundary({
          target: fixture.target,
          environment: "preview",
          pulledValues: fixture.pulledValues,
          explicitValues: fixture.explicitValues,
        }),
      (error) => {
        assert.match(error.message, new RegExp(fixture.expectedName));
        assert.doesNotMatch(error.message, new RegExp(secretValue));
        return true;
      },
    );
  }
});

test("governance preview requires its explicit explorer key without exposing values", () => {
  assert.throws(
    () =>
      validateVercelBuildCredentialBoundary({
        target: "governance",
        environment: "preview",
        pulledValues: {},
        explicitValues: {},
      }),
    /Missing explicit sensitive Vercel build variables: ETHERSCAN_API_KEY/,
  );
});

test("constant mismatches reveal only variable names", () => {
  const values = validValues("app", "v3");
  values.VERCEL_ENV = "secretly-wrong";
  assert.throws(
    () =>
      validateVercelBuildEnvironment({
        target: "app",
        environment: "v3",
        values,
      }),
    (error) => {
      assert.match(error.message, /VERCEL_ENV/);
      assert.doesNotMatch(error.message, /secretly-wrong/);
      return true;
    },
  );
});

test("unsupported target/environment combinations fail before validation", () => {
  assert.throws(() => getVercelBuildRequirements("unknown", "preview"));
  assert.throws(() => getVercelBuildRequirements("reserve", "v3"));
});
