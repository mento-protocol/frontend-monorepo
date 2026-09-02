import { canonicalizeMainPlanningDeploymentState } from "./vercel-deployment-state.mjs";
import {
  assertMainCandidateProviderCandidate,
  assertMainCandidateIntent,
  canonicalizeMainCandidateVercelMetadata,
  createMainCandidateIntent,
  isBridgeEraCandidateMetadata,
} from "./vercel-main-candidate.mjs";
import { generateVercelMainCandidateDeploymentId } from "./vercel-prebuilt.mjs";
import { assertMainReleaseManifest } from "./vercel-main-release-reconciliation.mjs";

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
function hasReservedCandidateMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return Object.keys(metadata).some((key) => key.startsWith("mento"));
}

function deploymentId(summary) {
  const id = summary?.uid ?? summary?.id;
  if (typeof id !== "string" || !DEPLOYMENT_ID.test(id)) {
    throw new Error("Main candidate deployment summary is malformed");
  }
  return id;
}

// The raw Vercel response is only retained long enough to validate its metadata.
// Both public callbacks close over this helper, so resolver callbacks remain safe
// when passed unbound.
export function createMainCandidateVercelProvider({ client, intent }) {
  const canonicalIntent =
    intent === undefined ? null : assertMainCandidateIntent(intent);
  if (!client || typeof client.requestWithRetry !== "function") {
    throw new Error("Vercel state client is required");
  }

  function assertQuery(query) {
    if (canonicalIntent === null) {
      throw new Error("Main candidate provider intent is required for listing");
    }
    if (!query || typeof query !== "object" || Array.isArray(query)) {
      throw new Error("Main candidate provider query is malformed");
    }
    for (const [key, value] of Object.entries({
      projectId: canonicalIntent.projectId,
      releaseId: canonicalIntent.releaseId,
      candidateId: canonicalIntent.candidateId,
      target: canonicalIntent.target,
      stableIntentDigest: canonicalIntent.stableIntentDigest,
    })) {
      if (query[key] !== value) {
        throw new Error("Main candidate provider query conflicts with intent");
      }
    }
    if (
      JSON.stringify(query.environment) !==
      JSON.stringify(canonicalIntent.environment)
    ) {
      throw new Error("Main candidate provider query conflicts with intent");
    }
  }

  async function listDeploymentIds({ projectId, releaseId, candidateId }) {
    const ids = [];
    const seen = new Set();
    let until = null;
    for (let page = 0; page < 5; page += 1) {
      const query = new URLSearchParams({
        projectId,
        limit: "100",
        "meta-mentoReleaseId": releaseId,
        "meta-mentoCandidateId": candidateId,
      });
      if (until !== null) query.set("until", until);
      const response = await client.requestWithRetry(
        `/v6/deployments?${query.toString()}`,
      );
      if (!Array.isArray(response?.deployments) || !response?.pagination) {
        throw new Error("Main candidate provider listing is malformed");
      }
      for (const summary of response.deployments) {
        const id = deploymentId(summary);
        if (seen.has(id))
          throw new Error("Main candidate listing is ambiguous");
        seen.add(id);
        ids.push(id);
      }
      if (
        response.pagination.next === null ||
        response.pagination.next === undefined
      ) {
        return { deploymentIds: ids, complete: true };
      }
      until = String(response.pagination.next);
      if (!/^[1-9][0-9]*$/.test(until)) {
        throw new Error("Main candidate pagination cursor is malformed");
      }
    }
    throw new Error("Main candidate pagination exceeded its bounded limit");
  }

  async function listCandidateDeploymentIds(query = undefined) {
    if (canonicalIntent === null) {
      throw new Error("Main candidate provider intent is required for listing");
    }
    if (query !== undefined) assertQuery(query);
    return listDeploymentIds({
      projectId: canonicalIntent.projectId,
      releaseId: canonicalIntent.releaseId,
      candidateId: canonicalIntent.candidateId,
    });
  }

  async function inspectDeploymentRecord(id, expected) {
    const deploymentResponse = await client.inspectDeployment(id);
    const aliasesResponse = await client.listDeploymentAliases(id);
    const state = canonicalizeMainPlanningDeploymentState({
      deploymentResponse,
      aliasesResponse,
      expected: {
        deployment: id,
        projectId: expected.projectId,
        projectName: expected.projectName,
        target: expected.environment.target,
        customEnvironmentSlug: expected.environment.customEnvironmentSlug,
      },
    });
    return {
      state,
      rawMetadata: deploymentResponse.meta,
    };
  }

  async function inspectCandidateState(id) {
    if (canonicalIntent === null) {
      throw new Error(
        "Main candidate provider intent is required for inspection",
      );
    }
    return (await inspectDeploymentRecord(id, canonicalIntent)).state;
  }

  async function inspectCandidate(id) {
    if (canonicalIntent === null) {
      throw new Error(
        "Main candidate provider intent is required for inspection",
      );
    }
    const { state, rawMetadata } = await inspectDeploymentRecord(
      id,
      canonicalIntent,
    );
    return {
      deploymentId: state.deploymentId,
      deploymentUrl: state.deploymentUrl,
      projectId: state.projectId,
      projectName: state.projectName,
      readyState: state.readyState,
      target: state.target,
      customEnvironmentSlug: state.customEnvironmentSlug,
      source: "cli",
      git: {
        org: state.git.org,
        repo: state.git.repo,
        ref: state.git.ref,
        sha: state.git.sha,
      },
      metadata: canonicalizeMainCandidateVercelMetadata(rawMetadata, {
        target: canonicalIntent.target,
        projectId: state.projectId,
        projectName: state.projectName,
        deploySha: state.git.sha,
      }),
    };
  }

  async function inspectMappedCandidate({
    deploymentId: id,
    target,
    projectId,
    projectName = `${target}.mento.org`,
  }) {
    if (!/^(?:app|governance|reserve|ui)$/.test(target)) {
      throw new Error("Main mapped candidate target is malformed");
    }
    const expected = {
      projectId,
      projectName,
      environment: { target: "production", customEnvironmentSlug: null },
    };
    const { state, rawMetadata } = await inspectDeploymentRecord(id, expected);
    if (!hasReservedCandidateMetadata(rawMetadata)) {
      return { canonicalState: state, metadata: null };
    }
    // A mapping sealed while `app.mento.org` still hung off the retired `v3`
    // custom environment carries a release manifest built against that
    // environment's App prior. No attempt of this release can reconcile or
    // resume that release, so the mapping is an unmarked rollback-only prior.
    // The seal is validated in full against the observed deployment, exactly as
    // a current seal is, before it earns that classification. Seals are
    // immutable and an operator may roll back to such a deployment at any
    // time, so this classification is permanent.
    if (
      isBridgeEraCandidateMetadata(rawMetadata, {
        target,
        projectId: state.projectId,
        projectName: state.projectName,
        deploySha: state.git.sha,
      })
    ) {
      return { canonicalState: state, metadata: null };
    }
    if (rawMetadata.mentoCandidateSchema === undefined) {
      throw new Error("Main mapped candidate metadata is partial");
    }
    const metadata = canonicalizeMainCandidateVercelMetadata(rawMetadata, {
      target,
      projectId: state.projectId,
      projectName: state.projectName,
      deploySha: state.git.sha,
    });
    return { canonicalState: state, metadata };
  }

  async function resolveReleaseCandidate({
    manifest,
    target,
    projectId,
    projectName = `${target}.mento.org`,
  }) {
    const release = assertMainReleaseManifest(manifest);
    if (
      !/^(?:app|governance|reserve|ui)$/.test(target) ||
      !release.stagedTargets.includes(target)
    ) {
      throw new Error("Main release candidate target is not staged");
    }
    if (
      projectId !== release.originalPriors[target].projectId ||
      projectName !== release.originalPriors[target].projectName
    ) {
      throw new Error("Main release candidate project conflicts with manifest");
    }
    const candidateId = generateVercelMainCandidateDeploymentId({
      repository: release.repository,
      target,
      commitSha: release.deploySha,
      upstreamRunId: release.upstreamRunId,
    });
    const query = {
      projectId,
      releaseId: release.releaseId,
      candidateId,
    };
    const first = await listDeploymentIds(query);
    const second = await listDeploymentIds(query);
    const firstIds = [...first.deploymentIds].sort();
    const secondIds = [...second.deploymentIds].sort();
    if (
      first.complete !== true ||
      second.complete !== true ||
      JSON.stringify(firstIds) !== JSON.stringify(secondIds)
    ) {
      throw new Error("Main release candidate census changed");
    }
    if (firstIds.length > 1) {
      throw new Error("Main release candidate census is ambiguous");
    }
    if (firstIds.length === 0) return null;

    const expected = {
      projectId,
      projectName,
      environment: { target: "production", customEnvironmentSlug: null },
    };
    const { state, rawMetadata } = await inspectDeploymentRecord(
      firstIds[0],
      expected,
    );
    const metadata = canonicalizeMainCandidateVercelMetadata(rawMetadata, {
      target,
      projectId: state.projectId,
      projectName: state.projectName,
      deploySha: state.git.sha,
    });
    const intent = createMainCandidateIntent({
      target,
      deploySha: release.deploySha,
      upstreamRunId: release.upstreamRunId,
      originRunId: metadata.auditOrigin.originRunId,
      originAttempt: metadata.auditOrigin.originAttempt,
      originTransactionId: metadata.auditOrigin.originTransactionId,
      projectId,
      projectName,
      releaseManifest: release,
    });
    const candidate = assertMainCandidateProviderCandidate(
      {
        deploymentId: state.deploymentId,
        deploymentUrl: state.deploymentUrl,
        projectId: state.projectId,
        projectName: state.projectName,
        readyState: state.readyState,
        target: state.target,
        customEnvironmentSlug: state.customEnvironmentSlug,
        source: "cli",
        git: {
          org: state.git.org,
          repo: state.git.repo,
          ref: state.git.ref,
          sha: state.git.sha,
        },
        metadata,
      },
      intent,
    );
    return { intent, candidate };
  }

  return {
    listCandidateDeploymentIds,
    inspectCandidateState,
    inspectCandidate,
    inspectMappedCandidate,
    resolveReleaseCandidate,
  };
}
