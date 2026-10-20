import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertVercelCliRuntimeContract } from "./vercel-cli-runtime-contract.mjs";
import { rotateVercelCliRuntimeContract } from "./rotate-vercel-runtime-contract.mjs";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = join("scripts", "vercel-cli-runtime");
const COPIED_FILES = Object.freeze([
  "package.json",
  join("patches", "jayson@4.3.0.patch"),
  join(RUNTIME, "contract.json"),
  join(RUNTIME, "package.json"),
  join(RUNTIME, "pnpm-lock.yaml"),
]);

function withRepositoryCopy(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rotate-runtime-")));
  try {
    for (const file of COPIED_FILES) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(join(REPOSITORY_ROOT, file), join(root, file));
    }
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readJson(root, file) {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

function assertContract(root) {
  return assertVercelCliRuntimeContract({
    rootPackageJsonPath: join(root, "package.json"),
    packageJsonPath: join(root, RUNTIME, "package.json"),
    lockfilePath: join(root, RUNTIME, "pnpm-lock.yaml"),
    contractPath: join(root, RUNTIME, "contract.json"),
    runtimeRootPath: root,
  });
}

test("a current runtime rotates to no change", () => {
  withRepositoryCopy((root) => {
    const contract = readFileSync(join(root, RUNTIME, "contract.json"));
    const installs = [];
    const result = rotateVercelCliRuntimeContract({
      repositoryRoot: root,
      install: (runtimeRoot) => installs.push(runtimeRoot),
    });
    assert.deepEqual(result, { overridesChanged: false, changes: [] });
    assert.deepEqual(installs, [join(root, RUNTIME)]);
    assert.deepEqual(
      readFileSync(join(root, RUNTIME, "contract.json")),
      contract,
    );
  });
});

test("a root override change is mirrored and the contract rotated", () => {
  withRepositoryCopy((root) => {
    const rootPackage = readJson(root, "package.json");
    rootPackage.pnpm.overrides["left-pad@<1.3.0"] = ">=1.3.0";
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(rootPackage, null, 2)}\n`,
    );
    assert.throws(() => assertContract(root), /manifest is not exact/u);
    const before = readJson(root, join(RUNTIME, "contract.json"));

    const result = rotateVercelCliRuntimeContract({
      repositoryRoot: root,
      install: () => {},
    });

    assert.equal(result.overridesChanged, true);
    assert.deepEqual(
      result.changes.map((change) => change.split(":")[0]),
      ["manifestSha256", "overridesSha256"],
    );
    assert.deepEqual(
      readJson(root, join(RUNTIME, "package.json")).pnpm.overrides,
      rootPackage.pnpm.overrides,
    );
    const after = readJson(root, join(RUNTIME, "contract.json"));
    assert.equal(after.vercelVersion, before.vercelVersion);
    assert.equal(after.registryIntegrity, before.registryIntegrity);
    assert.equal(after.lockfileSha256, before.lockfileSha256);
    assertContract(root);
  });
});

test("a regenerated runtime lockfile rotates its digest", () => {
  withRepositoryCopy((root) => {
    const result = rotateVercelCliRuntimeContract({
      repositoryRoot: root,
      install: (runtimeRoot) =>
        appendFileSync(join(runtimeRoot, "pnpm-lock.yaml"), "\n"),
    });
    assert.equal(result.overridesChanged, false);
    assert.deepEqual(
      result.changes.map((change) => change.split(":")[0]),
      ["lockfileSha256"],
    );
    assertContract(root);
  });
});
