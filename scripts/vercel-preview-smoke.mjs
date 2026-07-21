#!/usr/bin/env node

/* eslint-disable turbo/no-undeclared-env-vars -- this trusted entrypoint validates GitHub workflow-only inputs. */

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const PREVIEW_SMOKE_TARGETS = ["app", "governance", "reserve", "ui"];

const REPOSITORY = "mento-protocol/frontend-monorepo";
const VERCEL_ACTOR = Object.freeze({
  login: "vercel[bot]",
  id: 35_613_825,
  type: "Bot",
});
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9]+$/;
const VERCEL_DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const REF_PATTERN =
  /^(?![-/])(?!.*(?:\.\.|\/\/|@\{|[~^:?*[\\\s]))(?!.*(?:\/|\.|\.lock)$).+$/;
const MAXIMUM_RESPONSE_BYTES = 5 * 1024 * 1024;

const TARGET_CONTRACTS = Object.freeze({
  app: Object.freeze({
    hostPattern: /^appmento-[a-z0-9]{6,64}-mentolabs\.vercel\.app$/,
    nativeEnvironment: "Preview – app.mento.org",
    documentMarkers: ["Mento App", "Mento"],
  }),
  governance: Object.freeze({
    hostPattern: /^governancemento-[a-z0-9]{6,64}-mentolabs\.vercel\.app$/,
    nativeEnvironment: "Preview – governance.mento.org",
    documentMarkers: ["Mento Governance", "Governance"],
  }),
  reserve: Object.freeze({
    hostPattern: /^reservemento-[a-z0-9]{6,64}-mentolabs\.vercel\.app$/,
    nativeEnvironment: "Preview – reserve.mento.org",
    documentMarkers: ["Mento Reserve", "Supply Breakdown"],
  }),
  ui: Object.freeze({
    hostPattern: /^uimento-[a-z0-9]{6,64}-mentolabs\.vercel\.app$/,
    nativeEnvironment: "Preview – ui.mento.org",
    documentMarkers: ["Basic Components"],
  }),
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requiredText(value, label, pattern, maximum = 2_048) {
  invariant(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= maximum &&
      (!pattern || pattern.test(value)),
    `${label} is missing or invalid`,
  );
  return value;
}

function optionalEmpty(value, label) {
  invariant(
    value === undefined || value === null || value === "",
    `${label} must be empty`,
  );
}

function logicalTarget(value) {
  invariant(
    PREVIEW_SMOKE_TARGETS.includes(value),
    "Logical target is missing or invalid",
  );
  return value;
}

function positiveInteger(value, label) {
  const text = requiredText(String(value), label, POSITIVE_INTEGER_PATTERN, 20);
  const number = Number(text);
  invariant(Number.isSafeInteger(number), `${label} is missing or invalid`);
  return number;
}

export function immutableTargetPreviewUrl(value, target) {
  const contract = TARGET_CONTRACTS[logicalTarget(target)];
  const text = requiredText(value, "Vercel deployment URL");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(
      "Vercel deployment URL is not an immutable target preview URL",
    );
  }
  invariant(
    parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      contract.hostPattern.test(parsed.hostname),
    "Vercel deployment URL is not an immutable target preview URL",
  );
  return parsed.toString();
}

function nativeVerificationKey(githubDeploymentId, deploymentUrl) {
  const urlDigest = createHash("sha256").update(deploymentUrl).digest("hex");
  return {
    verificationKey: `vercel-native-preview:v1:deployment:${githubDeploymentId}:url-sha256:${urlDigest}`,
    urlDigest,
  };
}

function validateCommonMetadata(values, target, sha, deploymentUrl) {
  invariant(
    values.metadataLogicalTarget === target,
    "Metadata target mismatch",
  );
  invariant(
    values.metadataTarget === "preview",
    "Metadata Vercel target mismatch",
  );
  invariant(
    values.metadataRepository === REPOSITORY,
    "Metadata repository mismatch",
  );
  invariant(
    requiredText(values.metadataSha, "Metadata SHA", SHA_PATTERN) === sha,
    "Metadata SHA mismatch",
  );
  const metadataRef = requiredText(
    values.metadataRef,
    "Metadata ref",
    REF_PATTERN,
    255,
  );
  invariant(
    immutableTargetPreviewUrl(values.metadataUrl, target) === deploymentUrl,
    "Metadata URL mismatch",
  );
  return metadataRef;
}

function validateCredentialedTuple(values, common) {
  const expectedProjectId = requiredText(
    values.expectedProjectId,
    "Expected project ID",
    PROJECT_ID_PATTERN,
    128,
  );
  invariant(
    requiredText(
      values.metadataProjectId,
      "Metadata project ID",
      PROJECT_ID_PATTERN,
      128,
    ) === expectedProjectId,
    "Metadata project ID mismatch",
  );
  const vercelDeploymentId = requiredText(
    values.vercelDeploymentId,
    "Vercel Deployment ID",
    VERCEL_DEPLOYMENT_ID_PATTERN,
    128,
  );
  const nextDeploymentId = requiredText(
    values.nextDeploymentId,
    "Next.js deployment ID",
    new RegExp(`^m-${common.logicalTarget}-[0-9a-f]{19}$`),
    64,
  );
  optionalEmpty(values.metadataEnvironment, "Native metadata environment");
  optionalEmpty(values.metadataActorLogin, "Native metadata actor login");
  optionalEmpty(values.metadataActorId, "Native metadata actor ID");
  optionalEmpty(values.metadataActorType, "Native metadata actor type");
  return {
    ...common,
    expectedProjectId,
    vercelDeploymentId,
    nextDeploymentId,
  };
}

function validateControllerTuple(values, common) {
  const pullRequestNumber = positiveInteger(
    values.pullRequestNumber,
    "Pull request number",
  );
  const expectedKey = `vercel-preview:v1:pr:${pullRequestNumber}:target:${common.logicalTarget}:sha:${common.commitSha}`;
  invariant(
    values.verificationKey === expectedKey,
    "Controller verification key does not match the tuple",
  );
  return {
    ...validateCredentialedTuple(values, common),
    pullRequestNumber,
  };
}

function validateManualPilotTuple(values, common) {
  invariant(
    common.logicalTarget === "ui",
    "Manual pilot smoke supports only UI",
  );
  const runId = positiveInteger(values.workflowRunId, "Workflow run ID");
  const runAttempt = positiveInteger(
    values.workflowRunAttempt,
    "Workflow run attempt",
  );
  const expectedKey = `vercel-pilot:v1:ui:sha:${common.commitSha}:run:${runId}:attempt:${runAttempt}`;
  invariant(
    values.verificationKey === expectedKey,
    "Manual pilot verification key does not match the tuple",
  );
  optionalEmpty(values.pullRequestNumber, "Pull request number");
  return {
    ...validateCredentialedTuple(values, common),
    pullRequestNumber: null,
  };
}

function validateNativeTuple(values, common) {
  invariant(
    common.logicalTarget === "app" || common.logicalTarget === "governance",
    "Native adapter smoke supports only App and Governance",
  );
  const contract = TARGET_CONTRACTS[common.logicalTarget];
  invariant(
    values.metadataEnvironment === contract.nativeEnvironment,
    "Native metadata environment mismatch",
  );
  invariant(common.metadataRef !== "main", "Native adapter cannot smoke main");
  invariant(
    values.metadataActorLogin === VERCEL_ACTOR.login,
    "Native metadata actor login mismatch",
  );
  invariant(
    positiveInteger(values.metadataActorId, "Native metadata actor ID") ===
      VERCEL_ACTOR.id,
    "Native metadata actor ID mismatch",
  );
  invariant(
    values.metadataActorType === VERCEL_ACTOR.type,
    "Native metadata actor type mismatch",
  );
  const expected = nativeVerificationKey(
    common.githubDeploymentId,
    common.deploymentUrl,
  );
  invariant(
    values.verificationKey === expected.verificationKey,
    "Native verification key does not match the tuple",
  );
  optionalEmpty(values.pullRequestNumber, "Pull request number");
  optionalEmpty(values.expectedProjectId, "Expected project ID");
  optionalEmpty(values.metadataProjectId, "Metadata project ID");
  optionalEmpty(values.vercelDeploymentId, "Vercel Deployment ID");
  optionalEmpty(values.nextDeploymentId, "Next.js deployment ID");
  return {
    ...common,
    pullRequestNumber: null,
    expectedProjectId: null,
    vercelDeploymentId: null,
    nextDeploymentId: null,
    urlDigest: expected.urlDigest,
  };
}

export function validatePreviewSmokeTuple(values) {
  const target = logicalTarget(values.logicalTarget);
  const commitSha = requiredText(values.commitSha, "Commit SHA", SHA_PATTERN);
  const deploymentUrl = immutableTargetPreviewUrl(values.deploymentUrl, target);
  const githubDeploymentId = positiveInteger(
    values.githubDeploymentId,
    "GitHub Deployment ID",
  );
  const verificationMode = requiredText(
    values.verificationMode,
    "Verification mode",
    /^(?:controller|manual-pilot|native-adapter)$/,
    32,
  );
  const verificationKey = requiredText(
    values.verificationKey,
    "Verification key",
    undefined,
    512,
  );
  const metadataRef = validateCommonMetadata(
    values,
    target,
    commitSha,
    deploymentUrl,
  );
  const common = {
    logicalTarget: target,
    deploymentUrl,
    commitSha,
    githubDeploymentId,
    verificationMode,
    verificationKey,
    metadataRef,
  };

  if (verificationMode === "native-adapter")
    return validateNativeTuple(values, common);
  if (verificationMode === "manual-pilot")
    return validateManualPilotTuple(values, common);
  return validateControllerTuple(values, common);
}

function exactVercelActor(value) {
  return (
    isPlainObject(value) &&
    value.login === VERCEL_ACTOR.login &&
    value.id === VERCEL_ACTOR.id &&
    value.type === VERCEL_ACTOR.type
  );
}

function runtimeHasExactVercelActor(runtime) {
  // `actor` remains the original event actor on a workflow re-run, while
  // `triggering_actor` becomes the maintainer who requested that re-run.
  return (
    runtime.eventName === "deployment_status" &&
    runtime.repository === REPOSITORY &&
    runtime.actor === VERCEL_ACTOR.login &&
    String(runtime.actorId) === String(VERCEL_ACTOR.id)
  );
}

function nativeTargetFromEnvironment(environment) {
  return Object.entries(TARGET_CONTRACTS).find(
    ([target, contract]) =>
      (target === "app" || target === "governance") &&
      contract.nativeEnvironment === environment,
  )?.[0];
}

export function classifyNativePreviewEvent(event, runtime) {
  try {
    invariant(isPlainObject(event), "Event payload is invalid");
    const deployment = event.deployment;
    const status = event.deployment_status;
    invariant(
      isPlainObject(deployment) && isPlainObject(status),
      "Deployment event tuple is invalid",
    );

    const target = nativeTargetFromEnvironment(status.environment);
    if (!target || status.state !== "success") {
      return {
        eligible: false,
        reason: "not-app-governance-native-preview-success",
      };
    }
    const contract = TARGET_CONTRACTS[target];
    invariant(
      deployment.environment === contract.nativeEnvironment,
      "Deployment environment mismatch",
    );
    invariant(
      status.description === "Deployment has completed",
      "Deployment status description mismatch",
    );
    invariant(
      exactVercelActor(event.sender),
      "Event sender is not the exact Vercel bot",
    );
    invariant(
      exactVercelActor(deployment.creator),
      "Deployment creator is not the exact Vercel bot",
    );
    invariant(
      exactVercelActor(status.creator),
      "Status creator is not the exact Vercel bot",
    );
    invariant(
      runtimeHasExactVercelActor(runtime),
      "Workflow actor tuple is not the exact Vercel bot",
    );
    invariant(
      event.repository?.full_name === REPOSITORY,
      "Event repository mismatch",
    );
    invariant(deployment.task === "deploy", "Deployment task mismatch");
    invariant(
      isPlainObject(deployment.payload) &&
        Object.keys(deployment.payload).length === 0,
      "Native Deployment payload must be empty",
    );
    invariant(
      deployment.transient_environment === false,
      "Native preview transient flag mismatch",
    );
    const githubDeploymentId = positiveInteger(
      deployment.id,
      "GitHub Deployment ID",
    );
    const commitSha = requiredText(deployment.sha, "Commit SHA", SHA_PATTERN);
    const metadataRef = requiredText(
      deployment.ref,
      "Deployment ref",
      REF_PATTERN,
      255,
    );
    invariant(metadataRef !== "main", "Native adapter cannot smoke main");
    const deploymentUrl = immutableTargetPreviewUrl(
      status.environment_url,
      target,
    );
    invariant(
      immutableTargetPreviewUrl(status.log_url, target) === deploymentUrl,
      "Deployment status log URL mismatch",
    );
    const key = nativeVerificationKey(githubDeploymentId, deploymentUrl);
    return {
      eligible: true,
      reason: "exact-native-preview-success",
      logicalTarget: target,
      deploymentUrl,
      expectedSha: commitSha,
      githubDeploymentId: String(githubDeploymentId),
      verificationMode: "native-adapter",
      verificationKey: key.verificationKey,
      urlDigest: key.urlDigest,
      metadataLogicalTarget: target,
      metadataTarget: "preview",
      metadataRepository: REPOSITORY,
      metadataRef,
      metadataSha: commitSha,
      metadataUrl: deploymentUrl,
      metadataEnvironment: contract.nativeEnvironment,
      metadataActorLogin: VERCEL_ACTOR.login,
      metadataActorId: String(VERCEL_ACTOR.id),
      metadataActorType: VERCEL_ACTOR.type,
    };
  } catch (error) {
    return {
      eligible: false,
      reason: `rejected:${String(error?.message ?? error).slice(0, 200)}`,
    };
  }
}

function requireSecurityHeaders(response) {
  invariant(
    response.headers.get("content-security-policy") ===
      "frame-ancestors 'none'",
    "Preview response has an invalid content-security-policy",
  );
  invariant(
    response.headers.get("x-frame-options") === "DENY",
    "Preview response has an invalid x-frame-options",
  );
  invariant(
    response.headers.get("x-content-type-options") === "nosniff",
    "Preview response has an invalid x-content-type-options",
  );
}

async function readBoundedResponseBody(response, bodyType, controller) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const advertisedBytes = Number(contentLength);
    if (
      !Number.isSafeInteger(advertisedBytes) ||
      advertisedBytes < 0 ||
      advertisedBytes > MAXIMUM_RESPONSE_BYTES
    ) {
      controller.abort();
      throw new Error("Preview response is too large");
    }
  }
  invariant(
    response.body && typeof response.body.getReader === "function",
    "Preview response body is unavailable",
  );

  const reader = response.body.getReader();
  const chunks = [];
  let bodyBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      bodyBytes += chunk.byteLength;
      if (bodyBytes > MAXIMUM_RESPONSE_BYTES) {
        controller.abort();
        try {
          await reader.cancel("Preview response is too large");
        } catch {
          // Aborting the request can close the stream before cancel resolves.
        }
        throw new Error("Preview response is too large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(bodyBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bodyType === "text" ? new TextDecoder().decode(bytes) : bytes.buffer;
}

async function fetchWithTimeout(fetchImplementation, url, bodyType, timeoutMs) {
  invariant(
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 30_000,
    "Smoke request timeout is invalid",
  );
  const controller = new AbortController();
  let timer;
  try {
    const request = (async () => {
      const response = await fetchImplementation(url, {
        redirect: "follow",
        signal: controller.signal,
      });
      const body = await readBoundedResponseBody(
        response,
        bodyType,
        controller,
      );
      return { response, body };
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Preview smoke request timed out"));
      }, timeoutMs);
    });
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function representativeAssets(html, baseUrl) {
  const references = [
    ...html.matchAll(/(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g),
  ].map((match) => match[1].replaceAll("&amp;", "&"));
  invariant(
    references.length <= 512,
    "Preview HTML contains too many static asset references",
  );

  const assets = [];
  const seen = new Set();
  for (const reference of references) {
    let asset;
    try {
      asset = new URL(reference, baseUrl);
    } catch {
      throw new Error("Preview HTML contains an invalid static asset URL");
    }
    invariant(
      asset.origin === baseUrl.origin,
      "Preview HTML contains a cross-origin static asset",
    );
    if (seen.has(asset.toString())) continue;
    seen.add(asset.toString());
    assets.push(asset);
  }

  const script = assets.find((asset) => asset.pathname.endsWith(".js"));
  const style = assets.find((asset) => asset.pathname.endsWith(".css"));
  invariant(script, "Preview HTML is missing a representative .js asset");
  invariant(style, "Preview HTML is missing a representative .css asset");

  const optionalAssets = assets.filter((asset) =>
    /\.(?:avif|gif|ico|jpe?g|otf|png|svg|ttf|webp|woff2?)$/i.test(
      asset.pathname,
    ),
  );
  invariant(
    optionalAssets.length <= 32,
    "Preview HTML contains too many font or image assets",
  );
  return [script, style, ...optionalAssets];
}

function requireUiHtmlDeploymentIdentity(html, expectedDeploymentId) {
  const deploymentIds = [
    ...html.matchAll(/\bdata-dpl-id=(["'])([^"']+)\1/g),
  ].map((match) => match[2]);
  invariant(
    deploymentIds.length === 1 && deploymentIds[0] === expectedDeploymentId,
    "UI preview HTML does not carry only the expected build deployment ID",
  );
}

export async function smokePreviewHttp({
  values,
  fetchImplementation = fetch,
  requestTimeoutMs = 15_000,
}) {
  const tuple = validatePreviewSmokeTuple(values);
  const baseUrl = new URL(tuple.deploymentUrl);
  const { response, body } = await fetchWithTimeout(
    fetchImplementation,
    baseUrl,
    "text",
    requestTimeoutMs,
  );
  invariant(response.ok, `Preview returned HTTP ${response.status}`);
  invariant(
    new URL(response.url || baseUrl).origin === baseUrl.origin,
    "Preview escaped the immutable deployment origin",
  );
  requireSecurityHeaders(response);
  const html = String(body);
  invariant(
    TARGET_CONTRACTS[tuple.logicalTarget].documentMarkers.some((marker) =>
      html.includes(marker),
    ),
    "Preview did not render a target-specific document marker",
  );
  if (tuple.logicalTarget === "ui") {
    requireUiHtmlDeploymentIdentity(html, tuple.nextDeploymentId);
  }
  const assets = representativeAssets(html, baseUrl);
  for (const asset of assets) {
    if (tuple.nextDeploymentId) {
      const deploymentIds = asset.searchParams.getAll("dpl");
      invariant(
        deploymentIds.length === 1 &&
          deploymentIds[0] === tuple.nextDeploymentId,
        "Preview asset does not carry only the target-bound build ID",
      );
    }
    const assetResult = await fetchWithTimeout(
      fetchImplementation,
      asset,
      "bytes",
      requestTimeoutMs,
    );
    invariant(
      assetResult.response.ok,
      `Preview asset returned HTTP ${assetResult.response.status}`,
    );
    invariant(
      new URL(assetResult.response.url || asset).origin === baseUrl.origin,
      "Preview asset escaped the immutable deployment origin",
    );
  }
  return {
    logicalTarget: tuple.logicalTarget,
    deploymentUrl: tuple.deploymentUrl,
    commitSha: tuple.commitSha,
    githubDeploymentId: tuple.githubDeploymentId,
    checkedAssets: assets.length,
  };
}

function tupleFromEnvironment(environment = process.env) {
  return {
    logicalTarget: environment.LOGICAL_TARGET,
    deploymentUrl: environment.VERCEL_DEPLOYMENT_URL,
    commitSha: environment.DEPLOY_SHA,
    pullRequestNumber: environment.PULL_REQUEST_NUMBER,
    githubDeploymentId: environment.GITHUB_DEPLOYMENT_ID,
    verificationMode: environment.VERIFICATION_MODE,
    verificationKey: environment.VERIFICATION_KEY,
    workflowRunId: environment.WORKFLOW_RUN_ID,
    workflowRunAttempt: environment.WORKFLOW_RUN_ATTEMPT,
    vercelDeploymentId: environment.VERCEL_DEPLOYMENT_ID,
    nextDeploymentId: environment.MENTO_NEXT_DEPLOYMENT_ID,
    expectedProjectId: environment.EXPECTED_PROJECT_ID,
    metadataLogicalTarget: environment.METADATA_LOGICAL_TARGET,
    metadataProjectId: environment.METADATA_PROJECT_ID,
    metadataTarget: environment.METADATA_TARGET,
    metadataRepository: environment.METADATA_REPOSITORY,
    metadataRef: environment.METADATA_REF,
    metadataSha: environment.METADATA_SHA,
    metadataUrl: environment.METADATA_URL,
    metadataEnvironment: environment.METADATA_ENVIRONMENT,
    metadataActorLogin: environment.METADATA_ACTOR_LOGIN,
    metadataActorId: environment.METADATA_ACTOR_ID,
    metadataActorType: environment.METADATA_ACTOR_TYPE,
  };
}

function writeOutput(name, value) {
  invariant(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT is required");
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function writeClassificationOutputs(classification) {
  const names = [
    "eligible",
    "reason",
    "logicalTarget",
    "deploymentUrl",
    "expectedSha",
    "githubDeploymentId",
    "verificationMode",
    "verificationKey",
    "metadataLogicalTarget",
    "metadataTarget",
    "metadataRepository",
    "metadataRef",
    "metadataSha",
    "metadataUrl",
    "metadataEnvironment",
    "metadataActorLogin",
    "metadataActorId",
    "metadataActorType",
  ];
  for (const name of names) {
    const outputName = name.replaceAll(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`,
    );
    writeOutput(outputName, classification[name] ?? "");
  }
}

async function runCli(command) {
  if (command === "classify-native") {
    const eventPath = requiredText(
      process.env.GITHUB_EVENT_PATH,
      "GITHUB_EVENT_PATH",
      undefined,
      4_096,
    );
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const classification = classifyNativePreviewEvent(event, {
      eventName: process.env.GITHUB_EVENT_NAME,
      repository: process.env.GITHUB_REPOSITORY,
      actor: process.env.GITHUB_ACTOR,
      actorId: process.env.GITHUB_ACTOR_ID,
      triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR,
    });
    writeClassificationOutputs(classification);
    process.stdout.write(
      `${JSON.stringify({ eligible: classification.eligible, reason: classification.reason })}\n`,
    );
    return;
  }
  if (command === "validate") {
    const tuple = validatePreviewSmokeTuple(tupleFromEnvironment());
    writeOutput("logical_target", tuple.logicalTarget);
    writeOutput("deployment_url", tuple.deploymentUrl);
    writeOutput("expected_sha", tuple.commitSha);
    writeOutput(
      "artifact_identity",
      `${tuple.logicalTarget}-${tuple.commitSha}-${tuple.githubDeploymentId}`,
    );
    return;
  }
  if (command === "http") {
    process.stdout.write(
      `${JSON.stringify(await smokePreviewHttp({ values: tupleFromEnvironment() }))}\n`,
    );
    return;
  }
  throw new Error("Expected classify-native, validate, or http command");
}

function isCliEntrypoint() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isCliEntrypoint()) await runCli(process.argv[2]);
