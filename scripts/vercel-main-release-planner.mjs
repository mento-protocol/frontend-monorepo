import {
  MAIN_DEPLOYMENT_TARGETS,
  MAIN_TARGET_CONTRACTS,
  planMainDeployments,
  riderAliasesFrom,
} from "./vercel-main-plan.mjs";
import {
  assertMainPlanningSnapshot,
  canonicalizeDeploymentUrl,
} from "./vercel-deployment-state.mjs";
import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  createMainReleaseManifest,
} from "./vercel-main-release-reconciliation.mjs";

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function canonicalProjectIds(value) {
  if (
    !isPlainObject(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...MAIN_DEPLOYMENT_TARGETS].sort())
  ) {
    throw new Error("Main release baseline project IDs are malformed");
  }
  return Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => {
      const projectId = value[target];
      if (
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(projectId)
      ) {
        throw new Error(
          `Main release baseline ${target} project ID is malformed`,
        );
      }
      return [target, projectId];
    }),
  );
}

function targetStates(snapshot, target) {
  const aliases = MAIN_TARGET_CONTRACTS[target].aliases;
  const states = snapshot.states.filter((state) =>
    aliases.includes(state.alias),
  );
  if (
    states.length !== aliases.length ||
    new Set(states.map(({ alias }) => alias)).size !== aliases.length
  ) {
    throw new Error(`Main release baseline ${target} state is incomplete`);
  }
  return states.sort(
    (left, right) => aliases.indexOf(left.alias) - aliases.indexOf(right.alias),
  );
}

function planningGitEvidence(value) {
  if (value === null) {
    return {
      status: "missing",
      org: null,
      repo: null,
      ref: null,
      sha: null,
    };
  }
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 4 ||
    typeof value.org !== "string" ||
    typeof value.repo !== "string" ||
    typeof value.ref !== "string" ||
    typeof value.sha !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.sha)
  ) {
    return {
      status: "malformed",
      org: null,
      repo: null,
      ref: null,
      sha: null,
    };
  }
  return {
    status: "complete",
    org: value.org,
    repo: value.repo,
    ref: value.ref,
    sha: value.sha,
  };
}

function originalPrior({ target, states, planned }) {
  const first = states[0];
  if (
    states.some(
      (state) =>
        state.deploymentId !== first.deploymentId ||
        canonicalizeDeploymentUrl(state.deploymentUrl) !==
          first.deploymentUrl ||
        state.projectId !== first.projectId ||
        state.projectName !== first.projectName ||
        state.readyState !== first.readyState ||
        state.target !== first.target ||
        state.customEnvironmentSlug !== first.customEnvironmentSlug ||
        JSON.stringify(state.aliases) !== JSON.stringify(first.aliases),
    ) ||
    planned.deploymentId !== first.deploymentId ||
    planned.deploymentUrl !== first.deploymentUrl
  ) {
    throw new Error(`Main release baseline ${target} prior is ambiguous`);
  }
  const reviewedAliases = [...planned.aliases].sort();
  return {
    deploymentId: first.deploymentId,
    deploymentUrl: first.deploymentUrl,
    aliases: reviewedAliases,
    // Everything else the served deployment carried. Recorded so the release
    // evidence names every domain a promote repointed; never read by a
    // selection, verification, or recovery decision.
    riderAliases: riderAliasesFrom(first.aliases, reviewedAliases),
    projectId: first.projectId,
    projectName: first.projectName,
    readyState: first.readyState,
    target: first.target,
    customEnvironmentSlug: first.customEnvironmentSlug,
    planningLeaves: states
      .map((state) => ({
        alias: state.alias,
        deploymentId: state.deploymentId,
        deploymentUrl: state.deploymentUrl,
        aliases: [...planned.aliases].sort(),
        projectId: state.projectId,
        projectName: state.projectName,
        readyState: state.readyState,
        target: state.target,
        customEnvironmentSlug: state.customEnvironmentSlug,
        git: planningGitEvidence(state.git),
      }))
      .sort((left, right) => left.alias.localeCompare(right.alias)),
    servedSha: planned.servedSha,
  };
}

export function createMainReleaseBaseline({
  mode,
  mainOwnershipMode,
  deploySha,
  upstreamRunId,
  projectIds,
  planningSnapshot,
  rollbackOnlyTargets,
  repoRoot,
  gitAdapter,
  runPlanner,
}) {
  const projects = canonicalProjectIds(projectIds);
  const snapshot = assertMainPlanningSnapshot(planningSnapshot);
  const groupedStates = Object.fromEntries(
    MAIN_DEPLOYMENT_TARGETS.map((target) => [
      target,
      targetStates(snapshot, target),
    ]),
  );
  const planning = planMainDeployments({
    mode,
    mainOwnershipMode,
    deploySha,
    projectIds: projects,
    rollbackOnlyTargets,
    priorStates: Object.fromEntries(
      MAIN_DEPLOYMENT_TARGETS.map((target) => [
        target,
        { health: "passed", states: groupedStates[target] },
      ]),
    ),
    ...(repoRoot === undefined ? {} : { repoRoot }),
    ...(gitAdapter === undefined ? {} : { gitAdapter }),
    ...(runPlanner === undefined ? {} : { runPlanner }),
  });
  const plannedPriors = new Map(
    planning.priors.map((prior) => [prior.target, prior]),
  );
  const originalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
      target,
      originalPrior({
        target,
        states: groupedStates[target],
        planned: plannedPriors.get(target),
      }),
    ]),
  );
  const manifest = createMainReleaseManifest({
    upstreamRunId,
    plan: planning,
    originalPriors,
  });
  return { planning, manifest };
}
