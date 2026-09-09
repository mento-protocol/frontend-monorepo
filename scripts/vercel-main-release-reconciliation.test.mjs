import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MAIN_RELEASE_ACTIVATION_ORDER,
  assertMainReleaseManifest,
  createInheritedRollbackAuthorization,
  createMainReleaseManifest,
  decideMainPreplanReconciliation,
  decideMainReleaseReconciliation,
  recomputeMainReleasePlan,
  reconcileMainRelease,
  reconcileMainReleaseForRecovery,
} from "./vercel-main-release-reconciliation.mjs";
import {
  MAIN_TARGET_CONTRACTS,
  planMainDeployments,
} from "./vercel-main-plan.mjs";
import { PRODUCTION_GENERATED_ALIAS_CONTRACTS } from "./vercel-production-generated-aliases.mjs";

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
const PRIOR_SHA = "1111111111111111111111111111111111111111";
const TARGET_ORDER = ["app", "governance", "reserve", "ui"];

function deploymentId(target, kind) {
  return `dpl_${target}${kind}123`;
}

function deploymentUrl(target, kind) {
  return `https://${target}-${kind}-immutable.vercel.app`;
}

function plan(
  selected = TARGET_ORDER,
  { active = selected, shadow = [] } = {},
) {
  const canonicalSelected = TARGET_ORDER.filter((target) =>
    selected.includes(target),
  );
  const canonicalActive = TARGET_ORDER.filter((target) =>
    active.includes(target),
  );
  const canonicalShadow = TARGET_ORDER.filter((target) =>
    shadow.includes(target),
  );
  return {
    activeTargets: canonicalActive,
    deploySha: SHA,
    mainOwnershipMode: {
      app: canonicalShadow.includes("app") ? "shadow" : "github",
      governance: canonicalShadow.includes("governance") ? "shadow" : "github",
      reserve: canonicalShadow.includes("reserve") ? "shadow" : "github",
      ui: canonicalShadow.includes("ui") ? "shadow" : "github",
    },
    mode: "active",
    plan: canonicalSelected,
    priors: TARGET_ORDER.map((target) => ({
      aliases: [...MAIN_TARGET_CONTRACTS[target].aliases],
      deploymentId: deploymentId(target, "prior"),
      deploymentUrl: deploymentUrl(target, "prior"),
      servedSha: PRIOR_SHA,
      target,
    })),
    ranges: [
      {
        base: PRIOR_SHA,
        deployments: canonicalSelected,
        head: SHA,
        kind: "served",
        reason: "global-build-input",
        targets: TARGET_ORDER,
      },
    ],
    reasons: canonicalSelected.map((target) => ({
      base: PRIOR_SHA,
      reason: "global-build-input",
      target,
    })),
    schema: "vercel-main-plan:v2",
    stagedTargets: canonicalSelected,
    shadowTargets: canonicalShadow,
  };
}

function gitEvidence(overrides = {}) {
  return {
    status: "complete",
    org: "mento-protocol",
    repo: "frontend-monorepo",
    ref: "main",
    sha: PRIOR_SHA,
    ...overrides,
  };
}

function prior(target, { servedSha = PRIOR_SHA, git = gitEvidence() } = {}) {
  const contract = MAIN_TARGET_CONTRACTS[target];
  const base = {
    deploymentId: deploymentId(target, "prior"),
    deploymentUrl: deploymentUrl(target, "prior"),
    aliases: [...contract.aliases].sort(),
    projectId: `prj_${target}123`,
    projectName: contract.projectName,
    readyState: "READY",
    target: contract.target,
    customEnvironmentSlug: contract.customEnvironmentSlug,
    servedSha,
  };
  return {
    deploymentId: base.deploymentId,
    deploymentUrl: base.deploymentUrl,
    aliases: base.aliases,
    projectId: base.projectId,
    projectName: base.projectName,
    readyState: base.readyState,
    target: base.target,
    customEnvironmentSlug: base.customEnvironmentSlug,
    planningLeaves: base.aliases.map((alias, index) => ({
      alias,
      deploymentId: base.deploymentId,
      deploymentUrl: base.deploymentUrl,
      aliases: [...base.aliases],
      projectId: base.projectId,
      projectName: base.projectName,
      readyState: base.readyState,
      target: base.target,
      customEnvironmentSlug: base.customEnvironmentSlug,
      git: structuredClone(typeof git === "function" ? git(index) : git),
    })),
    servedSha: base.servedSha,
  };
}

function manifest(selected = TARGET_ORDER, options = {}) {
  return createMainReleaseManifest({
    upstreamRunId: "700",
    plan: plan(selected, options),
    originalPriors: Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [target, prior(target)]),
    ),
  });
}

function manifestWithPriors({
  selected,
  originalPriors,
  upstreamRunId,
  options = {},
}) {
  const releasePlan = plan(selected, options);
  releasePlan.priors = releasePlan.priors.map((entry) => ({
    ...entry,
    deploymentId: originalPriors[entry.target].deploymentId,
    deploymentUrl: originalPriors[entry.target].deploymentUrl,
    servedSha: originalPriors[entry.target].servedSha,
  }));
  return createMainReleaseManifest({
    upstreamRunId,
    plan: releasePlan,
    originalPriors,
  });
}

function candidate(target, releaseManifest, kind = "candidate") {
  return {
    deploymentId: deploymentId(target, kind),
    deploymentUrl: deploymentUrl(target, kind),
    manifest: releaseManifest,
  };
}

function mappingFor(alias, record) {
  return {
    alias,
    deploymentId: record.deploymentId,
    deploymentUrl: record.deploymentUrl,
  };
}

function recapturedPrior(previous, deployed) {
  return {
    ...structuredClone(previous),
    deploymentId: deployed.deploymentId,
    deploymentUrl: deployed.deploymentUrl,
    planningLeaves: previous.planningLeaves.map((leaf) => ({
      ...structuredClone(leaf),
      deploymentId: deployed.deploymentId,
      deploymentUrl: deployed.deploymentUrl,
      git: gitEvidence({ sha: SHA }),
    })),
    servedSha: SHA,
  };
}

function rawPlanningGit(git) {
  if (git.status === "missing") return null;
  const fields = Object.fromEntries(
    ["org", "repo", "ref", "sha"]
      .filter((key) => git[key] !== null)
      .map((key) => [key, git[key]]),
  );
  return git.status === "malformed"
    ? { ...fields, __sanitizedMalformed: true }
    : fields;
}

function plannerInputs(originalPriors) {
  return {
    projectIds: Object.fromEntries(
      TARGET_ORDER.map((target) => [target, originalPriors[target].projectId]),
    ),
    priorStates: Object.fromEntries(
      TARGET_ORDER.map((target) => [
        target,
        {
          health: "passed",
          states: originalPriors[target].planningLeaves.map((leaf) => ({
            alias: leaf.alias,
            deploymentId: leaf.deploymentId,
            deploymentUrl: leaf.deploymentUrl,
            projectId: leaf.projectId,
            projectName: leaf.projectName,
            readyState: leaf.readyState,
            target: leaf.target,
            customEnvironmentSlug: leaf.customEnvironmentSlug,
            git: rawPlanningGit(leaf.git),
            aliases:
              target === "app"
                ? [...leaf.aliases]
                : [
                    ...leaf.aliases,
                    PRODUCTION_GENERATED_ALIAS_CONTRACTS[target]
                      .generatedProjectAlias,
                  ].toSorted(),
            creatorUsername: null,
          })),
        },
      ]),
    ),
  };
}

function mapping(alias, target, state) {
  return {
    alias,
    deploymentId: deploymentId(target, state),
    deploymentUrl: deploymentUrl(target, state),
  };
}

function releaseState({
  selected = TARGET_ORDER,
  candidateCount = 0,
  appCandidateFrontier = false,
} = {}) {
  const releaseManifest = manifest(selected);
  const selectedTargets = releaseManifest.activeTargets;
  const candidates = {};
  const currentMappings = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      const priorRecord = releaseManifest.originalPriors[target];
      return [
        target,
        priorRecord.aliases.map((alias) => mapping(alias, target, "prior")),
      ];
    }),
  );
  for (const target of releaseManifest.stagedTargets) {
    const activeIndex = selectedTargets.indexOf(target);
    const hasCandidate =
      activeIndex >= 0 &&
      (activeIndex < candidateCount ||
        (appCandidateFrontier && target === "app"));
    candidates[target] = hasCandidate
      ? candidate(target, releaseManifest)
      : null;
    if (activeIndex >= 0) {
      currentMappings[target] = releaseManifest.originalPriors[
        target
      ].aliases.map((alias) =>
        mapping(alias, target, hasCandidate ? "candidate" : "prior"),
      );
    }
  }
  return { manifest: releaseManifest, candidates, currentMappings };
}

function candidateRelease(state) {
  return {
    manifest: state.manifest,
    candidates: state.candidates,
  };
}

function appRecoveryResidualState() {
  const state = releaseState();
  state.candidates.app = candidate("app", state.manifest);
  state.currentMappings.app = state.manifest.originalPriors.app.aliases.map(
    (alias) => mappingFor(alias, state.candidates.app),
  );
  return state;
}

test("release manifest binds the canonical planner result and all four rollback priors", () => {
  const first = manifest();
  const second = manifest();
  assert.deepEqual(first, second);
  assert.deepEqual(first.stagedTargets, ["governance", "reserve", "ui", "app"]);
  assert.deepEqual(first.activeTargets, first.stagedTargets);
  assert.deepEqual(first.rollbackOnlyTargets, []);
  assert.deepEqual(assertMainReleaseManifest(first), first);
  assert.equal(Object.hasOwn(first, "plan"), false);
  assert.equal(
    first.releasePlanDigest,
    createHash("sha256").update(JSON.stringify(plan())).digest("hex"),
  );
  assert.equal(first.originalPriors.app.projectId, "prj_app123");
  assert.deepEqual(first.originalPriors.app.aliases, ["app.mento.org"]);
  assert.equal(first.originalPriors.app.target, "production");
  assert.equal(first.originalPriors.app.customEnvironmentSlug, null);

  const tamperedIdentity = structuredClone(first);
  tamperedIdentity.releaseId = "mr-000000000000000000000000";
  assert.throws(
    () => assertMainReleaseManifest(tamperedIdentity),
    /stable identity conflicts/,
  );
  const tamperedPrior = structuredClone(first);
  tamperedPrior.originalPriors.reserve.aliases = ["attacker.example"];
  assert.throws(
    () => assertMainReleaseManifest(tamperedPrior),
    /reviewed topology/,
  );
  const tamperedPlanningAliases = structuredClone(first);
  tamperedPlanningAliases.originalPriors.governance.planningLeaves[0].aliases =
    ["governance.mento.org", "governancementoorg-mentolabs.vercel.app"];
  assert.throws(
    () => assertMainReleaseManifest(tamperedPlanningAliases),
    /reviewed topology/,
  );

  const forgedMalformed = structuredClone(first);
  forgedMalformed.originalPriors.app.planningLeaves[0].git = {
    status: "malformed",
    org: "attacker\u0000data",
    repo: null,
    ref: null,
    sha: null,
  };
  assert.throws(
    () => assertMainReleaseManifest(forgedMalformed),
    /status conflicts/,
  );
  const unsafeComplete = structuredClone(first);
  unsafeComplete.originalPriors.app.planningLeaves[0].git.ref =
    "refs/heads/../attacker";
  assert.throws(
    () => assertMainReleaseManifest(unsafeComplete),
    /complete identity is unsafe/,
  );
});

test("rollback-only targets persist canonically and reproduce the forced plan", () => {
  const originalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
      target,
      prior(target, {
        git: gitEvidence({ sha: target === "app" ? SHA : PRIOR_SHA }),
        servedSha: target === "app" ? SHA : PRIOR_SHA,
      }),
    ]),
  );
  const { projectIds, priorStates } = plannerInputs(originalPriors);
  const gitAdapter = {
    firstParent() {
      return "b".repeat(40);
    },
    isAncestor() {
      return true;
    },
    resolveCommit(sha) {
      return sha;
    },
  };
  const runPlanner = () =>
    assert.fail("rollback-only targets must bypass path-aware planning");
  const releasePlan = planMainDeployments({
    mode: "active",
    mainOwnershipMode: {
      app: "github",
      governance: "github",
      reserve: "github",
      ui: "github",
    },
    deploySha: SHA,
    projectIds,
    priorStates,
    rollbackOnlyTargets: [...TARGET_ORDER],
    gitAdapter,
    runPlanner,
  });
  const releaseManifest = createMainReleaseManifest({
    upstreamRunId: "700",
    plan: releasePlan,
    originalPriors,
  });
  assert.equal(releaseManifest.schema, "vercel-main-release-manifest:v2");
  assert.deepEqual(releaseManifest.rollbackOnlyTargets, [...TARGET_ORDER]);
  assert.deepEqual(
    recomputeMainReleasePlan({
      manifest: releaseManifest,
      gitAdapter,
      runPlanner,
    }),
    releasePlan,
  );

  const noncanonical = structuredClone(releaseManifest);
  noncanonical.rollbackOnlyTargets = ["governance", "app"];
  assert.throws(
    () => assertMainReleaseManifest(noncanonical),
    /rollback-only targets is not canonical/,
  );
});

test("no-target plan keeps an exact empty release identity and recomputes", () => {
  const originalPriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [target, prior(target)]),
  );
  const { projectIds, priorStates } = plannerInputs(originalPriors);
  const gitAdapter = {
    firstParent() {
      return "b".repeat(40);
    },
    isAncestor() {
      return true;
    },
    resolveCommit(sha) {
      return sha;
    },
  };
  const runPlanner = ({ base, head }) => ({
    base,
    deployments: [],
    head,
    reason: "non-runtime-only",
  });
  const noTargetPlan = planMainDeployments({
    mode: "active",
    mainOwnershipMode: {
      app: "github",
      governance: "github",
      reserve: "github",
      ui: "github",
    },
    deploySha: SHA,
    projectIds,
    priorStates,
    rollbackOnlyTargets: [],
    gitAdapter,
    runPlanner,
  });
  assert.deepEqual(noTargetPlan.stagedTargets, []);
  const noTargetManifest = createMainReleaseManifest({
    upstreamRunId: "700",
    plan: noTargetPlan,
    originalPriors,
  });
  assert.deepEqual(noTargetManifest.stagedTargets, []);
  assert.deepEqual(noTargetManifest.activeTargets, []);
  assert.deepEqual(noTargetManifest.rollbackOnlyTargets, []);
  assert.deepEqual(
    assertMainReleaseManifest(noTargetManifest),
    noTargetManifest,
  );
  assert.deepEqual(
    recomputeMainReleasePlan({
      manifest: noTargetManifest,
      gitAdapter,
      runPlanner,
    }),
    noTargetPlan,
  );

  const forged = structuredClone(noTargetManifest);
  forged.activeTargets = ["app"];
  assert.throws(
    () => assertMainReleaseManifest(forged),
    /active targets were not staged/,
  );
});

for (const [name, git, servedSha, reason] of [
  [
    "missing",
    gitEvidence({
      status: "missing",
      org: null,
      repo: null,
      ref: null,
      sha: null,
    }),
    null,
    "served-git-metadata-missing",
  ],
  [
    "malformed",
    gitEvidence({
      status: "malformed",
      org: null,
      repo: null,
      ref: null,
      sha: null,
    }),
    null,
    "served-git-metadata-malformed",
  ],
  [
    "wrong-source",
    gitEvidence({ repo: "other-repository" }),
    PRIOR_SHA,
    "served-git-metadata-wrong-source",
  ],
]) {
  test(`release manifest preserves the canonical ${name}-Git rollback prior`, () => {
    const releasePlan = plan(["app"]);
    releasePlan.priors[0].servedSha = servedSha;
    releasePlan.reasons = [{ target: "app", reason, base: servedSha }];
    const releaseManifest = createMainReleaseManifest({
      upstreamRunId: "700",
      plan: releasePlan,
      originalPriors: Object.fromEntries(
        MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
          target,
          prior(target, {
            git: target === "app" ? git : gitEvidence(),
            servedSha: target === "app" ? servedSha : PRIOR_SHA,
          }),
        ]),
      ),
    });
    assert.equal(releaseManifest.originalPriors.app.servedSha, servedSha);
    assert.deepEqual(
      assertMainReleaseManifest(releaseManifest),
      releaseManifest,
    );
  });
}

for (const [name, appGit, servedSha, plannerSelectsApp] of [
  ["valid", gitEvidence(), PRIOR_SHA, true],
  [
    "missing",
    gitEvidence({
      status: "missing",
      org: null,
      repo: null,
      ref: null,
      sha: null,
    }),
    null,
    false,
  ],
  [
    "malformed",
    gitEvidence({
      status: "malformed",
      org: null,
      repo: null,
      ref: null,
      sha: null,
    }),
    null,
    false,
  ],

  ["wrong-source", gitEvidence({ repo: "other-repository" }), PRIOR_SHA, false],
]) {
  test(`same-SHA provider manifest recomputes the exact ${name} planner result`, () => {
    const originalPriors = Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [
        target,
        prior(target, {
          git: target === "app" ? appGit : gitEvidence(),
          servedSha: target === "app" ? servedSha : PRIOR_SHA,
        }),
      ]),
    );
    const { projectIds, priorStates } = plannerInputs(originalPriors);
    const gitAdapter = {
      firstParent() {
        return "b".repeat(40);
      },
      isAncestor() {
        return true;
      },
      resolveCommit(sha) {
        return sha;
      },
    };
    const runPlanner = ({ base, head }) => ({
      base,
      deployments: plannerSelectsApp ? ["app"] : [],
      head,
      reason: plannerSelectsApp ? "affected-packages" : "non-runtime-only",
    });
    const releasePlan = planMainDeployments({
      mode: "active",
      mainOwnershipMode: {
        app: "github",
        governance: "github",
        reserve: "github",
        ui: "github",
      },
      deploySha: SHA,
      projectIds,
      priorStates,
      rollbackOnlyTargets: [],
      gitAdapter,
      runPlanner,
    });
    const releaseManifest = createMainReleaseManifest({
      upstreamRunId: "700",
      plan: releasePlan,
      originalPriors,
    });
    assert.deepEqual(
      recomputeMainReleasePlan({
        manifest: releaseManifest,
        gitAdapter,
        runPlanner,
      }),
      releasePlan,
    );
    assert.throws(
      () =>
        recomputeMainReleasePlan({
          manifest: releaseManifest,
          gitAdapter,
          runPlanner: ({ base, head }) => ({
            base,
            deployments: ["reserve"],
            head,
            reason: "affected-packages",
          }),
        }),
      /conflicts with its durable manifest/,
    );
  });
}

for (const inheritedCount of [1, 2, 3]) {
  test(`${inheritedCount} inherited promoted target(s) form a resumable activation prefix`, () => {
    const reconciliation = reconcileMainRelease(
      releaseState({ candidateCount: inheritedCount }),
    );
    assert.deepEqual(
      reconciliation.inheritedCandidateTargets,
      reconciliation.manifest.activeTargets.slice(0, inheritedCount),
    );
    assert.equal(
      reconciliation.frontier,
      reconciliation.manifest.activeTargets[inheritedCount],
    );
    assert.deepEqual(
      decideMainReleaseReconciliation({
        reconciliation,
        currentMain: true,
        preparation: "ready",
      }),
      {
        decision: "converge-forward",
        rollbackInherited: true,
        reason: "resume-canonical-release-prefix",
      },
    );
    assert.deepEqual(
      createInheritedRollbackAuthorization({
        reconciliation,
        reason: "first-forward-command",
      }).targets,
      reconciliation.manifest.activeTargets.slice(0, inheritedCount),
    );
  });

  test(`${inheritedCount} inherited promoted target(s) restore when suffix preparation fails`, () => {
    const reconciliation = reconcileMainRelease(
      releaseState({ candidateCount: inheritedCount }),
    );
    assert.deepEqual(
      decideMainReleaseReconciliation({
        reconciliation,
        currentMain: true,
        preparation: "failed",
      }),
      {
        decision: "restore-inherited",
        rollbackInherited: true,
        reason: "suffix-preparation-failed-after-partial-release",
      },
    );
    const authorization = createInheritedRollbackAuthorization({
      reconciliation,
      reason: "restore-inherited",
    });
    assert.equal(authorization.targets.length, inheritedCount);
  });
}

test("a stale main restores a proven inherited prefix but leaves an untouched release alone", () => {
  const partial = reconcileMainRelease(releaseState({ candidateCount: 2 }));
  assert.equal(
    decideMainReleaseReconciliation({
      reconciliation: partial,
      currentMain: false,
      preparation: "pending",
    }).decision,
    "restore-inherited",
  );
  const untouched = reconcileMainRelease(releaseState());
  assert.deepEqual(
    decideMainReleaseReconciliation({
      reconciliation: untouched,
      currentMain: false,
      preparation: "failed",
    }),
    {
      decision: "superseded-noop",
      rollbackInherited: false,
      reason: "main-advanced-before-release-mutation",
    },
  );
});

test("all-candidate is a verification-only no-op and never reader-authorized rollback", () => {
  const reconciliation = reconcileMainRelease(
    releaseState({ candidateCount: 4 }),
  );
  assert.equal(reconciliation.allCandidate, true);
  assert.deepEqual(
    decideMainReleaseReconciliation({
      reconciliation,
      currentMain: true,
      preparation: "failed",
    }),
    {
      decision: "verify-noop",
      rollbackInherited: false,
      reason: "release-already-candidate",
    },
  );
  assert.throws(
    () =>
      createInheritedRollbackAuthorization({
        reconciliation,
        reason: "restore-inherited",
      }),
    /cannot be auto-rolled back/,
  );
});

// Every reviewed target maps exactly one alias, so an App frontier is a
// whole-target candidate state; a mixed state is malformed evidence.
test("an App candidate frontier is a complete activation prefix", () => {
  const reconciliation = reconcileMainRelease(
    releaseState({ candidateCount: 3, appCandidateFrontier: true }),
  );
  assert.equal(reconciliation.frontier, null);
  assert.equal(reconciliation.targets.at(-1).state, "candidate");
  assert.equal(reconciliation.allCandidate, true);

  const mixed = releaseState({ candidateCount: 4 });
  mixed.currentMappings.app = [
    ...mixed.currentMappings.app,
    {
      alias: "second.mento.org",
      deploymentId: mixed.manifest.originalPriors.app.deploymentId,
      deploymentUrl: mixed.manifest.originalPriors.app.deploymentUrl,
    },
  ];
  assert.throws(
    () => reconcileMainRelease(mixed),
    /current mappings do not match reviewed aliases/,
  );
});

test("only an exact terminal App residual remains recoverable after ordinary rollback", () => {
  const candidateState = appRecoveryResidualState();
  for (const state of [candidateState]) {
    assert.throws(
      () => reconcileMainRelease(state),
      /(?:activation prefix|outside the release frontier)/,
    );
    const reconciliation = reconcileMainReleaseForRecovery(state);
    assert.deepEqual(
      reconciliation.targets.map(({ target, state: targetState }) => [
        target,
        targetState,
      ]),
      [
        ["governance", "prior"],
        ["reserve", "prior"],
        ["ui", "prior"],
        ["app", "candidate"],
      ],
    );
    assert.deepEqual(
      createInheritedRollbackAuthorization({
        reconciliation,
        reason: "restore-inherited",
      }),
      {
        reason: "restore-inherited",
        targets: ["app"],
        aliases: [...state.manifest.originalPriors.app.aliases].sort(),
      },
    );
    assert.throws(
      () =>
        createInheritedRollbackAuthorization({
          reconciliation,
          reason: "first-forward-command",
        }),
      /(?:activation prefix|outside the release frontier)/,
    );
    for (const currentMain of [true, false]) {
      for (const preparation of [
        "ready",
        "failed",
        "pending",
        "producer-live",
      ]) {
        assert.deepEqual(
          decideMainReleaseReconciliation({
            reconciliation,
            currentMain,
            preparation,
          }),
          {
            decision: "restore-inherited",
            rollbackInherited: true,
            reason: "terminal-app-recovery-residual",
          },
          `${currentMain ? "current" : "stale"} main with ${preparation} preparation`,
        );
      }
    }
  }
});

test("an App-only active candidate is a complete release, not a recovery residual", () => {
  const state = releaseState({ selected: ["app"], candidateCount: 1 });
  const reconciliation = reconcileMainRelease(state);
  assert.equal(reconciliation.allCandidate, true);
  assert.deepEqual(reconciliation.inheritedCandidateTargets, ["app"]);

  const matching = decideMainPreplanReconciliation({
    nextDeploySha: state.manifest.deploySha,
    nextUpstreamRunId: state.manifest.upstreamRunId,
    candidateReleases: [candidateRelease(state)],
    currentMappings: state.currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(matching.decision, "verify-existing-release");
  assert.equal(matching.reason, "current-main-release-already-complete");
  assert.equal(matching.rollbackAuthorization, null);

  const older = decideMainPreplanReconciliation({
    nextDeploySha: "2222222222222222222222222222222222222222",
    nextUpstreamRunId: "800",
    candidateReleases: [candidateRelease(state)],
    currentMappings: state.currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(older.decision, "capture-new-baseline");
  assert.equal(older.reason, "older-mapped-release-is-complete");
  assert.equal(older.rollbackAuthorization, null);
});

test("unsupported non-prefix, third-party, missing-candidate, and disagreeing-manifest states fail closed", () => {
  const nonPrefix = releaseState({ candidateCount: 2 });
  nonPrefix.currentMappings.governance = [
    mapping("governance.mento.org", "governance", "prior"),
  ];
  assert.throws(() => reconcileMainRelease(nonPrefix), /activation prefix/);

  const thirdParty = releaseState({ candidateCount: 1 });
  thirdParty.currentMappings.governance[0] = {
    alias: "governance.mento.org",
    deploymentId: "dpl_manual123",
    deploymentUrl: "https://manual-immutable.vercel.app",
  };
  assert.throws(
    () => reconcileMainRelease(thirdParty),
    /neither exact prior nor exact candidate/,
  );

  const missing = releaseState({ candidateCount: 1 });
  missing.candidates.governance = null;
  assert.throws(
    () => reconcileMainRelease(missing),
    /neither exact prior nor exact candidate/,
  );

  const disagreeing = releaseState({ candidateCount: 2 });
  disagreeing.candidates.reserve.manifest = manifest(["reserve"]);
  assert.throws(
    () => reconcileMainRelease(disagreeing),
    /disagree on their stable manifest/,
  );

  const ordinarySuffix = releaseState();
  ordinarySuffix.candidates.reserve = candidate(
    "reserve",
    ordinarySuffix.manifest,
  );
  ordinarySuffix.currentMappings.reserve =
    ordinarySuffix.manifest.originalPriors.reserve.aliases.map((alias) =>
      mappingFor(alias, ordinarySuffix.candidates.reserve),
    );
  assert.throws(
    () => reconcileMainRelease(ordinarySuffix),
    /activation prefix/,
  );

  // An App candidate ahead of an unmapped ordinary target is not a prefix.
  const appAheadOfOrdinary = releaseState({
    candidateCount: 1,
    appCandidateFrontier: true,
  });
  assert.throws(
    () => reconcileMainRelease(appAheadOfOrdinary),
    /activation prefix/,
  );
  assert.throws(
    () => reconcileMainReleaseForRecovery(ordinarySuffix),
    /activation prefix/,
  );
  assert.throws(
    () => reconcileMainReleaseForRecovery(appAheadOfOrdinary),
    /activation prefix/,
  );
});

test("selected subsets use activation order and never authorize unselected targets", () => {
  const state = releaseState({
    selected: ["app", "reserve"],
    candidateCount: 1,
  });
  assert.deepEqual(state.manifest.stagedTargets, ["reserve", "app"]);
  assert.deepEqual(state.manifest.activeTargets, ["reserve", "app"]);
  const reconciliation = reconcileMainRelease(state);
  assert.deepEqual(reconciliation.inheritedCandidateTargets, ["reserve"]);
  assert.equal(reconciliation.frontier, "app");
  assert.deepEqual(
    createInheritedRollbackAuthorization({
      reconciliation,
      reason: "first-forward-command",
    }).targets,
    ["reserve"],
  );

  const driftedUnselected = structuredClone(state);
  driftedUnselected.currentMappings.ui[0] = mapping(
    driftedUnselected.currentMappings.ui[0].alias,
    "ui",
    "candidate",
  );
  assert.throws(
    () => reconcileMainRelease(driftedUnselected),
    /neither exact prior nor exact candidate/,
  );
});

test("shadow-staged candidates are reusable evidence but never gain activation authority", () => {
  const releaseManifest = manifest(["governance", "reserve"], {
    active: ["reserve"],
    shadow: ["governance"],
  });
  const state = {
    manifest: releaseManifest,
    candidates: {
      governance: candidate("governance", releaseManifest),
      reserve: candidate("reserve", releaseManifest),
    },
    currentMappings: Object.fromEntries(
      MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
        const priorRecord = releaseManifest.originalPriors[target];
        return [
          target,
          priorRecord.aliases.map((alias) =>
            mapping(
              alias,
              target,
              target === "reserve" ? "candidate" : "prior",
            ),
          ),
        ];
      }),
    ),
  };
  const reconciliation = reconcileMainRelease(state);
  assert.deepEqual(
    reconciliation.targets.map(({ target }) => target),
    ["reserve"],
  );
  assert.deepEqual(reconciliation.inheritedCandidateTargets, ["reserve"]);

  state.currentMappings.governance[0] = mapping(
    state.currentMappings.governance[0].alias,
    "governance",
    "candidate",
  );
  assert.throws(
    () => reconcileMainRelease(state),
    /not active and must remain at its original prior/,
  );
});

for (const inheritedCount of [1, 2, 3]) {
  test(`fresh run restores ${inheritedCount}-target interrupted older release before planning`, () => {
    const state = releaseState({ candidateCount: inheritedCount });
    const decision = decideMainPreplanReconciliation({
      nextDeploySha: "2222222222222222222222222222222222222222",
      nextUpstreamRunId: "800",
      candidateReleases: [candidateRelease(state)],
      currentMappings: state.currentMappings,
      rollbackOnlyTargets: [],
    });
    assert.equal(decision.decision, "restore-before-planning");
    assert.equal(
      decision.reason,
      "older-main-release-is-an-interrupted-prefix",
    );
    assert.deepEqual(
      decision.rollbackAuthorization.targets,
      state.manifest.activeTargets.slice(0, inheritedCount),
    );
  });
}

test("pre-plan inspection resumes the same interrupted release and accepts a complete older release as baseline", () => {
  const partial = releaseState({ candidateCount: 2 });
  assert.equal(
    decideMainPreplanReconciliation({
      nextDeploySha: SHA,
      nextUpstreamRunId: "700",
      candidateReleases: [candidateRelease(partial)],
      currentMappings: partial.currentMappings,
      rollbackOnlyTargets: [],
    }).decision,
    "resume-existing-release",
  );
  assert.equal(
    decideMainPreplanReconciliation({
      nextDeploySha: SHA,
      nextUpstreamRunId: "701",
      candidateReleases: [candidateRelease(partial)],
      currentMappings: partial.currentMappings,
      rollbackOnlyTargets: [],
    }).decision,
    "restore-before-planning",
  );

  const complete = releaseState({ candidateCount: 4 });
  assert.equal(
    decideMainPreplanReconciliation({
      nextDeploySha: "2222222222222222222222222222222222222222",
      nextUpstreamRunId: "800",
      candidateReleases: [candidateRelease(complete)],
      currentMappings: complete.currentMappings,
      rollbackOnlyTargets: [],
    }).decision,
    "capture-new-baseline",
  );
  assert.equal(
    decideMainPreplanReconciliation({
      nextDeploySha: SHA,
      nextUpstreamRunId: "701",
      candidateReleases: [candidateRelease(complete)],
      currentMappings: complete.currentMappings,
      rollbackOnlyTargets: [],
    }).decision,
    "capture-new-baseline",
  );
});

test("same-release reuse requires every fresh rollback-only target to be staged", () => {
  const verifyState = releaseState({
    selected: ["governance"],
    candidateCount: 1,
  });
  assert.throws(
    () =>
      decideMainPreplanReconciliation({
        nextDeploySha: SHA,
        nextUpstreamRunId: "700",
        candidateReleases: [candidateRelease(verifyState)],
        currentMappings: verifyState.currentMappings,
        rollbackOnlyTargets: ["ui"],
      }),
    /omits fresh rollback-only targets: ui/,
  );

  const resumeState = releaseState({
    selected: ["governance", "reserve"],
    candidateCount: 1,
  });
  assert.throws(
    () =>
      decideMainPreplanReconciliation({
        nextDeploySha: SHA,
        nextUpstreamRunId: "700",
        candidateReleases: [candidateRelease(resumeState)],
        currentMappings: resumeState.currentMappings,
        rollbackOnlyTargets: ["ui"],
      }),
    /omits fresh rollback-only targets: ui/,
  );
  const covered = decideMainPreplanReconciliation({
    nextDeploySha: SHA,
    nextUpstreamRunId: "700",
    candidateReleases: [candidateRelease(resumeState)],
    currentMappings: resumeState.currentMappings,
    rollbackOnlyTargets: ["reserve"],
  });
  assert.equal(covered.decision, "resume-existing-release");
  assert.deepEqual(covered.rollbackOnlyTargets, ["reserve"]);
});

test("fresh uncovered targets preserve safe older-release recovery decisions", () => {
  const olderComplete = releaseState({
    selected: ["governance"],
    candidateCount: 1,
  });
  assert.equal(
    decideMainPreplanReconciliation({
      nextDeploySha: "2222222222222222222222222222222222222222",
      nextUpstreamRunId: "800",
      candidateReleases: [candidateRelease(olderComplete)],
      currentMappings: olderComplete.currentMappings,
      rollbackOnlyTargets: ["ui"],
    }).decision,
    "capture-new-baseline",
  );

  const olderPartial = releaseState({
    selected: ["governance", "reserve"],
    candidateCount: 1,
  });
  assert.equal(
    decideMainPreplanReconciliation({
      nextDeploySha: "2222222222222222222222222222222222222222",
      nextUpstreamRunId: "800",
      candidateReleases: [candidateRelease(olderPartial)],
      currentMappings: olderPartial.currentMappings,
      rollbackOnlyTargets: ["ui"],
    }).decision,
    "restore-before-planning",
  );
});

test("pre-plan inspection restores an older App-frontier release", () => {
  const state = releaseState({ candidateCount: 3 });
  const decision = decideMainPreplanReconciliation({
    nextDeploySha: "2222222222222222222222222222222222222222",
    nextUpstreamRunId: "800",
    candidateReleases: [candidateRelease(state)],
    currentMappings: state.currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(decision.decision, "restore-before-planning");
  assert.deepEqual(decision.rollbackAuthorization.targets, [
    "governance",
    "reserve",
    "ui",
  ]);
  assert.deepEqual(decision.rollbackAuthorization.aliases, [
    "governance.mento.org",
    "reserve.mento.org",
    "ui.mento.org",
  ]);
});

test("pre-plan restores a terminal App candidate residual", () => {
  const candidateState = appRecoveryResidualState();
  const cases = [
    {
      name: "older",
      nextDeploySha: "2222222222222222222222222222222222222222",
      nextUpstreamRunId: "800",
      reason: "older-main-release-is-an-app-recovery-residual",
    },
    {
      name: "matching",
      nextDeploySha: candidateState.manifest.deploySha,
      nextUpstreamRunId: candidateState.manifest.upstreamRunId,
      reason: "current-main-release-is-an-app-recovery-residual",
    },
  ];

  for (const state of [candidateState]) {
    for (const current of cases) {
      const decision = decideMainPreplanReconciliation({
        nextDeploySha: current.nextDeploySha,
        nextUpstreamRunId: current.nextUpstreamRunId,
        candidateReleases: [candidateRelease(state)],
        currentMappings: state.currentMappings,
        rollbackOnlyTargets: [],
      });
      assert.equal(decision.decision, "restore-before-planning", current.name);
      assert.equal(decision.reason, current.reason, current.name);
      assert.deepEqual(decision.rollbackAuthorization, {
        reason: "restore-inherited",
        targets: ["app"],
        aliases: [...state.manifest.originalPriors.app.aliases].sort(),
      });
    }
  }
});

test("pre-plan inspection selects the unique partial frontier across completed path-aware releases", () => {
  const nativePriors = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => [target, prior(target)]),
  );
  const releaseOne = manifestWithPriors({
    selected: ["governance"],
    originalPriors: nativePriors,
    upstreamRunId: "701",
  });
  const governanceOne = candidate("governance", releaseOne, "r1candidate");

  const afterReleaseOne = structuredClone(nativePriors);
  afterReleaseOne.governance = recapturedPrior(
    afterReleaseOne.governance,
    governanceOne,
  );
  const releaseTwo = manifestWithPriors({
    selected: ["ui"],
    originalPriors: afterReleaseOne,
    upstreamRunId: "702",
  });
  const uiTwo = candidate("ui", releaseTwo, "r2candidate");

  const afterReleaseTwo = structuredClone(afterReleaseOne);
  afterReleaseTwo.ui = recapturedPrior(afterReleaseTwo.ui, uiTwo);
  const releaseThree = manifestWithPriors({
    selected: ["reserve", "app"],
    originalPriors: afterReleaseTwo,
    upstreamRunId: "703",
  });
  const reserveThree = candidate("reserve", releaseThree, "r3candidate");
  const currentMappings = Object.fromEntries(
    MAIN_RELEASE_ACTIVATION_ORDER.map((target) => {
      const record =
        target === "governance"
          ? governanceOne
          : target === "ui"
            ? uiTwo
            : target === "reserve"
              ? reserveThree
              : afterReleaseTwo.app;
      return [
        target,
        afterReleaseTwo[target].aliases.map((alias) =>
          mappingFor(alias, record),
        ),
      ];
    }),
  );
  const decision = decideMainPreplanReconciliation({
    nextDeploySha: "2222222222222222222222222222222222222222",
    nextUpstreamRunId: "800",
    candidateReleases: [
      {
        manifest: releaseOne,
        candidates: { governance: governanceOne },
      },
      {
        manifest: releaseTwo,
        candidates: { ui: uiTwo },
      },
      {
        manifest: releaseThree,
        candidates: { reserve: reserveThree, app: null },
      },
    ],
    currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(decision.decision, "restore-before-planning");
  assert.equal(
    decision.reconciliation.manifest.releaseId,
    releaseThree.releaseId,
  );
  assert.deepEqual(decision.rollbackAuthorization.targets, ["reserve"]);
  assert.equal(
    decision.reconciliation.manifest.originalPriors.governance.deploymentId,
    governanceOne.deploymentId,
  );
  assert.equal(
    decision.reconciliation.manifest.originalPriors.ui.deploymentId,
    uiTwo.deploymentId,
  );
});

test("all-prior preparation failure has no rollback authority or mutation", () => {
  const reconciliation = reconcileMainRelease(releaseState());
  assert.equal(reconciliation.allPrior, true);
  assert.deepEqual(
    decideMainReleaseReconciliation({
      reconciliation,
      currentMain: true,
      preparation: "failed",
    }),
    {
      decision: "fail-no-mutation",
      rollbackInherited: false,
      reason: "suffix-preparation-failed-before-release-mutation",
    },
  );
});

for (const [name, candidateCount, expectedDecision] of [
  ["before any current command", 0, "fail-no-mutation"],
  ["during suffix or App preparation", 2, "restore-inherited"],
]) {
  test(`runner loss ${name} does not wait for a vanished producer`, () => {
    const reconciliation = reconcileMainRelease(
      releaseState({ candidateCount }),
    );
    assert.equal(
      decideMainReleaseReconciliation({
        reconciliation,
        currentMain: true,
        preparation: "pending",
      }).decision,
      expectedDecision,
    );
    assert.equal(
      decideMainReleaseReconciliation({
        reconciliation,
        currentMain: true,
        preparation: "producer-live",
      }).decision,
      "wait",
    );
  });
}
