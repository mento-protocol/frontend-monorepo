import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertMainTerminalReceipt,
  assertMainTerminalEvidence,
  createMainTerminalReceipt,
  createMainTerminalEvidence,
  decodeMainTerminalReceipt,
  decodeMainTerminalEvidence,
  digestMainTerminalEvidence,
  encodeMainTerminalReceipt,
  encodeMainTerminalEvidence,
  MAIN_TERMINAL_EVIDENCE_MAX_ENCODED_BYTES,
  MAIN_TERMINAL_RECEIPT_MAX_ENCODED_BYTES,
  MAIN_TERMINAL_RECEIPT_OUTCOMES,
} from "./vercel-main-terminal-receipt.mjs";

const SHA = "a".repeat(40);
const DIGEST = (value) => createHash("sha256").update(value).digest("hex");
const IDENTITY = Object.freeze({
  deploySha: SHA,
  upstreamRunId: "701",
  upstreamRunAttempt: "2",
  workflowRunId: "811",
  releaseId: `mr-${"b".repeat(24)}`,
  releaseManifestDigest: DIGEST("release-manifest"),
  releasePlanDigest: DIGEST("release-plan"),
  releaseExecutionDigest: DIGEST("release-execution"),
});

function proof(status, label) {
  return {
    status,
    digest: status === "not-required" ? null : DIGEST(label),
  };
}

function affectedOperation(overrides = {}) {
  return {
    operationId: "op-0001",
    target: "app",
    type: "app_v3_deploy",
    alias: null,
    state: "started",
    commandOutcome: null,
    mappingState: null,
    rollbackState: null,
    ...overrides,
  };
}

function receiptInput(outcome = "active-committed") {
  const contract = MAIN_TERMINAL_RECEIPT_OUTCOMES[outcome];
  const [mapping, census, state, smoke, legacy] = contract.proofs;
  return {
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: ["recovery-failed", "recovered-census-unproven"].includes(
      outcome,
    )
      ? "recover-main-deployment"
      : "activate-and-verify",
    evidenceDigest: DIGEST(`terminal-evidence:${outcome}`),
    outcome,
    finalMapping: proof(mapping, "mapping"),
    finalCensus: proof(census, "census"),
    stateProof: proof(state, "state"),
    publicSmoke: proof(smoke, "smoke"),
    freshLegacyV2: proof(legacy, "legacy"),
    mutationCount: contract.mutations ?? contract.minMutations ?? 0,
    rollbackTargets: contract.rollback === "required" ? ["governance"] : [],
    affectedOperations:
      outcome === "manual-intervention" ? [affectedOperation()] : [],
    journal:
      contract.journal === "not-applicable"
        ? { status: contract.journal, digest: null }
        : { status: contract.journal, digest: DIGEST(`journal:${outcome}`) },
  };
}

test("terminal receipt is canonical, self-digested, and compactly encoded", () => {
  const receipt = createMainTerminalReceipt(receiptInput());
  assert.deepEqual(assertMainTerminalReceipt(receipt, IDENTITY), receipt);
  const encoded = encodeMainTerminalReceipt(receipt);
  assert.ok(
    Buffer.byteLength(encoded, "utf8") <
      MAIN_TERMINAL_RECEIPT_MAX_ENCODED_BYTES,
  );
  assert.deepEqual(decodeMainTerminalReceipt(encoded, IDENTITY), receipt);
  assert.equal(
    receipt.digest,
    createMainTerminalReceipt(receiptInput()).digest,
  );
});

test("every terminal receipt outcome has a strict proof and journal contract", () => {
  for (const outcome of Object.keys(MAIN_TERMINAL_RECEIPT_OUTCOMES)) {
    const receipt = createMainTerminalReceipt(receiptInput(outcome));
    assert.equal(receipt.outcome, outcome);
  }

  const recovered = receiptInput("recovered");
  recovered.rollbackTargets = [];
  assert.throws(
    () => createMainTerminalReceipt(recovered),
    /requires rollback targets/,
  );

  const noTarget = receiptInput("no-target");
  noTarget.mutationCount = 1;
  assert.throws(
    () => createMainTerminalReceipt(noTarget),
    /mutation count conflicts/,
  );

  const committed = receiptInput("active-committed");
  committed.journal = { status: "recovered", digest: DIGEST("wrong") };
  assert.throws(
    () => createMainTerminalReceipt(committed),
    /journal conflicts/,
  );
});

test("recovery failure has a recovery-only, dynamic, tamper-evident terminal handoff", () => {
  const input = receiptInput("recovery-failed");
  input.producerJob = "recover-main-deployment";
  input.mutationCount = 17;
  const receipt = createMainTerminalReceipt(input);

  assert.deepEqual(
    [
      receipt.finalMapping.status,
      receipt.finalCensus.status,
      receipt.stateProof.status,
      receipt.publicSmoke.status,
      receipt.freshLegacyV2.status,
    ],
    ["unsafe", "unsafe", "unsafe", "not-required", "passed"],
  );
  assert.deepEqual(receipt.journal, {
    status: "recovery-failed",
    digest: DIGEST("journal:recovery-failed"),
  });
  assert.equal(receipt.mutationCount, 17);
  assert.deepEqual(receipt.rollbackTargets, []);
  assert.deepEqual(receipt.affectedOperations, []);

  assert.equal(
    createMainTerminalReceipt({ ...input, mutationCount: 0 }).mutationCount,
    0,
  );
  assert.throws(
    () => createMainTerminalReceipt({ ...input, mutationCount: -1 }),
    /mutation count is malformed/,
  );

  const encoded = encodeMainTerminalReceipt(receipt);
  assert.deepEqual(decodeMainTerminalReceipt(encoded, IDENTITY), receipt);

  const tampered = structuredClone(receipt);
  tampered.mutationCount = 18;
  const tamperedEncoded = Buffer.from(JSON.stringify(tampered)).toString(
    "base64url",
  );
  assert.throws(
    () => decodeMainTerminalReceipt(tamperedEncoded, IDENTITY),
    /self digest does not match/,
  );
  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...input,
        producerJob: "activate-and-verify",
      }),
    /requires the recovery producer job/,
  );
  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...input,
        rollbackTargets: ["governance"],
      }),
    /forbids rollback targets/,
  );
  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...input,
        affectedOperations: [affectedOperation()],
      }),
    /forbids affected operations/,
  );
});

test("recovered unproven census has a recovery-only durable terminal handoff", () => {
  const outcome = "recovered-census-unproven";
  const evidence = createMainTerminalEvidence({
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: "recover-main-deployment",
    outcome,
    affectedOperations: [],
    artifact: {
      censusFailure: "provider-read-transport",
      finalMapping: "prior",
      publicSmoke: "passed",
    },
  });
  const receipt = createMainTerminalReceipt({
    ...receiptInput(outcome),
    evidenceDigest: digestMainTerminalEvidence(evidence),
  });

  assert.deepEqual(
    [
      receipt.finalMapping.status,
      receipt.finalCensus.status,
      receipt.stateProof.status,
      receipt.publicSmoke.status,
      receipt.freshLegacyV2.status,
    ],
    ["passed", "unsafe", "unsafe", "passed", "passed"],
  );
  assert.equal(receipt.journal.status, "recovered");
  assert.deepEqual(receipt.rollbackTargets, ["governance"]);
  assert.deepEqual(
    decodeMainTerminalReceipt(encodeMainTerminalReceipt(receipt), IDENTITY),
    receipt,
  );
  assert.deepEqual(
    decodeMainTerminalEvidence(encodeMainTerminalEvidence(evidence), {
      receipt,
    }),
    evidence,
  );

  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...receiptInput(outcome),
        producerJob: "activate-and-verify",
      }),
    /requires the recovery producer job/,
  );
  assert.throws(
    () =>
      createMainTerminalEvidence({
        ...IDENTITY,
        producerRunAttempt: "2",
        producerJob: "activate-and-verify",
        outcome,
        affectedOperations: [],
        artifact: { censusFailure: "provider-read-transport" },
      }),
    /requires the recovery producer job/,
  );
  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...receiptInput(outcome),
        finalCensus: proof("passed", "census"),
      }),
    /proof statuses conflict/,
  );
});

test("current-release verification is a journal-free, zero-mutation success", () => {
  const receipt = createMainTerminalReceipt(
    receiptInput("current-release-verified"),
  );
  assert.equal(receipt.outcome, "current-release-verified");
  assert.deepEqual(receipt.journal, { status: "not-applicable", digest: null });
  assert.equal(receipt.mutationCount, 0);
  assert.deepEqual(receipt.rollbackTargets, []);
  assert.deepEqual(receipt.affectedOperations, []);
  for (const proof of [
    receipt.finalMapping,
    receipt.finalCensus,
    receipt.stateProof,
    receipt.publicSmoke,
    receipt.freshLegacyV2,
  ]) {
    assert.equal(proof.status, "passed");
    assert.match(proof.digest, /^[a-f0-9]{64}$/);
  }

  const evidence = createMainTerminalEvidence({
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: "activate-and-verify",
    outcome: "current-release-verified",
    affectedOperations: [],
    artifact: { finalState: "already-current", servedSha: SHA },
  });
  assert.equal(evidence.outcome, "current-release-verified");
});

test("current-release verification rejects journals, mutations, and incomplete proof evidence", () => {
  const input = receiptInput("current-release-verified");
  for (const [name, override, pattern] of [
    [
      "journal",
      { journal: { status: "committed", digest: DIGEST("journal") } },
      /journal conflicts/,
    ],
    ["mutation", { mutationCount: 1 }, /mutation count conflicts/],
    ["rollback", { rollbackTargets: ["ui"] }, /forbids rollback targets/],
    [
      "operations",
      { affectedOperations: [affectedOperation()] },
      /forbids affected operations/,
    ],
    [
      "wrong status",
      { publicSmoke: proof("not-required", "smoke") },
      /proof statuses conflict/,
    ],
    [
      "missing digest",
      { finalMapping: { status: "passed", digest: null } },
      /final mapping digest is malformed/,
    ],
    [
      "wrong digest",
      { stateProof: { status: "passed", digest: DIGEST("wrong").slice(1) } },
      /state proof digest is malformed/,
    ],
  ]) {
    assert.throws(
      () => createMainTerminalReceipt({ ...input, ...override }),
      pattern,
      name,
    );
  }
});

test("no-target receipt binds fresh legacy-v2 evidence after coordinator execution", () => {
  const noTarget = createMainTerminalReceipt(receiptInput("no-target"));
  assert.equal(noTarget.releaseId, IDENTITY.releaseId);
  assert.equal(noTarget.releasePlanDigest, IDENTITY.releasePlanDigest);
  assert.equal(
    noTarget.releaseExecutionDigest,
    IDENTITY.releaseExecutionDigest,
  );
  assert.deepEqual(noTarget.finalMapping, {
    status: "not-required",
    digest: null,
  });
  assert.equal(noTarget.freshLegacyV2.status, "passed");
  assert.equal(
    createMainTerminalReceipt(receiptInput("superseded-before-journal"))
      .freshLegacyV2.status,
    "passed",
  );
  assert.equal(
    createMainTerminalReceipt(receiptInput("shadow-prepared")).freshLegacyV2
      .status,
    "passed",
  );

  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...receiptInput("no-target"),
        releaseId: null,
      }),
    /release ID is malformed/,
  );
});

test("final-only rerun reconstructs retained canonical evidence without artifacts", () => {
  const evidence = createMainTerminalEvidence({
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: "activate-and-verify",
    outcome: "active-committed",
    affectedOperations: [],
    artifact: {
      aliases: ["app.mento.org", "reserve.mento.org"],
      finalState: "verified",
      servedSha: SHA,
    },
  });
  const coordinatorAtAttemptTwo = createMainTerminalReceipt({
    ...receiptInput(),
    evidenceDigest: digestMainTerminalEvidence(evidence),
  });
  const encoded = encodeMainTerminalReceipt(coordinatorAtAttemptTwo);
  const encodedEvidence = encodeMainTerminalEvidence(evidence);

  const finalOnlyAttemptThree = decodeMainTerminalReceipt(encoded, {
    ...IDENTITY,
    finalRunAttempt: "3",
  });
  assert.equal(finalOnlyAttemptThree.producerRunAttempt, "2");
  assert.equal(finalOnlyAttemptThree.producerJob, "activate-and-verify");
  const reconstructed = decodeMainTerminalEvidence(encodedEvidence, {
    receipt: finalOnlyAttemptThree,
  });
  assert.deepEqual(reconstructed, evidence);
  assert.deepEqual(
    assertMainTerminalEvidence(evidence, { receipt: coordinatorAtAttemptTwo }),
    evidence,
  );

  assert.throws(
    () =>
      decodeMainTerminalReceipt(encoded, {
        ...IDENTITY,
        workflowRunId: "812",
        finalRunAttempt: "3",
      }),
    /workflowRunId conflicts/,
  );
  assert.throws(
    () =>
      decodeMainTerminalReceipt(encoded, {
        ...IDENTITY,
        releasePlanDigest: DIGEST("other-plan"),
        finalRunAttempt: "3",
      }),
    /releasePlanDigest conflicts/,
  );
  assert.throws(
    () =>
      decodeMainTerminalReceipt(encoded, {
        ...IDENTITY,
        releaseExecutionDigest: DIGEST("other-execution"),
        finalRunAttempt: "3",
      }),
    /releaseExecutionDigest conflicts/,
  );
  assert.throws(
    () =>
      decodeMainTerminalEvidence(undefined, { receipt: finalOnlyAttemptThree }),
    /output is malformed/,
  );
  const noncanonicalJson = Buffer.from(
    `${JSON.stringify(evidence)}\n`,
    "utf8",
  ).toString("base64url");
  assert.throws(
    () =>
      decodeMainTerminalEvidence(noncanonicalJson, {
        receipt: finalOnlyAttemptThree,
      }),
    /cannot be decoded/,
  );
  const tamperedEvidence = structuredClone(evidence);
  tamperedEvidence.artifact.finalState = "forged";
  assert.throws(
    () =>
      assertMainTerminalEvidence(tamperedEvidence, {
        receipt: finalOnlyAttemptThree,
      }),
    /digest conflicts/,
  );
});

test("evidence preserves schema-owned field order and rejects unredacted or oversized artifacts", () => {
  const canonical = createMainTerminalEvidence({
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: "activate-and-verify",
    outcome: "verified-noop",
    affectedOperations: [],
    artifact: { mapping: "already-current", smoke: "passed" },
  });
  assert.ok(
    Buffer.byteLength(encodeMainTerminalEvidence(canonical), "utf8") <
      MAIN_TERMINAL_EVIDENCE_MAX_ENCODED_BYTES,
  );
  assert.deepEqual(
    Object.keys(
      createMainTerminalEvidence({
        ...IDENTITY,
        producerRunAttempt: "2",
        producerJob: "activate-and-verify",
        outcome: "verified-noop",
        affectedOperations: [],
        artifact: { smoke: "passed", mapping: "already-current" },
      }).artifact,
    ),
    ["smoke", "mapping"],
  );
  assert.throws(
    () =>
      createMainTerminalEvidence({
        ...IDENTITY,
        producerRunAttempt: "2",
        producerJob: "activate-and-verify",
        outcome: "verified-noop",
        affectedOperations: [],
        artifact: { authorization: "Bearer secret" },
      }),
    /not redacted/,
  );
  const oversized = createMainTerminalEvidence({
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: "activate-and-verify",
    outcome: "verified-noop",
    affectedOperations: [],
    artifact: { rows: Array.from({ length: 20 }, () => "x".repeat(4096)) },
  });
  assert.throws(() => encodeMainTerminalEvidence(oversized), /size bound/);
});

test("manual intervention stays terminal and re-emits unsafe evidence on a final-only rerun", () => {
  const evidence = createMainTerminalEvidence({
    ...IDENTITY,
    producerRunAttempt: "2",
    producerJob: "recover-main-deployment",
    outcome: "manual-intervention",
    affectedOperations: [affectedOperation()],
    artifact: {
      failure: "alias mapping did not converge",
      rollbackTargets: ["ui"],
    },
  });
  const receipt = createMainTerminalReceipt({
    ...receiptInput("manual-intervention"),
    producerJob: "recover-main-deployment",
    evidenceDigest: digestMainTerminalEvidence(evidence),
  });
  const rerunReceipt = decodeMainTerminalReceipt(
    encodeMainTerminalReceipt(receipt),
    {
      ...IDENTITY,
      finalRunAttempt: "3",
    },
  );
  const rerunEvidence = decodeMainTerminalEvidence(
    encodeMainTerminalEvidence(evidence),
    {
      receipt: rerunReceipt,
    },
  );
  assert.equal(rerunReceipt.outcome, "manual-intervention");
  assert.equal(rerunReceipt.journal.status, "manual-intervention");
  assert.equal(
    rerunEvidence.artifact.failure,
    "alias mapping did not converge",
  );
});

test("manual receipt carries an exact canonical affected-operation set without inventing rollback targets", () => {
  const affectedOperations = [
    affectedOperation({
      operationId: "op-0001",
      target: "app",
      type: "app_v3_deploy",
    }),
    affectedOperation({
      operationId: "op-0002",
      target: "app",
      type: "app_alias_set",
      alias: "app.mento.org",
      state: "verified",
      commandOutcome: "success",
      mappingState: "candidate",
    }),
    affectedOperation({
      operationId: "op-0003",
      target: "governance",
      type: "ordinary_rollback",
      state: "verified",
      commandOutcome: "success",
      mappingState: "prior",
      rollbackState: "entered",
    }),
  ];
  const receipt = createMainTerminalReceipt({
    ...receiptInput("manual-intervention"),
    mutationCount: affectedOperations.length,
    rollbackTargets: [],
    affectedOperations,
  });
  assert.deepEqual(receipt.affectedOperations, affectedOperations);
  assert.deepEqual(receipt.rollbackTargets, []);
  assert.equal(receipt.affectedOperations[0].state, "started");

  for (const [name, affected, mutationCount, pattern] of [
    ["empty", [], 1, /requires affected operations/],
    [
      "out of order",
      affectedOperations.toReversed(),
      affectedOperations.length,
      /not canonical/,
    ],
    [
      "duplicate",
      [affectedOperations[0], affectedOperations[0]],
      2,
      /not canonical/,
    ],
    [
      "count mismatch",
      affectedOperations,
      affectedOperations.length + 1,
      /mutation count conflicts/,
    ],
  ]) {
    assert.throws(
      () =>
        createMainTerminalReceipt({
          ...receiptInput("manual-intervention"),
          mutationCount,
          rollbackTargets: [],
          affectedOperations: affected,
        }),
      pattern,
      name,
    );
  }
  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...receiptInput("active-committed"),
        affectedOperations: [affectedOperations[0]],
      }),
    /forbids affected operations/,
  );
  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...receiptInput("manual-intervention"),
        affectedOperations: [
          affectedOperation({
            state: "started",
            commandOutcome: "unknown",
          }),
        ],
      }),
    /fields are inconsistent/,
  );
});

test("tampering, oversize output, and a future producer attempt fail closed", () => {
  const receipt = createMainTerminalReceipt(receiptInput());
  const tampered = structuredClone(receipt);
  tampered.mutationCount = 2;
  assert.throws(
    () => assertMainTerminalReceipt(tampered, IDENTITY),
    /self digest/,
  );

  assert.throws(
    () =>
      decodeMainTerminalReceipt(
        "a".repeat(MAIN_TERMINAL_RECEIPT_MAX_ENCODED_BYTES + 1),
      ),
    /size bound/,
  );

  const laterProducer = structuredClone(receipt);
  laterProducer.producerRunAttempt = "4";
  const redigested = createMainTerminalReceipt({
    ...receiptInput(),
    producerRunAttempt: "4",
  });
  assert.throws(
    () =>
      assertMainTerminalReceipt(redigested, {
        ...IDENTITY,
        finalRunAttempt: "3",
      }),
    /exceeds final attempt/,
  );
  assert.equal(laterProducer.producerRunAttempt, "4");
});

test("receipt rejects forbidden fields and noncanonical rollback target order", () => {
  const receipt = createMainTerminalReceipt({
    ...receiptInput("recovered"),
    rollbackTargets: ["governance", "reserve"],
  });
  const extra = { ...receipt, unexpected: true };
  assert.throws(() => assertMainTerminalReceipt(extra), /keys are missing/);
  assert.throws(
    () =>
      assertMainTerminalReceipt({
        ...receipt,
        schema: "vercel-main-terminal-receipt:v1",
      }),
    /schema is unsupported/,
  );

  assert.throws(
    () =>
      createMainTerminalReceipt({
        ...receiptInput("recovered"),
        rollbackTargets: ["reserve", "governance"],
      }),
    /not canonical/,
  );
});
