import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// scripts/check-shell-size.mjs is a byte-identical copy of the file maintained
// in mento-protocol/agents, and its full suite lives there. These cases are a
// smoke test: they prove the copy and its mvdan-sh dependency work here.
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checkerPath = join(repositoryRoot, "scripts", "check-shell-size.mjs");

// Small limits keep the fixtures short. The checker reads both names from the
// environment.
const MAX_FILE_LINES = "20";
const MAX_FUNCTION_LINES = "3";

const SHORT_SCRIPT = `#!/usr/bin/env bash
short() {
  echo ok
}
`;

const LONG_SCRIPT = `#!/usr/bin/env bash
big_helper() {
  echo one
  echo two
  echo three
}
`;

function git(root, args) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function commitAll(root, message) {
  git(root, ["add", "--all"]);
  git(root, [
    "-c",
    "user.name=Shell Size Test",
    "-c",
    "user.email=shell-size-test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
}

function writeFile(root, path, contents) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

// A throwaway repository holding the checker, this repository's node_modules,
// and nothing else. The root is asserted first: without a repository of its
// own the checker walks up into the enclosing one, and every case would pass
// while testing nothing.
function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "shell-size-"));
  try {
    git(root, ["-c", "init.defaultBranch=main", "init", "--quiet"]);
    mkdirSync(join(root, "scripts"));
    copyFileSync(checkerPath, join(root, "scripts", "check-shell-size.mjs"));
    symlinkSync(
      join(repositoryRoot, "node_modules"),
      join(root, "node_modules"),
      "dir",
    );
    assert.equal(
      git(root, ["rev-parse", "--show-toplevel"]).trim(),
      realpathSync(root),
      "the fixture must be a repository of its own",
    );
    callback(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function runChecker(root, base = "") {
  return spawnSync(
    process.execPath,
    [join(root, "scripts", "check-shell-size.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MAX_FILE_LINES,
        MAX_FUNCTION_LINES,
        SHELL_SIZE_BASE: base,
      },
    },
  );
}

test("a tree within the limits passes", () => {
  withFixture((root) => {
    writeFile(root, "scripts/sample.sh", SHORT_SCRIPT);
    commitAll(root, "add a short shell script");

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /check-shell-size: ok/);
  });
});

test("a function over the limit fails and names the function", () => {
  withFixture((root) => {
    writeFile(root, "scripts/sample.sh", LONG_SCRIPT);
    commitAll(root, "add a long function");

    const result = runChecker(root);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /scripts\/sample\.sh:2: function big_helper is 5 lines, the limit is 3/,
    );
  });
});

test("a function row in the baseline exempts that function", () => {
  withFixture((root) => {
    writeFile(root, "scripts/sample.sh", LONG_SCRIPT);
    writeFile(
      root,
      "scripts/shell-size-baseline.txt",
      "# baseline\nscripts/sample.sh big_helper 5\n",
    );
    commitAll(root, "baseline the long function");

    const result = runChecker(root);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /check-shell-size: ok/);
  });
});

test("a row the base branch lacks is refused", () => {
  withFixture((root) => {
    writeFile(root, "scripts/sample.sh", LONG_SCRIPT);
    writeFile(root, "scripts/shell-size-baseline.txt", "# baseline\n");
    commitAll(root, "adopt the checker with no rows");
    writeFile(
      root,
      "scripts/shell-size-baseline.txt",
      "# baseline\nscripts/sample.sh big_helper 5\n",
    );

    const result = runChecker(root, "main");

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /scripts\/sample\.sh big_helper is not listed in main; a removed entry may not return/,
    );
  });
});
