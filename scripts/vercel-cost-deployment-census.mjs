#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalizeMainCandidateVercelMetadata } from "./vercel-main-candidate.mjs";

export const VERCEL_DEPLOYMENT_PAGES_SCHEMA = "vercel-deployment-pages:v1";
export const VERCEL_DEPLOYMENT_CENSUS_PROOF_SCHEMA =
  "vercel-deployment-census-proof:v1";

const TARGETS = Object.freeze(["app", "governance", "reserve", "ui"]);
const PATHS = Object.freeze(["preview", "main", "legacy-v2", "unknown"]);
const SOURCES = Object.freeze([
  "github-actions-prebuilt",
  "vercel-native",
  "manual",
  "unknown",
]);
const OUTCOMES = new Map([
  ["READY", "ready"],
  ["ERROR", "error"],
  ["CANCELED", "canceled"],
]);
const PROVIDER_STATES = new Set([
  "BLOCKED",
  "BUILDING",
  "CANCELED",
  "DELETED",
  "ERROR",
  "INITIALIZING",
  "QUEUED",
  "READY",
]);
const ENVELOPE_KEYS = Object.freeze([
  "schema",
  "window",
  "projects",
  "annotations",
]);
const WINDOW_KEYS = Object.freeze(["startUtc", "endUtcExclusive"]);
const PROJECT_KEYS = Object.freeze(["target", "projectId", "query", "pages"]);
const QUERY_KEYS = Object.freeze([
  "path",
  "teamId",
  "projectId",
  "since",
  "until",
  "limit",
]);
const PAGE_KEYS = Object.freeze(["requestCursor", "response"]);
const RESPONSE_KEYS = Object.freeze(["deployments", "pagination"]);
const PAGINATION_KEYS = Object.freeze(["count", "next", "prev"]);
const ANNOTATION_KEYS = Object.freeze(["path", "source", "evidenceUrl"]);
const OUTPUT_KEYS = Object.freeze([
  "deploymentId",
  "target",
  "path",
  "source",
  "outcome",
  "sourceSha",
  "createdAtUtc",
  "evidenceUrl",
]);

const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]+$/;
const PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9]+$/;
const TEAM_ID_PATTERN = /^team_[A-Za-z0-9]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const CONTROLLER_KEY_PATTERN =
  /^vercel-preview:v1:pr:[1-9][0-9]*:target:(app|governance|reserve|ui):sha:([a-f0-9]{40})$/;
const CANONICAL_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_PAGES_PER_PROJECT = 100;
const PAGE_LIMIT = 100;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label);
  const actual = Object.keys(value).toSorted();
  const canonical = [...expected].toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(canonical)) {
    throw new Error(`${label} must contain exactly: ${canonical.join(", ")}`);
  }
}

function assertString(value, label, pattern, maximum = 1024) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw new Error(`${label} is malformed`);
  }
  return value;
}

function assertSafeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function canonicalUtc(value, label) {
  if (typeof value !== "string" || !CANONICAL_UTC_PATTERN.test(value)) {
    throw new Error(
      `${label} must be canonical UTC with millisecond precision`,
    );
  }
  const timestamp = Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new Error(
      `${label} must be canonical UTC with millisecond precision`,
    );
  }
  return timestamp;
}

function canonicalWindow(value) {
  assertExactKeys(value, WINDOW_KEYS, "window");
  const start = canonicalUtc(value.startUtc, "window.startUtc");
  const end = canonicalUtc(value.endUtcExclusive, "window.endUtcExclusive");
  if (
    start >= end ||
    new Date(start).getUTCHours() !== 0 ||
    new Date(start).getUTCMinutes() !== 0 ||
    new Date(start).getUTCSeconds() !== 0 ||
    new Date(start).getUTCMilliseconds() !== 0 ||
    new Date(end).getUTCHours() !== 0 ||
    new Date(end).getUTCMinutes() !== 0 ||
    new Date(end).getUTCSeconds() !== 0 ||
    new Date(end).getUTCMilliseconds() !== 0
  ) {
    throw new Error("window must be a nonempty complete-UTC-day interval");
  }
  return { start, end };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseInput(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) {
    throw new Error(`input must be between 1 and ${MAX_INPUT_BYTES} bytes`);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("input must be valid UTF-8");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `input must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { bytes, parsed };
}

function canonicalRawUrl(value, label) {
  assertString(value, label, undefined, 2048);
  const candidate = /^https?:\/\//.test(value) ? value : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be a root *.vercel.app deployment URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/" ||
    !parsed.hostname.endsWith(".vercel.app") ||
    parsed.hostname.length <= ".vercel.app".length
  ) {
    throw new Error(`${label} must be a root *.vercel.app deployment URL`);
  }
  return `https://${parsed.hostname}/`;
}

function canonicalEvidenceUrl(value, label) {
  assertString(value, label, undefined, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a public evidence URL`);
  }
  const githubEvidence =
    parsed.hostname === "github.com" &&
    /^\/mento-protocol\/frontend-monorepo\/(?:actions\/runs\/\d+(?:\/job\/\d+)?|runs\/\d+|deployments\/\d+)\/?$/.test(
      parsed.pathname,
    );
  const vercelEvidence =
    parsed.hostname.endsWith(".vercel.app") &&
    parsed.hostname.length > ".vercel.app".length &&
    parsed.pathname === "/";
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (!githubEvidence && !vercelEvidence)
  ) {
    throw new Error(
      `${label} must be a public GitHub run/deployment or root *.vercel.app URL`,
    );
  }
  return parsed.toString();
}

function knownGitMetadata(deployment, label) {
  const meta =
    deployment.meta === undefined || deployment.meta === null
      ? null
      : assertObject(deployment.meta, `${label}.meta`);
  const names = [
    "githubCommitOrg",
    "githubCommitRepo",
    "githubCommitRef",
    "githubCommitSha",
  ];
  const present = names.filter((name) => meta && meta[name] !== undefined);
  let result = null;
  let knownSha = null;
  if (present.length !== 0) {
    const parsed = {};
    if (meta.githubCommitOrg !== undefined) {
      parsed.org = assertString(
        meta.githubCommitOrg,
        `${label}.meta.githubCommitOrg`,
      );
    }
    if (meta.githubCommitRepo !== undefined) {
      parsed.repo = assertString(
        meta.githubCommitRepo,
        `${label}.meta.githubCommitRepo`,
      );
    }
    if (meta.githubCommitRef !== undefined) {
      parsed.ref = assertString(
        meta.githubCommitRef,
        `${label}.meta.githubCommitRef`,
        undefined,
        255,
      );
      if (
        [...parsed.ref].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 0x1f || code === 0x7f;
        })
      ) {
        throw new Error(`${label}.meta.githubCommitRef is malformed`);
      }
    }
    if (meta.githubCommitSha !== undefined) {
      knownSha = assertString(
        meta.githubCommitSha,
        `${label}.meta.githubCommitSha`,
        SHA_PATTERN,
        40,
      );
      parsed.sha = knownSha;
    }
    if (present.length === names.length) {
      result = parsed;
    }
  }

  if (deployment.gitSource !== undefined && deployment.gitSource !== null) {
    const gitSource = assertObject(deployment.gitSource, `${label}.gitSource`);
    if (gitSource.sha !== undefined) {
      const gitSourceSha = assertString(
        gitSource.sha,
        `${label}.gitSource.sha`,
        SHA_PATTERN,
        40,
      );
      if (knownSha !== null && knownSha !== gitSourceSha) {
        throw new Error(`${label} contains conflicting Git SHAs`);
      }
    }
  }
  return { meta, git: result };
}

function mentoMetadataKeys(meta) {
  return meta === null
    ? []
    : Object.keys(meta).filter((name) => name.startsWith("mento"));
}

function assertPreviewSignature({ meta, git, target, label }) {
  if (meta === null || git === null) {
    throw new Error(`${label} GitHub preview metadata is incomplete`);
  }
  const keys = mentoMetadataKeys(meta);
  if (
    keys.length !== 1 ||
    keys[0] !== "mentoControllerKey" ||
    typeof meta.mentoControllerKey !== "string"
  ) {
    throw new Error(`${label} GitHub preview signature is malformed`);
  }
  const match = CONTROLLER_KEY_PATTERN.exec(meta.mentoControllerKey);
  if (match === null || match[1] !== target || match[2] !== git.sha) {
    throw new Error(`${label} GitHub preview signature conflicts with the row`);
  }
}

function assertMainSignature({ meta, git, target, projectId, label }) {
  if (meta === null || git === null) {
    throw new Error(`${label} GitHub main metadata is incomplete`);
  }
  try {
    canonicalizeMainCandidateVercelMetadata(meta, {
      target,
      projectId,
      projectName: `${target}.mento.org`,
      deploySha: git.sha,
    });
  } catch (error) {
    throw new Error(
      `${label} GitHub main signature is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function rawEnvironment(deployment, label) {
  const targetPresent = Object.hasOwn(deployment, "target");
  let target = null;
  if (deployment.target !== undefined && deployment.target !== null) {
    target = assertString(deployment.target, `${label}.target`, undefined, 128);
  }
  const customEnvironmentPresent = Object.hasOwn(
    deployment,
    "customEnvironment",
  );
  let customEnvironmentSlug = null;
  if (
    deployment.customEnvironment !== undefined &&
    deployment.customEnvironment !== null
  ) {
    const customEnvironment = assertObject(
      deployment.customEnvironment,
      `${label}.customEnvironment`,
    );
    customEnvironmentSlug = assertString(
      customEnvironment.slug,
      `${label}.customEnvironment.slug`,
      undefined,
      128,
    );
  }
  return {
    targetPresent,
    target,
    customEnvironmentPresent,
    customEnvironmentSlug,
  };
}

function validateRawDeploymentIdentity({
  deployment,
  projectId,
  start,
  end,
  label,
}) {
  assertObject(deployment, label);
  const deploymentId = assertString(
    deployment.uid,
    `${label}.uid`,
    DEPLOYMENT_ID_PATTERN,
    128,
  );
  if (deployment.id !== undefined && deployment.id !== deploymentId) {
    throw new Error(`${label}.id conflicts with uid`);
  }
  if (deployment.projectId !== projectId) {
    throw new Error(`${label}.projectId conflicts with its project envelope`);
  }
  if (deployment.project !== undefined && deployment.project !== null) {
    let alternateProjectId;
    if (typeof deployment.project === "string") {
      alternateProjectId = deployment.project;
    } else if (isObject(deployment.project)) {
      const { id, uid } = deployment.project;
      if (id !== undefined && uid !== undefined && id !== uid) {
        throw new Error(`${label}.project contains conflicting IDs`);
      }
      alternateProjectId = id ?? uid;
    } else {
      throw new Error(`${label}.project is malformed`);
    }
    if (alternateProjectId !== undefined && alternateProjectId !== projectId) {
      throw new Error(`${label}.project conflicts with projectId`);
    }
  }
  const createdAt = assertSafeInteger(
    deployment.createdAt,
    `${label}.createdAt`,
    { minimum: 1 },
  );
  if (createdAt < start - 1 || createdAt >= end) {
    throw new Error(`${label}.createdAt falls outside the bounded query`);
  }
  return {
    deploymentId,
    createdAt,
    inWindow: createdAt >= start,
  };
}

function normalizeDeployment({
  deployment,
  identity,
  annotation,
  target,
  projectId,
  label,
}) {
  const { deploymentId, createdAt } = identity;
  const readyState = assertString(deployment.readyState, `${label}.readyState`);
  if (!PROVIDER_STATES.has(readyState)) {
    throw new Error(`${label}.readyState is unsupported`);
  }
  if (deployment.state !== undefined && deployment.state !== readyState) {
    throw new Error(`${label}.state conflicts with readyState`);
  }
  const outcome = OUTCOMES.get(readyState);
  if (outcome === undefined) {
    throw new Error(
      `${label}.readyState is nonterminal; re-export after it settles`,
    );
  }
  if (deployment.url === null || deployment.url === undefined) {
    throw new Error(`${label}.url is required for a final census`);
  }
  const rawUrl = canonicalRawUrl(deployment.url, `${label}.url`);
  if (
    deployment.prebuilt !== undefined &&
    typeof deployment.prebuilt !== "boolean"
  ) {
    throw new Error(`${label}.prebuilt must be boolean when present`);
  }
  if (
    deployment.source !== undefined &&
    deployment.source !== null &&
    typeof deployment.source !== "string"
  ) {
    throw new Error(`${label}.source must be a string when present`);
  }
  const environment = rawEnvironment(deployment, label);

  assertExactKeys(annotation, ANNOTATION_KEYS, `${label} annotation`);
  if (!PATHS.includes(annotation.path)) {
    throw new Error(`${label} annotation.path is unsupported`);
  }
  if (!SOURCES.includes(annotation.source)) {
    throw new Error(`${label} annotation.source is unsupported`);
  }
  const evidenceUrl = canonicalEvidenceUrl(
    annotation.evidenceUrl,
    `${label} annotation.evidenceUrl`,
  );
  if (
    new URL(evidenceUrl).hostname.endsWith(".vercel.app") &&
    evidenceUrl !== rawUrl
  ) {
    throw new Error(`${label} annotation evidence URL conflicts with raw url`);
  }

  const { meta, git } = knownGitMetadata(deployment, label);
  const signatureKeys = mentoMetadataKeys(meta);
  if (
    annotation.path === "preview" &&
    ((environment.targetPresent &&
      environment.target !== null &&
      environment.target !== "preview") ||
      (environment.customEnvironmentPresent &&
        environment.customEnvironmentSlug !== null))
  ) {
    throw new Error(`${label} preview environment conflicts with its path`);
  }
  const requiresGitIdentity =
    ["preview", "main"].includes(annotation.path) &&
    ["github-actions-prebuilt", "vercel-native"].includes(annotation.source);
  if (
    (requiresGitIdentity || annotation.path === "legacy-v2") &&
    (git === null ||
      git.org !== "mento-protocol" ||
      git.repo !== "frontend-monorepo")
  ) {
    throw new Error(
      `${label} migrated or legacy deployment lacks a complete in-scope Git identity`,
    );
  }
  if (annotation.source === "github-actions-prebuilt") {
    if (deployment.prebuilt === false) {
      throw new Error(`${label}.prebuilt conflicts with its annotated source`);
    }
    if (annotation.path === "preview") {
      assertPreviewSignature({ meta, git, target, label });
    } else if (annotation.path === "main") {
      assertMainSignature({ meta, git, target, projectId, label });
      const expectedEnvironment =
        target === "app"
          ? { target: null, customEnvironmentSlug: "v3" }
          : { target: "production", customEnvironmentSlug: null };
      if (
        (environment.targetPresent &&
          environment.target !== expectedEnvironment.target) ||
        (environment.customEnvironmentPresent &&
          environment.customEnvironmentSlug !==
            expectedEnvironment.customEnvironmentSlug)
      ) {
        throw new Error(
          `${label} GitHub main environment conflicts with its target`,
        );
      }
    } else {
      throw new Error(
        `${label} GitHub-owned source requires preview or main path`,
      );
    }
  } else if (
    annotation.source === "vercel-native" &&
    signatureKeys.length !== 0
  ) {
    throw new Error(
      `${label} Mento metadata conflicts with its annotated source`,
    );
  }

  if (annotation.source === "vercel-native" && deployment.prebuilt === true) {
    throw new Error(`${label}.prebuilt conflicts with its annotated source`);
  }
  if (annotation.path === "legacy-v2") {
    if (
      target !== "app" ||
      annotation.source !== "vercel-native" ||
      git === null ||
      git.ref !== "v2" ||
      !environment.targetPresent ||
      environment.target !== "production" ||
      environment.customEnvironmentSlug !== null
    ) {
      throw new Error(`${label} legacy-v2 signature is malformed`);
    }
  }

  const migrated = requiresGitIdentity;
  const sourceSha =
    migrated || annotation.path === "legacy-v2" ? git.sha : null;

  const row = {
    deploymentId,
    target,
    path: annotation.path,
    source: annotation.source,
    outcome,
    sourceSha,
    createdAtUtc: new Date(createdAt).toISOString(),
    evidenceUrl,
  };
  if (JSON.stringify(Object.keys(row)) !== JSON.stringify(OUTPUT_KEYS)) {
    throw new Error("internal census row key order is invalid");
  }
  return row;
}

function canonicalQuery(query, { target, projectId, start, end }) {
  const label = `projects.${target}.query`;
  assertExactKeys(query, QUERY_KEYS, label);
  if (query.path !== "/v7/deployments") {
    throw new Error(`${label}.path must be /v7/deployments`);
  }
  assertString(query.teamId, `${label}.teamId`, TEAM_ID_PATTERN, 128);
  if (query.projectId !== projectId) {
    throw new Error(`${label}.projectId conflicts with the project envelope`);
  }
  if (query.limit !== PAGE_LIMIT) {
    throw new Error(`${label}.limit must be ${PAGE_LIMIT}`);
  }
  if (query.since !== start - 1 || query.until !== end) {
    throw new Error(
      `${label} must use since=startMs-1 and until=endMsExclusive`,
    );
  }
  return query.teamId;
}

function canonicalPagination(value, label, count) {
  assertExactKeys(value, PAGINATION_KEYS, label);
  if (value.count !== count) {
    throw new Error(`${label}.count must equal deployments.length`);
  }
  for (const key of ["next", "prev"]) {
    if (value[key] !== null) {
      assertSafeInteger(value[key], `${label}.${key}`, { minimum: 1 });
    }
  }
  return value;
}

function normalizeProject({
  project,
  annotations,
  start,
  end,
  rawDeploymentIds,
  censusDeploymentIds,
}) {
  assertExactKeys(project, PROJECT_KEYS, "project");
  const target = assertString(project.target, "project.target");
  if (!TARGETS.includes(target))
    throw new Error("project.target is unsupported");
  const projectId = assertString(
    project.projectId,
    `projects.${target}.projectId`,
    PROJECT_ID_PATTERN,
    128,
  );
  const teamId = canonicalQuery(project.query, {
    target,
    projectId,
    start,
    end,
  });
  if (
    !Array.isArray(project.pages) ||
    project.pages.length === 0 ||
    project.pages.length > MAX_PAGES_PER_PROJECT
  ) {
    throw new Error(
      `projects.${target}.pages must contain 1-${MAX_PAGES_PER_PROJECT} pages`,
    );
  }

  let expectedCursor = end;
  const seenCursors = new Set();
  const rows = [];
  for (const [pageIndex, page] of project.pages.entries()) {
    const pageLabel = `projects.${target}.pages[${pageIndex}]`;
    assertExactKeys(page, PAGE_KEYS, pageLabel);
    if (page.requestCursor !== expectedCursor) {
      throw new Error(`${pageLabel}.requestCursor breaks the cursor chain`);
    }
    assertSafeInteger(page.requestCursor, `${pageLabel}.requestCursor`, {
      minimum: 1,
    });
    if (seenCursors.has(page.requestCursor)) {
      throw new Error(`${pageLabel}.requestCursor repeats an earlier cursor`);
    }
    seenCursors.add(page.requestCursor);
    assertExactKeys(page.response, RESPONSE_KEYS, `${pageLabel}.response`);
    if (
      !Array.isArray(page.response.deployments) ||
      page.response.deployments.length > PAGE_LIMIT
    ) {
      throw new Error(
        `${pageLabel}.response.deployments must contain at most ${PAGE_LIMIT} rows`,
      );
    }
    const pagination = canonicalPagination(
      page.response.pagination,
      `${pageLabel}.response.pagination`,
      page.response.deployments.length,
    );
    for (const [rowIndex, deployment] of page.response.deployments.entries()) {
      const rowLabel = `${pageLabel}.response.deployments[${rowIndex}]`;
      const identity = validateRawDeploymentIdentity({
        deployment,
        projectId,
        start,
        end,
        label: rowLabel,
      });
      if (rawDeploymentIds.has(identity.deploymentId)) {
        throw new Error(
          `deploymentId ${identity.deploymentId} appears more than once`,
        );
      }
      rawDeploymentIds.add(identity.deploymentId);
      if (!identity.inWindow) {
        continue;
      }
      if (annotations[identity.deploymentId] === undefined) {
        throw new Error(`${rowLabel} has no exact maintainer annotation`);
      }
      const row = normalizeDeployment({
        deployment,
        identity,
        annotation: annotations[identity.deploymentId],
        target,
        projectId,
        label: rowLabel,
      });
      censusDeploymentIds.add(identity.deploymentId);
      rows.push(row);
    }
    if (pagination.next === null) {
      if (pageIndex !== project.pages.length - 1) {
        throw new Error(`${pageLabel} is terminal before the final saved page`);
      }
    } else {
      if (pageIndex === project.pages.length - 1) {
        throw new Error(`${pageLabel} is missing its terminal next:null page`);
      }
      if (
        pagination.next >= page.requestCursor ||
        pagination.next <= project.query.since ||
        seenCursors.has(pagination.next)
      ) {
        throw new Error(`${pageLabel}.response.pagination.next is invalid`);
      }
      expectedCursor = pagination.next;
    }
  }
  return {
    target,
    projectId,
    teamId,
    rows,
    proof: {
      target,
      projectId,
      pageCount: project.pages.length,
      rowCount: rows.length,
      terminalRequestCursor:
        project.pages[project.pages.length - 1].requestCursor,
      terminalNextCursor: null,
    },
  };
}

export function normalizeVercelDeploymentPages(raw) {
  const { bytes, parsed } = parseInput(raw);
  assertExactKeys(parsed, ENVELOPE_KEYS, "input");
  if (parsed.schema !== VERCEL_DEPLOYMENT_PAGES_SCHEMA) {
    throw new Error(`input.schema must be ${VERCEL_DEPLOYMENT_PAGES_SCHEMA}`);
  }
  const { start, end } = canonicalWindow(parsed.window);
  if (
    !Array.isArray(parsed.projects) ||
    parsed.projects.length !== TARGETS.length
  ) {
    throw new Error("input.projects must contain exactly four targets");
  }
  const annotations = assertObject(parsed.annotations, "input.annotations");
  for (const id of Object.keys(annotations)) {
    assertString(id, "input.annotations deployment ID", DEPLOYMENT_ID_PATTERN);
  }

  const targetNames = parsed.projects.map((project) => project?.target);
  if (
    targetNames.some((target) => !TARGETS.includes(target)) ||
    new Set(targetNames).size !== TARGETS.length
  ) {
    throw new Error("input.projects must contain each logical target once");
  }
  const projectIds = parsed.projects.map((project) => project?.projectId);
  if (new Set(projectIds).size !== TARGETS.length) {
    throw new Error("input.projects must contain four distinct project IDs");
  }

  const rawDeploymentIds = new Set();
  const censusDeploymentIds = new Set();
  const projects = parsed.projects.map((project) =>
    normalizeProject({
      project,
      annotations,
      start,
      end,
      rawDeploymentIds,
      censusDeploymentIds,
    }),
  );
  if (new Set(projects.map((project) => project.teamId)).size !== 1) {
    throw new Error("all project queries must use the same Vercel team ID");
  }
  const annotationIds = Object.keys(annotations).toSorted();
  const censusIds = [...censusDeploymentIds].toSorted();
  if (JSON.stringify(annotationIds) !== JSON.stringify(censusIds)) {
    throw new Error(
      "input.annotations must match the deployment census exactly",
    );
  }

  const rows = projects
    .flatMap((project) => project.rows)
    .toSorted((left, right) => {
      const time = left.createdAtUtc.localeCompare(right.createdAtUtc);
      return time === 0
        ? left.deploymentId.localeCompare(right.deploymentId)
        : time;
    });
  const output = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const canonicalProjects = TARGETS.map(
    (target) => projects.find((project) => project.target === target).proof,
  );
  const proof = {
    schema: VERCEL_DEPLOYMENT_CENSUS_PROOF_SCHEMA,
    sourceSchema: VERCEL_DEPLOYMENT_PAGES_SCHEMA,
    inputSha256: sha256(bytes),
    outputSha256: sha256(output),
    window: {
      startUtc: parsed.window.startUtc,
      endUtcExclusive: parsed.window.endUtcExclusive,
    },
    projects: canonicalProjects,
    pageCount: canonicalProjects.reduce(
      (total, project) => total + project.pageCount,
      0,
    ),
    rowCount: rows.length,
    annotationCount: annotationIds.length,
    deploymentCensusComplete: true,
  };
  return {
    output,
    proof: `${JSON.stringify(proof)}\n`,
    proofObject: proof,
    rows,
  };
}

function parseArguments(argv) {
  if (argv.includes("--help")) {
    process.stdout.write(
      "Usage: pnpm vercel:cost:normalize-deployments --input <private-pages-envelope.json> --output <census.jsonl> --proof <private-census-proof.json>\n",
    );
    process.exit(0);
  }
  const allowed = new Set(["--input", "--output", "--proof"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !allowed.has(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--") ||
      values[name] !== undefined
    ) {
      throw new Error("expected exactly --input, --output, and --proof");
    }
    values[name] = value;
  }
  if (
    argv.length !== allowed.size * 2 ||
    [...allowed].some((name) => values[name] === undefined)
  ) {
    throw new Error("expected exactly --input, --output, and --proof");
  }
  return {
    input: resolve(values["--input"]),
    output: resolve(values["--output"]),
    proof: resolve(values["--proof"]),
  };
}

function assertRegularSingleLink(stat) {
  if (!stat.isFile() || stat.isSymbolicLink?.() || stat.nlink !== 1n) {
    throw new Error("input must be one regular, non-symlink file");
  }
}

function readInputFile(path) {
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new Error("this platform cannot safely open private input evidence");
  }
  const pathBefore = lstatSync(path, { bigint: true });
  assertRegularSingleLink(pathBefore);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true });
    assertRegularSingleLink(openedBefore);
    if (
      openedBefore.dev !== pathBefore.dev ||
      openedBefore.ino !== pathBefore.ino
    ) {
      throw new Error("input identity changed before it was opened");
    }
    const bytes = readFileSync(descriptor);
    const openedAfter = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(path, { bigint: true });
    assertRegularSingleLink(openedAfter);
    assertRegularSingleLink(pathAfter);
    for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (
        openedBefore[field] !== openedAfter[field] ||
        openedAfter[field] !== pathAfter[field]
      ) {
        throw new Error("input changed while it was being read");
      }
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function assertDestination(path, label) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists; refusing to overwrite evidence`);
}

export function runCli(argv) {
  const paths = parseArguments(argv);
  if (new Set(Object.values(paths)).size !== 3) {
    throw new Error("input, output, and proof paths must be distinct");
  }
  assertDestination(paths.output, "output");
  assertDestination(paths.proof, "proof");
  const normalized = normalizeVercelDeploymentPages(readInputFile(paths.input));
  writeFileSync(paths.output, normalized.output, { flag: "wx", mode: 0o600 });
  writeFileSync(paths.proof, normalized.proof, { flag: "wx", mode: 0o600 });
  process.stdout.write(
    `Normalized ${normalized.proofObject.rowCount} Vercel deployment records.\n`,
  );
}

const isCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `Vercel deployment census normalization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
