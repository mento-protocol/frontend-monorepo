import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES,
  MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS,
  MAIN_CANDIDATE_MAX_METADATA_BYTES,
  assertMainCandidateIntent,
  assertMainCandidateResolution,
  canonicalizeMainCandidateVercelMetadata,
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
  decodeMainCandidateReceipt,
  encodeMainCandidateReceipt,
  mainCandidateVercelMetadataByteLength,
  resolveMainCandidateProviderState,
} from "./vercel-main-candidate.mjs";
import { createMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";
import { planMainDeployments } from "./vercel-main-plan.mjs";

const SHA = "dddddddddddddddddddddddddddddddddddddddd";
const TRANSACTION_ID = "main-0123456789abcdef0123456789abcdef";
const fixtureUrl = new URL(
  "./fixtures/vercel-main-plan/valid-priors.json",
  import.meta.url,
);

function fixture() {
  return JSON.parse(readFileSync(fixtureUrl, "utf8"));
}

function planContext() {
  const input = fixture();
  const priorSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  for (const target of ["app", "governance", "reserve", "ui"]) {
    for (const state of input.priorStates[target].states)
      state.git.sha = priorSha;
  }
  const gitAdapter = {
    firstParent: () => input.firstParent,
    isAncestor: () => true,
    resolveCommit: (sha) => sha,
  };
  const plan = planMainDeployments({
    mode: input.mode,
    mainOwnershipMode: input.mainOwnershipMode,
    deploySha: input.deploySha,
    projectIds: input.projectIds,
    priorStates: input.priorStates,
    rollbackOnlyTargets: [],
    gitAdapter,
    runPlanner: ({ base, head }) => ({
      base,
      head,
      deployments: ["app", "governance", "reserve", "ui"],
      reason: "global-build-input",
    }),
  });
  const originalPriors = Object.fromEntries(
    ["governance", "reserve", "ui", "app"].map((target) => {
      const state = input.priorStates[target].states[0];
      const prior = plan.priors.find((entry) => entry.target === target);
      return [
        target,
        {
          deploymentId: prior.deploymentId,
          deploymentUrl: prior.deploymentUrl,
          aliases: prior.aliases,
          projectId: state.projectId,
          projectName: state.projectName,
          readyState: "READY",
          target: state.target,
          customEnvironmentSlug: state.customEnvironmentSlug,
          planningLeaves: input.priorStates[target].states.map((leaf) => ({
            alias: leaf.alias,
            deploymentId: prior.deploymentId,
            deploymentUrl: prior.deploymentUrl,
            aliases: prior.aliases,
            projectId: state.projectId,
            projectName: state.projectName,
            readyState: "READY",
            target: state.target,
            customEnvironmentSlug: state.customEnvironmentSlug,
            git: { status: "complete", ...leaf.git },
          })),
          servedSha: prior.servedSha,
        },
      ];
    }),
  );
  return createMainReleaseManifest({
    upstreamRunId: "800",
    plan,
    originalPriors,
  });
}

function intent(overrides = {}) {
  const releaseManifest = overrides.releaseManifest ?? planContext();
  const target = overrides.target ?? "ui";
  return createMainCandidateIntent({
    target,
    deploySha: SHA,
    upstreamRunId: "800",
    originRunId: "900",
    originAttempt: "2",
    originTransactionId: TRANSACTION_ID,
    projectId: releaseManifest.originalPriors[target].projectId,
    releaseManifest,
    ...overrides,
  });
}

function candidate(candidateIntent, overrides = {}) {
  return {
    deploymentId: "dpl_0123456789abcdef",
    deploymentUrl: "https://ui-candidate.vercel.app",
    projectId: candidateIntent.projectId,
    projectName: candidateIntent.projectName,
    readyState: "READY",
    target: candidateIntent.environment.target,
    customEnvironmentSlug: candidateIntent.environment.customEnvironmentSlug,
    source: "cli",
    git: {
      org: "mento-protocol",
      repo: "frontend-monorepo",
      ref: "main",
      sha: candidateIntent.deploySha,
    },
    metadata: canonicalizeMainCandidateVercelMetadata(
      createMainCandidateVercelMetadata({ intent: candidateIntent }),
      {
        target: candidateIntent.target,
        projectId: candidateIntent.projectId,
        projectName: candidateIntent.projectName,
        deploySha: candidateIntent.deploySha,
      },
    ),
    ...overrides,
  };
}

function smoke(state) {
  return {
    immutableUrl: state.deploymentUrl,
    servedSha: state.git.sha,
    status: "passed",
  };
}

function listing(ids) {
  return { deploymentIds: ids, complete: true };
}

function metadataContext(current) {
  return {
    target: current.target,
    projectId: current.projectId,
    projectName: current.projectName,
    deploySha: current.deploySha,
  };
}

test("stable candidate identity ignores downstream audit origin", () => {
  const first = intent();
  const rerun = intent({ originRunId: "901", originAttempt: "3" });
  assert.equal(first.releaseId, rerun.releaseId);
  assert.equal(first.candidateId, rerun.candidateId);
  assert.equal(first.stableIntentDigest, rerun.stableIntentDigest);
  assert.notEqual(first.digest, rerun.digest);
  assert.deepEqual(assertMainCandidateIntent(rerun), rerun);
});

test("intent binds the compact stable manifest and stable digest", () => {
  const current = intent();
  for (const mutate of [
    (value) => {
      value.releaseManifest.originalPriors.ui.deploymentId = "dpl_other123";
    },
    (value) => {
      value.projectId = "prj_other";
    },
    (value) => {
      value.reviewedAliasesDigest = "a".repeat(64);
    },
    (value) => {
      value.stableIntentDigest = "a".repeat(64);
    },
  ]) {
    const forged = structuredClone(current);
    mutate(forged);
    assert.throws(() => assertMainCandidateIntent(forged));
  }
});

test("metadata chunks round-trip the complete manifest within fixed field bounds", () => {
  const current = intent();
  const metadata = createMainCandidateVercelMetadata({ intent: current });
  const metadataBytes = mainCandidateVercelMetadataByteLength(metadata);
  const nonManifestFields = Object.keys(metadata).filter(
    (key) => !key.startsWith("mentoReleaseManifestChunk"),
  );
  assert.deepEqual(nonManifestFields, [
    "mentoCandidateSchema",
    "mentoReleaseId",
    "mentoCandidateId",
    "mentoNextDeploymentId",
    "mentoStableIntentDigest",
    "mentoReleaseManifestEncoding",
    "mentoOriginRunId",
    "mentoOriginRunAttempt",
    "mentoOriginTransactionId",
  ]);
  const actualEncoded = Array.from(
    { length: Number(metadata.mentoReleaseManifestChunkCount) },
    (_, index) => metadata[`mentoReleaseManifestChunk${index}`],
  ).join("");
  assert.deepEqual(
    JSON.parse(
      inflateRawSync(Buffer.from(actualEncoded, "base64url")).toString("utf8"),
    ),
    current.releaseManifest,
  );
  assert.ok(
    metadataBytes <= MAIN_CANDIDATE_MAX_METADATA_BYTES,
    `all-target manifest uses ${metadataBytes}/${MAIN_CANDIDATE_MAX_METADATA_BYTES} metadata bytes`,
  );
  assert.ok(
    Number(metadata.mentoReleaseManifestChunkCount) <=
      MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS,
    "all-target manifest must fit the enforced chunk bound",
  );
  const chunks = Object.entries(metadata).filter(
    ([key]) =>
      key.startsWith("mentoReleaseManifestChunk") &&
      key !== "mentoReleaseManifestChunkCount",
  );
  assert.ok(chunks.length > 1, "fixture proves multi-field encoding");
  for (const [, chunk] of chunks)
    assert.ok(chunk.length <= MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES);
  const canonical = canonicalizeMainCandidateVercelMetadata(
    metadata,
    metadataContext(current),
  );
  assert.deepEqual(canonical.releaseManifest, current.releaseManifest);
  assert.equal(canonical.stableIntentDigest, current.stableIntentDigest);
  const capacity = ["app", "governance", "reserve", "ui"].map((target) => {
    const candidateIntent = intent({ target });
    const candidateMetadata = createMainCandidateVercelMetadata({
      intent: candidateIntent,
    });
    return {
      bytes: mainCandidateVercelMetadataByteLength(candidateMetadata),
      chunks: Number(candidateMetadata.mentoReleaseManifestChunkCount),
    };
  });
  assert.ok(
    Math.max(...capacity.map(({ bytes }) => bytes)) <=
      MAIN_CANDIDATE_MAX_METADATA_BYTES,
    "every target's full four-prior manifest must fit the metadata bound",
  );
  assert.ok(
    Math.max(...capacity.map(({ chunks: count }) => count)) <=
      MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS,
    "every target's full four-prior manifest must fit the chunk bound",
  );
  for (const mutate of [
    (value) => {
      value.mentoReleaseManifestChunk0 = `${value.mentoReleaseManifestChunk0.slice(0, -1)}A`;
    },
    (value) => {
      delete value.mentoReleaseManifestChunk0;
    },
    (value) => {
      value.mentoReleaseManifestChunk99 = "A";
    },
    (value) => {
      value.mentoUnreviewedDuplicate = "forbidden";
    },
    (value) => {
      const left = value.mentoReleaseManifestChunk0;
      value.mentoReleaseManifestChunk0 = value.mentoReleaseManifestChunk1;
      value.mentoReleaseManifestChunk1 = left;
    },
  ]) {
    const forged = structuredClone(metadata);
    mutate(forged);
    assert.throws(() =>
      canonicalizeMainCandidateVercelMetadata(forged, metadataContext(current)),
    );
  }
});

test("metadata accepts a distinct valid deflate stream for the same canonical manifest", () => {
  const current = intent();
  const metadata = createMainCandidateVercelMetadata({ intent: current });
  const alternate = deflateRawSync(
    Buffer.from(JSON.stringify(current.releaseManifest), "utf8"),
    { level: 1 },
  ).toString("base64url");
  const chunks = alternate.match(
    new RegExp(`.{1,${MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES}}`, "g"),
  );
  const forged = structuredClone(metadata);
  for (const key of Object.keys(forged)) {
    if (/^mentoReleaseManifestChunk\d+$/.test(key)) delete forged[key];
  }
  forged.mentoReleaseManifestChunkCount = String(chunks.length);
  for (const [index, chunk] of chunks.entries()) {
    forged[`mentoReleaseManifestChunk${index}`] = chunk;
  }
  const canonical = canonicalizeMainCandidateVercelMetadata(
    forged,
    metadataContext(current),
  );
  assert.deepEqual(canonical.releaseManifest, current.releaseManifest);
  assert.equal(canonical.stableIntentDigest, current.stableIntentDigest);
});

test("metadata bounds reject decompression expansion before parsing", () => {
  const current = intent();
  const metadata = createMainCandidateVercelMetadata({ intent: current });
  const expansion = deflateRawSync(
    Buffer.from(JSON.stringify({ padding: "x".repeat(20_000) }), "utf8"),
    { level: 9 },
  ).toString("base64url");
  const chunks = expansion.match(
    new RegExp(`.{1,${MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES}}`, "g"),
  );
  const forged = structuredClone(metadata);
  for (const key of Object.keys(forged)) {
    if (/^mentoReleaseManifestChunk\d+$/.test(key)) delete forged[key];
  }
  forged.mentoReleaseManifestChunkCount = String(chunks.length);
  for (const [index, chunk] of chunks.entries()) {
    forged[`mentoReleaseManifestChunk${index}`] = chunk;
  }
  assert.throws(
    () =>
      canonicalizeMainCandidateVercelMetadata(forged, metadataContext(current)),
    /encoding is malformed/,
  );
});

test("metadata rejects GitHub ownership while accepting different audit origin", () => {
  const current = intent();
  const metadata = createMainCandidateVercelMetadata({ intent: current });
  const differentAudit = {
    ...metadata,
    mentoOriginRunId: "901",
    mentoOriginRunAttempt: "7",
    mentoOriginTransactionId: "main-ffffffffffffffffffffffffffffffff",
  };
  assert.equal(
    canonicalizeMainCandidateVercelMetadata(
      differentAudit,
      metadataContext(current),
    ).auditOrigin.originRunId,
    "901",
  );
  const missingAudit = { ...metadata };
  delete missingAudit.mentoOriginRunId;
  assert.throws(
    () =>
      canonicalizeMainCandidateVercelMetadata(
        missingAudit,
        metadataContext(current),
      ),
    /audit origin/,
  );
  assert.throws(
    () =>
      canonicalizeMainCandidateVercelMetadata(
        { ...metadata, githubDeployment: "1" },
        metadataContext(current),
      ),
    /GitHub-owned/,
  );
});

test("candidate resolver requires a stable zero/singleton census and detects deletion races", async () => {
  const current = intent();
  const state = candidate(current);
  const zero = await resolveMainCandidateProviderState({
    intent: current,
    listCandidateDeploymentIds: async () => listing([]),
    inspectCandidate: async () => assert.fail("zero listing cannot inspect"),
    smokeCandidate: async () => assert.fail("zero listing cannot smoke"),
  });
  assert.equal(zero.outcome, "create-if-zero");

  const duplicate = await resolveMainCandidateProviderState({
    intent: current,
    listCandidateDeploymentIds: async () =>
      listing([state.deploymentId, "dpl_abcdef0123456789"]),
    inspectCandidate: async () => state,
    smokeCandidate: async () => smoke(state),
  });
  assert.equal(duplicate.reason, "multiple-candidates");

  let lists = 0;
  const disappeared = await resolveMainCandidateProviderState({
    intent: current,
    listCandidateDeploymentIds: async () =>
      listing(lists++ === 0 ? [state.deploymentId] : []),
    inspectCandidate: async () => state,
    smokeCandidate: async () => smoke(state),
  });
  assert.equal(disappeared.reason, "provider-relisting");
});

test("receipt reuse gets a fresh immutable smoke and null reuse metrics", async () => {
  const first = intent({ originRunId: "900", originAttempt: "1" });
  const state = candidate(first);
  const receipt = createMainCandidateReceipt({
    intent: first,
    candidate: state,
    immutableSmoke: smoke(state),
  });
  const rerun = intent({ originRunId: "901", originAttempt: "2" });
  const result = await resolveMainCandidateProviderState({
    intent: rerun,
    receipt,
    listCandidateDeploymentIds: async () => listing([state.deploymentId]),
    inspectCandidate: async () => state,
    smokeCandidate: async () => smoke(state),
  });
  assert.equal(result.outcome, "reuse-from-receipt");
  assert.deepEqual(result.metrics, {
    buildDurationMs: null,
    deploymentDurationMs: null,
    cacheHit: null,
  });
  assert.deepEqual(assertMainCandidateResolution(result), result);
});

test("candidate receipt job output encoding is canonical and intent-bound", () => {
  const current = intent();
  const state = candidate(current);
  const receipt = createMainCandidateReceipt({
    intent: current,
    candidate: state,
    immutableSmoke: smoke(state),
  });
  const encoded = encodeMainCandidateReceipt(receipt, current);
  assert.deepEqual(decodeMainCandidateReceipt(encoded, current), receipt);
  assert.throws(
    () => decodeMainCandidateReceipt(encoded, intent({ target: "governance" })),
    /different intent/,
  );
  assert.throws(
    () => decodeMainCandidateReceipt(`${encoded}=`, current),
    /encoding is malformed/,
  );
});

test("every main candidate uses the ordinary production environment", () => {
  for (const target of ["app", "governance", "reserve", "ui"]) {
    assert.deepEqual(intent({ target }).environment, {
      target: "production",
      customEnvironmentSlug: null,
    });
  }
});
