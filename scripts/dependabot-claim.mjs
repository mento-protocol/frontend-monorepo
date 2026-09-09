#!/usr/bin/env node
// Thin wrapper around the per-pull-request claim CLI.
//
// It reads `.github/dependabot-prep-policy.json`, checks the policy schema and
// the pinned claims package, and runs that package's `mento-issues` binary
// through `pnpm dlx`. The package is never installed into this repository and
// never imported here, so no manifest or lockfile entry exists for it.
//
// `pnpm dlx` resolves the package into a temporary project outside this
// workspace, so `pnpm-workspace.yaml`'s `onlyBuiltDependencies` allowlist does
// not gate that install. pnpm 10 blocks a dependency's lifecycle scripts by
// default, and this wrapper also passes `--config.ignore-scripts=true`, so no
// `preinstall`, `install` or `postinstall` script runs — of the pinned package
// or of anything in its resolved tree — whatever a host `.npmrc` allows.
// `--ignore-scripts` is not a `dlx` option; `--config.ignore-scripts=true` is
// the form pnpm 10 accepts (measured with pnpm 10.34.5).
//
// `--package=<name>@<version>` selects the package and `mento-issues` names the
// binary. Without `--package`, `pnpm dlx` reads its first positional as the
// package specifier alone and forwards every later positional to the binary it
// derives from the installed package, so `pnpm dlx <spec> mento-issues …` would
// pass `mento-issues` to the CLI as its first argument.
//
// Usage: pnpm dependabot:claim -- <group> <command> [flags] [-- <argv>]

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const POLICY_SCHEMA = "dependabot-prep-policy:v4";
const EXIT_USAGE = 2;
const EXIT_CONFIG = 3;
// The npm package-name grammar, scoped or unscoped, with a leading dash
// excluded in both halves. It stops a policy value from becoming a `pnpm` flag
// or an alternative package specifier.
const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/u;
const CONFIG_FLAG = /^--config(?:=|$)/u;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

const policyPath = fileURLToPath(
  new URL("../.github/dependabot-prep-policy.json", import.meta.url),
);

function fail(exitCode, message) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
} catch (error) {
  fail(EXIT_CONFIG, `cannot read ${policyPath}: ${error.message}`);
}

if (policy.schema !== POLICY_SCHEMA) {
  fail(
    EXIT_CONFIG,
    `dependabot:claim requires ${POLICY_SCHEMA}, found ${policy.schema}`,
  );
}

const pin = policy.coordination?.claims?.package;
if (typeof pin?.name !== "string" || !PACKAGE_NAME.test(pin.name)) {
  fail(
    EXIT_CONFIG,
    "policy coordination.claims.package.name must be an npm package name",
  );
}
if (typeof pin?.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(pin.version)) {
  fail(
    EXIT_CONFIG,
    "policy coordination.claims.package.version must be an exact x.y.z version",
  );
}

// pnpm 10 forwards its own separator, so the documented
// `pnpm dependabot:claim -- claims claim ...` form arrives with a leading `--`
// (measured with pnpm 10.34.5). Drop it before the guard separator is located.
// A pnpm that strips its separator instead leaves nothing to drop.
const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();

// Split at the guard separator so a guarded child's argv stays intact.
const separator = argv.indexOf("--");
const head = separator === -1 ? argv : argv.slice(0, separator);
const tail = separator === -1 ? [] : argv.slice(separator);

// Only this wrapper's own flags are refused. A guarded child keeps its `--config`.
if (head.some((argument) => CONFIG_FLAG.test(argument))) {
  fail(
    EXIT_USAGE,
    "dependabot:claim supplies --config from repository policy; remove the flag",
  );
}

// Put `--config` immediately after the leading group and command words. No
// caller flag can then take the policy path as its value, and the flag still
// lands before the guard separator.
let insertAt = 0;
while (insertAt < head.length && !head[insertAt].startsWith("-")) {
  insertAt += 1;
}

const forwarded = [
  ...head.slice(0, insertAt),
  "--config",
  policyPath,
  ...head.slice(insertAt),
  ...tail,
];

const child = spawn(
  "pnpm",
  [
    "--config.ignore-scripts=true",
    `--package=${pin.name}@${pin.version}`,
    "dlx",
    "mento-issues",
    ...forwarded,
  ],
  { shell: false, stdio: "inherit" },
);

// A signal addressed to this process alone must not orphan a renewing guard.
let forwardedSignal = null;
for (const signal of FORWARDED_SIGNALS) {
  process.on(signal, () => {
    forwardedSignal = signal;
    child.kill(signal);
  });
}

child.on("error", (error) => {
  fail(
    EXIT_CONFIG,
    `cannot run pnpm dlx ${pin.name}@${pin.version}: ${error.message}`,
  );
});

// An interrupted run must not reach the caller as "proceed", and `128 + signal`
// is outside the documented exit rule, so a signal-killed child and a child that
// traps the signal and still exits 0 both report the rule's "stop and report".
child.on("exit", (code, signal) => {
  if (signal) {
    fail(EXIT_CONFIG, `mento-issues terminated by ${signal}`);
  }
  if (forwardedSignal !== null && code === 0) {
    fail(EXIT_CONFIG, `mento-issues interrupted by ${forwardedSignal}`);
  }
  process.exit(code ?? EXIT_CONFIG);
});
