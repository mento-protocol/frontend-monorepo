import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function yaml(relativePath) {
  return parse(read(relativePath), { uniqueKeys: true });
}

function authorityJson(source) {
  const strictJson = JSON.parse(source);
  const duplicateFree = parse(source, { uniqueKeys: true });
  assert.deepEqual(duplicateFree, strictJson);
  return strictJson;
}

function nestedStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(nestedStrings);
  }
  return [];
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function dependabotPatternMatches(pattern, dependency) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`).test(dependency);
}

function dependabotGroupMatches(
  group,
  dependency,
  dependencyType,
  updateType,
  appliesTo = "version-updates",
) {
  if ((group["applies-to"] ?? "version-updates") !== appliesTo) {
    return false;
  }
  if (group["dependency-type"] && group["dependency-type"] !== dependencyType) {
    return false;
  }
  if (group["update-types"] && !group["update-types"].includes(updateType)) {
    return false;
  }
  const patterns = group.patterns ?? ["*"];
  const exclusions = group["exclude-patterns"] ?? [];
  return (
    patterns.some((pattern) => dependabotPatternMatches(pattern, dependency)) &&
    !exclusions.some((pattern) => dependabotPatternMatches(pattern, dependency))
  );
}

function matchingDependabotGroups(
  groups,
  dependency,
  dependencyType,
  updateType,
  appliesTo = "version-updates",
) {
  return Object.entries(groups)
    .filter(([, group]) =>
      dependabotGroupMatches(
        group,
        dependency,
        dependencyType,
        updateType,
        appliesTo,
      ),
    )
    .map(([name]) => name);
}

function firstDependabotGroup(groups, dependency, dependencyType, updateType) {
  return Object.entries(groups).find(([, group]) =>
    dependabotGroupMatches(group, dependency, dependencyType, updateType),
  )?.[0];
}

const CLAUDE_ACTION =
  "anthropics/claude-code-action@e5ad3c7725bc2459721893f88879fef9dbcf97b0";
const CLAUDE_PLUGIN_MARKETPLACE = "./.claude-code-plugin-marketplace";
const CLAUDE_CODE_REVIEW_PLUGIN = `${CLAUDE_PLUGIN_MARKETPLACE}/plugins/code-review`;
const CLAUDE_PLUGIN_MARKETPLACE_REF =
  "2bb60696142b493eafaeacfe00eac51d16c50c4f";
const DEPENDABOT_POLICY_TOP_LEVEL_KEYS = [
  "admission",
  "baseRef",
  "branchMaintenance",
  "credentialBoundary",
  "evidence",
  "feedback",
  "githubActions",
  "history",
  "identities",
  "lineageReceipts",
  "manualResearch",
  "nativeCommit",
  "operationalExit",
  "preparationModes",
  "protectedPaths",
  "repository",
  "schema",
  "trustedMaintainer",
  "vetoLabels",
  "writeAuthorization",
];
function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected)
  );
}

function osvReusableRevision(value) {
  return /^google\/osv-scanner-action\/\.github\/workflows\/osv-scanner-reusable\.yml@([0-9a-f]{40})$/u.exec(
    String(value ?? ""),
  )?.[1];
}

function workspacePackagePaths() {
  const paths = ["package.json"];
  for (const directory of ["apps", "packages"]) {
    const root = fileURLToPath(new URL(`../${directory}/`, import.meta.url));
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${directory}/${entry.name}/package.json`;
      if (existsSync(new URL(`../${relativePath}`, import.meta.url))) {
        paths.push(relativePath);
      }
    }
  }
  return paths;
}

test("agent preparation policy pins the repository authority contract", () => {
  assert.throws(() => authorityJson('{"schema":"first","schema":"second"}'));
  assert.throws(() =>
    authorityJson(
      '{"schema":"dependabot-prep-policy:v2","identities":{"pullRequestAuthor":{},"pullRequestAuthor":{}}}',
    ),
  );
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  assert.equal(hasExactKeys(policy, DEPENDABOT_POLICY_TOP_LEVEL_KEYS), true);
  assert.equal(
    hasExactKeys(
      { ...policy, unknownAuthority: { merge: true } },
      DEPENDABOT_POLICY_TOP_LEVEL_KEYS,
    ),
    false,
  );
  assert.equal(policy.schema, "dependabot-prep-policy:v2");
  assert.equal(policy.repository, "mento-protocol/frontend-monorepo");
  assert.equal(policy.baseRef, "main");
  assert.deepEqual(policy.identities, {
    pullRequestAuthor: {
      id: 49699333,
      login: "dependabot[bot]",
      type: "Bot",
    },
    forcePushActor: { id: 49699333, login: "dependabot", type: "Bot" },
    nativeCommitAuthor: {
      id: 49699333,
      login: "dependabot[bot]",
      type: "Bot",
    },
    nativeCommitters: [
      { id: 49699333, login: "dependabot[bot]", type: "Bot" },
      { id: 19864447, login: "web-flow", type: "User" },
    ],
  });
  assert.deepEqual(policy.nativeCommit, {
    parentCount: 1,
    verified: true,
    verificationReason: "valid",
  });
  assert.deepEqual(policy.credentialBoundary, {
    modelGhConfig: "/var/lib/dependabot/gh",
    modelCredential: "absent",
    mutatorGhConfig: "/var/lib/dependabot-mutator/gh",
    mutatorCredentialOwner: "dedicated-nologin-identity",
    broker: "/opt/dependabot-prep/mutation-broker.mjs",
    client: "/opt/dependabot-prep/mutation-client.mjs",
    socket: "/run/dependabot-prep/broker.sock",
    readOperations: [
      "rest-get-fixed-repository",
      "graphql-template-pull-request-force-push-history",
      "graphql-template-pull-request-review-threads",
    ],
    writeOperations: {
      branch: ["exact-cas-push", "exact-cas-base-sync"],
      "branch-maintenance": ["exact-dependabot-recreate"],
      "review-request": ["exact-coderabbit-review-request"],
      comment: ["bounded-top-level-comment"],
      reply: ["bounded-review-comment-reply"],
    },
    directAuthenticatedGh: "forbidden",
  });
  assert.deepEqual(policy.evidence, {
    normalization: {
      requiredFields: [
        "normalizedBy",
        "normalizationStatus",
        "normalizationNote",
      ],
      statusValues: ["verified", "rejected"],
      preparedRequiresVerified: true,
      preparedRequiresCompletePagination: true,
      preparedShaFormat: "40-lowercase-hex-git-oid",
      nonPreparedUnknownShaValue: "unknown",
      nonPreparedUnknownShaFields: ["generationBaseSha", "policySha"],
      currentTargetBaseShaRequired: true,
      rejectedEvidenceResult: "blocked-not-operational-failure",
    },
    shaRoles: {
      generationBaseSha: "native-generation-ancestry-anchor",
      currentTargetBaseSha: "live-base-ref-oid-used-for-preparation",
      policySha: "git-blob-oid-of-policy-at-current-target-base",
    },
    forcePushTimeline: {
      source: "graphql",
      connection: "PullRequest.timelineItems",
      itemType: "HeadRefForcePushedEvent",
      beforeOidField: "beforeCommit.oid",
      afterOidField: "afterCommit.oid",
      requireCompletePagination: true,
      resultEvidenceField: "forcePushHistory",
      resultFields: [
        "source",
        "eventType",
        "paginationComplete",
        "transitions",
      ],
      resultTransitionFields: [
        "eventId",
        "createdAt",
        "beforeSha",
        "afterSha",
        "actorLogin",
        "actorType",
        "actorId",
      ],
      normalizedFields: [
        "eventType",
        "paginationComplete",
        "source",
        "transitions",
      ],
      normalizedTransitionFields: [
        "actorId",
        "actorLogin",
        "actorType",
        "afterSha",
        "beforeSha",
        "createdAt",
        "eventId",
      ],
      missingOid: "blocked",
    },
    repositoryRules: {
      appliedBranchRulesEndpoint:
        "/repos/{owner}/{repo}/rules/branches/{branch}",
      rulesetsEndpoint: "/repos/{owner}/{repo}/rulesets",
      rulesetEndpoint: "/repos/{owner}/{repo}/rulesets/{rulesetId}",
      requireCompletePagination: true,
      requireFullRulesetReadback: true,
      resultEvidenceField: "repositoryRules",
      resultFields: [
        "source",
        "branchRulesEndpoint",
        "rulesetsEndpoint",
        "paginationComplete",
        "summary",
      ],
      normalizedFields: [
        "branchRulesEndpoint",
        "branchRules",
        "complete",
        "evidenceSha256",
        "paginationComplete",
        "rulesets",
        "rulesetsEndpoint",
        "source",
        "targetRefName",
      ],
      legacyBranchProtection: "not-authoritative",
      unreadable: "blocked",
    },
    mutationLineage: {
      resultEvidenceField: "mutationLineage",
      requiredFields: [
        "complete",
        "finalHeadSha",
        "nativeLineageSha256",
        "originHeadSha",
        "source",
        "transitions",
      ],
      sourceFields: ["kind", "modelWritable", "mutationAuthority"],
      requiredSource: {
        kind: "root-owned-mutation-receipts",
        modelWritable: false,
        mutationAuthority: false,
      },
      transitionFields: [
        "kind",
        "newHeadSha",
        "oldHeadSha",
        "receiptFile",
        "receiptSha256",
      ],
      transitionKinds: ["exact-cas-push", "exact-cas-base-sync"],
      preparedRequiresComplete: true,
      preparedFinalHeadMustMatch: true,
    },
    generationTransition: {
      resultEvidenceField: "generationTransition",
      ordinaryValue: null,
      rejectedValue: null,
      recreateFields: [
        "boundaryAfterSha",
        "boundaryBeforeSha",
        "boundaryCreatedAt",
        "boundaryEventId",
        "commentCreatedAt",
        "commentId",
        "commentUpdatedAt",
        "kind",
        "oldHeadSha",
        "oldNativeOriginHeadSha",
        "operator",
        "receiptFile",
        "receiptSha256",
        "requestSha256",
        "requestedTargetBaseSha",
        "source",
      ],
      requiredKind: "controller-recreate",
      requiredSource: {
        kind: "root-owned-recreate-receipt",
        modelWritable: false,
        mutationAuthority: false,
      },
      receiptAuthority: "/var/lib/dependabot/lineage/recreates",
      commentMustBeUnedited: true,
      boundary:
        "first-normalized-force-push-after-comment-from-exact-old-head",
      requiresNoHistoricalReplay: true,
      requiredBaseBindings: [
        "generationBaseSha",
        "currentTargetBaseSha",
        "requestedTargetBaseSha",
      ],
    },
  });
  assert.deepEqual(policy.trustedMaintainer, {
    associations: ["COLLABORATOR", "MEMBER", "OWNER"],
    branchMaintenancePermissions: ["admin", "write"],
  });
  assert.deepEqual(policy.vetoLabels, [
    "dependencies:manual",
    "dependabot:manual",
    "do-not-merge",
    "no-auto-merge",
    "processor:veto",
  ]);
  assert.deepEqual(policy.branchMaintenance, {
    commands: ["@dependabot rebase", "@dependabot recreate"],
    requirePositiveCommentId: true,
    requireUneditedComment: true,
    requireValidUtcTimestamps: true,
    rebaseResetsForcePushHistory: false,
    recreateStartsGenerationAfterComment: true,
    controllerRecreate: {
      operation: "recreate",
      grant: "recreate",
      body: "@dependabot recreate",
      eligibleEcosystem: "npm",
      processingMode: "full",
      requiresAuthenticatedNativeGeneration: true,
      oncePerExactNativeGeneration: true,
      postComment: "wait-for-and-reauthenticate-new-native-generation",
      refMutationAuthority: "dependabot-only",
    },
  });
  assert.deepEqual(policy.feedback, {
    requireCompletePagination: true,
    reviewRequest: {
      acceptedStates: ["APPROVED", "COMMENTED"],
      body: "@coderabbitai review",
      reviewer: {
        id: 136622811,
        login: "coderabbitai[bot]",
        type: "Bot",
      },
      requiresAuthenticatedOperator: true,
      requiresAppendOnlyInvocationRecords: true,
      requiresExactHeadBindingAtCreation: true,
      requiresStableCommentId: true,
      historicalAuthenticatedHeadsRemainAdmitted: true,
    },
    topLevelResponse: {
      markerSchema: "dependabot-prep-comment:v1",
      requiresAppendOnlyInvocationRecord: true,
      requiresAuthenticatedOperator: true,
      requiresExactHeadBindingAtCreation: true,
      requiresRootBodyDigest: true,
      requiresRootIdDigest: true,
      requiresStableCommentId: true,
      requiresVisibleBodyDigest: true,
    },
    dependabotOperationalComments: {
      actor: {
        id: 49699333,
        login: "dependabot[bot]",
        type: "Bot",
      },
      associations: ["CONTRIBUTOR", "NONE"],
      bodyRule: "any-bounded-body",
      maximumBodyLength: 50_000,
    },
    informationalBotIssueComments: {
      maximumBodyLength: 50_000,
      rules: [
        {
          actor: {
            id: 41898282,
            login: "github-actions[bot]",
            type: "Bot",
          },
          app: { id: 15368, slug: "github-actions" },
          associations: ["NONE"],
          predicates: [
            {
              kind: "startsWith",
              value: "<!-- vercel-preview-journal:v2 -->",
            },
            {
              kind: "includes",
              value: "**No reviewer action is required.**",
            },
          ],
        },
        {
          actor: {
            id: 62215774,
            login: "argos-ci[bot]",
            type: "Bot",
          },
          app: { id: 57576, slug: "argos-ci" },
          associations: ["NONE"],
          predicates: [
            {
              kind: "startsWith",
              value:
                "**The latest updates on your projects.** Learn more about [Argos notifications ↗︎](https://argos-ci.com/docs/learn/review-workflow/pull-request-comments)",
            },
          ],
        },
        {
          actor: { id: 35613825, login: "vercel[bot]", type: "Bot" },
          app: { id: 8329, slug: "vercel" },
          associations: ["NONE"],
          predicates: [{ kind: "startsWith", value: "[vc]: " }],
        },
        {
          actor: {
            id: 199175422,
            login: "chatgpt-codex-connector[bot]",
            type: "Bot",
          },
          app: { id: 1144995, slug: "chatgpt-codex-connector" },
          associations: ["NONE"],
          predicates: [
            {
              kind: "startsWith",
              value: "Codex Review: Didn't find any major issues.",
            },
          ],
        },
      ],
    },
    trustedMaintainerIssueComment:
      "manual-unless-exact-branch-command-or-current-invocation-procedural-comment",
    unknownOrMalformedBotFeedback: "blocked",
  });
  assert.deepEqual(policy.history, {
    closeOrReopenByNonDependabot: "manual",
    existingNonNativeHead:
      "admit-only-complete-validated-broker-receipt-chain",
    forcePushRequiresCompletePagination: true,
    forcePushRequiresContinuousShas: true,
    forcePushRequiresNonCyclicShas: true,
    forcePushRequiresOrderedUtcTimestamps: true,
    forcePushRequiresUniqueEventIds: true,
    unknownForcePush: "blocked",
  });
  assert.deepEqual(policy.admission, {
    ordinaryNpm: {
      ecosystem: "npm",
      allowedProcessingModes: ["full", "sync-only"],
      originalAllowedExactPaths: [
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
      ],
      originalAllowedPathSuffixes: ["/package.json"],
      forbiddenPathPrefixes: [
        "scripts/vercel-cli-runtime/",
        "scripts/vercel-pnpm-runtime/",
        "scripts/vercel-pnpm-bootstrap/",
      ],
      finalForbiddenPathPrefixes: [
        "scripts/vercel-cli-runtime/",
        "scripts/vercel-pnpm-runtime/",
        "scripts/vercel-pnpm-bootstrap/",
      ],
      finalPathRule: "reviewed-nonprotected-compatibility-repair",
      candidateAuthoredRepair: {
        requiresSeparateCleanBaseSync: true,
        commitShape: "one-parent-from-exact-old-head",
        pathStatus: "modified-existing-nonprotected-only",
        allowedPathPrefixes: ["apps/", "packages/"],
        dependencyManifestOrLockfileMutation: "forbidden",
        finalDependencyTuples: "exact-authenticated-native-tuples",
      },
      excludedPackages: [
        "next",
        "vercel",
        "pnpm",
        "@pnpm/linux-x64",
        "@playwright/test",
        "@argos-ci/playwright",
      ],
      excludedPackagePrefixes: [],
      manualRiskPackagePatterns: [
        "wagmi",
        "viem",
        "viem-*",
        "@wagmi/*",
        "@rainbow-me/*",
        "@metamask/*",
        "ethers",
        "ethers-*",
        "@mento-protocol/*",
        "@wormhole-foundation/*",
        "@solana/*",
        "@walletconnect/*",
        "@reown/*",
        "@celo/*",
        "@ledgerhq/*",
        "@trezor/*",
        "@safe-global/*",
        "@noble/*",
        "@scure/*",
        "*wallet*",
        "*web3*",
      ],
      versionTransition: {
        accepted: "strict-forward-stable-semver-with-identical-range-prefix",
        unsupportedOrAmbiguous: "manual",
      },
      unknownDependency: "manual",
    },
    ordinaryNpmInitialState: {
      behindCurrentTargetBase: "admissible-work",
      conflicting: "admissible-work",
      redRequiredChecks: "admissible-work",
    },
    protectedRuntimeManual: {
      packages: [
        "vercel",
        "pnpm",
        "@pnpm/linux-x64",
        "@playwright/test",
        "@argos-ci/playwright",
      ],
      packagePrefixes: [],
      forbiddenPathPrefixes: [
        "scripts/vercel-cli-runtime/",
        "scripts/vercel-pnpm-runtime/",
        "scripts/vercel-pnpm-bootstrap/",
      ],
      next: {
        package: "next",
        manualUpdateTypes: ["semver-minor", "semver-major"],
        outOfContractPatch: true,
      },
    },
    nextPatch: {
      package: "next",
      updateType: "semver-patch-only",
      processingMode: "full",
      originalDelta: "exact-next-dependency-and-lockfile-tuple-only",
      allowedRegions: {
        "pnpm-workspace.yaml": ["catalog.next"],
        "package.json": ["pnpm.overrides.next"],
        "pnpm-lock.yaml": ["exact-next-runtime-closure"],
        "scripts/vercel-cli-runtime/package.json": ["pnpm.overrides.next"],
        "scripts/vercel-cli-runtime/pnpm-lock.yaml": [
          "exact-next-runtime-closure",
        ],
        "scripts/vercel-cli-runtime/contract.json": [
          "lockfileSha256",
          "manifestSha256",
          "overridesSha256",
        ],
      },
      agentRepair: "bounded-data-only-within-exact-tuple",
      derivation: "deterministic-without-candidate-execution",
      candidateExecution: "forbidden",
      packageManagerExecution: "forbidden",
      allOtherContent: "byte-and-mode-identical-to-currentTargetBaseSha",
      unexpectedAmbiguousOrUnproducible: "manual",
      finalGate: "same-as-admission.finalGate",
    },
    nextMinorOrMajor: {
      package: "next",
      updateTypes: ["semver-minor", "semver-major"],
      processingMode: "manual",
    },
    finalGate: {
      containsCurrentTargetBase: true,
      exactHeadRequiredChecks: "passing",
      exactHeadCodeRabbitReview: true,
      feedback: "answered",
      mergeability: "MERGEABLE",
      autoMergeRequest: null,
      requiredCheckProducers: [
        {
          acceptedConclusions: ["success", "neutral", "skipped"],
          app: { id: 15368, slug: "github-actions" },
          context: "Build and Test",
          integrationId: 15368,
          kind: "check-run",
          workflow: {
            event: "pull_request",
            id: 156727246,
            path: ".github/workflows/ci.yml",
          },
        },
        {
          acceptedConclusions: ["success", "neutral", "skipped"],
          app: { id: 15368, slug: "github-actions" },
          context: "Visual Regression (ui.mento.org)",
          integrationId: 15368,
          kind: "check-run",
          workflow: {
            event: "pull_request",
            id: 296885588,
            path: ".github/workflows/visual.yml",
          },
        },
        {
          acceptedConclusions: ["success", "neutral", "skipped"],
          app: { id: 15368, slug: "github-actions" },
          context: "osv-scanner / osv-scan",
          integrationId: 15368,
          kind: "check-run",
          workflow: {
            event: "pull_request",
            id: 297207753,
            path: ".github/workflows/supply-chain.yml",
          },
        },
        {
          acceptedStates: ["success"],
          context: "Vercel Preview",
          creator: {
            id: 41898282,
            login: "github-actions[bot]",
            type: "Bot",
          },
          integrationId: 15368,
          kind: "commit-status",
          workflow: {
            event: "pull_request_target",
            id: 314322382,
            path: ".github/workflows/vercel-preview-intake.yml",
          },
        },
      ],
    },
  });
  assert.deepEqual(policy.preparationModes, {
    full: {
      scope: "ordinary-npm-or-constrained-next-patch",
      allowsBaseSynchronization: true,
      allowsBoundedDataOnlyRepairs: true,
    },
    "sync-only": {
      scope: "policy-admitted-npm-without-agent-authored-repair",
      allowsBaseSynchronization: true,
      allowsBoundedDataOnlyRepairs: false,
    },
    "review-only": {
      scope: "unchanged-current-native-head",
      allowsBaseSynchronization: false,
      allowsBoundedDataOnlyRepairs: false,
    },
    manual: {
      scope: "human-or-other-controller-reserved",
      allowsBaseSynchronization: false,
      allowsBoundedDataOnlyRepairs: false,
    },
  });
  assert.deepEqual(policy.protectedPaths, {
    prefixes: [".github/workflows/", ".github/actions/"],
    originalPullRequestDelta: "must-not-contain-protected-paths",
    protectedTreePrecondition: {
      requiresIndependentVerification: true,
      oldHead: "byte-and-mode-identical-to-currentTargetBaseSha",
      candidate: "byte-and-mode-identical-to-currentTargetBaseSha",
      agentEdit: "forbidden",
      conflictResolution: "forbidden",
      verifyBeforeCommit: true,
      verifyInIndependentQuarantine: true,
      verifyImmediatelyBeforeMutation: true,
      mismatch: "recreate-or-manual-before-ref-mutation",
      workflowsWriteGrant: "forbidden",
    },
    directPullRequestChanges: "no-ref-mutation",
  });
  assert.deepEqual(policy.githubActions, {
    ecosystem: "github-actions",
    refMutation: "forbidden",
    sensitiveOrSelfReviewingProcessingMode: "manual",
    nonRoutineVersionUpdateProcessingMode: "manual",
    securityUpdates: { processingMode: "manual" },
    ambiguousOrMixed: "manual",
    preparedRequiresUnchangedNativeGreenHead: true,
    routineGroup: {
      name: "github-actions-routine",
      headRefPrefix: "dependabot/github_actions/github-actions-routine",
      appliesTo: "version-updates",
      updateTypes: ["semver-minor", "semver-patch"],
      processingMode: "review-only",
      dependencyMatch: "authenticated-same-line-uses-ref-rotations",
      requiredRefFormat: "40-lowercase-hex-git-oid",
      originalAllowedPathPrefixes: [".github/workflows/"],
      sensitiveActionPatterns: [
        "actions/create-github-app-token",
        "actions/dependency-review-action",
        "anthropics/*",
        "dependabot/*",
        "github/codeql-action*",
        "google/osv-scanner-action*",
        "ossf/scorecard-action",
      ],
    },
  });
  assert.deepEqual(policy.manualResearch, {
    requiredForManualVerdict: true,
    dependencyInventoryField: "dependencies",
    dependencyInventory:
      "nonempty-unique-exact-name-fromVersion-toVersion-tuples",
    packageCoverage: "exact-pull-request-dependency-set",
    packageTupleEqualityRequired: true,
    authoritativeSources: [
      "upstream-changelog",
      "upstream-release-notes",
      "upstream-migration-guide",
      "upstream-security-advisory",
      "upstream-project-or-package-fallback",
    ],
    desiredSourceKinds: [
      "changelog",
      "release-notes",
      "migration-guide",
      "security-advisory",
    ],
    fallbackSourceKind: "upstream-project-or-package",
    fallbackAllowedOnlyWhenAllDesiredSourceKindsAbsent: true,
    missingDesiredSourceKindsField: "missingSourceKinds",
    missingDesiredSourceKinds:
      "record-exact-absent-set-and-lower-confidence",
    minimumLiveVerifiedAuthoritativeUrlsPerPackageTuple: 1,
    liveVerification: "required-per-exact-package-tuple",
    requiredFields: [
      "status",
      "overallRecommendation",
      "repositoryImpact",
      "riskLevel",
      "confidenceLevel",
      "confidenceRationale",
      "packages",
      "sourceFailures",
    ],
    statusValues: ["complete", "partial", "unavailable"],
    packageRequiredFields: [
      "name",
      "fromVersion",
      "toVersion",
      "changeSummary",
      "breakingChanges",
      "recommendation",
      "riskLevel",
      "confidenceLevel",
      "confidenceRationale",
      "sourceStatus",
      "sourceNote",
      "missingSourceKinds",
      "sources",
    ],
    sourceRequiredFields: [
      "kind",
      "url",
      "title",
      "versionCoverage",
      "verifiedAt",
    ],
    sourceKinds: [
      "changelog",
      "release-notes",
      "migration-guide",
      "security-advisory",
      "upstream-project-or-package",
    ],
    sourceUrlScheme: "https",
    verifiedOrPartialSourceRequiresHttpsUrl: true,
    acceptedSourceRequiresLiveFetch: true,
    acceptedSourceRequiresAuthoritativeUpstreamOwnership: true,
    sourceStatusValues: ["verified", "partial", "missing", "ambiguous"],
    riskLevels: ["low", "medium", "high", "critical", "unknown"],
    confidenceLevels: ["low", "medium", "high"],
    noLiveVerifiedAuthoritativeSource: "operational-research-incomplete",
    operationalResearchIncompleteStatus: "unavailable",
    operationalResearchIncompleteRequiresLauncherFailure: true,
    incompleteSourceCoverageConfidence: "low-or-medium-only",
    candidateExecution: "forbidden",
  });
  assert.deepEqual(policy.lineageReceipts, {
    schema: "dependabot-prep-mutation-receipt:v1",
    broker: "/opt/dependabot-prep/mutation-broker.mjs",
    client: "/opt/dependabot-prep/mutation-client.mjs",
    socket: "/run/dependabot-prep/broker.sock",
    store: "/var/lib/dependabot/lineage/receipts",
    intentStore: "/var/lib/dependabot/lineage/intents",
    pendingStore: "/var/lib/dependabot/lineage/pending",
    operationLock: "/var/lib/dependabot/lineage/operation.lock",
    intentSchema: "dependabot-prep-mutation-intent:v1",
    intentRequiredFields: [
      "schema",
      "recordedAt",
      "repository",
      "pullRequestNumber",
      "headRefName",
      "mutation",
      "processingMode",
      "runId",
      "runAuthorizationSha256",
      "oldHeadSha",
      "proposedNewHeadSha",
      "requestedTargetBaseSha",
      "policy",
      "operator",
      "nativeAnchor",
    ],
    intentProposedNewHeadSha: {
      "exact-cas-push": "40-lowercase-hex-git-oid",
      "exact-cas-base-sync": "40-lowercase-hex-git-oid",
    },
    intentNativeAnchorFields: [
      "generationBaseSha",
      "nativeOriginHeadSha",
      "nativeLineageSha256",
    ],
    intentArm: "durable-before-network-mutation",
    mutationSerialization: "global-atomic-directory-lock",
    intentFinalization:
      "durable-receipt-reread-then-pending-rename-unlink-and-directory-fsync",
    recovery:
      "block-all-ref-mutation-until-explicit-human-forensic-recovery-no-automatic-delete-or-retry",
    writer: "root-owned-pinned-least-privilege-service",
    write: "atomic-before-control-returns-after-push-readback",
    mutationKinds: ["exact-cas-push", "exact-cas-base-sync"],
    requiredFields: [
      "sequence",
      "previousReceiptSha256",
      "recordedAt",
      "repository",
      "pullRequestNumber",
      "headRefName",
      "mutation",
      "processingMode",
      "runAuthorizationSha256",
      "oldHeadSha",
      "newHeadSha",
      "currentTargetBaseSha",
      "postMutationTargetBaseSha",
      "baseMoved",
      "policy",
      "runId",
      "operator",
      "evidence",
      "components",
    ],
    policyFields: ["commitSha", "blobSha", "sha256"],
    operatorFields: ["id", "login", "type"],
    evidenceFields: [
      "liveHeadSha",
      "commitParents",
      "protectedTreeSha256",
      "generationBaseSha",
      "nativeOriginHeadSha",
      "nativeLineageSha256",
    ],
    componentFields: [
      "pinsSha256",
      "toolchainManifestSha256",
      "skillSha256",
      "brokerSha256",
      "workerSha256",
    ],
    transition: "exact-non-force-parent-to-head",
    crossInvocationCommand: "dependabot-lineage <pr> <ref> <headOid>",
    crossInvocationAdmission: "complete-broker-verified-receipt-chain-only",
    missingInvalidOrAmbiguous: "manual",
  });
  assert.deepEqual(policy.writeAuthorization, {
    orchestrator: "/opt/dependabot-prep/authorized-run",
    implementation: "/opt/dependabot-prep/authorized-run.mjs",
    selftestOrchestrator: "/opt/dependabot-prep/selftest-run",
    selftestAttester: "/opt/dependabot-prep/selftest-attest.mjs",
    selftestAttestation: "/etc/dependabot-prep/selftest-attestation.json",
    writeCommandArgv: ["sudo", "/opt/dependabot-prep/authorized-run"],
    scheduledGrants: [
      "branch",
      "recreate",
      "review-request",
      "comment",
      "reply",
    ],
    scheduledDeniedGrants: [
      "rerun",
      "execute",
      "thread-resolution",
      "approve",
      "dismiss-review",
      "auto-merge",
      "merge",
      "close",
      "enqueue",
    ],
    directLauncherWrite: "refuse",
    directLauncherNonWriteOperations: [
      "run --read-only",
      "status",
    ],
    rootOnlyMaintenanceOperations: ["pin", "selftest-run"],
    dependabotMaintenanceOperations: ["lease-clear"],
    capability: {
      kind: "root-owned-short-lived-nonce",
      lifetime: "single-run",
      requiredBindings: [
        "mode",
        "grants",
        "runId",
        "authorizerPid",
        "authorizerBootId",
        "authorizerStartTimeTicks",
      ],
      authorizerProcess: "live-root-pid-boot-id-and-start-time-required",
      modelWritable: false,
      brokerRequiresCapability: true,
    },
  });
  assert.deepEqual(policy.operationalExit, {
    completeValidatedInventory: 0,
    operationalFailure: 1,
    pinOrSelftestDrift: 2,
    activeLeaseContention: 3,
    perPullRequestManualOrBlockedIsOperationalFailure: false,
    countBuckets: ["verdict", "processingMode"],
    machineFields: [
      "reportExit",
      "operationalStatus",
      "resultStatus",
      "counts",
    ],
  });
});

test("Dependabot PRs keep repository credentials and caches disabled", () => {
  const configurations = [
    {
      expectedSecretCount: 24,
      gate: "needs.changes.outputs.allow_repository_credentials",
      path: ".github/workflows/ci.yml",
      planJob: "changes",
    },
    {
      expectedSecretCount: 6,
      gate: "needs.e2e-plan.outputs.allow_repository_credentials",
      path: ".github/workflows/e2e.yml",
      planJob: "e2e-plan",
    },
    {
      expectedSecretCount: 6,
      gate: "needs.visual-plan.outputs.allow_repository_credentials",
      path: ".github/workflows/visual.yml",
      planJob: "visual-plan",
    },
    {
      expectedSecretCount: 0,
      gate: "env.ALLOW_REPOSITORY_CREDENTIALS",
      path: ".github/workflows/quality-budgets.yml",
      planJob: null,
    },
  ];
  const protectedPaths = configurations.map(({ path }) => path).sort();
  const workflowRoot = fileURLToPath(
    new URL("../.github/workflows/", import.meta.url),
  );
  const directPullRequestWorkflows = readdirSync(workflowRoot)
    .filter((name) => /\.ya?ml$/u.test(name))
    .map((name) => {
      const path = `.github/workflows/${name}`;
      return { parsed: yaml(path), path };
    })
    .filter(({ parsed }) => Object.hasOwn(parsed.on ?? {}, "pull_request"));

  assert.deepEqual(
    directPullRequestWorkflows
      .filter(({ parsed }) =>
        nestedStrings(parsed).some((value) => value.includes("secrets.")),
      )
      .map(({ path }) => path)
      .sort(),
    [
      ".github/workflows/ci.yml",
      ".github/workflows/claude-code-review.yml",
      ".github/workflows/e2e.yml",
      ".github/workflows/visual.yml",
    ],
  );
  const humanReviewJob = yaml(".github/workflows/claude-code-review.yml").jobs[
    "claude-review-human"
  ];
  assert.match(humanReviewJob.if, /pull_request\.user\.type == 'User'/u);
  for (const { parsed, path } of directPullRequestWorkflows) {
    assert.doesNotMatch(
      JSON.stringify(parsed.jobs),
      /"secrets":"inherit"/u,
      `${path} must not inherit an unbounded secret set`,
    );
  }

  const cachePaths = directPullRequestWorkflows
    .filter(({ parsed }) =>
      Object.values(parsed.jobs).some((job) =>
        (job.steps ?? []).some(
          (step) =>
            step.uses === "./.github/actions/pnpm-install" ||
            step.uses?.startsWith("actions/cache@") ||
            step.uses?.startsWith("trunk-io/trunk-action@") ||
            Object.hasOwn(step.with ?? {}, "cache-dependency-path"),
        ),
      ),
    )
    .map(({ path }) => path)
    .sort();
  assert.deepEqual(cachePaths, protectedPaths);

  const directLocalActions = directPullRequestWorkflows
    .flatMap(({ parsed }) => Object.values(parsed.jobs))
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.uses)
    .filter((uses) => uses?.startsWith("./.github/actions/"));
  assert.deepEqual([...new Set(directLocalActions)].sort(), [
    "./.github/actions/pnpm-install",
  ]);

  const installAction = yaml(".github/actions/pnpm-install/action.yml");
  assert.deepEqual(
    installAction.runs.steps
      .map((step) => step.uses)
      .filter((uses) => uses?.startsWith("./")),
    [],
  );
  const cachedNode = installAction.runs.steps.find(
    (step) =>
      step.uses?.startsWith("actions/setup-node@") &&
      step.with?.cache === "pnpm",
  );
  assert.equal(cachedNode.if, "inputs.cache == 'true'");
  assert.equal(
    cachedNode.with["cache-dependency-path"],
    "${{ inputs.working-directory }}/pnpm-lock.yaml",
  );
  const uncachedNode = installAction.runs.steps.find(
    (step) =>
      step.uses?.startsWith("actions/setup-node@") &&
      step.with?.["package-manager-cache"] === false,
  );
  assert.equal(uncachedNode.if, "inputs.cache != 'true'");

  const requiredGrantSignals = [
    "github.event_name != 'pull_request'",
    "github.event.pull_request.user.type == 'User'",
    "github.event.pull_request.user.id != 49699333",
    "github.event.pull_request.user.login != 'dependabot[bot]'",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "github.event.pull_request.head.ref != 'dependabot'",
    "!startsWith(github.event.pull_request.head.ref, 'dependabot/')",
    "github.event.sender.type == 'User'",
  ];

  for (const { expectedSecretCount, gate, path, planJob } of configurations) {
    const parsed = yaml(path);
    const grant = parsed.env.ALLOW_REPOSITORY_CREDENTIALS;
    for (const signal of requiredGrantSignals) {
      assert.ok(grant.includes(signal), `${path} is missing ${signal}`);
    }

    if (planJob !== null) {
      const classifier = parsed.jobs[planJob].steps[0];
      assert.equal(classifier.name, "Classify repository credential access");
      assert.equal(classifier.id, "credentials");
      assert.equal(
        classifier.run,
        [
          "set -euo pipefail",
          'case "$ALLOW_REPOSITORY_CREDENTIALS" in',
          "  true | false) ;;",
          "  *) exit 1 ;;",
          "esac",
          'echo "allow_repository_credentials=$ALLOW_REPOSITORY_CREDENTIALS" >> "$GITHUB_OUTPUT"',
          "",
        ].join("\n"),
        `${path} must validate and propagate the exact fail-closed credential grant`,
      );
      assert.equal(
        parsed.jobs[planJob].outputs.allow_repository_credentials,
        "${{ steps.credentials.outputs.allow_repository_credentials }}",
      );
    }

    const secretValues = nestedStrings(parsed).filter((value) =>
      value.includes("secrets."),
    );
    assert.equal(secretValues.length, expectedSecretCount, path);
    for (const value of secretValues) {
      assert.match(
        value,
        new RegExp(
          `^\\$\\{\\{ ${gate.replaceAll(".", "\\.")} == 'true' && secrets\\.[A-Z0-9_]+ \\|\\| '' \\}\\}$`,
          "u",
        ),
        `${path} secret access must require the positive grant`,
      );
    }

    const steps = Object.values(parsed.jobs).flatMap((job) => job.steps ?? []);
    for (const checkout of steps.filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    )) {
      assert.equal(checkout.with?.["persist-credentials"], false, path);
    }
    for (const install of steps.filter(
      (step) => step.uses === "./.github/actions/pnpm-install",
    )) {
      assert.equal(install.with?.cache, `\${{ ${gate} == 'true' }}`, path);
    }
    for (const cache of steps.filter((step) =>
      step.uses?.startsWith("actions/cache@"),
    )) {
      assert.equal(cache.if, `${gate} == 'true'`, path);
    }
  }

  const trunk = yaml(".github/workflows/ci.yml").jobs.static.steps.find(
    (step) => step.uses?.startsWith("trunk-io/trunk-action@"),
  );
  assert.deepEqual(yaml(".github/workflows/ci.yml").jobs.static.permissions, {
    contents: "read",
  });
  assert.equal(
    trunk.with?.cache,
    "${{ needs.changes.outputs.allow_repository_credentials == 'true' }}",
  );
  assert.equal(trunk.with?.["save-annotations"], true);
});

test("the shared fork clock selects every connected E2E lane", () => {
  const e2e = yaml(".github/workflows/e2e.yml");
  const impact = e2e.jobs["e2e-plan"].steps.find(
    (step) => step.name === "Detect E2E impact",
  );
  assert.ok(impact);
  assert.match(
    impact.run,
    /scripts\/fork-test-clock\.mjs \| scripts\/fork-test-clock\.test\.mjs\)\n\s+run_app=true\n\s+run_gov=true\n\s+run_monad=true/u,
  );
});

test("human Claude review keeps its same-repository marketplace boundary", () => {
  const humanReview = yaml(".github/workflows/claude-code-review.yml");
  const job = humanReview.jobs["claude-review-human"];
  assert.ok(job);
  assert.equal(job.name, "claude-review-human");
  assert.match(job.if, /head\.repo\.full_name == github\.repository/u);
  assert.match(job.if, /pull_request\.user\.type == 'User'/u);
  assert.equal(humanReview.jobs["claude-review"], undefined);

  const guardIndex = job.steps.findIndex(
    (step) => step.name === "Reject candidate marketplace path collision",
  );
  const marketplaceCheckoutIndex = job.steps.findIndex(
    (step) => step.name === "Checkout pinned Claude plugin marketplace",
  );
  assert.ok(guardIndex >= 0);
  assert.equal(marketplaceCheckoutIndex, guardIndex + 1);
  const marketplaceGuard = job.steps[guardIndex];
  assert.match(marketplaceGuard.run, /GITHUB_WORKSPACE/u);
  assert.match(marketplaceGuard.run, /-e "\$marketplace_path"/u);
  assert.match(marketplaceGuard.run, /-L "\$marketplace_path"/u);

  const marketplaceCheckout = job.steps[marketplaceCheckoutIndex];
  assert.equal(
    marketplaceCheckout.uses,
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  );
  assert.equal(marketplaceCheckout.with.repository, "anthropics/claude-code");
  assert.equal(marketplaceCheckout.with.ref, CLAUDE_PLUGIN_MARKETPLACE_REF);
  assert.equal(
    marketplaceCheckout.with.path,
    CLAUDE_PLUGIN_MARKETPLACE.slice(2),
  );
  assert.equal(marketplaceCheckout.with["persist-credentials"], false);
  assert.deepEqual(
    marketplaceCheckout.with["sparse-checkout"].trim().split("\n"),
    [".claude-plugin", "plugins/code-review"],
  );

  const marketplaceVerification = job.steps[marketplaceCheckoutIndex + 1];
  assert.equal(
    marketplaceVerification.name,
    "Verify pinned Claude plugin marketplace",
  );
  assert.equal(
    marketplaceVerification.env.EXPECTED_MARKETPLACE_SHA,
    CLAUDE_PLUGIN_MARKETPLACE_REF,
  );
  assert.match(marketplaceVerification.run, /! -L "\$marketplace_path"/u);
  assert.match(
    marketplaceVerification.run,
    /git -C "\$marketplace_path" rev-parse HEAD/u,
  );

  const review = job.steps.find((step) => step.uses === CLAUDE_ACTION);
  assert.ok(review);
  assert.equal(
    review.with.claude_args,
    `--plugin-dir ${CLAUDE_CODE_REVIEW_PLUGIN}`,
  );
  assert.equal(Object.hasOwn(review.with, "plugin_marketplaces"), false);
  assert.equal(Object.hasOwn(review.with, "plugins"), false);
  assert.equal(Object.hasOwn(review.with, "allowed_bots"), false);
});

test("human Claude review rejects a candidate marketplace symlink", () => {
  const humanReview = yaml(".github/workflows/claude-code-review.yml");
  const guard = humanReview.jobs["claude-review-human"].steps.find(
    (step) => step.name === "Reject candidate marketplace path collision",
  );
  assert.ok(guard);

  const workspace = mkdtempSync(join(tmpdir(), "claude-review-workspace-"));
  try {
    const redirect = join(workspace, "redirect");
    mkdirSync(redirect);
    symlinkSync(
      redirect,
      join(workspace, CLAUDE_PLUGIN_MARKETPLACE.slice(2)),
      "dir",
    );
    const result = spawnSync("/bin/bash", ["-c", guard.run], {
      encoding: "utf8",
      env: { GITHUB_WORKSPACE: workspace, PATH: "/usr/bin:/bin" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Candidate content occupies/u);
    assert.deepEqual(readdirSync(redirect), []);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("pull requests diff OSV findings read-only and trusted runs own full SARIF scans", () => {
  const supplyChain = yaml(".github/workflows/supply-chain.yml");
  const readOnlyOsv = yaml(".github/workflows/_osv-scanner-readonly.yml");
  const osvJobIds = [
    "osv",
    "osv-pnpm-runtime",
    "osv-vercel-cli-runtime",
    "osv-pnpm-bootstrap",
  ];
  const sarifJobIds = osvJobIds.map((jobId) => `${jobId}-sarif`);
  const sarifRevisions = [];

  assert.deepEqual(Object.keys(supplyChain.on).sort(), [
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
  ]);
  assert.deepEqual(supplyChain.on.push, { branches: ["main"] });
  assert.deepEqual(supplyChain.on.schedule, [{ cron: "17 6 * * *" }]);
  assert.deepEqual(
    Object.keys(supplyChain.jobs).sort(),
    [...osvJobIds, ...sarifJobIds, "lockfile-lint", "version-skew"].sort(),
  );

  for (const jobId of osvJobIds) {
    const readOnlyJob = supplyChain.jobs[jobId];
    // One job per target, so no `needs` edge can skip the required check. A
    // skipped required check sits pending forever and blocks every merge.
    assert.equal(readOnlyJob.if, "github.event_name == 'pull_request'");
    assert.equal(readOnlyJob.needs, undefined);
    // With the artifact hop gone the scan reads no Actions API, so it no longer
    // asks for `actions: read`.
    assert.deepEqual(readOnlyJob.permissions, { contents: "read" });
    assert.equal(Object.hasOwn(readOnlyJob.with, "upload-sarif"), false);
    assert.equal(
      readOnlyJob.uses,
      "./.github/workflows/_osv-scanner-readonly.yml",
    );
    // The two sides must scan the same config and lockfile relative paths, each
    // rooted at its own checkout directory. Anything else and the two result
    // sets are not comparable and the diff is meaningless.
    const baseArgs = readOnlyJob.with["base-scan-args"];
    const headArgs = readOnlyJob.with["head-scan-args"];
    assert.equal(typeof baseArgs, "string");
    assert.equal(typeof headArgs, "string");
    assert.notEqual(baseArgs, headArgs);
    assert.equal(headArgs.replaceAll("candidate/", "base/"), baseArgs);

    const sarifJob = supplyChain.jobs[`${jobId}-sarif`];
    assert.equal(
      sarifJob.if,
      "github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'",
    );
    assert.deepEqual(sarifJob.permissions, {
      actions: "read",
      contents: "read",
      "security-events": "write",
    });
    const sarifRevision = osvReusableRevision(sarifJob.uses);
    assert.ok(sarifRevision);
    sarifRevisions.push(sarifRevision);
    assert.equal(sarifJob.with["upload-sarif"], true);
  }

  for (const jobId of ["lockfile-lint", "version-skew"]) {
    const baselineJob = supplyChain.jobs[jobId];
    assert.equal(
      baselineJob.if,
      undefined,
      `${jobId} must run on main pushes as deterministic recovery evidence`,
    );
    const checkout = baselineJob.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with?.["persist-credentials"], false);
  }

  assert.deepEqual(Object.keys(readOnlyOsv.on), ["workflow_call"]);
  assert.deepEqual(Object.keys(readOnlyOsv.on.workflow_call.inputs).sort(), [
    "base-scan-args",
    "head-scan-args",
  ]);
  for (const input of ["base-scan-args", "head-scan-args"]) {
    assert.equal(readOnlyOsv.on.workflow_call.inputs[input].required, true);
  }
  assert.deepEqual(readOnlyOsv.permissions, { contents: "read" });
  const readOnlyJob = readOnlyOsv.jobs["osv-scan"];
  assert.deepEqual(readOnlyJob.permissions, { contents: "read" });
  // A reusable-workflow check reports as `<caller job name> / <called job
  // name>`, so this name is half of the exact required `osv-scanner / osv-scan`.
  assert.equal(readOnlyJob.name, "osv-scan");
  assert.equal(readOnlyJob["timeout-minutes"], 10);
  const readOnlySteps = readOnlyJob.steps;
  const checkouts = readOnlySteps.filter((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  // Two directories, never one path checked out twice: head content must never
  // be able to land on top of the tree the base scan reads. The base tree is
  // then deleted before the head arrives, so the two never coexist.
  assert.equal(checkouts.length, 2);
  const [baseCheckout, checkout] = checkouts;
  assert.equal(baseCheckout.with.path, "base");
  assert.equal(checkout.with.path, "candidate");
  // Both sides come from one event snapshot. A branch name resolves to whatever
  // main points at when this job starts, while the head scan always scans the
  // event's fixed merge commit; if main moved in between, a dependency the new
  // tip fixed would be reported as newly introduced.
  assert.equal(
    baseCheckout.with.ref,
    "${{ github.event.pull_request.base.sha }}",
  );
  assert.notEqual(baseCheckout.with.ref, "${{ github.base_ref }}");
  assert.equal(checkout.with.ref, undefined);
  for (const step of checkouts) {
    assert.equal(step.with["persist-credentials"], false);
  }

  // Two scanner steps, base and head, plus exactly one reporter: the shape
  // upstream's PR mode ships. AGENTS.md's OSV rule is about keeping the scanner
  // and reporter actions at the same pinned revision, asserted below.
  const scannerSteps = readOnlySteps.filter((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-scanner-action@"),
  );
  assert.equal(scannerSteps.length, 2);
  const [baseScanner, scanner] = scannerSteps;
  const scannerRevision =
    /^google\/osv-scanner-action\/osv-scanner-action@([0-9a-f]{40})$/u.exec(
      scanner.uses,
    )?.[1];
  assert.ok(scannerRevision);
  assert.equal(baseScanner.uses, scanner.uses);
  assert.equal(baseScanner.id, "base-scan");
  assert.equal(scanner.id, "scan");
  for (const step of scannerSteps) {
    assert.equal(step["continue-on-error"], true);
    assert.match(step.with["scan-args"], /--format=json/u);
  }
  // Each side takes its own arguments, which is what carries its own config.
  // Scanning both sides with the head config would let a pull request that
  // removes a suppression pass, because the advisory would be suppressed in the
  // baseline too.
  assert.match(
    baseScanner.with["scan-args"],
    /\$\{\{ inputs\.base-scan-args \}\}/u,
  );
  assert.match(
    scanner.with["scan-args"],
    /\$\{\{ inputs\.head-scan-args \}\}/u,
  );
  assert.doesNotMatch(baseScanner.with["scan-args"], /inputs\.head-scan-args/u);
  assert.doesNotMatch(scanner.with["scan-args"], /inputs\.base-scan-args/u);

  // A base scan that failed, or a base commit without this lockfile, falls back
  // to an empty baseline, so every finding here counts as new. That can only
  // over-report, never under-report, and it keeps this job reporting.
  const baselineGuards = readOnlySteps.filter(
    (step) => step.name === "Establish the base vulnerability baseline",
  );
  assert.equal(baselineGuards.length, 1);
  const [baselineGuard] = baselineGuards;
  assert.equal(baselineGuard.shell, "bash");
  assert.deepEqual(baselineGuard.env, {
    BASE_RESULTS: "${{ github.workspace }}/osv-state/old-results.json",
  });
  assert.match(baselineGuard.run, /Array\.isArray\(parsed\.results\)/u);
  assert.match(baselineGuard.run, /\{"results":\[\]\}/u);

  // First half of the anti-aliasing pair. Once the baseline is captured the
  // base tree is deleted, so a candidate symlink has no second tree to name.
  // Without it a pull request could commit `pnpm-lock.yaml -> ../base/…`, have
  // the head scan reproduce the baseline, and pass the required check while the
  // proposed lockfile carried vulnerable dependencies.
  const baseRemovals = readOnlySteps.filter(
    (step) => step.name === "Remove the base tree before the head checkout",
  );
  assert.equal(baseRemovals.length, 1);
  const [baseRemoval] = baseRemovals;
  assert.equal(baseRemoval.if, undefined);
  assert.equal(baseRemoval.shell, "bash");
  assert.match(baseRemoval.run, /rm -rf "\$\{GITHUB_WORKSPACE\}\/base"/u);
  assert.match(baseRemoval.run, /exit 1/u);

  // Second half: every head scan input must resolve to a real file inside the
  // head checkout. The config toml is validated alongside the lockfile — it is
  // a scan input too, and the one that decides which advisories are suppressed.
  const pathGuards = readOnlySteps.filter(
    (step) =>
      step.name === "Reject head scan inputs that leave the candidate checkout",
  );
  assert.equal(pathGuards.length, 1);
  const [pathGuard] = pathGuards;
  assert.equal(pathGuard.if, undefined);
  assert.equal(pathGuard.shell, "bash");
  assert.deepEqual(pathGuard.env, {
    HEAD_SCAN_ARGS: "${{ inputs.head-scan-args }}",
  });
  assert.match(pathGuard.run, /--lockfile=\* \| --config=\*/u);
  assert.ok(
    readOnlySteps.indexOf(baseRemoval) < readOnlySteps.indexOf(checkout),
    "the base tree must be gone before the head is checked out",
  );
  assert.ok(
    readOnlySteps.indexOf(checkout) < readOnlySteps.indexOf(pathGuard) &&
      readOnlySteps.indexOf(pathGuard) < readOnlySteps.indexOf(scanner),
    "head scan inputs must be validated after the head checkout and before the head scan",
  );

  const completionGuards = readOnlySteps.filter(
    (step) => step.name === "Check that the scan completed",
  );
  assert.equal(completionGuards.length, 1);
  const [completionGuard] = completionGuards;
  // Content, not size. A pull request can add a tracked non-empty file, which
  // is not evidence that a scan ran. The guard is also unconditional, so a
  // scanner that exits 0 without writing a usable result still fails the job.
  assert.equal(completionGuard.if, undefined);
  assert.equal(completionGuard.shell, "bash");
  assert.deepEqual(completionGuard.env, {
    RESULTS: "${{ github.workspace }}/osv-state/results.json",
  });
  assert.match(completionGuard.run, /Array\.isArray\(parsed\.results\)/u);
  assert.match(completionGuard.run, /exit 1/u);

  const reporterSteps = readOnlySteps.filter((step) =>
    step.uses?.startsWith("google/osv-scanner-action/osv-reporter-action@"),
  );
  assert.equal(reporterSteps.length, 1);
  const [reporter] = reporterSteps;
  const reporterRevision =
    /^google\/osv-scanner-action\/osv-reporter-action@([0-9a-f]{40})$/u.exec(
      reporter.uses,
    )?.[1];
  assert.ok(reporterRevision);
  assert.equal(reporterRevision, scannerRevision);
  assert.deepEqual([...new Set(sarifRevisions)], [scannerRevision]);
  assert.equal(
    osvReusableRevision(
      `google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yaml@${scannerRevision}`,
    ),
    undefined,
  );
  assert.notEqual(
    osvReusableRevision(
      `google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@${"f".repeat(40)}`,
    ),
    scannerRevision,
  );

  // The directory is cleared before every write, so even if a future change
  // moved scan state back inside the candidate tree, a tracked file could not
  // survive to stand in for a result.
  const scratchSteps = readOnlySteps.filter(
    (step) =>
      step.name === "Create the scan state directory beside the checkouts",
  );
  assert.equal(scratchSteps.length, 1);
  const [scratch] = scratchSteps;
  assert.match(scratch.run, /rm -rf "\$\{GITHUB_WORKSPACE\}\/osv-state"/u);
  assert.match(scratch.run, /mkdir -p "\$\{GITHUB_WORKSPACE\}\/osv-state"/u);

  const order = [
    baseCheckout,
    scratch,
    baseScanner,
    baselineGuard,
    baseRemoval,
    checkout,
    pathGuard,
    scanner,
    completionGuard,
    reporter,
  ].map((step) => readOnlySteps.indexOf(step));
  assert.deepEqual(
    order,
    [...order].sort((left, right) => left - right),
    "the base checkout, scratch directory, base scan, baseline, base removal, head checkout, input validation, head scan, guard, and reporter must run in that order",
  );
  assert.ok(order.every((index) => index >= 0));
  assert.match(reporter.with["scan-args"], /--gh-annotations=false/u);
  assert.match(reporter.with["scan-args"], /--fail-on-vuln=true/u);
  // No SARIF write path, and no artifact hop in either direction: the whole
  // diff is computed and consumed inside this one job.
  assert.doesNotMatch(
    JSON.stringify(readOnlyOsv),
    /security-events|upload-sarif|github\/codeql-action|actions\/(?:upload|download)-artifact/u,
  );

  // No scan input or output may sit inside either checkout. The head checkout
  // is candidate-controlled, so a tracked file at a workspace-relative path
  // could stand in for a real scan result: as a forged empty baseline that
  // hides an introduced vulnerability, or as a forged result that satisfies the
  // completion guard after a scan failed. The job checks the base out into
  // `base/`, the head into `candidate/`, and keeps scan state beside both in
  // `osv-state/`, which a pull request cannot write to because it can only add
  // files inside its own tree. GITHUB_WORKSPACE is the one bind mount GitHub
  // documents for container actions, where it appears at /github/workspace.
  const scanPathFlag = /--(?:output|old|new)=(\S+)/gu;
  const assertOutsideCheckout = (step) => {
    const values = [...step.with["scan-args"].matchAll(scanPathFlag)].map(
      ([, value]) => value,
    );
    assert.ok(values.length > 0);
    for (const value of values) {
      assert.ok(
        value.startsWith("/github/workspace/osv-state/"),
        `${step.uses} reads or writes ${value} inside the checkout`,
      );
    }
  };
  assertOutsideCheckout(baseScanner);
  assertOutsideCheckout(scanner);
  assertOutsideCheckout(reporter);

  // The container path the actions write to and the host path the shell guards
  // read must stay the same file. Container actions see GITHUB_WORKSPACE
  // mounted at /github/workspace, so the two spellings differ only by prefix.
  // If they ever drift, the guards would check a file nothing wrote and the
  // scan would report a clean diff it never computed.
  const CONTAINER_TEMP = "/github/workspace/";
  const HOST_TEMP = "${{ github.workspace }}/";
  const hostPathFor = (containerPath) =>
    `${HOST_TEMP}${containerPath.slice(CONTAINER_TEMP.length)}`;
  const scannerOutput = /--output=(\S+)/u.exec(scanner.with["scan-args"])[1];
  assert.equal(completionGuard.env.RESULTS, hostPathFor(scannerOutput));
  const reporterOld = /--old=(\S+)/u.exec(reporter.with["scan-args"])[1];
  assert.equal(baselineGuard.env.BASE_RESULTS, hostPathFor(reporterOld));
  const reporterNew = /--new=(\S+)/u.exec(reporter.with["scan-args"])[1];
  assert.equal(
    reporterNew,
    scannerOutput,
    "the reporter must read exactly the file the scanner wrote",
  );
  // Same matched-pair rule on the base side: what the base scan's container
  // writes is the file the fallback guard reads and the reporter compares
  // against, and the two scans must not write to the same file.
  const baseScannerOutput = /--output=(\S+)/u.exec(
    baseScanner.with["scan-args"],
  )[1];
  assert.equal(baselineGuard.env.BASE_RESULTS, hostPathFor(baseScannerOutput));
  assert.equal(reporterOld, baseScannerOutput);
  assert.notEqual(baseScannerOutput, scannerOutput);

  // Every scan path is rooted at its own side's checkout directory, so each
  // side is scanned with its own config. Scanning the base with the head's
  // config would suppress an advisory in the baseline that the head removed the
  // suppression for, and the pull request would pass.
  for (const jobId of osvJobIds) {
    const job = supplyChain.jobs[jobId];
    for (const [input, root] of [
      ["base-scan-args", "base/"],
      ["head-scan-args", "candidate/"],
    ]) {
      const values = [
        ...job.with[input].matchAll(/--(?:config|lockfile)=(\S+)/gu),
      ].map(([, value]) => value);
      assert.ok(values.length > 0);
      for (const value of values) {
        assert.ok(
          value.startsWith(root),
          `${jobId} ${input} must be rooted at ${root}, found ${value}`,
        );
      }
    }
    // A target either configures both sides or neither, and a configured side
    // reads the config out of its own checkout.
    const baseConfig = /--config=(\S+)/u.exec(job.with["base-scan-args"])?.[1];
    const headConfig = /--config=(\S+)/u.exec(job.with["head-scan-args"])?.[1];
    assert.equal(baseConfig === undefined, headConfig === undefined);
    if (baseConfig !== undefined) {
      assert.ok(baseConfig.startsWith("base/"));
      assert.ok(headConfig.startsWith("candidate/"));
    }
  }

  // Tripwire: nothing tracked may sit where scan state is written. A pull
  // request that added such a path fails here rather than silently forging a
  // result. The jobs also rm -rf the directory before writing to it.
  const trackedScanState = spawnSync("git", ["ls-files", "-z", "osv-state"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(trackedScanState.status, 0);
  assert.equal(trackedScanState.stdout, "");
  // The separate baseline workflow is gone; the diff is one job again.
  assert.equal(
    existsSync(
      new URL(
        "../.github/workflows/_osv-scanner-baseline.yml",
        import.meta.url,
      ),
    ),
    false,
  );

  const dependencyReview = yaml(".github/workflows/dependency-review.yml");
  const dependencyCheckout = dependencyReview.jobs[
    "dependency-review"
  ].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(dependencyCheckout.with["persist-credentials"], false);
});

test("the OSV head scan refuses inputs that leave the candidate checkout", () => {
  const readOnlyOsv = yaml(".github/workflows/_osv-scanner-readonly.yml");
  const steps = readOnlyOsv.jobs["osv-scan"].steps;
  const stepNamed = (name) => {
    const step = steps.find((candidate) => candidate.name === name);
    assert.ok(step, `missing step: ${name}`);
    return step;
  };
  const pathGuard = stepNamed(
    "Reject head scan inputs that leave the candidate checkout",
  );
  const baseRemoval = stepNamed(
    "Remove the base tree before the head checkout",
  );

  const workspace = mkdtempSync(join(tmpdir(), "osv-scan-inputs-"));
  try {
    // A workspace shaped like the job's: a candidate checkout beside a base
    // tree that has not been removed yet, which is the state the guard has to
    // survive even when the removal step is defeated.
    mkdirSync(join(workspace, "candidate", "scripts"), { recursive: true });
    mkdirSync(join(workspace, "base"), { recursive: true });
    writeFileSync(
      join(workspace, "candidate", "pnpm-lock.yaml"),
      "head lock\n",
    );
    writeFileSync(join(workspace, "candidate", "osv-scanner.toml"), "\n");
    writeFileSync(join(workspace, "base", "pnpm-lock.yaml"), "base lock\n");
    writeFileSync(join(workspace, "base", "osv-scanner.toml"), "\n");
    // A lockfile replaced by a symlink into the trusted base tree — the exact
    // bypass: the head scan would reproduce the baseline and every introduced
    // vulnerability would look unchanged.
    symlinkSync(
      "../base/pnpm-lock.yaml",
      join(workspace, "candidate", "escape.yaml"),
    );
    // The config toml is a scan input too, and the one that decides which
    // advisories are suppressed.
    symlinkSync(
      "../base/osv-scanner.toml",
      join(workspace, "candidate", "escape.toml"),
    );
    // A symlink that stays inside the candidate tree is still rejected: a scan
    // input must be the file the pull request proposes, not an alias for one.
    symlinkSync("pnpm-lock.yaml", join(workspace, "candidate", "alias.yaml"));
    // A symlinked parent directory leaves the final component a real file, so
    // only resolving the whole path catches it.
    symlinkSync("../base", join(workspace, "candidate", "aliasdir"));

    const runGuard = (headScanArgs) =>
      spawnSync("/bin/bash", ["-c", pathGuard.run], {
        encoding: "utf8",
        env: {
          GITHUB_WORKSPACE: workspace,
          HEAD_SCAN_ARGS: headScanArgs,
          PATH: "/usr/bin:/bin",
        },
      });

    const accepted = runGuard(
      "--config=candidate/osv-scanner.toml\n--lockfile=candidate/pnpm-lock.yaml",
    );
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /candidate\/osv-scanner\.toml resolves to/u);
    assert.match(accepted.stdout, /candidate\/pnpm-lock\.yaml resolves to/u);

    for (const [args, expected] of [
      // A lockfile symlinked out of the candidate tree.
      ["--lockfile=candidate/escape.yaml", /is a symlink/u],
      // The same trick on the config, which suppresses advisories.
      [
        "--config=candidate/escape.toml\n--lockfile=candidate/pnpm-lock.yaml",
        /is a symlink/u,
      ],
      // A symlink that never leaves the candidate tree.
      ["--lockfile=candidate/alias.yaml", /is a symlink/u],
      // A real file reached through a symlinked parent directory.
      [
        "--lockfile=candidate/aliasdir/pnpm-lock.yaml",
        /outside the candidate/u,
      ],
      // An argument that was never rooted at the candidate tree.
      ["--lockfile=base/pnpm-lock.yaml", /is not rooted at candidate\//u],
      // A missing input fails closed rather than being skipped.
      [
        "--lockfile=candidate/absent.yaml",
        /is missing or is not a regular file/u,
      ],
      // A directory is not a scan input.
      ["--lockfile=candidate/scripts", /is missing or is not a regular file/u],
      // Arguments carrying nothing to validate must not pass silently.
      ["--format=json", /No --lockfile or --config head scan input/u],
    ]) {
      const rejected = runGuard(args);
      assert.notEqual(rejected.status, 0, `accepted ${args}`);
      assert.match(rejected.stdout, expected);
      assert.match(rejected.stdout, /^::error::/mu);
    }

    // The removal step actually removes the tree, and says so.
    const removal = spawnSync("/bin/bash", ["-c", baseRemoval.run], {
      encoding: "utf8",
      env: { GITHUB_WORKSPACE: workspace, PATH: "/usr/bin:/bin" },
    });
    assert.equal(removal.status, 0, removal.stdout + removal.stderr);
    assert.equal(existsSync(join(workspace, "base")), false);
    // With the base tree gone the escaping symlink dangles, so the guard's
    // second layer would catch it even if the first were bypassed.
    const dangling = runGuard("--lockfile=candidate/escape.yaml");
    assert.notEqual(dangling.status, 0);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("pnpm release-age exclusions stay exact and bounded", () => {
  const workspace = yaml("pnpm-workspace.yaml");
  const turboReleaseAgeExclusions = [
    "turbo@2.10.11",
    "@turbo/darwin-64@2.10.11",
    "@turbo/darwin-arm64@2.10.11",
    "@turbo/linux-64@2.10.11",
    "@turbo/linux-arm64@2.10.11",
    "@turbo/windows-64@2.10.11",
    "@turbo/windows-arm64@2.10.11",
  ];

  assert.deepEqual(
    workspace.minimumReleaseAgeExclude,
    turboReleaseAgeExclusions,
  );

  const lockfile = yaml("pnpm-lock.yaml");
  for (const packageSelector of turboReleaseAgeExclusions) {
    assert.ok(
      lockfile.packages[packageSelector],
      `remove the release-age exclusion when ${packageSelector} leaves the reviewed lockfile`,
    );
  }
});

test("Wormhole Connect owns isolated UI dependencies", () => {
  const appManifest = JSON.parse(read("apps/app.mento.org/package.json"));
  const uiManifest = JSON.parse(read("packages/ui/package.json"));
  const workspace = yaml("pnpm-workspace.yaml");
  const lockfile = yaml("pnpm-lock.yaml");
  const appLucide =
    lockfile.importers["apps/app.mento.org"].dependencies["lucide-react"];
  const wormholePackage =
    lockfile.packages["@wormhole-foundation/wormhole-connect@6.0.0"];
  const wormholeSnapshots = Object.entries(lockfile.snapshots).filter(([key]) =>
    key.startsWith("@wormhole-foundation/wormhole-connect@6.0.0("),
  );
  const approvedResolvedLucide = /^1\.31\.0(?:\(|$)/u;
  const widgetResolvedLucide = /^0\.554\.0(?:\(|$)/u;
  const widgetOnlyUiDependencies = [
    "@emotion/react",
    "@emotion/styled",
    "@mui/icons-material",
    "@mui/material",
    "@mui/styled-engine",
    "@mui/system",
  ];
  const allowedPeerVersions =
    workspace.peerDependencyRules?.allowedVersions ?? {};

  assert.equal(
    appManifest.dependencies["@wormhole-foundation/wormhole-connect"],
    "^6.0.0",
  );
  assert.equal(appManifest.dependencies["lucide-react"], "catalog:");
  assert.equal(uiManifest.dependencies["lucide-react"], "^1.28.0");
  assert.equal(workspace.catalog["lucide-react"], "^1.28.0");
  assert.equal(appLucide.specifier, "catalog:");
  assert.match(appLucide.version, approvedResolvedLucide);
  assert.equal(
    Object.keys(allowedPeerVersions).some((selector) =>
      selector.startsWith("@wormhole-foundation/wormhole-connect@"),
    ),
    false,
  );
  assert.equal(wormholePackage.peerDependencies["lucide-react"], undefined);
  assert.equal(wormholeSnapshots.length, 1);

  const wormholeDependencies = wormholeSnapshots[0][1].dependencies;
  for (const packageName of widgetOnlyUiDependencies) {
    assert.equal(appManifest.dependencies[packageName], undefined);
    assert.ok(wormholeDependencies[packageName]);
  }
  assert.match(wormholeDependencies["lucide-react"], widgetResolvedLucide);
});

test("Wagmi paths share one use-sync-external-store peer snapshot", () => {
  const manifest = JSON.parse(read("package.json"));
  const vercelRuntimeManifest = JSON.parse(
    read("scripts/vercel-cli-runtime/package.json"),
  );
  const lockfile = read("pnpm-lock.yaml");

  assert.equal(
    manifest.pnpm.overrides["zustand>use-sync-external-store"],
    "1.4.0",
  );
  assert.equal(
    vercelRuntimeManifest.pnpm.overrides["zustand>use-sync-external-store"],
    "1.4.0",
  );
  const wagmiPeerSnapshots = [
    ...lockfile.matchAll(/^ {2}'(@wagmi\/core@[^']+\([^']+\))':$/gmu),
  ].map((match) => match[1]);

  assert.equal(wagmiPeerSnapshots.length, 1);
  assert.equal(
    wagmiPeerSnapshots[0].includes("use-sync-external-store@1.4.0"),
    true,
  );
});

test("Dependabot groups isolate protected runtimes and couple test tooling", () => {
  const config = yaml(".github/dependabot.yml");
  const policy = authorityJson(read(".github/dependabot-prep-policy.json"));
  const npmConfig = config.updates.find(
    (update) => update["package-ecosystem"] === "npm",
  );
  const actionsConfigs = config.updates.filter(
    (update) => update["package-ecosystem"] === "github-actions",
  );
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const localActionRoot = join(repositoryRoot, ".github/actions");
  const nestedActionDirectories = filesBelow(localActionRoot)
    .filter((path) => /(?:^|\/)action\.ya?ml$/u.test(path))
    .map((path) => `/${relative(repositoryRoot, dirname(path))}`)
    .sort();
  assert.equal(actionsConfigs.length, 2);
  const actionsConfig = actionsConfigs.find(
    (update) => update.directory === "/",
  );
  const localActionsConfig = actionsConfigs.find((update) => update.directories);
  assert.equal(actionsConfig.directories, undefined);
  assert.equal(localActionsConfig.directory, undefined);
  assert.deepEqual(
    [...localActionsConfig.directories].sort(),
    nestedActionDirectories,
    "the exact local Action manifest directories need Dependabot coverage",
  );
  assert.equal(
    new Set(localActionsConfig.directories).size,
    localActionsConfig.directories.length,
    "local Action directories must not be duplicated",
  );
  assert.equal(
    localActionsConfig.directories.includes("/"),
    false,
    "the local Action entry must not overlap the root workflow entry",
  );
  for (const field of [
    "schedule",
    "cooldown",
    "open-pull-requests-limit",
    "labels",
    "commit-message",
  ]) {
    assert.deepEqual(
      localActionsConfig[field],
      actionsConfig[field],
      `local Actions must preserve root ${field} semantics`,
    );
  }
  assert.deepEqual(localActionsConfig.groups, {
    "github-actions-local-manual": {
      "applies-to": "version-updates",
      patterns: ["*"],
    },
    "github-actions-local-security-manual": {
      "applies-to": "security-updates",
      patterns: ["*"],
    },
  });

  for (const update of [npmConfig, ...actionsConfigs]) {
    assert.deepEqual(update.schedule, {
      interval: "weekly",
      day: "monday",
      time: "06:00",
      timezone: "UTC",
    });
  }
  assert.equal(npmConfig["open-pull-requests-limit"], 12);
  assert.deepEqual(npmConfig.cooldown, {
    "default-days": 7,
    "semver-major-days": 21,
    "semver-minor-days": 7,
    "semver-patch-days": 7,
  });
  assert.deepEqual(npmConfig.groups["vercel-cli"], {
    "applies-to": "version-updates",
    patterns: ["vercel"],
    "update-types": ["minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["vercel-cli-security"], {
    "applies-to": "security-updates",
    patterns: ["vercel"],
  });
  assert.deepEqual(npmConfig.groups["next-runtime"], {
    "applies-to": "version-updates",
    patterns: ["next"],
    "update-types": ["major", "minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["next-runtime-security"], {
    "applies-to": "security-updates",
    patterns: ["next"],
  });
  assert.deepEqual(npmConfig.groups["playwright-runtime"], {
    "applies-to": "version-updates",
    patterns: ["@playwright/test", "@argos-ci/playwright"],
    "update-types": ["major", "minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["playwright-runtime-security"], {
    "applies-to": "security-updates",
    patterns: ["@playwright/test", "@argos-ci/playwright"],
  });
  assert.deepEqual(npmConfig.groups["pnpm-runtime"], {
    "applies-to": "version-updates",
    patterns: ["pnpm", "@pnpm/linux-x64"],
    "update-types": ["major", "minor", "patch"],
  });
  assert.deepEqual(npmConfig.groups["pnpm-runtime-security"], {
    "applies-to": "security-updates",
    patterns: ["pnpm", "@pnpm/linux-x64"],
  });
  const protectedRuntimeDependencies = [
    "vercel",
    "next",
    "@playwright/test",
    "@argos-ci/playwright",
    "pnpm",
    "@pnpm/linux-x64",
  ];
  const protectedVersionGroups = {
    vercel: "vercel-cli",
    next: "next-runtime",
    "@playwright/test": "playwright-runtime",
    "@argos-ci/playwright": "playwright-runtime",
    pnpm: "pnpm-runtime",
    "@pnpm/linux-x64": "pnpm-runtime",
  };
  const protectedSecurityGroups = {
    vercel: "vercel-cli-security",
    next: "next-runtime-security",
    "@playwright/test": "playwright-runtime-security",
    "@argos-ci/playwright": "playwright-runtime-security",
    pnpm: "pnpm-runtime-security",
    "@pnpm/linux-x64": "pnpm-runtime-security",
  };
  for (const dependencyType of ["production", "development"]) {
    for (const [dependency, expectedGroup] of Object.entries(
      protectedVersionGroups,
    )) {
      const updateTypes =
        dependency === "vercel"
          ? ["minor", "patch"]
          : ["major", "minor", "patch"];
      for (const updateType of updateTypes) {
        assert.deepEqual(
          matchingDependabotGroups(
            npmConfig.groups,
            dependency,
            dependencyType,
            updateType,
          ),
          [expectedGroup],
          `${dependency} ${updateType} must not overlap an ordinary version-update group`,
        );
      }
    }
    for (const [dependency, expectedGroup] of Object.entries(
      protectedSecurityGroups,
    )) {
      assert.deepEqual(
        matchingDependabotGroups(
          npmConfig.groups,
          dependency,
          dependencyType,
          "patch",
          "security-updates",
        ),
        [expectedGroup],
        `${dependency} must not overlap a catch-all security group`,
      );
    }
  }
  for (const groupName of [
    "production-misc",
    "tooling",
    "security-runtime",
    "security-tooling",
  ]) {
    for (const dependency of protectedRuntimeDependencies) {
      assert.ok(
        npmConfig.groups[groupName]["exclude-patterns"].includes(dependency),
        `${groupName} must exclude protected ${dependency}`,
      );
    }
  }
  for (const dependencyType of ["production", "development"]) {
    assert.deepEqual(
      matchingDependabotGroups(
        npmConfig.groups,
        "vercel",
        dependencyType,
        "major",
      ),
      [],
      "a Vercel major must stay an ungrouped protected update",
    );
  }
  for (const dependencyType of ["production", "development"]) {
    for (const updateType of ["minor", "patch"]) {
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          "vercel",
          dependencyType,
          updateType,
        ),
        "vercel-cli",
      );
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          "next",
          dependencyType,
          updateType,
        ),
        "next-runtime",
      );
      for (const dependency of ["@playwright/test", "@argos-ci/playwright"]) {
        assert.equal(
          firstDependabotGroup(
            npmConfig.groups,
            dependency,
            dependencyType,
            updateType,
          ),
          "playwright-runtime",
        );
      }
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          "pnpm",
          dependencyType,
          updateType,
        ),
        "pnpm-runtime",
      );
    }
  }
  assert.deepEqual(npmConfig.groups["test-toolchain"], {
    "applies-to": "version-updates",
    "dependency-type": "development",
    patterns: ["vite", "vitest", "@vitest/*"],
    "update-types": ["major", "minor", "patch"],
  });
  for (const dependency of ["vite", "vitest", "@vitest/coverage-v8"]) {
    for (const updateType of ["major", "minor", "patch"]) {
      assert.deepEqual(
        matchingDependabotGroups(
          npmConfig.groups,
          dependency,
          "development",
          updateType,
        ),
        ["test-toolchain"],
        `${dependency} must be coupled only through test-toolchain`,
      );
    }
  }
  for (const pattern of ["vite", "vitest", "@vitest/*"]) {
    assert.ok(npmConfig.groups.tooling["exclude-patterns"].includes(pattern));
  }

  const namedProductionGroups = ["frontend-core", "web3-stack", "ui-styling"];
  assert.deepEqual(
    policy.admission.ordinaryNpm.manualRiskPackagePatterns,
    npmConfig.groups["web3-stack"].patterns,
    "broker manual-risk patterns must match the focused web3 group",
  );
  const namedProductionPatterns = namedProductionGroups.flatMap(
    (groupName) => npmConfig.groups[groupName].patterns,
  );
  const protectedProductionPatterns = [
    ...npmConfig.groups["next-runtime"].patterns,
    ...npmConfig.groups["playwright-runtime"].patterns,
    ...npmConfig.groups["vercel-cli"].patterns,
    ...npmConfig.groups["pnpm-runtime"].patterns,
  ];
  assert.deepEqual(
    [...npmConfig.groups["production-misc"]["exclude-patterns"]].sort(),
    [
      ...new Set([...namedProductionPatterns, ...protectedProductionPatterns]),
    ].sort(),
    "production-misc exclusions must mirror named and protected production groups",
  );
  for (const [groupName, dependencies] of Object.entries({
    "frontend-core": [
      "react",
      "react-dom",
      "@types/react",
      "@vercel/analytics",
    ],
    "web3-stack": [
      "@mento-protocol/mento-sdk",
      "@metamask/jazzicon",
      "@rainbow-me/rainbowkit",
      "viem",
      "wagmi",
      "wallet-sdk",
    ],
    "ui-styling": ["@radix-ui/react-dialog", "jotai", "tailwindcss", "zod"],
  })) {
    for (const dependency of dependencies) {
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          dependency,
          "production",
          "minor",
        ),
        groupName,
        `${dependency} must route to ${groupName}`,
      );
    }
  }
  const expectedSensitiveDependencies = [
    "@celo/wallet-base",
    "@ledgerhq/connect-kit",
    "@mento-protocol/mento-sdk",
    "@metamask/jazzicon",
    "@noble/hashes",
    "@rainbow-me/rainbowkit",
    "@reown/appkit",
    "@safe-global/protocol-kit",
    "@scure/bip39",
    "@solana/web3.js",
    "@trezor/connect-web",
    "@wagmi/core",
    "@walletconnect/sign-client",
    "@wormhole-foundation/wormhole-connect",
    "ethers",
    "ethers-utils",
    "viem",
    "viem-utils",
    "wallet-sdk",
    "web3",
  ];
  for (const dependency of expectedSensitiveDependencies) {
    for (const dependencyType of ["production", "development"]) {
      assert.equal(
        firstDependabotGroup(
          npmConfig.groups,
          dependency,
          dependencyType,
          "minor",
        ),
        "web3-stack",
        `${dependency} (${dependencyType}) must route to web3-stack`,
      );
    }
  }
  assert.equal(
    firstDependabotGroup(npmConfig.groups, "date-fns", "production", "patch"),
    "production-misc",
  );
  assert.equal(
    firstDependabotGroup(npmConfig.groups, "eslint", "development", "patch"),
    "tooling",
  );

  assert.deepEqual(npmConfig.groups["web3-stack-security"], {
    "applies-to": "security-updates",
    patterns: policy.admission.ordinaryNpm.manualRiskPackagePatterns,
  });
  const securityExclusions = [
    ...protectedRuntimeDependencies,
    ...policy.admission.ordinaryNpm.manualRiskPackagePatterns,
  ];
  assert.deepEqual(npmConfig.groups["security-runtime"], {
    "applies-to": "security-updates",
    "dependency-type": "production",
    patterns: ["*"],
    "exclude-patterns": securityExclusions,
  });
  assert.deepEqual(npmConfig.groups["security-tooling"], {
    "applies-to": "security-updates",
    "dependency-type": "development",
    patterns: ["*"],
    "exclude-patterns": securityExclusions,
  });
  for (const dependency of expectedSensitiveDependencies) {
    for (const dependencyType of ["production", "development"]) {
      assert.deepEqual(
        matchingDependabotGroups(
          npmConfig.groups,
          dependency,
          dependencyType,
          "patch",
          "security-updates",
        ),
        ["web3-stack-security"],
        `${dependency} security update must stay in the manual-risk group`,
      );
    }
  }
  assert.equal(npmConfig.ignore, undefined);

  const routine = actionsConfig.groups["github-actions-routine"];
  const manual = actionsConfig.groups["github-actions-manual"];
  assert.deepEqual(manual.patterns, routine["exclude-patterns"]);
  assert.deepEqual(
    policy.githubActions.routineGroup.sensitiveActionPatterns,
    routine["exclude-patterns"],
  );
  const actionDependencies = new Set();
  const githubRoot = fileURLToPath(new URL("../.github/", import.meta.url));
  for (const path of filesBelow(githubRoot).filter((entry) =>
    /\.ya?ml$/u.test(entry),
  )) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gmu)) {
      const dependency = match[1].replace(/^['"]|['"]$/gu, "").split("@")[0];
      if (!dependency.startsWith("./") && dependency.includes("/")) {
        actionDependencies.add(dependency);
      }
    }
  }
  const sensitive = [...actionDependencies]
    .filter((dependency) =>
      /(?:create-github-app-token|dependency-review|anthropic|claude|codex|copilot|codeql|dependabot|osv|scorecard|security|harden-runner|trivy|snyk|attest|reviewer|review-action)/iu.test(
        dependency,
      ),
    )
    .sort();
  assert.deepEqual(sensitive, [
    "actions/dependency-review-action",
    "anthropics/claude-code-action",
    "github/codeql-action/upload-sarif",
    "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml",
    "google/osv-scanner-action/osv-reporter-action",
    "google/osv-scanner-action/osv-scanner-action",
    "ossf/scorecard-action",
  ]);
  for (const dependency of sensitive) {
    assert.ok(
      routine["exclude-patterns"].some((pattern) =>
        dependabotPatternMatches(pattern, dependency),
      ),
      `${dependency} must stay out of the routine Actions group`,
    );
  }

  for (const packagePath of workspacePackagePaths()) {
    const manifest = JSON.parse(read(packagePath));
    for (const [manifestKey, dependencyType] of [
      ["dependencies", "production"],
      ["devDependencies", "development"],
    ]) {
      for (const [dependency, version] of Object.entries(
        manifest[manifestKey] ?? {},
      )) {
        if (String(version).startsWith("workspace:")) continue;
        for (const updateType of ["minor", "patch"]) {
          assert.ok(
            firstDependabotGroup(
              npmConfig.groups,
              dependency,
              dependencyType,
              updateType,
            ),
            `${packagePath} ${dependency} has no ${updateType} group`,
          );
        }
      }
    }
  }
});

test("repository workflow code cannot merge Dependabot pull requests", () => {
  const workflowDirectory = fileURLToPath(
    new URL("../.github/workflows/", import.meta.url),
  );
  assert.equal(
    existsSync(
      new URL(
        "../.github/workflows/dependabot-auto-merge.yml",
        import.meta.url,
      ),
    ),
    false,
  );
  const forbiddenMergeAuthority =
    /gh\s+pr\s+merge|enablePullRequestAutoMerge|enqueuePullRequest|mergePullRequest|\/pulls\/[^\s"'`]*\/merge|pulls\.merge/iu;

  const actionDirectory = fileURLToPath(
    new URL("../.github/actions/", import.meta.url),
  );
  const scriptDirectory = fileURLToPath(
    new URL("../scripts/", import.meta.url),
  );
  const authoritySources = [
    ...filesBelow(workflowDirectory).filter((path) => /\.ya?ml$/u.test(path)),
    ...filesBelow(actionDirectory).filter((path) =>
      /\.(?:c?js|mjs|sh|ts|ya?ml)$/u.test(path),
    ),
    ...filesBelow(scriptDirectory).filter(
      (path) =>
        /\.(?:js|mjs|sh|ts)$/u.test(path) &&
        !/\.test\.(?:js|mjs|ts)$/u.test(path),
    ),
    fileURLToPath(new URL("../package.json", import.meta.url)),
  ];
  for (const path of authoritySources) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      forbiddenMergeAuthority,
      `${path} must not merge or enable native auto-merge`,
    );
  }
});

test("canonical instructions preserve the external preparation boundary", () => {
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "docs/dependabot-automation.md",
  ]) {
    const source = read(path).replace(/\s+/gu, " ");
    assert.match(source, /exact final head and base/iu, path);
    assert.match(source, /(?:current-head|exact-head).{0,80}review/iu, path);
    assert.match(source, /auto-merge/iu, path);
    assert.match(
      source,
      /(?:must not|never).{0,100}approv.{0,100}(?:merge|auto-merge)/iu,
      path,
    );
    assert.match(
      source,
      /(?:human approval.{0,80}(?:separate|final)|(?:separate|final).{0,80}human approval|maintainer.{0,80}(?:human|final) approval)/iu,
      path,
    );
  }
});

test("canonical instructions pin Dependabot preparation policy v2", () => {
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
    "docs/dependabot-automation.md",
    "docs/adr/0009-external-agent-dependabot-preparation.md",
  ]) {
    const source = read(path).replace(/\s+/gu, " ");
    assert.match(source, /generationBaseSha/iu, path);
    assert.match(source, /currentTargetBaseSha/iu, path);
    assert.match(source, /policySha/iu, path);
    assert.match(
      source,
      /full.{0,80}sync-only.{0,80}review-only.{0,80}manual/iu,
      path,
    );
    assert.match(
      source,
      /(?:changelog|release notes).{0,180}risk.{0,80}confidence/iu,
      path,
    );
    assert.match(source, /live-verif/iu, path);
    assert.match(source, /authoritative upstream HTTPS URL/iu, path);
    assert.match(source, /upstream project or package page/iu, path);
    assert.match(source, /operationally incomplete/iu, path);
    assert.match(source, /critical.{0,20}unknown/iu, path);
    assert.match(
      source,
      /(?:byte-and-mode|byte-for-byte.{0,40}mode-for-mode)/iu,
      path,
    );
    assert.match(
      source,
      /(?:does not grant|grants neither|no).{0,80}(?:check reruns|`rerun`)/iu,
      path,
    );
    assert.match(
      source,
      /(?:(?:Next\.js|`next`).{0,120}patch|patch.{0,120}(?:Next\.js|`next`)).{0,120}`full`/iu,
      path,
    );
    assert.match(
      source,
      /Next.{0,100}(?:minor.{0,40}major|minor\/major).{0,100}`manual`/iu,
      path,
    );
    assert.match(source, /\/opt\/dependabot-prep\/authorized-run/u, path);
    assert.match(source, /\/opt\/dependabot-prep\/authorized-run\.mjs/u, path);
    assert.match(source, /sudo \/opt\/dependabot-prep\/selftest-run/u, path);
    assert.match(source, /\/etc\/dependabot-prep\/selftest-attestation\.json/u, path);
    assert.match(source, /\/var\/lib\/dependabot\/gh/u, path);
    assert.match(source, /\/var\/lib\/dependabot-mutator\/gh/u, path);
    assert.match(source, /(?:no credential|empty)/iu, path);
  }

  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    "docs/dependabot-automation.md",
    "docs/adr/0009-external-agent-dependabot-preparation.md",
  ]) {
    const source = read(path).replace(/\s+/gu, " ");
    assert.match(source, /HeadRefForcePushedEvent/iu, path);
    assert.match(source, /rules\/branches/iu, path);
    assert.match(
      source,
      /complete.{0,80}(?:inventory|sweep).{0,80}(?:exit|exits) `?0/iu,
      path,
    );
    assert.match(source, /root-owned.{0,120}receipt/iu, path);
  }

  const overrideRunbook = read("docs/dependency-overrides.md").replace(
    /\s+/gu,
    " ",
  );
  assert.match(
    overrideRunbook,
    /semver-patch-only Next\.js.{0,120}`full`/iu,
  );
  for (const field of [
    "lockfileSha256",
    "manifestSha256",
    "overridesSha256",
    "runtimeDependenciesSha256",
  ]) {
    assert.match(overrideRunbook, new RegExp(field, "u"));
  }
});
