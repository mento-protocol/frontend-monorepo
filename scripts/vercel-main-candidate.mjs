import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  assertBridgeEraReleaseManifest,
  assertMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";
import { generateVercelMainCandidateDeploymentId } from "./vercel-prebuilt.mjs";
import { canonicalizeDeploymentUrl } from "./vercel-deployment-url.mjs";

const MAIN_CANDIDATE_INTENT_SCHEMA = "vercel-main-candidate-intent:v3";
const MAIN_CANDIDATE_RECEIPT_SCHEMA = "vercel-main-candidate-receipt:v3";
export const MAIN_CANDIDATE_RESOLUTION_SCHEMA =
  "vercel-main-candidate-resolution:v3";
const MAIN_CANDIDATE_REPOSITORY = "mento-protocol/frontend-monorepo";
const MAIN_CANDIDATE_METADATA_SCHEMA = "vercel-main-candidate-metadata:v3";
const MAIN_CANDIDATE_MANIFEST_ENCODING = "deflate-raw-base64url:v1";
export const MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES = 512;
export const MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS = 12;
const MAIN_CANDIDATE_MAX_MANIFEST_BYTES = 16_384;
export const MAIN_CANDIDATE_MAX_METADATA_BYTES = 8192;
const MAIN_CANDIDATE_RECEIPT_MAX_ENCODED_BYTES = 32 * 1024;
const MAIN_CANDIDATE_TARGETS = Object.freeze([
  "app",
  "governance",
  "reserve",
  "ui",
]);

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const POSITIVE_ID_PATTERN = /^[1-9][0-9]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const TRANSACTION_ID_PATTERN = /^main-[a-f0-9]{32}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const INTENT_KEYS = Object.freeze([
  "schema",
  "repository",
  "releaseId",
  "candidateId",
  "target",
  "environment",
  "deploySha",
  "upstreamRunId",
  "source",
  "projectId",
  "projectName",
  "releaseManifest",
  "stableIntentDigest",
  "originRunId",
  "originAttempt",
  "originTransactionId",
  "digest",
]);
const ENVIRONMENT_KEYS = Object.freeze(["target", "customEnvironmentSlug"]);
const CANDIDATE_KEYS = Object.freeze([
  "deploymentId",
  "deploymentUrl",
  "projectId",
  "projectName",
  "readyState",
  "target",
  "customEnvironmentSlug",
  "source",
  "git",
  "metadata",
]);
const GIT_KEYS = Object.freeze(["org", "repo", "ref", "sha"]);
const METADATA_KEYS = Object.freeze([
  "schema",
  "releaseId",
  "candidateId",
  "releaseManifest",
  "stableIntentDigest",
  "auditOrigin",
]);
const AUDIT_ORIGIN_KEYS = Object.freeze([
  "originRunId",
  "originAttempt",
  "originTransactionId",
]);
const SMOKE_KEYS = Object.freeze(["immutableUrl", "servedSha", "status"]);
const EMPTY_REUSE_METRICS = Object.freeze({
  buildDurationMs: null,
  deploymentDurationMs: null,
  cacheHit: null,
});
const METRICS_KEYS = Object.freeze(Object.keys(EMPTY_REUSE_METRICS));
const RECEIPT_KEYS = Object.freeze([
  "schema",
  "intent",
  "candidate",
  "immutableSmoke",
  "metrics",
  "digest",
]);
const RESOLUTION_KEYS = Object.freeze([
  "schema",
  "outcome",
  "reason",
  "intent",
  "candidate",
  "receipt",
  "immutableSmoke",
  "metrics",
]);

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} keys are missing, extra, or out of order`);
  }
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || value.length === 0 || !pattern.test(value)) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function requireCanonicalSha(value, label) {
  const sha = requireString(value, label, SHA_PATTERN);
  if (sha !== sha.toLowerCase()) throw new Error(`${label} is malformed`);
  return sha;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Every main candidate is an ordinary production deployment.
function expectedEnvironment(target) {
  if (!MAIN_CANDIDATE_TARGETS.includes(target)) {
    throw new Error(`Unknown main candidate target: ${String(target)}`);
  }
  return { target: "production", customEnvironmentSlug: null };
}

function expectedProjectName(target) {
  return `${target}.mento.org`;
}

function canonicalEnvironment(value, target) {
  assertExactKeys(value, ENVIRONMENT_KEYS, "Main candidate environment");
  const expected = expectedEnvironment(target);
  if (
    value.target !== expected.target ||
    value.customEnvironmentSlug !== expected.customEnvironmentSlug
  ) {
    throw new Error("Main candidate environment conflicts with target");
  }
  return { ...expected };
}

function canonicalAuditOrigin(value) {
  assertExactKeys(value, AUDIT_ORIGIN_KEYS, "Main candidate audit origin");
  return {
    originRunId: requireString(
      value.originRunId,
      "Main candidate origin run ID",
      POSITIVE_ID_PATTERN,
    ),
    originAttempt: requireString(
      value.originAttempt,
      "Main candidate origin attempt",
      POSITIVE_ID_PATTERN,
    ),
    originTransactionId: requireString(
      value.originTransactionId,
      "Main candidate origin transaction",
      TRANSACTION_ID_PATTERN,
    ),
  };
}

function stableIntentBody({
  releaseId,
  candidateId,
  target,
  environment,
  deploySha,
  upstreamRunId,
  source,
  projectId,
  projectName,
  releaseManifest,
}) {
  return {
    schema: MAIN_CANDIDATE_INTENT_SCHEMA,
    repository: MAIN_CANDIDATE_REPOSITORY,
    releaseId,
    candidateId,
    target,
    environment,
    deploySha,
    upstreamRunId,
    source,
    projectId,
    projectName,
    releaseManifest,
  };
}

function canonicalStableContext(
  { target, deploySha, upstreamRunId, projectId, projectName, releaseManifest },
  assertManifest = assertMainReleaseManifest,
) {
  const canonicalTarget = requireString(
    target,
    "Main candidate target",
    /^(?:app|governance|reserve|ui)$/,
  );
  const canonicalDeploySha = requireCanonicalSha(
    deploySha,
    "Main candidate SHA",
  );
  const canonicalUpstreamRunId = requireString(
    String(upstreamRunId),
    "Main candidate upstream run ID",
    POSITIVE_ID_PATTERN,
  );
  const canonicalProjectId = requireString(
    projectId,
    "Main candidate project ID",
    IDENTIFIER_PATTERN,
  );
  if (projectName !== expectedProjectName(canonicalTarget)) {
    throw new Error("Main candidate project name conflicts with target");
  }
  const manifest = assertManifest(releaseManifest);
  if (
    manifest.deploySha !== canonicalDeploySha ||
    manifest.upstreamRunId !== canonicalUpstreamRunId ||
    !manifest.stagedTargets.includes(canonicalTarget) ||
    manifest.originalPriors[canonicalTarget].projectId !== canonicalProjectId
  ) {
    throw new Error("Main candidate release manifest conflicts with candidate");
  }
  const releaseId = manifest.releaseId;
  const candidateId = generateVercelMainCandidateDeploymentId({
    repository: MAIN_CANDIDATE_REPOSITORY,
    target: canonicalTarget,
    commitSha: canonicalDeploySha,
    upstreamRunId: canonicalUpstreamRunId,
  });
  const environment = expectedEnvironment(canonicalTarget);
  const source = "cli";
  const body = stableIntentBody({
    releaseId,
    candidateId,
    target: canonicalTarget,
    environment,
    deploySha: canonicalDeploySha,
    upstreamRunId: canonicalUpstreamRunId,
    source,
    projectId: canonicalProjectId,
    projectName,
    releaseManifest: manifest,
  });
  return {
    ...body,
    stableIntentDigest: digest(body),
  };
}

function sameStableCandidateIdentity(left, right) {
  return left.stableIntentDigest === right.stableIntentDigest;
}

export function createMainCandidateIntent({
  target,
  deploySha,
  upstreamRunId,
  originRunId,
  originAttempt,
  originTransactionId,
  projectId,
  projectName = expectedProjectName(target),
  releaseManifest,
}) {
  const stable = canonicalStableContext({
    target,
    deploySha,
    upstreamRunId,
    projectId,
    projectName,
    releaseManifest,
  });
  const auditOrigin = canonicalAuditOrigin({
    originRunId,
    originAttempt,
    originTransactionId,
  });
  const intent = { ...stable, ...auditOrigin };
  return { ...intent, digest: digest(intent) };
}

export function assertMainCandidateIntent(value) {
  assertExactKeys(value, INTENT_KEYS, "Main candidate intent");
  if (
    value.schema !== MAIN_CANDIDATE_INTENT_SCHEMA ||
    value.repository !== MAIN_CANDIDATE_REPOSITORY
  ) {
    throw new Error("Main candidate intent schema is malformed");
  }
  const releaseManifest = assertMainReleaseManifest(value.releaseManifest);
  if (
    releaseManifest.releaseId !== value.releaseId ||
    releaseManifest.upstreamRunId !== value.upstreamRunId
  ) {
    throw new Error("Main candidate release manifest conflicts with intent");
  }
  const expected = createMainCandidateIntent({
    target: value.target,
    deploySha: value.deploySha,
    upstreamRunId: releaseManifest.upstreamRunId,
    originRunId: value.originRunId,
    originAttempt: value.originAttempt,
    originTransactionId: value.originTransactionId,
    projectId: value.projectId,
    projectName: value.projectName,
    releaseManifest,
  });
  canonicalEnvironment(value.environment, expected.target);
  if (
    value.candidateId !== expected.candidateId ||
    value.source !== expected.source ||
    value.stableIntentDigest !== expected.stableIntentDigest ||
    value.digest !== expected.digest
  ) {
    throw new Error("Main candidate intent digest or identity conflicts");
  }
  return structuredClone(expected);
}

function encodeManifest(manifest) {
  const serialized = JSON.stringify(assertMainReleaseManifest(manifest));
  if (
    Buffer.byteLength(serialized, "utf8") > MAIN_CANDIDATE_MAX_MANIFEST_BYTES
  ) {
    throw new Error(
      "Main candidate release manifest exceeds its raw size bound",
    );
  }
  const encoded = deflateRawSync(Buffer.from(serialized, "utf8"), {
    level: 9,
  }).toString("base64url");
  if (
    inflateRawSync(Buffer.from(encoded, "base64url"), {
      maxOutputLength: MAIN_CANDIDATE_MAX_MANIFEST_BYTES,
    }).toString("utf8") !== serialized
  ) {
    throw new Error("Main candidate release manifest encoding is unavailable");
  }
  const chunks =
    encoded.match(
      new RegExp(`.{1,${MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES}}`, "g"),
    ) ?? [];
  if (
    chunks.length === 0 ||
    chunks.length > MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS
  ) {
    throw new Error("Main candidate release manifest exceeds metadata bounds");
  }
  return chunks;
}

export function mainCandidateVercelMetadataByteLength(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Main candidate Vercel metadata is malformed");
  }
  const candidateMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key.startsWith("mento")),
  );
  return Buffer.byteLength(JSON.stringify(candidateMetadata), "utf8");
}

function decodeManifestBody(metadata) {
  const count = Number(metadata.mentoReleaseManifestChunkCount);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS
  ) {
    throw new Error("Main candidate release manifest chunk count is malformed");
  }
  const chunkKeys = Object.keys(metadata).filter(
    (key) =>
      key.startsWith("mentoReleaseManifestChunk") &&
      key !== "mentoReleaseManifestChunkCount",
  );
  const expectedKeys = Array.from(
    { length: count },
    (_, index) => `mentoReleaseManifestChunk${index}`,
  );
  if (
    JSON.stringify(chunkKeys.sort()) !==
    JSON.stringify([...expectedKeys].sort())
  ) {
    throw new Error(
      "Main candidate release manifest chunks are missing or extra",
    );
  }
  const encoded = expectedKeys
    .map((key) => {
      const chunk = metadata[key];
      if (
        typeof chunk !== "string" ||
        chunk.length > MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES ||
        !BASE64URL_PATTERN.test(chunk)
      ) {
        throw new Error("Main candidate release manifest chunk is malformed");
      }
      return chunk;
    })
    .join("");
  if (
    encoded.length >
    MAIN_CANDIDATE_MAX_MANIFEST_CHUNKS * MAIN_CANDIDATE_MANIFEST_CHUNK_BYTES
  ) {
    throw new Error("Main candidate release manifest encoding exceeds bounds");
  }
  let parsed;
  try {
    parsed = JSON.parse(
      inflateRawSync(Buffer.from(encoded, "base64url"), {
        maxOutputLength: MAIN_CANDIDATE_MAX_MANIFEST_BYTES,
      }).toString("utf8"),
    );
  } catch (error) {
    throw new Error(
      `Main candidate release manifest encoding is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parsed;
}

function decodeManifest(metadata, assertManifest) {
  const parsed = decodeManifestBody(metadata);
  const manifest = assertManifest(parsed);
  if (JSON.stringify(manifest) !== JSON.stringify(parsed)) {
    throw new Error("Main candidate release manifest is not canonical");
  }
  return manifest;
}

export function createMainCandidateVercelMetadata({ intent }) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  const manifest = assertMainReleaseManifest(canonicalIntent.releaseManifest);
  const chunks = encodeManifest(manifest);
  const metadata = {
    mentoCandidateSchema: MAIN_CANDIDATE_METADATA_SCHEMA,
    mentoReleaseId: canonicalIntent.releaseId,
    mentoCandidateId: canonicalIntent.candidateId,
    mentoNextDeploymentId: canonicalIntent.candidateId,
    mentoStableIntentDigest: canonicalIntent.stableIntentDigest,
    mentoReleaseManifestEncoding: MAIN_CANDIDATE_MANIFEST_ENCODING,
    mentoReleaseManifestChunkCount: String(chunks.length),
    ...Object.fromEntries(
      chunks.map((chunk, index) => [
        `mentoReleaseManifestChunk${index}`,
        chunk,
      ]),
    ),
    mentoOriginRunId: canonicalIntent.originRunId,
    mentoOriginRunAttempt: canonicalIntent.originAttempt,
    mentoOriginTransactionId: canonicalIntent.originTransactionId,
  };
  if (
    mainCandidateVercelMetadataByteLength(metadata) >
    MAIN_CANDIDATE_MAX_METADATA_BYTES
  ) {
    throw new Error("Main candidate Vercel metadata exceeds its bounded size");
  }
  return metadata;
}

function auditOriginFromMetadata(metadata) {
  const values = [
    metadata.mentoOriginRunId,
    metadata.mentoOriginRunAttempt,
    metadata.mentoOriginTransactionId,
  ];
  if (values.some((value) => value === undefined)) {
    throw new Error("Main candidate audit origin metadata is incomplete");
  }
  return canonicalAuditOrigin({
    originRunId: values[0],
    originAttempt: values[1],
    originTransactionId: values[2],
  });
}

function canonicalizeCandidateMetadata(metadata, context, assertManifest) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Main candidate Vercel metadata is malformed");
  }
  if (Object.hasOwn(metadata, "githubDeployment")) {
    throw new Error("GitHub-owned Vercel candidates cannot be reused");
  }
  if (
    mainCandidateVercelMetadataByteLength(metadata) >
    MAIN_CANDIDATE_MAX_METADATA_BYTES
  ) {
    throw new Error("Main candidate Vercel metadata exceeds its bounded size");
  }
  for (const field of [
    "mentoCandidateSchema",
    "mentoReleaseId",
    "mentoCandidateId",
    "mentoNextDeploymentId",
    "mentoStableIntentDigest",
    "mentoReleaseManifestEncoding",
    "mentoReleaseManifestChunkCount",
  ]) {
    if (typeof metadata[field] !== "string") {
      throw new Error("Main candidate Vercel metadata is incomplete");
    }
  }
  if (
    metadata.mentoCandidateSchema !== MAIN_CANDIDATE_METADATA_SCHEMA ||
    metadata.mentoReleaseManifestEncoding !== MAIN_CANDIDATE_MANIFEST_ENCODING
  ) {
    throw new Error("Main candidate Vercel metadata schema is malformed");
  }
  const manifest = decodeManifest(metadata, assertManifest);
  const allowedMetadataKeys = new Set([
    "mentoCandidateSchema",
    "mentoReleaseId",
    "mentoCandidateId",
    "mentoNextDeploymentId",
    "mentoStableIntentDigest",
    "mentoReleaseManifestEncoding",
    "mentoReleaseManifestChunkCount",
    "mentoOriginRunId",
    "mentoOriginRunAttempt",
    "mentoOriginTransactionId",
    ...Array.from(
      { length: Number(metadata.mentoReleaseManifestChunkCount) },
      (_, index) => `mentoReleaseManifestChunk${index}`,
    ),
  ]);
  if (
    Object.keys(metadata).some(
      (key) => key.startsWith("mento") && !allowedMetadataKeys.has(key),
    )
  ) {
    throw new Error("Main candidate Vercel metadata has unsupported fields");
  }
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("Main candidate metadata context is required");
  }
  const stable = canonicalStableContext(
    {
      target: context.target,
      deploySha: context.deploySha,
      upstreamRunId: manifest.upstreamRunId,
      projectId: context.projectId,
      projectName: context.projectName,
      releaseManifest: manifest,
    },
    assertManifest,
  );
  if (
    metadata.mentoReleaseId !== stable.releaseId ||
    metadata.mentoCandidateId !== stable.candidateId ||
    metadata.mentoNextDeploymentId !== stable.candidateId ||
    metadata.mentoStableIntentDigest !== stable.stableIntentDigest
  ) {
    throw new Error("Main candidate Vercel metadata stable fields conflict");
  }
  return {
    schema: MAIN_CANDIDATE_METADATA_SCHEMA,
    releaseId: stable.releaseId,
    candidateId: stable.candidateId,
    releaseManifest: manifest,
    stableIntentDigest: stable.stableIntentDigest,
    auditOrigin: auditOriginFromMetadata(metadata),
  };
}

export function canonicalizeMainCandidateVercelMetadata(metadata, context) {
  return canonicalizeCandidateMetadata(
    metadata,
    context,
    assertMainReleaseManifest,
  );
}

// True only for metadata that is a complete, internally consistent candidate
// seal whose embedded release manifest is bridge-era: the same schema, key
// allowlist, size bound, manifest structure, stable release/candidate identity,
// digest, and audit origin the current contract requires, with the single
// permitted difference being the manifest's App prior — the retired `v3`
// custom environment and one of that environment's two alias topologies. A
// corrupt or partially bridge-era seal fails one of those checks and is not
// admitted here, so it still reaches the ordinary assertion path and fails the
// run closed. Seals are immutable, so this admission is permanent.
//
// The stable body stays production-shaped for every target, deliberately.
// Verified by generating seals with the real modules at each merge commit
// (see `scripts/fixtures/vercel-main-candidate/historical-seals.json`):
//   - 3df6e091 (#890, bridge era) sealed App stable bodies with
//     `{target: "production", customEnvironmentSlug: null}` — its `v3` stable
//     body existed only on a read-side classifier, never on a sealing path.
//   - 1a362e5d (#879, pre-conversion) is the only code that ever bound
//     `{target: null, customEnvironmentSlug: "v3"}` into a stable body, and
//     only for App. Those App deployments live in the retired environment, so
//     `inspectDeploymentRecord` rejects them on the production expectation long
//     before their metadata is read.
// Admitting a `v3` stable body here would therefore admit a digest shape no
// reachable deployment carries, so it is refused.
export function isBridgeEraCandidateMetadata(metadata, context) {
  try {
    canonicalizeCandidateMetadata(
      metadata,
      context,
      assertBridgeEraReleaseManifest,
    );
    return true;
  } catch {
    return false;
  }
}

function canonicalCandidate(value, intent) {
  assertExactKeys(value, CANDIDATE_KEYS, "Main candidate provider state");
  const deploymentId = requireString(
    value.deploymentId,
    "Main candidate deployment ID",
    DEPLOYMENT_ID_PATTERN,
  );
  const deploymentUrl = canonicalizeDeploymentUrl(value.deploymentUrl);
  const projectId = requireString(
    value.projectId,
    "Main candidate provider project ID",
    IDENTIFIER_PATTERN,
  );
  const projectName = requireString(
    value.projectName,
    "Main candidate provider project name",
    IDENTIFIER_PATTERN,
  );
  if (
    projectId !== intent.projectId ||
    projectName !== intent.projectName ||
    value.readyState !== "READY" ||
    value.source !== "cli"
  ) {
    throw new Error("Main candidate provider state conflicts with intent");
  }
  const environment = canonicalEnvironment(
    {
      target: value.target,
      customEnvironmentSlug: value.customEnvironmentSlug,
    },
    intent.target,
  );
  assertExactKeys(value.git, GIT_KEYS, "Main candidate provider Git state");
  if (
    value.git.org !== "mento-protocol" ||
    value.git.repo !== "frontend-monorepo" ||
    value.git.ref !== "main" ||
    requireCanonicalSha(value.git.sha, "Main candidate provider Git SHA") !==
      intent.deploySha
  ) {
    throw new Error("Main candidate provider Git state conflicts with intent");
  }
  assertExactKeys(
    value.metadata,
    METADATA_KEYS,
    "Main candidate provider metadata",
  );
  const metadata = value.metadata;
  if (
    metadata.schema !== MAIN_CANDIDATE_METADATA_SCHEMA ||
    metadata.releaseId !== intent.releaseId ||
    metadata.candidateId !== intent.candidateId ||
    JSON.stringify(metadata.releaseManifest) !==
      JSON.stringify(intent.releaseManifest) ||
    metadata.stableIntentDigest !== intent.stableIntentDigest
  ) {
    throw new Error("Main candidate provider metadata conflicts with intent");
  }
  return {
    deploymentId,
    deploymentUrl,
    projectId,
    projectName,
    readyState: "READY",
    ...environment,
    source: "cli",
    git: { ...value.git },
    metadata: structuredClone(metadata),
  };
}

export function assertMainCandidateProviderCandidate(value, intent) {
  return canonicalCandidate(value, assertMainCandidateIntent(intent));
}

function canonicalImmutableSmoke(value, candidate, intent) {
  assertExactKeys(value, SMOKE_KEYS, "Main candidate immutable smoke");
  if (
    value.status !== "passed" ||
    canonicalizeDeploymentUrl(value.immutableUrl) !== candidate.deploymentUrl ||
    requireCanonicalSha(value.servedSha, "Main candidate smoke SHA") !==
      intent.deploySha
  ) {
    throw new Error("Main candidate immutable smoke conflicts with receipt");
  }
  return {
    immutableUrl: candidate.deploymentUrl,
    servedSha: intent.deploySha,
    status: "passed",
  };
}

function canonicalReuseMetrics(value) {
  assertExactKeys(value, METRICS_KEYS, "Main candidate metrics");
  if (JSON.stringify(value) !== JSON.stringify(EMPTY_REUSE_METRICS))
    throw new Error("Reused main candidate metrics must be empty");
  return { ...EMPTY_REUSE_METRICS };
}

export function createMainCandidateReceipt({
  intent,
  candidate,
  immutableSmoke,
}) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  const canonical = canonicalCandidate(candidate, canonicalIntent);
  const smoke = canonicalImmutableSmoke(
    immutableSmoke,
    canonical,
    canonicalIntent,
  );
  const receipt = {
    schema: MAIN_CANDIDATE_RECEIPT_SCHEMA,
    intent: canonicalIntent,
    candidate: canonical,
    immutableSmoke: smoke,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
  return { ...receipt, digest: digest(receipt) };
}

export function assertMainCandidateReceipt(value, expectedIntent = undefined) {
  assertExactKeys(value, RECEIPT_KEYS, "Main candidate receipt");
  if (value.schema !== MAIN_CANDIDATE_RECEIPT_SCHEMA)
    throw new Error("Main candidate receipt schema is malformed");
  const intent = assertMainCandidateIntent(value.intent);
  if (
    expectedIntent !== undefined &&
    !sameStableCandidateIdentity(
      intent,
      assertMainCandidateIntent(expectedIntent),
    )
  )
    throw new Error("Main candidate receipt belongs to a different intent");
  const candidate = canonicalCandidate(value.candidate, intent);
  const immutableSmoke = canonicalImmutableSmoke(
    value.immutableSmoke,
    candidate,
    intent,
  );
  const metrics = canonicalReuseMetrics(value.metrics);
  const receipt = {
    schema: MAIN_CANDIDATE_RECEIPT_SCHEMA,
    intent,
    candidate,
    immutableSmoke,
    metrics,
  };
  if (!DIGEST_PATTERN.test(value.digest) || value.digest !== digest(receipt))
    throw new Error("Main candidate receipt digest conflicts");
  return { ...receipt, digest: value.digest };
}

export function encodeMainCandidateReceipt(value, expectedIntent = undefined) {
  const canonical = assertMainCandidateReceipt(value, expectedIntent);
  const encoded = Buffer.from(JSON.stringify(canonical), "utf8").toString(
    "base64url",
  );
  if (
    Buffer.byteLength(encoded, "utf8") >
    MAIN_CANDIDATE_RECEIPT_MAX_ENCODED_BYTES
  ) {
    throw new Error("Main candidate receipt exceeds its output size bound");
  }
  return encoded;
}

export function decodeMainCandidateReceipt(
  encoded,
  expectedIntent = undefined,
) {
  if (
    typeof encoded !== "string" ||
    !BASE64URL_PATTERN.test(encoded) ||
    Buffer.byteLength(encoded, "utf8") >
      MAIN_CANDIDATE_RECEIPT_MAX_ENCODED_BYTES
  ) {
    throw new Error(
      "Main candidate receipt encoding is malformed or oversized",
    );
  }
  let parsed;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) {
      throw new Error("noncanonical base64url");
    }
    const serialized = decoded.toString("utf8");
    parsed = JSON.parse(serialized);
    if (JSON.stringify(parsed) !== serialized) {
      throw new Error("noncanonical JSON");
    }
  } catch {
    throw new Error("Main candidate receipt cannot be decoded");
  }
  return assertMainCandidateReceipt(parsed, expectedIntent);
}

function blocked(intent, reason) {
  return {
    schema: MAIN_CANDIDATE_RESOLUTION_SCHEMA,
    outcome: "blocked",
    reason,
    intent,
    candidate: null,
    receipt: null,
    immutableSmoke: null,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

export function assertMainCandidateResolution(value) {
  assertExactKeys(value, RESOLUTION_KEYS, "Main candidate resolution");
  if (value.schema !== MAIN_CANDIDATE_RESOLUTION_SCHEMA)
    throw new Error("Main candidate resolution schema is malformed");
  const intent = assertMainCandidateIntent(value.intent);
  const metrics = canonicalReuseMetrics(value.metrics);
  if (value.outcome === "blocked") {
    if (
      typeof value.reason !== "string" ||
      value.reason.length === 0 ||
      value.candidate !== null ||
      value.receipt !== null ||
      value.immutableSmoke !== null
    )
      throw new Error("Blocked main candidate resolution is malformed");
    return { ...value, intent, metrics };
  }
  if (value.reason !== null)
    throw new Error("Resolved main candidate resolution has a reason");
  if (value.outcome === "create-if-zero") {
    if (
      value.candidate !== null ||
      value.receipt !== null ||
      value.immutableSmoke !== null
    )
      throw new Error("Zero-candidate resolution is malformed");
    return { ...value, intent, metrics };
  }
  const candidate = canonicalCandidate(value.candidate, intent);
  const immutableSmoke = canonicalImmutableSmoke(
    value.immutableSmoke,
    candidate,
    intent,
  );
  if (value.outcome === "recover-from-intent" && value.receipt === null)
    return { ...value, intent, candidate, immutableSmoke, metrics };
  if (value.outcome === "reuse-from-receipt") {
    const receipt = assertMainCandidateReceipt(value.receipt, intent);
    if (
      candidate.deploymentId !== receipt.candidate.deploymentId ||
      candidate.deploymentUrl !== receipt.candidate.deploymentUrl
    )
      throw new Error("Reused main candidate conflicts with receipt");
    return { ...value, intent, candidate, receipt, immutableSmoke, metrics };
  }
  throw new Error("Main candidate resolution outcome is malformed");
}

function resolved(
  intent,
  outcome,
  candidate,
  receipt = null,
  immutableSmoke = null,
) {
  return {
    schema: MAIN_CANDIDATE_RESOLUTION_SCHEMA,
    outcome,
    reason: null,
    intent,
    candidate,
    receipt,
    immutableSmoke,
    metrics: { ...EMPTY_REUSE_METRICS },
  };
}

function canonicalProviderListing(value) {
  assertExactKeys(
    value,
    ["deploymentIds", "complete"],
    "Main candidate provider listing",
  );
  if (value.complete !== true || !Array.isArray(value.deploymentIds))
    throw new Error("Main candidate provider listing is incomplete");
  const ids = value.deploymentIds.map((id) =>
    requireString(
      id,
      "Main candidate listed deployment ID",
      DEPLOYMENT_ID_PATTERN,
    ),
  );
  if (new Set(ids).size !== ids.length)
    throw new Error("Main candidate provider listing is ambiguous");
  return ids;
}

async function listExact(intent, listCandidateDeploymentIds) {
  return canonicalProviderListing(
    await listCandidateDeploymentIds({
      projectId: intent.projectId,
      releaseId: intent.releaseId,
      candidateId: intent.candidateId,
      target: intent.target,
      environment: intent.environment,
      stableIntentDigest: intent.stableIntentDigest,
    }),
  );
}

async function relistExactCandidate({
  intent,
  deploymentId,
  listCandidateDeploymentIds,
}) {
  const ids = await listExact(intent, listCandidateDeploymentIds);
  return ids.length === 1 && ids[0] === deploymentId;
}

export async function resolveMainCandidateProviderState({
  intent,
  receipt = null,
  listCandidateDeploymentIds,
  inspectCandidate,
  smokeCandidate,
}) {
  const canonicalIntent = assertMainCandidateIntent(intent);
  if (typeof listCandidateDeploymentIds !== "function")
    throw new Error(
      "Main candidate provider listing implementation is required",
    );
  if (typeof inspectCandidate !== "function")
    throw new Error(
      "Main candidate provider inspection implementation is required",
    );
  if (typeof smokeCandidate !== "function")
    throw new Error("Main candidate smoke implementation is required");
  let ids;
  try {
    ids = await listExact(canonicalIntent, listCandidateDeploymentIds);
  } catch {
    return blocked(canonicalIntent, "provider-listing");
  }
  if (ids.length > 1) return blocked(canonicalIntent, "multiple-candidates");
  if (ids.length === 0) {
    try {
      if (
        (await listExact(canonicalIntent, listCandidateDeploymentIds))
          .length !== 0
      )
        return blocked(canonicalIntent, "provider-relisting");
      return resolved(canonicalIntent, "create-if-zero", null);
    } catch {
      return blocked(canonicalIntent, "provider-relisting");
    }
  }
  let canonicalReceipt = null;
  if (receipt !== null) {
    try {
      canonicalReceipt = assertMainCandidateReceipt(receipt, canonicalIntent);
    } catch {
      return blocked(canonicalIntent, "receipt-conflict");
    }
    if (canonicalReceipt.candidate.deploymentId !== ids[0])
      return blocked(
        canonicalIntent,
        "receipt-candidate-missing-or-conflicting",
      );
  }
  try {
    const candidate = canonicalCandidate(
      await inspectCandidate(ids[0]),
      canonicalIntent,
    );
    if (
      canonicalReceipt !== null &&
      (candidate.deploymentId !== canonicalReceipt.candidate.deploymentId ||
        candidate.deploymentUrl !== canonicalReceipt.candidate.deploymentUrl)
    )
      return blocked(canonicalIntent, "receipt-candidate-conflict");
    if (
      !(await relistExactCandidate({
        intent: canonicalIntent,
        deploymentId: candidate.deploymentId,
        listCandidateDeploymentIds,
      }))
    )
      return blocked(canonicalIntent, "provider-relisting");
    const reinspected = canonicalCandidate(
      await inspectCandidate(candidate.deploymentId),
      canonicalIntent,
    );
    if (
      reinspected.deploymentId !== candidate.deploymentId ||
      reinspected.deploymentUrl !== candidate.deploymentUrl
    )
      return blocked(canonicalIntent, "candidate-reinspection-conflict");
    const immutableSmoke = canonicalImmutableSmoke(
      await smokeCandidate(reinspected),
      reinspected,
      canonicalIntent,
    );
    return resolved(
      canonicalIntent,
      canonicalReceipt === null ? "recover-from-intent" : "reuse-from-receipt",
      reinspected,
      canonicalReceipt,
      immutableSmoke,
    );
  } catch {
    return blocked(
      canonicalIntent,
      canonicalReceipt === null
        ? "candidate-reinspection"
        : "receipt-reinspection",
    );
  }
}
