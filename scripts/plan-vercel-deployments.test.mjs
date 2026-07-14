import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  planVercelDeployments,
  runTurboAffectedPlan,
  VERCEL_DEPLOYMENTS,
} from "./plan-vercel-deployments.mjs";

const scriptPath = fileURLToPath(
  new URL("./plan-vercel-deployments.mjs", import.meta.url),
);

function commit(directory, message) {
  execFileSync("git", ["add", "--all"], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Vercel Planner Test",
      "-c",
      "user.email=vercel-planner@example.invalid",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    { cwd: directory },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
}

function createFixture(changedPath) {
  const directory = mkdtempSync(join(tmpdir(), "vercel-plan-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  writeFileSync(join(directory, "seed.txt"), "base\n");
  const base = commit(directory, "base");
  const absolutePath = join(directory, changedPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, "changed\n");
  const head = commit(directory, "change");
  return { directory, base, head };
}

function createRenameFixture(sourcePath, destinationPath) {
  const directory = mkdtempSync(join(tmpdir(), "vercel-plan-rename-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  const absoluteSource = join(directory, sourcePath);
  mkdirSync(dirname(absoluteSource), { recursive: true });
  writeFileSync(absoluteSource, "base\n");
  const base = commit(directory, "base");
  const absoluteDestination = join(directory, destinationPath);
  mkdirSync(dirname(absoluteDestination), { recursive: true });
  execFileSync("git", ["mv", sourcePath, destinationPath], { cwd: directory });
  const head = commit(directory, "rename");
  return { directory, base, head };
}

function withFixture(changedPath, callback) {
  const fixture = createFixture(changedPath);
  try {
    callback(fixture);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
}

function turboPlan(packages) {
  return {
    tasks: packages.map((packageName) => ({
      package: packageName,
      task: "build",
      taskId: `${packageName}#build`,
    })),
  };
}

for (const [target, packageName] of [
  ["app", "app.mento.org"],
  ["governance", "governance.mento.org"],
  ["reserve", "reserve.mento.org"],
  ["ui", "ui.mento.org"],
]) {
  test(`plans only ${target} for an app-local build change`, () => {
    withFixture(`apps/${packageName}/app/page.tsx`, (fixture) => {
      const plan = planVercelDeployments({
        repoRoot: fixture.directory,
        base: fixture.base,
        head: fixture.head,
        runTurbo: () => turboPlan([packageName]),
      });
      assert.deepEqual(plan.deployments, [target]);
      assert.equal(plan.reason, "affected-packages");
      assert.equal(plan.base, fixture.base);
      assert.equal(plan.head, fixture.head);
    });
  });
}

test("packages/ui affects all four deployments", () => {
  withFixture("packages/ui/src/button.tsx", (fixture) => {
    const plan = planVercelDeployments({
      repoRoot: fixture.directory,
      base: fixture.base,
      head: fixture.head,
      runTurbo: () =>
        turboPlan([
          "ui.mento.org",
          "reserve.mento.org",
          "app.mento.org",
          "governance.mento.org",
        ]),
    });
    assert.deepEqual(plan.deployments, VERCEL_DEPLOYMENTS);
  });
});

test("packages/web3 affects app, governance, and reserve in stable order", () => {
  withFixture("packages/web3/src/config.ts", (fixture) => {
    const plan = planVercelDeployments({
      repoRoot: fixture.directory,
      base: fixture.base,
      head: fixture.head,
      runTurbo: () =>
        turboPlan([
          "reserve.mento.org",
          "governance.mento.org",
          "app.mento.org",
        ]),
    });
    assert.deepEqual(plan.deployments, ["app", "governance", "reserve"]);
  });
});

for (const globalPath of [
  "pnpm-lock.yaml",
  "turbo.json",
  ".npmrc",
  "patches/fix.patch",
  "scripts/security-headers.mjs",
  "scripts/plan-vercel-deployments.mjs",
  ".github/workflows/vercel-preview.yml",
]) {
  test(`fails closed for global input ${globalPath}`, () => {
    withFixture(globalPath, (fixture) => {
      let turboCalled = false;
      const plan = planVercelDeployments({
        repoRoot: fixture.directory,
        base: fixture.base,
        head: fixture.head,
        runTurbo: () => {
          turboCalled = true;
          return turboPlan([]);
        },
      });
      assert.deepEqual(plan.deployments, VERCEL_DEPLOYMENTS);
      assert.equal(plan.reason, "global-build-input");
      assert.equal(turboCalled, false);
    });
  });
}

for (const path of [
  "docs/vercel-deployments.md",
  "README.md",
  "apps/app.mento.org/app/page.test.tsx",
  "apps/governance.mento.org/e2e/lock.spec.ts",
  "packages/ui/src/__tests__/button.tsx",
  "packages/ui/src/__snapshots__/button.snap",
]) {
  test(`returns no deployments for proven non-runtime change ${path}`, () => {
    withFixture(path, (fixture) => {
      const plan = planVercelDeployments({
        repoRoot: fixture.directory,
        base: fixture.base,
        head: fixture.head,
        runTurbo: () => assert.fail("Turbo must not run for non-runtime paths"),
      });
      assert.deepEqual(plan.deployments, []);
      assert.equal(plan.reason, "non-runtime-only");
    });
  });
}

test("invalid or missing commits fail closed", () => {
  const fixture = createFixture("apps/app.mento.org/app/page.tsx");
  try {
    for (const [base, head] of [
      [undefined, fixture.head],
      [fixture.base, undefined],
      ["not-a-sha", fixture.head],
      ["0".repeat(40), fixture.head],
      [fixture.head, fixture.base],
    ]) {
      const plan = planVercelDeployments({
        repoRoot: fixture.directory,
        base,
        head,
      });
      assert.deepEqual(plan.deployments, VERCEL_DEPLOYMENTS);
      assert.equal(plan.reason, "invalid-commits");
    }
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("identical base and head fail closed as an empty diff", () => {
  const fixture = createFixture("apps/app.mento.org/app/page.tsx");
  try {
    const plan = planVercelDeployments({
      repoRoot: fixture.directory,
      base: fixture.head,
      head: fixture.head,
    });
    assert.deepEqual(plan.deployments, VERCEL_DEPLOYMENTS);
    assert.equal(plan.reason, "empty-diff");
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("a rename preserves the deleted global path and fails closed", () => {
  const fixture = createRenameFixture(
    ".github/workflows/deploy.yml",
    "docs/retired-deploy.yml",
  );
  try {
    let turboCalled = false;
    const plan = planVercelDeployments({
      repoRoot: fixture.directory,
      base: fixture.base,
      head: fixture.head,
      runTurbo: () => {
        turboCalled = true;
        return turboPlan([]);
      },
    });
    assert.deepEqual(plan.deployments, VERCEL_DEPLOYMENTS);
    assert.equal(plan.reason, "global-build-input");
    assert.equal(turboCalled, false);
  } finally {
    rmSync(fixture.directory, { force: true, recursive: true });
  }
});

test("malformed or ambiguous Turbo output fails closed", () => {
  for (const output of [{ nope: [] }, { tasks: [] }, { tasks: [{}] }]) {
    withFixture("packages/unknown/src/index.ts", (fixture) => {
      const plan = planVercelDeployments({
        repoRoot: fixture.directory,
        base: fixture.base,
        head: fixture.head,
        runTurbo: () => output,
      });
      assert.deepEqual(plan.deployments, VERCEL_DEPLOYMENTS);
      assert.equal(plan.reason, "turbo-planning-failed");
    });
  }
});

test("Turbo planning receives explicit SCM SHAs and dry-run arguments", () => {
  let invocation;
  const result = runTurboAffectedPlan({
    repoRoot: "/tmp/example",
    base: "a".repeat(40),
    head: "b".repeat(40),
    spawn: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: JSON.stringify(turboPlan(["ui.mento.org"])) };
    },
  });

  assert.deepEqual(result, turboPlan(["ui.mento.org"]));
  assert.equal(invocation.command, "pnpm");
  assert.deepEqual(invocation.args, [
    "exec",
    "turbo",
    "run",
    "build",
    "--affected",
    "--dry=json",
  ]);
  assert.equal(invocation.options.env.TURBO_SCM_BASE, "a".repeat(40));
  assert.equal(invocation.options.env.TURBO_SCM_HEAD, "b".repeat(40));
});

test("planner is self-contained for trusted-base execution", () => {
  const source = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(source, /from\s+["']\.\.?\//);
  assert.doesNotMatch(source, /import\s*\(["']\.\.?\//);
});

test("CLI emits stable fail-closed JSON when required SHAs are absent", () => {
  const output = execFileSync(process.execPath, [scriptPath], {
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(output), {
    deployments: VERCEL_DEPLOYMENTS,
    base: null,
    head: null,
    reason: "invalid-commits",
  });
});
