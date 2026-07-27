import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runMainReleaseCli } from "./vercel-main-release-cli.mjs";
import {
  canonicalizeMainCandidateVercelMetadata,
  createMainCandidateIntent,
  createMainCandidateReceipt,
  createMainCandidateVercelMetadata,
  encodeMainCandidateReceipt,
} from "./vercel-main-candidate.mjs";
import {
  createMainReleaseExecution,
  createMainReleaseSelection,
  decodeMainReleaseExecution,
} from "./vercel-main-release-execution.mjs";
import {
  createMainReleaseManifest,
  decideMainPreplanReconciliation,
  reconcileMainRelease,
} from "./vercel-main-release-reconciliation.mjs";
import { createMainCanonicalMappings } from "./vercel-main-provider-cli.mjs";
import {
  createMainTransactionId,
  mainTransactionJournalArtifactName,
} from "./vercel-main-transaction.mjs";
import {
  createMainActiveTerminalStateProof,
  createMainCurrentActivePublicSmokes,
  createMainCurrentReleaseVerifiedDeploymentStateSpec,
  createMainStageBarrier,
} from "./vercel-main-deployment.mjs";
import { createActiveDeploymentStateProof } from "./vercel-deployment-state.mjs";

const SHA = "a".repeat(40);
const PRIOR_SHA = "b".repeat(40);
const TARGETS = ["app", "governance", "reserve", "ui"];
const RELEASE_ORDER = ["governance", "reserve", "ui", "app"];

function planning(
  stagedTargets = ["app", "governance"],
  rollbackOnlyTargets = [],
) {
  return {
    schema: "vercel-main-plan:v2",
    mode: "active",
    deploySha: SHA,
    mainOwnershipMode: Object.fromEntries(
      TARGETS.map((target) => [target, "github"]),
    ),
    plan: [...stagedTargets],
    stagedTargets: [...stagedTargets],
    activeTargets: [...stagedTargets],
    shadowTargets: [],
    priors: TARGETS.map((target) => ({
      target,
      aliases:
        target === "app"
          ? ["app.mento.org", "appmentoorg-env-v3-mentolabs.vercel.app"]
          : [`${target}.mento.org`],
      deploymentId: `dpl_${target}Prior123`,
      deploymentUrl: `https://${target}-prior.vercel.app`,
      servedSha: PRIOR_SHA,
    })),
    ranges: [],
    reasons: rollbackOnlyTargets.map((target) => ({
      target,
      base: PRIOR_SHA,
      reason: "served-mapping-rollback-only",
    })),
  };
}

function manifest(
  stagedTargets = ["app", "governance"],
  upstreamRunId = "123",
  rollbackOnlyTargets = [],
) {
  const plan = planning(stagedTargets, rollbackOnlyTargets);
  const priors = Object.fromEntries(
    RELEASE_ORDER.map((target) => {
      const prior = plan.priors.find((entry) => entry.target === target);
      return [
        target,
        {
          deploymentId: prior.deploymentId,
          deploymentUrl: prior.deploymentUrl,
          aliases: prior.aliases,
          projectId: `prj_${target}`,
          projectName: `${target}.mento.org`,
          readyState: "READY",
          target: target === "app" ? null : "production",
          customEnvironmentSlug: target === "app" ? "v3" : null,
          planningLeaves: prior.aliases.map((alias) => ({
            alias,
            deploymentId: prior.deploymentId,
            deploymentUrl: prior.deploymentUrl,
            aliases: prior.aliases,
            projectId: `prj_${target}`,
            projectName: `${target}.mento.org`,
            readyState: "READY",
            target: target === "app" ? null : "production",
            customEnvironmentSlug: target === "app" ? "v3" : null,
            git: {
              status: "complete",
              org: "mento-protocol",
              repo: "frontend-monorepo",
              ref: "main",
              sha: PRIOR_SHA,
            },
          })),
          servedSha: PRIOR_SHA,
        },
      ];
    }),
  );
  return createMainReleaseManifest({
    upstreamRunId,
    plan,
    originalPriors: priors,
  });
}

function legacy() {
  return [
    {
      alias: "v2-app.mento.org",
      deploymentId: "dpl_legacyV2Prior123",
      deploymentUrl: "https://legacy-v2-prior.vercel.app",
      creatorUsername: "mentolabs",
      projectId: "prj_app",
      projectName: "app.mento.org",
      readyState: "READY",
      target: "production",
      customEnvironmentSlug: null,
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "v2",
        sha: "c".repeat(40),
      },
      aliases: [
        "appmentoorg-git-v2-mentolabs.vercel.app",
        "appmentoorg-mentolabs.vercel.app",
        "appmentoorg.vercel.app",
        "v2-app.mento.org",
      ],
    },
  ];
}

function preplan(releaseManifest, decision = "resume-existing-release") {
  const reason =
    decision === "resume-existing-release"
      ? "current-main-release-is-an-interrupted-prefix"
      : "current-main-release-already-complete";
  const candidates = Object.fromEntries(
    releaseManifest.stagedTargets.map((target) => [
      target,
      {
        deploymentId: `dpl_${target}Candidate123`,
        deploymentUrl: `https://${target}-candidate.vercel.app`,
        manifest: releaseManifest,
      },
    ]),
  );
  const firstActive = releaseManifest.activeTargets[0];
  const currentMappings = Object.fromEntries(
    RELEASE_ORDER.map((target) => {
      const prior = releaseManifest.originalPriors[target];
      const atCandidate =
        releaseManifest.activeTargets.includes(target) &&
        (decision === "verify-existing-release" || target === firstActive);
      const candidate = candidates[target];
      return [
        target,
        prior.aliases.map((alias) => ({
          alias,
          deploymentId: atCandidate
            ? candidate.deploymentId
            : prior.deploymentId,
          deploymentUrl: atCandidate
            ? candidate.deploymentUrl
            : prior.deploymentUrl,
        })),
      ];
    }),
  );
  const reconciliation = reconcileMainRelease({
    manifest: releaseManifest,
    candidates,
    currentMappings,
  });
  return {
    schema: "vercel-main-preplan-reconciliation:v2",
    decision,
    reason,
    rollbackOnlyTargets: [],
    reconciliation,
    rollbackAuthorization: null,
  };
}

function candidateRelease(releaseManifest) {
  return {
    manifest: releaseManifest,
    candidates: Object.fromEntries(
      releaseManifest.stagedTargets.map((target) => [
        target,
        {
          deploymentId: `dpl_${target}Candidate123`,
          deploymentUrl: `https://${target}-candidate.vercel.app`,
          manifest: releaseManifest,
        },
      ]),
    ),
  };
}

function planningSnapshot(
  releaseManifest,
  decision = "resume-existing-release",
) {
  const decisionState = preplan(releaseManifest, decision);
  return {
    schema: "vercel-main-planning-snapshot:v1",
    states: decisionState.reconciliation.observedTargets
      .flatMap(({ target, startMappings }) => {
        const prior = releaseManifest.originalPriors[target];
        return startMappings.map((mapping) => ({
          alias: mapping.alias,
          deploymentId: mapping.deploymentId,
          deploymentUrl: mapping.deploymentUrl,
          creatorUsername: "mentolabs",
          projectId: prior.projectId,
          projectName: prior.projectName,
          readyState: "READY",
          target: prior.target,
          customEnvironmentSlug: prior.customEnvironmentSlug,
          git: {
            org: "mento-protocol",
            repo: "frontend-monorepo",
            ref: "main",
            sha: mapping.deploymentId === prior.deploymentId ? PRIOR_SHA : SHA,
          },
          aliases: [...prior.aliases],
        }));
      })
      .sort((left, right) => left.alias.localeCompare(right.alias)),
  };
}

function discovery(
  releaseManifest,
  snapshot,
  { empty = false, rollbackOnlyTargets = [] } = {},
) {
  const legacyState = legacy()[0];
  return {
    schema: "vercel-main-provider-discovery:v2",
    planningSnapshotDigest: createHash("sha256")
      .update(JSON.stringify(snapshot))
      .digest("hex"),
    legacyAppV2Digest: createHash("sha256")
      .update(JSON.stringify(legacyState))
      .digest("hex"),
    projectIds: {
      app: "prj_app",
      governance: "prj_governance",
      reserve: "prj_reserve",
      ui: "prj_ui",
    },
    discovery: {
      schema: "vercel-main-preplan-candidate-discovery:v2",
      rollbackOnlyTargets,
      candidateReleases: empty ? [] : [candidateRelease(releaseManifest)],
    },
  };
}

function environment(directory) {
  const output = join(directory, "github-output");
  closeSync(openSync(output, "w", 0o600));
  return {
    RUNNER_TEMP: directory,
    DEPLOY_SHA: SHA,
    UPSTREAM_RUN_ID: "123",
    UPSTREAM_RUN_ATTEMPT: "2",
    UPSTREAM_RUN_URL:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/2",
    BUILD_AND_TEST_JOB_URL:
      "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/456",
    VERCEL_MAIN_MODE: "active",
    MAIN_OWNERSHIP_MODE_JSON:
      '{"app":"github","governance":"github","reserve":"github","ui":"github"}',
    VERCEL_PROJECT_ID_APP: "prj_app",
    VERCEL_PROJECT_ID_GOVERNANCE: "prj_governance",
    VERCEL_PROJECT_ID_RESERVE: "prj_reserve",
    VERCEL_PROJECT_ID_UI: "prj_ui",
    SOURCE_PATH: directory,
    GITHUB_OUTPUT: output,
    GITHUB_RUN_ID: "800",
    GITHUB_RUN_ATTEMPT: "3",
  };
}

function executionFor(releaseManifest) {
  const legacyState = legacy()[0];
  return createMainReleaseExecution({
    decision:
      releaseManifest.stagedTargets.length === 0
        ? "verify-existing-release"
        : "resume-existing-release",
    reason:
      releaseManifest.stagedTargets.length === 0
        ? "current-main-release-already-complete"
        : "current-main-release-is-an-interrupted-prefix",
    manifest: releaseManifest,
    upstream: {
      runId: releaseManifest.upstreamRunId,
      runAttempt: "2",
      runUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${releaseManifest.upstreamRunId}/attempts/2`,
      buildAndTestJobUrl: `https://github.com/mento-protocol/frontend-monorepo/actions/runs/${releaseManifest.upstreamRunId}/job/456`,
    },
    legacyAppV2: legacyState,
    selection: createMainReleaseSelection({
      providerDiscoveryDigest: "c".repeat(64),
      planningSnapshotDigest: "d".repeat(64),
      rollbackOnlyTargets: releaseManifest.rollbackOnlyTargets,
      legacyAppV2: legacyState,
      projectIds: Object.fromEntries(
        RELEASE_ORDER.map((target) => [target, `prj_${target}`]),
      ),
      mode: releaseManifest.mode,
      mainOwnershipMode: releaseManifest.mainOwnershipMode,
      selectedManifest: releaseManifest,
    }),
  });
}

function write(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return path;
}

function currentAttemptReceipt(
  releaseManifest,
  target,
  { runId = "800", runAttempt = "3" } = {},
) {
  const identity = {
    repository: "mento-protocol/frontend-monorepo",
    deploySha: releaseManifest.deploySha,
    runId,
    runAttempt,
  };
  const prior = releaseManifest.originalPriors[target];
  const intent = createMainCandidateIntent({
    target,
    deploySha: releaseManifest.deploySha,
    upstreamRunId: releaseManifest.upstreamRunId,
    originRunId: identity.runId,
    originAttempt: identity.runAttempt,
    originTransactionId: createMainTransactionId(identity),
    projectId: prior.projectId,
    projectName: prior.projectName,
    releaseManifest,
  });
  const deploymentUrl = `https://${target}-candidate.vercel.app`;
  return createMainCandidateReceipt({
    intent,
    candidate: {
      deploymentId: `dpl_${target}Candidate123`,
      deploymentUrl,
      projectId: prior.projectId,
      projectName: prior.projectName,
      readyState: "READY",
      target: target === "app" ? null : "production",
      customEnvironmentSlug: target === "app" ? "v3" : null,
      source: "cli",
      git: {
        org: "mento-protocol",
        repo: "frontend-monorepo",
        ref: "main",
        sha: releaseManifest.deploySha,
      },
      metadata: canonicalizeMainCandidateVercelMetadata(
        createMainCandidateVercelMetadata({ intent }),
        {
          target,
          deploySha: releaseManifest.deploySha,
          projectId: prior.projectId,
          projectName: prior.projectName,
        },
      ),
    },
    immutableSmoke: {
      immutableUrl: deploymentUrl,
      servedSha: releaseManifest.deploySha,
      status: "passed",
    },
  });
}

function verifiedReleaseExecution(releaseManifest) {
  const execution = executionFor(releaseManifest);
  return createMainReleaseExecution({
    ...execution,
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
  });
}

function currentReleaseRuntimeSmoke(target) {
  const finalUrls = {
    app: "https://app.mento.org/",
    governance: "https://governance.mento.org/voting-power",
    reserve: "https://reserve.mento.org/?tab=stablecoins",
    ui: "https://ui.mento.org/form-components",
  };
  const interactions = {
    app: "real-production-wallet-list",
    governance: "governance-voting-power-navigation",
    reserve: "reserve-overview-data-and-supply-tab",
    ui: "ui-search-navigation-and-checkbox",
  };
  return {
    deploy_sha: SHA,
    final_url: finalUrls[target],
    interaction: interactions[target],
    logical_target: target,
    public_url: `https://${target}.mento.org/`,
    successful_documents: 1,
    successful_fonts: 1,
    successful_scripts: 1,
    successful_stylesheets: 1,
  };
}

function currentReleaseFixture() {
  const release = manifest(["governance"]);
  const execution = verifiedReleaseExecution(release);
  const governanceReceipt = currentAttemptReceipt(release, "governance");
  const barrier = createMainStageBarrier({
    execution,
    candidateReceipts: {
      app: null,
      governance: governanceReceipt,
      reserve: null,
      ui: null,
    },
    appPreparation: null,
    runId: "800",
    runAttempt: "3",
  });
  const stateSpec = createMainCurrentReleaseVerifiedDeploymentStateSpec({
    execution,
    barrier,
    runId: "800",
    runAttempt: "3",
  });
  const deployments = Object.fromEntries(
    Object.entries(stateSpec.projects).map(([target, project]) => {
      if (project.deploymentId === null) return [target, []];
      return [
        target,
        [
          {
            deploymentId: project.deploymentId,
            response: {
              id: project.deploymentId,
              url: project.deploymentUrl,
              projectId: project.projectId,
              name: project.projectName,
              readyState: "READY",
              target: project.target,
              customEnvironment:
                project.customEnvironmentSlug === null
                  ? null
                  : { slug: project.customEnvironmentSlug },
              source: "cli",
              meta: {
                githubCommitOrg: "mento-protocol",
                githubCommitRef: "main",
                githubCommitRepo: "frontend-monorepo",
                githubCommitSha: SHA,
                ...createMainCandidateVercelMetadata({
                  intent: createMainCandidateIntent({
                    target,
                    deploySha: stateSpec.deploySha,
                    upstreamRunId: stateSpec.releaseManifest.upstreamRunId,
                    originRunId: stateSpec.runId,
                    originAttempt: stateSpec.runAttempt,
                    originTransactionId: stateSpec.transactionId,
                    projectId: project.projectId,
                    projectName: project.projectName,
                    releaseManifest: stateSpec.releaseManifest,
                  }),
                }),
              },
              git: {
                org: "mento-protocol",
                repo: "frontend-monorepo",
                ref: "main",
                sha: SHA,
              },
            },
          },
        ],
      ];
    }),
  );
  const deploymentStateProof = createActiveDeploymentStateProof({
    spec: stateSpec,
    deployments,
    legacyV2: {
      ownership: "native-vercel-git",
      state: {
        alias: stateSpec.legacyAppV2.alias,
        deploymentId: stateSpec.legacyAppV2.deployment,
        deploymentUrl: stateSpec.legacyAppV2.deploymentUrl,
        creatorUsername: null,
        projectId: stateSpec.legacyAppV2.projectId,
        projectName: stateSpec.legacyAppV2.projectName,
        readyState: "READY",
        target: "production",
        customEnvironmentSlug: null,
        git: { ...stateSpec.legacyAppV2.git },
        aliases: [stateSpec.legacyAppV2.alias],
      },
    },
  });
  assert.equal(deploymentStateProof.outcome, "proven");
  const terminalStateProof = createMainActiveTerminalStateProof({
    execution,
    barrier,
    stateProof: deploymentStateProof,
    runId: "800",
    runAttempt: "3",
  });
  const finalMappings = {
    schema: "vercel-main-canonical-mappings:v1",
    mappings: Object.fromEntries(
      [...TARGETS, "legacy-app"].map((target) => {
        const prior =
          target === "legacy-app"
            ? execution.legacyAppV2
            : execution.manifest.originalPriors[target];
        const candidate =
          target === "governance" ? governanceReceipt.candidate : prior;
        return [
          target,
          prior.aliases
            .map((alias) => ({
              alias,
              deploymentId: candidate.deploymentId,
              deploymentUrl: candidate.deploymentUrl,
            }))
            .toSorted((left, right) => left.alias.localeCompare(right.alias)),
        ];
      }),
    ),
  };
  const publicSmokes = createMainCurrentActivePublicSmokes({
    execution,
    barrier,
    targetResults: {
      app: null,
      governance: currentReleaseRuntimeSmoke("governance"),
      reserve: null,
      ui: null,
    },
    runId: "800",
    runAttempt: "3",
  });
  return {
    execution,
    finalMappings,
    freshLegacyV2: [execution.legacyAppV2],
    freshness: {
      schema: "vercel-main-active-freshness:v1",
      status: "fresh",
      deploySha: SHA,
      observedSha: SHA,
    },
    publicSmokes,
    terminalStateProof,
  };
}

function executionArguments(
  directory,
  {
    release,
    census,
    preplanValue = preplan(release),
    discoveryValue = discovery(release, census),
    legacyValue = legacy(),
    suffix = "",
  },
) {
  return [
    "execution",
    "--preplan",
    write(directory, `preplan${suffix}.json`, preplanValue),
    "--discovery",
    write(directory, `discovery${suffix}.json`, discoveryValue),
    "--planning-snapshot",
    write(directory, `planning${suffix}.json`, census),
    "--legacy-snapshot",
    write(directory, `legacy${suffix}.json`, legacyValue),
    "--output",
    join(directory, `execution${suffix}.json`),
  ];
}

test("execution consumes the exact provider manifest without a new baseline", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest();
  const census = planningSnapshot(release);
  const providerDiscovery = discovery(release, census);
  const env = environment(directory);
  const output = join(directory, "execution.json");
  const value = await runMainReleaseCli({
    argv: [
      "execution",
      "--preplan",
      write(directory, "preplan.json", preplan(release)),
      "--discovery",
      write(directory, "discovery.json", providerDiscovery),
      "--planning-snapshot",
      write(directory, "planning.json", census),
      "--legacy-snapshot",
      write(directory, "legacy.json", legacy()),
      "--output",
      output,
    ],
    env,
    baselineFactory: () =>
      assert.fail("resume must not invoke the baseline planner"),
  });
  assert.equal(value.manifest.releaseId, release.releaseId);
  assert.equal(value.decision, "resume-existing-release");
  const encoded = readFileSync(env.GITHUB_OUTPUT, "utf8")
    .split("\n")
    .find((line) => line.startsWith("execution="))
    .slice("execution=".length);
  assert.deepEqual(
    decodeMainReleaseExecution(encoded, {
      deploySha: SHA,
      upstreamRunId: "123",
    }),
    value,
  );
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), value);
});

test("execution rejects same-release reuse that omits a fresh rollback-only target", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-rollback-coverage-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  for (const [name, stagedTargets, decision] of [
    ["verify", ["governance"], "verify-existing-release"],
    ["resume", ["governance", "reserve"], "resume-existing-release"],
  ]) {
    const release = manifest(stagedTargets);
    const census = planningSnapshot(release, decision);
    const preplanValue = {
      ...preplan(release, decision),
      rollbackOnlyTargets: ["ui"],
    };
    await assert.rejects(
      runMainReleaseCli({
        argv: executionArguments(directory, {
          release,
          census,
          preplanValue,
          discoveryValue: discovery(release, census, {
            rollbackOnlyTargets: ["ui"],
          }),
          suffix: `-${name}`,
        }),
        env: environment(directory),
      }),
      /omits fresh rollback-only targets: ui/,
      name,
    );
  }
});

test("existing release execution rejects a replacement baseline", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest();
  const census = planningSnapshot(release);
  await assert.rejects(
    runMainReleaseCli({
      argv: [
        "execution",
        "--preplan",
        write(directory, "preplan.json", preplan(release)),
        "--discovery",
        write(directory, "discovery.json", discovery(release, census)),
        "--planning-snapshot",
        write(directory, "planning.json", census),
        "--legacy-snapshot",
        write(directory, "legacy.json", legacy()),
        "--baseline",
        write(directory, "baseline.json", release),
        "--output",
        join(directory, "execution.json"),
      ],
      env: environment(directory),
    }),
    /unsupported or duplicated/,
  );
});

test("only capture-new execution invokes the baseline planner", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest(TARGETS, "123", TARGETS);
  const census = planningSnapshot(release);
  const capturePreplan = {
    schema: "vercel-main-preplan-reconciliation:v2",
    decision: "capture-new-baseline",
    reason: "no-mapped-release-metadata",
    rollbackOnlyTargets: ["app", "governance", "reserve", "ui"],
    reconciliation: null,
    rollbackAuthorization: null,
  };
  let captured = 0;
  const value = await runMainReleaseCli({
    argv: executionArguments(directory, {
      release,
      census,
      preplanValue: capturePreplan,
      discoveryValue: discovery(release, census, {
        empty: true,
        rollbackOnlyTargets: ["app", "governance", "reserve", "ui"],
      }),
    }),
    env: environment(directory),
    baselineFactory: (options) => {
      captured += 1;
      assert.deepEqual(options.planningSnapshot, census);
      assert.deepEqual(options.rollbackOnlyTargets, [
        "app",
        "governance",
        "reserve",
        "ui",
      ]);
      return { manifest: release };
    },
  });
  assert.equal(captured, 1);
  assert.equal(value.decision, "capture-new-baseline");
});

test("execution rejects provider evidence that does not select the supplied release", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest();
  const census = planningSnapshot(release);
  const baseDiscovery = discovery(release, census);
  const alteredManifest = {
    ...release,
    releasePlanDigest: "e".repeat(64),
  };
  const cases = [
    {
      name: "empty-discovery",
      discoveryValue: discovery(release, census, { empty: true }),
      pattern: /pre-plan decision conflicts/,
    },
    {
      name: "swapped-projects",
      discoveryValue: {
        ...baseDiscovery,
        projectIds: {
          ...baseDiscovery.projectIds,
          governance: baseDiscovery.projectIds.reserve,
          reserve: baseDiscovery.projectIds.governance,
        },
      },
      pattern: /provider discovery conflicts/,
    },
    {
      name: "altered-selected-manifest",
      preplanValue: preplan(alteredManifest),
      pattern: /pre-plan decision conflicts/,
    },
    {
      name: "swapped-discovered-manifest",
      discoveryValue: {
        ...baseDiscovery,
        discovery: {
          ...baseDiscovery.discovery,
          candidateReleases: [candidateRelease(alteredManifest)],
        },
      },
      pattern: /pre-plan decision conflicts|compatible frontier/,
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    await assert.rejects(
      runMainReleaseCli({
        argv: executionArguments(directory, {
          release,
          census,
          preplanValue: scenario.preplanValue,
          discoveryValue: scenario.discoveryValue,
          suffix: `-${index}`,
        }),
        env: environment(directory),
      }),
      scenario.pattern,
      scenario.name,
    );
  }
});

test("execution rejects ownership, census, and valid legacy drift", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest();
  const census = planningSnapshot(release);
  const changedCensus = structuredClone(census);
  changedCensus.states.find(
    ({ alias }) => alias === "ui.mento.org",
  ).deploymentId = "dpl_changedUi123";
  changedCensus.states.find(
    ({ alias }) => alias === "ui.mento.org",
  ).deploymentUrl = "https://changed-ui.vercel.app";
  await assert.rejects(
    runMainReleaseCli({
      argv: executionArguments(directory, {
        release,
        census: changedCensus,
        discoveryValue: discovery(release, census),
        suffix: "-census",
      }),
      env: environment(directory),
    }),
    /provider discovery conflicts/,
  );

  const wrongOwnership = environment(directory);
  wrongOwnership.MAIN_OWNERSHIP_MODE_JSON =
    '{"app":"shadow","governance":"github","reserve":"github","ui":"github"}';
  await assert.rejects(
    runMainReleaseCli({
      argv: executionArguments(directory, {
        release,
        census,
        suffix: "-ownership",
      }),
      env: wrongOwnership,
    }),
    /ownership or projects/,
  );

  const wrongMode = environment(directory);
  wrongMode.VERCEL_MAIN_MODE = "shadow";
  await assert.rejects(
    runMainReleaseCli({
      argv: executionArguments(directory, {
        release,
        census,
        suffix: "-mode",
      }),
      env: wrongMode,
    }),
    /ownership or projects/,
  );

  const wrongProjects = environment(directory);
  wrongProjects.VERCEL_PROJECT_ID_UI = "prj_other";
  await assert.rejects(
    runMainReleaseCli({
      argv: executionArguments(directory, {
        release,
        census,
        suffix: "-projects",
      }),
      env: wrongProjects,
    }),
    /provider discovery conflicts/,
  );

  const changedLegacy = legacy();
  changedLegacy[0] = {
    ...changedLegacy[0],
    deploymentId: "dpl_changedLegacyV2Prior123",
    deploymentUrl: "https://changed-legacy-v2-prior.vercel.app",
  };
  await assert.rejects(
    runMainReleaseCli({
      argv: executionArguments(directory, {
        release,
        census,
        legacyValue: changedLegacy,
        suffix: "-legacy",
      }),
      env: environment(directory),
    }),
    /legacy v2 state changed/,
  );
});

test("release CLI rejects linked private inputs and outputs", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest();
  const census = planningSnapshot(release);
  const argv = executionArguments(directory, {
    release,
    census,
    suffix: "-linked",
  });
  const preplanPath = argv[2];
  const originalPath = join(directory, "preplan-original.json");
  linkSync(preplanPath, originalPath);
  await assert.rejects(
    runMainReleaseCli({ argv, env: environment(directory) }),
    /missing, unsafe, or malformed/,
  );

  const symlinkOutput = join(directory, "materialized-linked.json");
  symlinkSync(join(directory, "missing-target.json"), symlinkOutput);
  const value = createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: release,
    upstream: {
      runId: "123",
      runAttempt: "2",
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/2",
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/456",
    },
    legacyAppV2: legacy()[0],
    selection: createMainReleaseSelection({
      providerDiscoveryDigest: "c".repeat(64),
      planningSnapshotDigest: "d".repeat(64),
      rollbackOnlyTargets: release.rollbackOnlyTargets,
      legacyAppV2: legacy()[0],
      projectIds: Object.fromEntries(
        RELEASE_ORDER.map((target) => [target, `prj_${target}`]),
      ),
      mode: release.mode,
      mainOwnershipMode: release.mainOwnershipMode,
      selectedManifest: release,
    }),
  });
  await assert.rejects(
    runMainReleaseCli({
      argv: ["materialize", "--output", symlinkOutput],
      env: {
        ...environment(directory),
        MAIN_RELEASE_EXECUTION: Buffer.from(JSON.stringify(value)).toString(
          "base64url",
        ),
      },
    }),
    /could not be written safely/,
  );
});

test("materialize binds retained output to the exact SHA and upstream run", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-cli-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest();
  const legacyState = legacy()[0];
  const value = createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: release,
    upstream: {
      runId: "123",
      runAttempt: "2",
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/2",
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/456",
    },
    legacyAppV2: legacyState,
    selection: createMainReleaseSelection({
      providerDiscoveryDigest: "c".repeat(64),
      planningSnapshotDigest: "d".repeat(64),
      rollbackOnlyTargets: release.rollbackOnlyTargets,
      legacyAppV2: legacyState,
      projectIds: Object.fromEntries(
        RELEASE_ORDER.map((target) => [target, `prj_${target}`]),
      ),
      mode: release.mode,
      mainOwnershipMode: release.mainOwnershipMode,
      selectedManifest: release,
    }),
  });
  const env = {
    ...environment(directory),
    MAIN_RELEASE_EXECUTION: Buffer.from(JSON.stringify(value)).toString(
      "base64url",
    ),
  };
  const output = join(directory, "materialized.json");
  assert.deepEqual(
    await runMainReleaseCli({
      argv: ["materialize", "--output", output],
      env,
    }),
    value,
  );
  const selectionOutput = join(directory, "selection.json");
  assert.deepEqual(
    await runMainReleaseCli({
      argv: ["selection", "--execution", output, "--output", selectionOutput],
      env,
    }),
    value.selection,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(selectionOutput, "utf8")),
    value.selection,
  );
  env.DEPLOY_SHA = "e".repeat(40);
  await assert.rejects(
    runMainReleaseCli({
      argv: ["materialize", "--output", join(directory, "bad.json")],
      env,
    }),
    /expected SHA/,
  );
});

test("candidate receipt materializer binds every selected job output to the exact execution and attempt", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-receipts-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest(["app", "governance"]);
  const execution = executionFor(release);
  const executionPath = write(directory, "execution.json", execution);
  const governanceReceipt = currentAttemptReceipt(release, "governance");
  const governanceEncoded = encodeMainCandidateReceipt(governanceReceipt);
  const output = join(directory, "receipts.json");
  const argv = ({
    app = "none",
    governance = governanceEncoded,
    reserve = "none",
    ui = "none",
    destination = output,
  } = {}) => [
    "candidate-receipts",
    "--app",
    app,
    "--execution",
    executionPath,
    "--governance",
    governance,
    "--output",
    destination,
    "--reserve",
    reserve,
    "--ui",
    ui,
  ];
  const pending = await runMainReleaseCli({
    argv: argv(),
    env: environment(directory),
  });
  assert.deepEqual(pending, {
    app: null,
    governance: governanceReceipt,
    reserve: null,
    ui: null,
  });
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), pending);

  const appReceipt = currentAttemptReceipt(release, "app");
  const reused = await runMainReleaseCli({
    argv: argv({
      app: encodeMainCandidateReceipt(appReceipt),
      destination: join(directory, "receipts-reused-app.json"),
    }),
    env: environment(directory),
  });
  assert.deepEqual(reused.app, appReceipt);

  const noTargetRelease = manifest([]);
  assert.deepEqual(
    await runMainReleaseCli({
      argv: [
        "candidate-receipts",
        "--app",
        "none",
        "--execution",
        write(
          directory,
          "execution-no-target.json",
          executionFor(noTargetRelease),
        ),
        "--governance",
        "none",
        "--output",
        join(directory, "receipts-no-target.json"),
        "--reserve",
        "none",
        "--ui",
        "none",
      ],
      env: environment(directory),
    }),
    { app: null, governance: null, reserve: null, ui: null },
  );

  const divergentRelease = manifest(["app", "governance"], "124");
  const cases = [
    {
      name: "missing-selected-ordinary",
      governance: "none",
      pattern: /governance requires a receipt/,
    },
    {
      name: "unselected-target-receipt",
      reserve: governanceEncoded,
      pattern: /reserve must have no receipt/,
    },
    {
      name: "malformed-encoding",
      governance: "not_base64=",
      pattern: /encoding is malformed/,
    },
    {
      name: "wrong-release",
      governance: encodeMainCandidateReceipt(
        currentAttemptReceipt(divergentRelease, "governance"),
      ),
      pattern: /different intent/,
    },
    {
      name: "wrong-attempt",
      governance: encodeMainCandidateReceipt(
        currentAttemptReceipt(release, "governance", { runAttempt: "4" }),
      ),
      pattern: /not from the current attempt/,
    },
  ];
  for (const [index, scenario] of cases.entries()) {
    await assert.rejects(
      runMainReleaseCli({
        argv: argv({
          governance: scenario.governance ?? governanceEncoded,
          reserve: scenario.reserve ?? "none",
          destination: join(directory, `receipts-invalid-${index}.json`),
        }),
        env: environment(directory),
      }),
      scenario.pattern,
      scenario.name,
    );
  }
  await assert.rejects(
    runMainReleaseCli({
      argv: [
        "candidate-receipts",
        "--app",
        "none",
        "--execution",
        executionPath,
        "--governance",
        "",
        "--output",
        join(directory, "receipts-empty.json"),
        "--reserve",
        "none",
        "--ui",
        "none",
      ],
      env: environment(directory),
    }),
    /arguments are malformed/,
  );
});

test("inherited recovery requires current-attempt receipts only for moved candidates", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-inherited-candidates-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest(["app", "governance"], "122");
  const sameReleasePreplan = preplan(release);
  const currentMappings = Object.fromEntries(
    sameReleasePreplan.reconciliation.observedTargets.map(
      ({ target, startMappings }) => [
        target,
        startMappings.map(({ state: _state, ...mapping }) => {
          void _state;
          return mapping;
        }),
      ],
    ),
  );
  const inheritedPreplan = decideMainPreplanReconciliation({
    nextDeploySha: SHA,
    nextUpstreamRunId: "123",
    candidateReleases: [candidateRelease(release)],
    currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(inheritedPreplan.decision, "restore-before-planning");
  assert.deepEqual(inheritedPreplan.rollbackAuthorization.targets, [
    "governance",
  ]);
  const preplanPath = write(
    directory,
    "inherited-candidate-preplan.json",
    inheritedPreplan,
  );
  const expectedIntent = currentAttemptReceipt(release, "governance").intent;
  const intentOutput = join(directory, "inherited-governance-intent.json");
  assert.deepEqual(
    await runMainReleaseCli({
      argv: [
        "inherited-candidate-intent",
        "--output",
        intentOutput,
        "--preplan",
        preplanPath,
        "--target",
        "governance",
      ],
      env: environment(directory),
    }),
    expectedIntent,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(intentOutput, "utf8")),
    expectedIntent,
  );

  const governanceReceipt = currentAttemptReceipt(release, "governance");
  const receiptOutput = join(directory, "inherited-candidate-receipts.json");
  const argv = ({
    app = "none",
    governance = encodeMainCandidateReceipt(governanceReceipt),
    reserve = "none",
    ui = "none",
    output = receiptOutput,
    preplanValue = preplanPath,
  } = {}) => [
    "inherited-candidate-receipts",
    "--app",
    app,
    "--governance",
    governance,
    "--output",
    output,
    "--preplan",
    preplanValue,
    "--reserve",
    reserve,
    "--ui",
    ui,
  ];
  const receipts = await runMainReleaseCli({
    argv: argv(),
    env: environment(directory),
  });
  assert.deepEqual(receipts, {
    app: null,
    governance: governanceReceipt,
    reserve: null,
    ui: null,
  });
  assert.deepEqual(JSON.parse(readFileSync(receiptOutput, "utf8")), receipts);

  const cases = [
    {
      name: "missing-moved-governance",
      arguments: argv({
        governance: "none",
        output: join(directory, "missing-governance.json"),
      }),
      pattern:
        /moved inherited main release target governance requires a receipt/i,
    },
    {
      name: "unmoved-pending-app-receipt",
      arguments: argv({
        app: encodeMainCandidateReceipt(governanceReceipt),
        output: join(directory, "unmoved-app.json"),
      }),
      pattern: /unmoved inherited main release target app/i,
    },
    {
      name: "wrong-attempt",
      arguments: argv({
        governance: encodeMainCandidateReceipt(
          currentAttemptReceipt(release, "governance", { runAttempt: "4" }),
        ),
        output: join(directory, "wrong-attempt.json"),
      }),
      pattern: /not from the current attempt/,
    },
    {
      name: "non-restore-preplan",
      arguments: argv({
        output: join(directory, "non-restore.json"),
        preplanValue: write(
          directory,
          "non-restore-preplan.json",
          preplan(release),
        ),
      }),
      pattern: /decision is inconsistent|requires restore-before-planning/,
    },
  ];
  for (const scenario of cases) {
    await assert.rejects(
      runMainReleaseCli({
        argv: scenario.arguments,
        env: environment(directory),
      }),
      scenario.pattern,
      scenario.name,
    );
  }
  await assert.rejects(
    runMainReleaseCli({
      argv: [
        "inherited-candidate-intent",
        "--output",
        join(directory, "unmoved-intent.json"),
        "--preplan",
        preplanPath,
        "--target",
        "app",
      ],
      env: environment(directory),
    }),
    /target app has no moved candidate/,
  );
});

test("terminal artifact CLI writes execution-bound safe-noop evidence without planner or job JSON", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-terminal-artifacts-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const execution = executionFor(manifest([]));
  const evidenceOutput = join(directory, "active-evidence.json");
  const proofsOutput = join(directory, "terminal-proofs.json");
  const nullPath = write(directory, "terminal-null.json", null);
  const argumentsFor = ({
    legacyValue = [execution.legacyAppV2],
    legacyName = "terminal-legacy.json",
  } = {}) => [
    "terminal-artifacts",
    "--active-evidence-output",
    evidenceOutput,
    "--execution",
    write(directory, "terminal-execution.json", execution),
    "--final-census",
    nullPath,
    "--final-mappings",
    nullPath,
    "--freshness",
    nullPath,
    "--journal-history",
    write(directory, "terminal-empty-history.json", []),
    "--legacy-v2",
    write(directory, legacyName, legacyValue),
    "--outcome",
    "no-target",
    "--proofs-output",
    proofsOutput,
    "--public-smokes",
    nullPath,
    "--stage-results",
    nullPath,
    "--state-proof",
    nullPath,
  ];
  const artifacts = await runMainReleaseCli({
    argv: argumentsFor(),
    env: environment(directory),
  });
  assert.equal(
    artifacts.evidence.schema,
    "vercel-main-active-safe-noop-evidence:v1",
  );
  assert.equal(artifacts.evidence.reason, "no-target");
  assert.equal(artifacts.proofs.outcome, "no-target");
  assert.equal(artifacts.proofs.freshLegacyV2.status, "passed");
  assert.deepEqual(
    JSON.parse(readFileSync(evidenceOutput, "utf8")),
    artifacts.evidence,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(proofsOutput, "utf8")),
    artifacts.proofs,
  );
  await assert.rejects(
    runMainReleaseCli({
      argv: argumentsFor({
        legacyValue: [
          {
            ...execution.legacyAppV2,
            deploymentId: "dpl_wrongLegacy123",
          },
        ],
        legacyName: "terminal-wrong-legacy.json",
      }),
      env: environment(directory),
    }),
    /fresh legacy v2 snapshot conflicts/,
  );
});

test("terminal artifact CLI fully re-verifies an already-current release without a journal", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-current-release-terminal-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = currentReleaseFixture();
  const evidenceOutput = join(directory, "current-release-evidence.json");
  const proofsOutput = join(directory, "current-release-proofs.json");
  const argumentsFor = ({
    execution = fixture.execution,
    journalHistory = [],
    finalMappings = fixture.finalMappings,
    freshness = fixture.freshness,
    stateProof = fixture.terminalStateProof,
  } = {}) => [
    "terminal-artifacts",
    "--active-evidence-output",
    evidenceOutput,
    "--execution",
    write(directory, "current-release-execution.json", execution),
    "--final-census",
    write(directory, "current-release-final-census.json", stateProof),
    "--final-mappings",
    write(directory, "current-release-final-mappings.json", finalMappings),
    "--freshness",
    write(directory, "current-release-freshness.json", freshness),
    "--journal-history",
    write(directory, "current-release-history.json", journalHistory),
    "--legacy-v2",
    write(directory, "current-release-legacy-v2.json", fixture.freshLegacyV2),
    "--outcome",
    "current-release-verified",
    "--proofs-output",
    proofsOutput,
    "--public-smokes",
    write(
      directory,
      "current-release-public-smokes.json",
      fixture.publicSmokes,
    ),
    "--stage-results",
    write(directory, "current-release-stage-results.json", null),
    "--state-proof",
    write(directory, "current-release-terminal-state-proof.json", stateProof),
  ];

  const artifacts = await runMainReleaseCli({
    argv: argumentsFor(),
    env: environment(directory),
  });
  assert.equal(
    artifacts.evidence.schema,
    "vercel-main-active-current-release-evidence:v1",
  );
  assert.equal(artifacts.proofs.outcome, "current-release-verified");
  assert.equal(artifacts.proofs.mutationCount, 0);
  assert.deepEqual(artifacts.proofs.rollbackTargets, []);
  assert.deepEqual(artifacts.proofs.affectedOperations, []);
  assert.equal(artifacts.proofs.journal.status, "not-applicable");
  assert.equal(artifacts.proofs.finalMapping.status, "passed");
  assert.equal(artifacts.proofs.finalCensus.status, "passed");
  assert.equal(artifacts.proofs.stateProof.status, "passed");
  assert.equal(artifacts.proofs.publicSmoke.status, "passed");
  assert.equal(artifacts.proofs.freshLegacyV2.status, "passed");
  assert.equal(
    artifacts.proofs.publicSmoke.artifact.governance.runtime.interaction,
    "governance-voting-power-navigation",
  );
  assert.deepEqual(
    JSON.parse(readFileSync(evidenceOutput, "utf8")),
    artifacts.evidence,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(proofsOutput, "utf8")),
    artifacts.proofs,
  );

  const wrongExecution = structuredClone(fixture.execution);
  wrongExecution.decision = "resume-existing-release";
  const malformedWrapper = structuredClone(fixture.terminalStateProof);
  malformedWrapper.appShadowPreparation = null;
  for (const [name, overrides, pattern] of [
    ["wrong decision", { execution: wrongExecution }, /decision or reason/],
    ["nonempty journal", { journalHistory: [{ forged: true }] }, /journal/],
    [
      "stale freshness",
      {
        freshness: {
          ...fixture.freshness,
          status: "superseded",
          observedSha: "b".repeat(40),
        },
      },
      /(?:freshness|fresh main proof)/,
    ],
    [
      "malformed wrapper",
      { stateProof: malformedWrapper },
      /(?:state proof|terminal App shadow preparation)/,
    ],
  ]) {
    await assert.rejects(
      runMainReleaseCli({
        argv: argumentsFor(overrides),
        env: environment(directory),
      }),
      pattern,
      name,
    );
  }
});

test("terminal stage-result materializer preserves literal coordinator-only failure", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-stage-results-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const execution = executionFor(manifest(["governance"]));
  const result = await runMainReleaseCli({
    argv: [
      "terminal-stage-results",
      "--execution",
      write(directory, "execution.json", execution),
      "--app-result",
      "skipped",
      "--governance-result",
      "success",
      "--reserve-result",
      "skipped",
      "--ui-result",
      "skipped",
      "--coordinator-result",
      "failure",
      "--output",
      join(directory, "stage-results.json"),
    ],
    env: environment(directory),
  });
  assert.deepEqual(result, {
    schema: "vercel-main-stage-results:v2",
    deploySha: SHA,
    runId: "800",
    runAttempt: "3",
    results: {
      app: "skipped",
      governance: "success",
      reserve: "skipped",
      ui: "skipped",
    },
    coordinatorResult: "failure",
  });
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, "stage-results.json"), "utf8")),
    result,
  );
});

test("terminal artifact CLI materializes a pre-journal preparation failure from exact stage results", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-stage-failure-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const execution = executionFor(manifest(["governance"]));
  const nullPath = write(directory, "null.json", null);
  const evidenceOutput = join(directory, "evidence.json");
  const proofsOutput = join(directory, "proofs.json");
  const artifacts = await runMainReleaseCli({
    argv: [
      "terminal-artifacts",
      "--active-evidence-output",
      evidenceOutput,
      "--execution",
      write(directory, "execution.json", execution),
      "--final-census",
      nullPath,
      "--final-mappings",
      nullPath,
      "--freshness",
      nullPath,
      "--journal-history",
      write(directory, "history.json", []),
      "--legacy-v2",
      write(directory, "legacy.json", [execution.legacyAppV2]),
      "--outcome",
      "preparation-failed-before-journal",
      "--proofs-output",
      proofsOutput,
      "--public-smokes",
      nullPath,
      "--stage-results",
      write(directory, "stage-results.json", {
        schema: "vercel-main-stage-results:v2",
        deploySha: SHA,
        runId: "800",
        runAttempt: "3",
        results: {
          app: "skipped",
          governance: "failure",
          reserve: "skipped",
          ui: "skipped",
        },
        coordinatorResult: "skipped",
      }),
      "--state-proof",
      nullPath,
    ],
    env: environment(directory),
  });
  assert.equal(
    artifacts.evidence.schema,
    "vercel-main-active-preparation-failure-evidence:v1",
  );
  assert.equal(artifacts.proofs.outcome, "preparation-failed-before-journal");
  assert.deepEqual(
    JSON.parse(readFileSync(evidenceOutput, "utf8")),
    artifacts.evidence,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(proofsOutput, "utf8")),
    artifacts.proofs,
  );
});

test("forward journal uses only asserted execution, fresh mappings, and current-attempt receipts", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-forward-journal-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest([]);
  const legacyState = legacy()[0];
  const execution = createMainReleaseExecution({
    decision: "verify-existing-release",
    reason: "current-main-release-already-complete",
    manifest: release,
    upstream: {
      runId: "123",
      runAttempt: "2",
      runUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/attempts/2",
      buildAndTestJobUrl:
        "https://github.com/mento-protocol/frontend-monorepo/actions/runs/123/job/456",
    },
    legacyAppV2: legacyState,
    selection: createMainReleaseSelection({
      providerDiscoveryDigest: "c".repeat(64),
      planningSnapshotDigest: "d".repeat(64),
      rollbackOnlyTargets: release.rollbackOnlyTargets,
      legacyAppV2: legacyState,
      projectIds: Object.fromEntries(
        RELEASE_ORDER.map((target) => [target, `prj_${target}`]),
      ),
      mode: release.mode,
      mainOwnershipMode: release.mainOwnershipMode,
      selectedManifest: release,
    }),
  });
  const snapshot = planningSnapshot(release);
  const mappings = createMainCanonicalMappings({
    planningSnapshot: snapshot,
    projectIds: {
      app: execution.projection.projectIds.app,
      governance: execution.projection.projectIds.governance,
      reserve: execution.projection.projectIds.reserve,
      ui: execution.projection.projectIds.ui,
    },
    legacySnapshot: [legacyState],
  });
  const output = join(directory, "forward-journal.json");
  const value = await runMainReleaseCli({
    argv: [
      "forward-journal",
      "--execution",
      write(directory, "execution.json", execution),
      "--current-mappings",
      write(directory, "mappings.json", mappings),
      "--candidate-receipts",
      write(directory, "receipts.json", {
        app: null,
        governance: null,
        reserve: null,
        ui: null,
      }),
      "--output",
      output,
    ],
    env: environment(directory),
  });
  assert.equal(value.runId, "800");
  assert.equal(value.runAttempt, "3");
  assert.deepEqual(value.candidates, {
    app: null,
    governance: null,
    reserve: null,
    ui: null,
  });
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), value);
  const outputs = readFileSync(join(directory, "github-output"), "utf8");
  assert.match(outputs, /^transaction_id=main-[a-f0-9]{32}$/m);
  await assert.rejects(
    runMainReleaseCli({
      argv: [
        "forward-journal",
        "--execution",
        write(directory, "execution-forged.json", execution),
        "--current-mappings",
        write(directory, "mappings-forged.json", mappings),
        "--candidate-receipts",
        write(directory, "receipts-forged.json", {
          app: { forged: true },
          governance: null,
          reserve: null,
          ui: null,
        }),
        "--output",
        join(directory, "forged-journal.json"),
      ],
      env: environment(directory),
    }),
    /unselected app|Candidate receipt/,
  );
});

test("inherited recovery journal binds a partial prefix to current-attempt receipts and exact outputs", async (t) => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "main-release-inherited-journal-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = manifest(["governance", "reserve"], "122");
  const sameReleasePreplan = preplan(release);
  const currentMappings = Object.fromEntries(
    sameReleasePreplan.reconciliation.observedTargets.map(
      ({ target, startMappings }) => [
        target,
        startMappings.map(({ state: _state, ...mapping }) => {
          void _state;
          return mapping;
        }),
      ],
    ),
  );
  const inheritedPreplan = decideMainPreplanReconciliation({
    nextDeploySha: SHA,
    nextUpstreamRunId: "123",
    candidateReleases: [candidateRelease(release)],
    currentMappings,
    rollbackOnlyTargets: [],
  });
  assert.equal(inheritedPreplan.decision, "restore-before-planning");
  assert.deepEqual(inheritedPreplan.rollbackAuthorization.targets, [
    "governance",
  ]);

  const legacyState = legacy()[0];
  const mappings = createMainCanonicalMappings({
    planningSnapshot: planningSnapshot(release),
    projectIds: {
      app: "prj_app",
      governance: "prj_governance",
      reserve: "prj_reserve",
      ui: "prj_ui",
    },
    legacySnapshot: [legacyState],
  });
  const candidateReceipts = {
    app: null,
    governance: currentAttemptReceipt(release, "governance"),
    reserve: currentAttemptReceipt(release, "reserve"),
    ui: null,
  };
  const journalOutput = join(directory, "inherited-journal.json");
  const planOutput = join(directory, "inherited-plan.json");
  const result = await runMainReleaseCli({
    argv: [
      "inherited-recovery-journal",
      "--preplan",
      write(directory, "inherited-preplan.json", inheritedPreplan),
      "--legacy-snapshot",
      write(directory, "inherited-legacy.json", [legacyState]),
      "--current-mappings",
      write(directory, "inherited-mappings.json", mappings),
      "--candidate-receipts",
      write(directory, "inherited-receipts.json", candidateReceipts),
      "--journal-output",
      journalOutput,
      "--plan-output",
      planOutput,
    ],
    env: environment(directory),
  });

  assert.deepEqual(Object.keys(result), ["journal", "recoveryPlan"]);
  assert.equal(result.journal.runId, "800");
  assert.equal(result.journal.runAttempt, "3");
  assert.equal(result.journal.release.releaseId, release.releaseId);
  assert.equal(
    result.journal.candidates.governance.deploymentId,
    "dpl_governanceCandidate123",
  );
  assert.equal(
    result.journal.candidates.reserve.deploymentId,
    "dpl_reserveCandidate123",
  );
  assert.deepEqual(result.recoveryPlan.rollbackAuthority, {
    targets: ["governance"],
    aliases: ["governance.mento.org"],
  });
  assert.deepEqual(result.recoveryPlan.actions, [
    {
      kind: "ordinary_rollback",
      target: "governance",
      aliases: ["governance.mento.org"],
      priorDeploymentId: "dpl_governancePrior123",
      priorDeploymentUrl: "https://governance-prior.vercel.app",
      candidateDeploymentId: "dpl_governanceCandidate123",
      candidateDeploymentUrl: "https://governance-candidate.vercel.app",
    },
  ]);
  assert.deepEqual(
    JSON.parse(readFileSync(journalOutput, "utf8")),
    result.journal,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(planOutput, "utf8")),
    result.recoveryPlan,
  );
  assert.equal(
    readFileSync(join(directory, "github-output"), "utf8"),
    [
      `transaction_id=${result.journal.transactionId}`,
      `journal_artifact_name=${mainTransactionJournalArtifactName(result.journal)}`,
      "journal_sequence=0",
      "recovery_decision=restore-inherited",
      "",
    ].join("\n"),
  );
});
