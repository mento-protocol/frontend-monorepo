import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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
  classifyAddedPaths,
  evaluateAddedPaths,
} from "./check-adr-reminder.mjs";

const scriptPath = fileURLToPath(
  new URL("./check-adr-reminder.mjs", import.meta.url),
);

function addFile(root, path, contents = "test\n") {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function commitAll(root, message) {
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=ADR Test",
      "-c",
      "user.email=adr-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    { cwd: root },
  );
}

function withRepository(callback) {
  const root = mkdtempSync(join(tmpdir(), "adr-reminder-"));
  try {
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet"], {
      cwd: root,
    });
    addFile(root, "README.md", "initial\n");
    commitAll(root, "initial");
    callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

test("detects newly added workflows and top-level workspace manifests", () => {
  const result = classifyAddedPaths([
    ".github/workflows/deploy.yml",
    ".github/workflows/release.yaml",
    "apps/explorer/package.json",
    "packages/analytics/package.json",
  ]);

  assert.equal(result.needsAdr, true);
  assert.deepEqual(
    result.triggers.map(({ path }) => path),
    [
      ".github/workflows/deploy.yml",
      ".github/workflows/release.yaml",
      "apps/explorer/package.json",
      "packages/analytics/package.json",
    ],
  );
});

test("stays quiet for lower-signal paths and nested example manifests", () => {
  const result = evaluateAddedPaths([
    ".github/actions/setup/action.yml",
    "apps/explorer/examples/demo/package.json",
    "docs/runbook.md",
    "package.json",
    "packages/ui/src/button.tsx",
  ]);

  assert.equal(result.needsAdr, false);
  assert.equal(result.message, "");
  assert.equal(result.exitCode, 0);
});

test("an added numbered ADR satisfies the reminder", () => {
  const result = evaluateAddedPaths(
    [".github/workflows/deploy.yml", "docs/adr/0002-deployment-controller.md"],
    { strict: true },
  );

  assert.equal(result.needsAdr, false);
  assert.deepEqual(result.adrPaths, ["docs/adr/0002-deployment-controller.md"]);
  assert.equal(result.exitCode, 0);
});

test("advisory mode reports but does not fail; strict mode fails", () => {
  const advisory = evaluateAddedPaths([".github/workflows/deploy.yml"]);
  const strict = evaluateAddedPaths([".github/workflows/deploy.yml"], {
    strict: true,
  });

  assert.match(advisory.message, /Architecture decision reminder/);
  assert.match(advisory.message, /new GitHub Actions workflow/);
  assert.equal(advisory.exitCode, 0);
  assert.equal(strict.exitCode, 1);
});

test("CLI only considers newly added files in the git diff", () => {
  withRepository((root) => {
    addFile(root, ".github/workflows/existing.yml", "name: Existing\n");
    commitAll(root, "add existing workflow");
    writeFileSync(
      join(root, ".github/workflows/existing.yml"),
      "name: Modified\n",
    );

    const modified = spawnSync(
      process.execPath,
      [scriptPath, "--base", "HEAD", "--strict"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(modified.status, 0, modified.stderr);
    assert.equal(modified.stdout, "");

    addFile(root, ".github/workflows/new.yml", "name: New\n");
    execFileSync("git", ["add", "--all"], { cwd: root });

    const advisory = spawnSync(
      process.execPath,
      [scriptPath, "--base", "HEAD"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(advisory.status, 0, advisory.stderr);
    assert.match(advisory.stdout, /\.github\/workflows\/new\.yml/);

    const strict = spawnSync(
      process.execPath,
      [scriptPath, "--base", "HEAD", "--strict"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(strict.status, 1, strict.stderr);
  });
});

test("CLI can include untracked files and recognizes a same-change ADR", () => {
  withRepository((root) => {
    addFile(root, "apps/new-app/package.json", "{}\n");

    const hidden = spawnSync(
      process.execPath,
      [scriptPath, "--base", "HEAD", "--strict"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(hidden.status, 0, hidden.stderr);

    const included = spawnSync(
      process.execPath,
      [scriptPath, "--base", "HEAD", "--include-untracked", "--strict"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(included.status, 1, included.stderr);

    addFile(root, "docs/adr/0002-new-app.md", "# ADR\n");
    const accompanied = spawnSync(
      process.execPath,
      [scriptPath, "--base", "HEAD", "--include-untracked", "--strict"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(accompanied.status, 0, accompanied.stderr);
    assert.equal(accompanied.stdout, "");
  });
});

test("CLI audits committed push content even when the working tree differs", () => {
  withRepository((root) => {
    execFileSync("git", ["branch", "base"], { cwd: root });
    addFile(root, ".github/workflows/deploy.yml", "name: Deploy\n");
    commitAll(root, "add deployment workflow");
    rmSync(join(root, ".github/workflows/deploy.yml"));

    const result = spawnSync(
      process.execPath,
      [scriptPath, "--base", "base", "--strict"],
      { cwd: root, encoding: "utf8" },
    );

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /\.github\/workflows\/deploy\.yml/);
  });
});

test("CLI compares divergent branches from their merge base", () => {
  withRepository((root) => {
    addFile(root, ".github/workflows/existing.yml", "name: Existing\n");
    commitAll(root, "add existing workflow");
    execFileSync("git", ["branch", "feature"], { cwd: root });

    rmSync(join(root, ".github/workflows/existing.yml"));
    commitAll(root, "remove existing workflow on main");
    execFileSync("git", ["switch", "--quiet", "feature"], { cwd: root });

    const result = spawnSync(
      process.execPath,
      [scriptPath, "--base", "main", "--strict"],
      { cwd: root, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
});

test("repository wiring keeps the reminder advisory and discoverable", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const trunk = readFileSync(
    new URL("../.trunk/trunk.yaml", import.meta.url),
    "utf8",
  );
  const markdownlint = readFileSync(
    new URL("../.trunk/configs/.markdownlint.yaml", import.meta.url),
    "utf8",
  );
  const template = readFileSync(
    new URL("../.github/pull_request_template.md", import.meta.url),
    "utf8",
  );
  const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  const claude = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.equal(
    packageJson.scripts["adr:check"],
    "node scripts/check-adr-reminder.mjs",
  );
  assert.equal(
    packageJson.scripts["adr:check:test"],
    "node --test scripts/check-adr-reminder.test.mjs",
  );
  assert.match(packageJson.scripts.test, /pnpm adr:check:test/);
  assert.match(
    trunk,
    /- id: adr-reminder-pre-push\n(?: {6}[^\n]+\n)* {6}run: pnpm adr:check\n {6}triggers:\n {8}- git_hooks: \[pre-push\]/,
  );
  assert.match(
    trunk,
    /enabled:\n(?: {4}- [^\n]+\n)* {4}- adr-reminder-pre-push(?:\s+# [^\n]+)?/,
  );
  assert.doesNotMatch(trunk, /run: pnpm adr:check --strict/);
  assert.match(markdownlint, /MD025:\n {2}front_matter_title: (?:""|'')/);
  assert.match(template, /Architecture decision\?/);
  assert.match(agents, /docs\/adr\//);
  assert.match(claude, /pnpm adr:check/);
  assert.match(readme, /pnpm adr:check/);
});
