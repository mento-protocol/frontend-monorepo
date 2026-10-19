// Drives scripts/cloud-session-setup.sh as a black box. The script only acts
// when CLAUDE_CODE_REMOTE is "true", and every tool it calls that would reach
// the network or the real machine (git, timeout, pnpm, ln) is stubbed on PATH,
// so a case is a scratch tree plus a handful of environment variables.
//
// The cases here cover the two guards: a plugin ref that is not a plain ref
// must be refused before it reaches `rm -rf` or `git clone`, and a failed
// `ln -s` must leave no alias directory behind, so a later session retries.

import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const setupScript = fileURLToPath(
  new URL("cloud-session-setup.sh", import.meta.url),
);

const stubs = {
  // Answers `rev-parse --show-toplevel` and makes `clone` create a checkout.
  git: `#!/bin/sh
printf 'git %s\\n' "$*" >>"$STUB_LOG"
case "$1" in
rev-parse) printf '%s\\n' "$STUB_REPOSITORY"; exit 0 ;;
clone) for a in "$@"; do d="$a"; done; mkdir -p "$d/.git" && printf 'stub\\n' >"$d/plugin.yaml"; exit 0 ;;
esac
exit 0
`,
  timeout: `#!/bin/sh
shift
exec "$@"
`,
  pnpm: `#!/bin/sh
printf 'pnpm %s\\n' "$*" >>"$STUB_LOG"
case "$1" in --version) printf '10.34.5\\n' ;; esac
exit 0
`,
  // STUB_LN_FAILS=1 reproduces a link that cannot be made.
  ln: `#!/bin/sh
printf 'ln %s\\n' "$*" >>"$STUB_LOG"
if [ "\${STUB_LN_FAILS:-0}" = "1" ]; then echo "stub ln: refused" >&2; exit 1; fi
exec /bin/ln "$@"
`,
};

const browsersManifest = JSON.stringify({
  browsers: [
    { name: "chromium", revision: "1200" },
    { name: "chromium-headless-shell", revision: "1200" },
    { name: "firefox", revision: "9" },
  ],
});

function writeFile(target, contents, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, mode === undefined ? undefined : { mode });
}

// Builds one scratch session: a repository with a .trunk/trunk.yaml carrying
// `ref`, an installed playwright-core manifest, a shipped browser tree and the
// stub binaries. The tree is removed after the case, pass or fail, so a red run
// leaves nothing behind in the temp directory.
function makeSession(ref, t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-session-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repo");
  const binaries = path.join(root, "bin");
  const browsers = path.join(root, "browsers");

  writeFile(
    path.join(repository, "package.json"),
    '{"packageManager":"pnpm@10.34.5"}\n',
  );
  writeFile(path.join(repository, "pnpm-lock.yaml"), "lockfileVersion: 9.0\n");
  writeFile(path.join(repository, "pnpm-workspace.yaml"), "packages: []\n");
  writeFile(path.join(repository, ".npmrc"), "public-hoist-pattern[]=*\n");
  writeFile(
    path.join(repository, ".trunk", "trunk.yaml"),
    `version: 0.1\nplugins:\n  sources:\n    - id: trunk\n      ref: ${ref}\n`,
  );
  writeFile(
    path.join(
      repository,
      "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/browsers.json",
    ),
    browsersManifest,
  );
  writeFile(
    path.join(browsers, "chromium-1100/chrome-linux/chrome"),
    "chrome\n",
    0o755,
  );
  writeFile(
    path.join(browsers, "chromium_headless_shell-1100/chrome-headless-shell"),
    "shell\n",
    0o755,
  );
  for (const [name, body] of Object.entries(stubs)) {
    writeFile(path.join(binaries, name), body, 0o755);
  }
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  return {
    root,
    repository,
    binaries,
    browsers,
    temporary: path.join(root, "tmp"),
  };
}

function runSetup(session, { linkFails = false } = {}) {
  const log = path.join(session.root, "calls.log");
  const result = spawnSync("bash", [setupScript], {
    cwd: session.repository,
    encoding: "utf8",
    env: {
      ...process.env,
      // eslint-disable-next-line turbo/no-undeclared-env-vars -- PATH is the test's own stub lookup, not a Turbo task input.
      PATH: `${session.binaries}${path.delimiter}${process.env.PATH}`,
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: session.repository,
      TMPDIR: session.temporary,
      PLAYWRIGHT_BROWSERS_PATH: session.browsers,
      STUB_LOG: log,
      STUB_REPOSITORY: session.repository,
      STUB_LN_FAILS: linkFails ? "1" : "0",
    },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
  fs.rmSync(log, { force: true });
  return { ...result, calls };
}

function countLines(text, needle) {
  return text.split("\n").filter((line) => line.includes(needle)).length;
}

test("a plain ref is cloned and both playwright aliases are linked", (t) => {
  const session = makeSession("v1.7.3", t);
  const run = runSetup(session);

  assert.equal(run.status, 0);
  assert.match(run.stdout, /trunk plugins at v1\.7\.3 ready/);
  assert.match(
    fs.readFileSync(path.join(session.repository, ".trunk/user.yaml"), "utf8"),
    new RegExp(`local: ${session.temporary}/trunk-plugins-v1\\.7\\.3`),
  );
  assert.ok(
    fs
      .lstatSync(path.join(session.browsers, "chromium-1200/chrome-linux64"))
      .isSymbolicLink(),
  );
  assert.ok(
    fs
      .lstatSync(
        path.join(
          session.browsers,
          "chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell",
        ),
      )
      .isSymbolicLink(),
  );
});

for (const ref of ["../../escape", "-o", ".hidden", "-", "v1..2/head"]) {
  test(`the ref ${JSON.stringify(ref)} is refused before rm -rf or git clone`, (t) => {
    const session = makeSession(ref, t);
    // Seed the override a previous session generated, so the absence assertion
    // below proves the refusal removes it rather than never writing one.
    writeFile(
      path.join(session.repository, ".trunk/user.yaml"),
      "# generated by scripts/cloud-session-setup.sh\n",
    );
    const run = runSetup(session);

    assert.equal(run.status, 0);
    assert.equal(countLines(run.stdout, "is not a plain ref"), 1);
    assert.doesNotMatch(run.calls, /git clone/);
    assert.equal(
      fs.existsSync(path.join(session.repository, ".trunk/user.yaml")),
      false,
    );
    assert.deepEqual(
      fs
        .readdirSync(session.temporary)
        .filter((entry) => entry.startsWith("trunk-plugins")),
      [],
    );
    // The session still gets its install and its browsers.
    assert.match(run.stdout, /dependencies installed/);
  });
}

test("a revision that is not a plain number is never built into a path", (t) => {
  const session = makeSession("v1.7.3", t);
  // The first segment names a revision directory the tree already has, so an
  // unguarded script resolves the rest and reaches <root>/escaped, outside the
  // browsers root it was given. A first segment that does not exist would stop
  // at `mkdir` on its own and prove nothing about the guard.
  const escape = "1100/../../escaped";
  writeFile(
    path.join(
      session.repository,
      "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core/browsers.json",
    ),
    JSON.stringify({ browsers: [{ name: "chromium", revision: escape }] }),
  );

  // `ln` succeeds here, so an alias an unguarded script built from the crafted
  // revision stays on disk rather than being removed by its own recovery.
  const run = runSetup(session);

  assert.equal(run.status, 0);
  assert.doesNotMatch(run.stdout, /aliased playwright browsers/);
  assert.doesNotMatch(run.stdout, /could not alias/);
  assert.equal(
    fs.existsSync(path.join(session.browsers, escape)),
    false,
    "nothing outside the browsers directory may be created",
  );
  assert.deepEqual(
    fs.readdirSync(session.browsers).sort(),
    ["chromium-1100", "chromium_headless_shell-1100"],
    "no alias directory may be created for the crafted revision",
  );
});

test("a failed ln leaves an alias another session owns alone", (t) => {
  const session = makeSession("v1.7.3", t);
  const owned = path.join(session.browsers, "chromium-1200");
  // What a concurrent session that already finished its alias leaves behind.
  writeFile(path.join(owned, "chrome-linux64/marker"), "other session\n");

  const run = runSetup(session, { linkFails: true });

  assert.equal(run.status, 0);
  assert.equal(
    fs.existsSync(path.join(owned, "chrome-linux64/marker")),
    true,
    "the alias of another session must survive this run",
  );
});

test("a failed ln leaves no alias directory, and the next run links it", (t) => {
  const session = makeSession("v1.7.3", t);
  const failed = runSetup(session, { linkFails: true });

  assert.equal(failed.status, 0);
  assert.equal(countLines(failed.stdout, "could not alias"), 2);
  assert.doesNotMatch(failed.stdout, /aliased playwright browsers/);
  assert.equal(
    fs.existsSync(path.join(session.browsers, "chromium-1200")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(session.browsers, "chromium_headless_shell-1200")),
    false,
  );

  const retried = runSetup(session);
  assert.match(retried.stdout, /aliased playwright browsers/);
  assert.ok(
    fs
      .lstatSync(path.join(session.browsers, "chromium-1200/chrome-linux64"))
      .isSymbolicLink(),
  );
});
