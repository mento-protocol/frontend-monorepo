import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILD_VARIABLE_CLASSIFICATIONS,
  getVercelBuildRequirements,
  validateVercelBuildEnvironment,
} from "./vercel-build-environment.mjs";

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
