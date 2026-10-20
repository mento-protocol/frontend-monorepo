import assert from "node:assert/strict";
import { test } from "node:test";
import { diffLockfileEdges, lockfileEdges } from "./lockfile-edge-diff.mjs";

function lockfile({ preact = "10.29.8", zod = "4.6.6" } = {}) {
  return `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      zod:
        specifier: ^4.6.6
        version: ${zod}

  apps/app.mento.org:
    dependencies:
      '@base-org/account':
        specifier: 2.4.0
        version: 2.4.0(react@19.2.0)(zod@${zod})

packages:

  preact@${preact}:
    resolution: {integrity: sha512-x}

snapshots:

  '@base-org/account@2.4.0(react@19.2.0)(zod@${zod})':
    dependencies:
      preact: ${preact}
      zod: ${zod}
    transitivePeerDependencies:
      - bufferutil

  preact@${preact}: {}

  zod@${zod}: {}
`;
}

test("lockfileEdges reads importer and snapshot edges without peer suffixes", () => {
  assert.deepEqual([...lockfileEdges(lockfile())].sort(), [
    "@base-org/account@2.4.0 -> preact@10.29.8",
    "@base-org/account@2.4.0 -> zod@4.6.6",
    "importer:. -> zod@4.6.6",
    "importer:apps/app.mento.org -> @base-org/account@2.4.0",
  ]);
});

test("diffLockfileEdges is empty for identical lockfiles", () => {
  assert.deepEqual(diffLockfileEdges(lockfile(), lockfile()), []);
});

test("diffLockfileEdges reports a drifted snapshot edge", () => {
  assert.deepEqual(
    diffLockfileEdges(lockfile(), lockfile({ preact: "11.0.0" })),
    [
      "- @base-org/account@2.4.0 -> preact@10.29.8",
      "+ @base-org/account@2.4.0 -> preact@11.0.0",
    ],
  );
});

test("diffLockfileEdges reports importer and snapshot edges together", () => {
  assert.deepEqual(diffLockfileEdges(lockfile(), lockfile({ zod: "4.6.7" })), [
    "- @base-org/account@2.4.0 -> zod@4.6.6",
    "- importer:. -> zod@4.6.6",
    "+ @base-org/account@2.4.0 -> zod@4.6.7",
    "+ importer:. -> zod@4.6.7",
  ]);
});
