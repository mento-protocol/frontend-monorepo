#!/usr/bin/env node

import { Buffer } from "node:buffer";
import process from "node:process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const MAX_MATERIALIZED_VALUE_BYTES = 32 * 1_024;

export const BUILD_VARIABLE_CLASSIFICATIONS = [
  "system-injected",
  "vercel-pull",
  "safe-explicit-constant",
  "sensitive-non-exportable",
];

const ENVIRONMENT_SEMANTICS = {
  preview: {
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview",
    NEXT_PUBLIC_VERCEL_ENV: "preview",
  },
  production: {
    VERCEL_ENV: "production",
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_VERCEL_ENV: "production",
  },
  v3: {
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "v3",
    NEXT_PUBLIC_VERCEL_ENV: "preview",
  },
};

const TARGET_ENVIRONMENTS = {
  app: ["preview", "v3", "production"],
  governance: ["preview", "production"],
  reserve: ["preview", "production"],
  ui: ["preview", "production"],
};

const TARGET_VARIABLES = {
  app: [
    pullable("NEXT_PUBLIC_STORAGE_URL"),
    pullable("NEXT_PUBLIC_WALLET_CONNECT_ID"),
    pullable("NEXT_PUBLIC_SENTRY_DSN_SWAP", { allowEmpty: true }),
    sensitive("SENTRY_AUTH_TOKEN", {
      environments: ["production"],
      githubScope: "vercel-cli-production environment; app build step only",
    }),
  ],
  governance: [
    pullable("NEXT_PUBLIC_BLOCKSCOUT_API_URL"),
    pullable("NEXT_PUBLIC_BLOCKSCOUT_GRAPHQL_URL"),
    pullable("NEXT_PUBLIC_ETHERSCAN_API_URL"),
    pullable("NEXT_PUBLIC_GRAPH_API_KEY"),
    pullable("NEXT_PUBLIC_SENTRY_DSN_GOVERNANCE", { allowEmpty: true }),
    pullable("NEXT_PUBLIC_STORAGE_URL"),
    pullable("NEXT_PUBLIC_SUBGRAPH_URL"),
    pullable("NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA"),
    pullable("NEXT_PUBLIC_WALLET_CONNECT_ID"),
    sensitive("ETHERSCAN_API_KEY", {
      githubScope:
        "repository for trusted previews and vercel-cli-production environment for main; governance build step only",
    }),
    sensitive("SENTRY_AUTH_TOKEN", {
      environments: ["production"],
      githubScope:
        "vercel-cli-production environment; governance build step only",
    }),
  ],
  reserve: [
    pullable("NEXT_PUBLIC_ANALYTICS_API_URL"),
    pullable("NEXT_PUBLIC_STORAGE_URL"),
    pullable("NEXT_PUBLIC_SENTRY_DSN_RESERVE", { allowEmpty: true }),
    sensitive("SENTRY_AUTH_TOKEN", {
      environments: ["production"],
      githubScope: "vercel-cli-production environment; reserve build step only",
    }),
  ],
  ui: [pullable("NEXT_PUBLIC_STORAGE_URL")],
};

const SENSITIVE_VARIABLE_NAMES = [
  ...new Set(
    Object.values(TARGET_VARIABLES)
      .flat()
      .filter(
        (variable) => variable.ciClassification === "sensitive-non-exportable",
      )
      .map((variable) => variable.name),
  ),
].sort();

function pullable(name, { allowEmpty = false } = {}) {
  return {
    name,
    platformClassification: "vercel-pull",
    ciClassification: "vercel-pull",
    allowEmpty,
  };
}

function sensitive(
  name,
  { environments, githubScope, allowEmpty = false } = {},
) {
  return {
    name,
    platformClassification: "sensitive-non-exportable",
    ciClassification: "sensitive-non-exportable",
    environments,
    githubSecret: name,
    githubScope,
    allowEmpty,
  };
}

export function getVercelBuildRequirements(target, environment) {
  const validEnvironments = TARGET_ENVIRONMENTS[target];
  if (!validEnvironments) throw new Error(`Unknown Vercel target: ${target}`);
  if (!validEnvironments.includes(environment)) {
    throw new Error(`Unsupported ${target} environment: ${environment}`);
  }

  const semantics = ENVIRONMENT_SEMANTICS[environment];
  const systemVariables = Object.entries(semantics).map(([name, value]) => ({
    name,
    platformClassification: "system-injected",
    ciClassification: "safe-explicit-constant",
    expectedValue: value,
    allowEmpty: false,
  }));
  const targetVariables = TARGET_VARIABLES[target].filter(
    (variable) =>
      !variable.environments || variable.environments.includes(environment),
  );

  return [...systemVariables, ...targetVariables].map((variable) => ({
    ...variable,
    target,
    environment,
  }));
}

export function validateVercelBuildEnvironment({
  target,
  environment,
  values = process.env,
}) {
  const requirements = getVercelBuildRequirements(target, environment);
  const missing = [];
  const invalidConstants = [];

  for (const requirement of requirements) {
    const value = values[requirement.name];
    if (
      value === undefined ||
      (!requirement.allowEmpty &&
        typeof value === "string" &&
        value.length === 0)
    ) {
      missing.push(requirement.name);
      continue;
    }
    if (
      requirement.expectedValue !== undefined &&
      value !== requirement.expectedValue
    ) {
      invalidConstants.push(requirement.name);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required Vercel build variables: ${missing.sort().join(", ")}`,
    );
  }
  if (invalidConstants.length > 0) {
    throw new Error(
      `Invalid Vercel build constants: ${invalidConstants.sort().join(", ")}`,
    );
  }

  return { target, environment, checked: requirements.length };
}

export function validateVercelBuildCredentialBoundary({
  target,
  environment,
  pulledValues,
  explicitValues,
}) {
  const requirements = getVercelBuildRequirements(target, environment);
  const allowedExplicitSensitive = new Set(
    requirements
      .filter(
        (requirement) =>
          requirement.ciClassification === "sensitive-non-exportable",
      )
      .map((requirement) => requirement.name),
  );
  const forbidden = [];
  const missing = [];

  for (const name of SENSITIVE_VARIABLE_NAMES) {
    if (Object.hasOwn(pulledValues, name)) forbidden.push(name);
    if (
      Object.hasOwn(explicitValues, name) &&
      !allowedExplicitSensitive.has(name)
    ) {
      forbidden.push(name);
    }
  }
  for (const name of allowedExplicitSensitive) {
    if (
      !Object.hasOwn(explicitValues, name) ||
      typeof explicitValues[name] !== "string" ||
      explicitValues[name].length === 0
    ) {
      missing.push(name);
    }
  }

  if (forbidden.length > 0) {
    throw new Error(
      `Forbidden Vercel build variable sources: ${[...new Set(forbidden)].sort().join(", ")}`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing explicit sensitive Vercel build variables: ${missing.sort().join(", ")}`,
    );
  }
  return { target, environment, checked: SENSITIVE_VARIABLE_NAMES.length };
}

function hasControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function validateMaterializedValue(name, value, { allowEmpty }) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > MAX_MATERIALIZED_VALUE_BYTES ||
    hasControlCharacters(value)
  ) {
    throw new Error(`Invalid Vercel-pulled build variable: ${name}`);
  }
  return value;
}

export function selectVercelPulledEnvironment({
  target,
  environment,
  pulledValues,
}) {
  if (
    pulledValues === null ||
    typeof pulledValues !== "object" ||
    Array.isArray(pulledValues)
  ) {
    throw new Error("Vercel-pulled build variables are invalid");
  }
  const pullableRequirements = getVercelBuildRequirements(
    target,
    environment,
  ).filter((requirement) => requirement.ciClassification === "vercel-pull");
  const selected = {};
  const missing = [];
  for (const requirement of pullableRequirements) {
    if (!Object.hasOwn(pulledValues, requirement.name)) {
      missing.push(requirement.name);
      continue;
    }
    selected[requirement.name] = validateMaterializedValue(
      requirement.name,
      pulledValues[requirement.name],
      requirement,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing Vercel-pulled build variables: ${missing.sort().join(", ")}`,
    );
  }
  return selected;
}

function canonicalDelimiter(name, value) {
  for (const delimiter of ["'", "`", '"']) {
    if (!value.includes(delimiter)) return delimiter;
  }
  throw new Error(`Unrepresentable Vercel-pulled build variable: ${name}`);
}

function compareVariableNames([left], [right]) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateMaterializedName(name) {
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("Materialized Vercel build variable name is invalid");
  }
  return name;
}

function hasExactEntries(actual, expected) {
  const actualEntries = Object.entries(actual).sort(compareVariableNames);
  const expectedEntries = Object.entries(expected).sort(compareVariableNames);
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([name, value], index) =>
        name === expectedEntries[index][0] &&
        value === expectedEntries[index][1],
    )
  );
}

export function serializeVercelPulledEnvironment(values) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Materialized Vercel build variables are invalid");
  }
  const lines = Object.entries(values)
    .sort(compareVariableNames)
    .map(([name, value]) => {
      validateMaterializedName(name);
      validateMaterializedValue(name, value, { allowEmpty: true });
      const delimiter = canonicalDelimiter(name, value);
      const line = `${name}=${delimiter}${value}${delimiter}`;
      let parsedLine;
      try {
        parsedLine = parseEnv(`${line}\n`);
      } catch {
        throw new Error(
          `Unrepresentable Vercel-pulled build variable: ${name}`,
        );
      }
      if (!hasExactEntries(parsedLine, { [name]: value })) {
        throw new Error(
          `Unrepresentable Vercel-pulled build variable: ${name}`,
        );
      }
      return line;
    });
  const serialized = `${lines.join("\n")}\n`;
  let reparsed;
  try {
    reparsed = parseEnv(serialized);
  } catch {
    throw new Error("Materialized Vercel build variables cannot be parsed");
  }
  if (!hasExactEntries(reparsed, values)) {
    throw new Error("Materialized Vercel build variables do not round-trip");
  }
  return serialized;
}

export function parseVercelPulledEnvironment(raw) {
  try {
    return parseEnv(raw);
  } catch {
    throw new Error("Vercel-pulled build variables are invalid");
  }
}

export function loadVercelPulledEnvironment({
  target,
  projectDirectory,
  environment,
  values = process.env,
}) {
  if (typeof projectDirectory !== "string" || projectDirectory.length === 0) {
    throw new Error("Vercel project directory is required");
  }
  const environmentPath = join(
    projectDirectory,
    ".vercel",
    `.env.${environment}.local`,
  );
  let rawValues;
  try {
    rawValues = parseVercelPulledEnvironment(
      readFileSync(environmentPath, "utf8"),
    );
  } catch {
    throw new Error(
      `Missing or invalid Vercel-pulled environment file: ${environmentPath}`,
    );
  }

  const pulledValues = selectVercelPulledEnvironment({
    target,
    environment,
    pulledValues: rawValues,
  });

  validateVercelBuildCredentialBoundary({
    target,
    environment,
    pulledValues,
    explicitValues: values,
  });

  // Explicit workflow constants and narrowly scoped GitHub secrets take
  // precedence over ordinary values written by `vercel pull`.
  return { ...pulledValues, ...values };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    options[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return { command: argv[0], options };
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "inventory") {
    process.stdout.write(
      `${JSON.stringify(
        getVercelBuildRequirements(options.target, options.environment),
      )}\n`,
    );
  } else if (command === "check") {
    if (
      typeof options["project-directory"] !== "string" ||
      options["project-directory"].length === 0
    ) {
      throw new Error("--project-directory is required for environment checks");
    }
    const values = loadVercelPulledEnvironment({
      target: options.target,
      environment: options.environment,
      projectDirectory: resolve(options["project-directory"]),
    });
    const result = validateVercelBuildEnvironment({
      target: options.target,
      environment: options.environment,
      values,
    });
    process.stdout.write(
      `Vercel build environment verified for ${result.target}/${result.environment} (${result.checked} variables)\n`,
    );
  } else {
    throw new Error(
      "Usage: vercel-build-environment.mjs inventory|check --target <target> --environment <environment> [--project-directory <path>]",
    );
  }
}
