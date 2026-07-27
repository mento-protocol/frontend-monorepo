import { canonicalizeHostname } from "./vercel-deployment-url.mjs";

const CREATOR_USERNAME_PATTERN =
  /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const RESERVED_CREATOR_PREFIXES = Object.freeze(["env-", "git-"]);

export const PRODUCTION_GENERATED_ALIAS_CONTRACTS = Object.freeze({
  governance: Object.freeze({
    generatedGitMainAlias: "governancementoorg-git-main-mentolabs.vercel.app",
    generatedProjectAlias: "governancementoorg-mentolabs.vercel.app",
    generatedProjectSlug: "governancementoorg",
    generatedScopeSlug: "mentolabs",
  }),
  reserve: Object.freeze({
    generatedGitMainAlias: "reservementoorg-git-main-mentolabs.vercel.app",
    generatedProjectAlias: "reservementoorg-mentolabs.vercel.app",
    generatedProjectSlug: "reservementoorg",
    generatedScopeSlug: "mentolabs",
  }),
  ui: Object.freeze({
    generatedGitMainAlias: "uimentoorg-git-main-mentolabs.vercel.app",
    generatedProjectAlias: "uimentoorg-mentolabs.vercel.app",
    generatedProjectSlug: "uimentoorg",
    generatedScopeSlug: "mentolabs",
  }),
});

export const PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES = Object.freeze({
  CANDIDATE: "candidate",
  SERVED_PRIOR: "served-prior",
});

function targetContract(logicalTarget) {
  if (!Object.hasOwn(PRODUCTION_GENERATED_ALIAS_CONTRACTS, logicalTarget)) {
    throw new Error(
      "Target does not support production generated-alias verification",
    );
  }
  return PRODUCTION_GENERATED_ALIAS_CONTRACTS[logicalTarget];
}

function assertCanonicalCreatorUsername(creatorUsername) {
  if (creatorUsername === null) return;
  if (
    typeof creatorUsername !== "string" ||
    !CREATOR_USERNAME_PATTERN.test(creatorUsername)
  ) {
    throw new Error("Canonical deployment creator username is malformed");
  }
}

function creatorUsesReservedNamespace(creatorUsername) {
  return RESERVED_CREATOR_PREFIXES.some((prefix) =>
    creatorUsername.startsWith(prefix),
  );
}

export function assertOnlyExpectedProductionGeneratedAliases({
  aliases,
  creatorUsername,
  logicalTarget,
  mode,
}) {
  const contract = targetContract(logicalTarget);
  assertCanonicalCreatorUsername(creatorUsername);
  if (
    !Object.values(PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES).includes(mode)
  ) {
    throw new Error("Production generated-alias topology mode is malformed");
  }
  if (!Array.isArray(aliases)) {
    throw new Error("Production generated-alias topology is malformed");
  }
  let canonicalAliases;
  try {
    canonicalAliases = aliases.map((alias) => canonicalizeHostname(alias));
  } catch {
    throw new Error("Production generated-alias topology is malformed");
  }
  if (
    new Set(canonicalAliases).size !== canonicalAliases.length ||
    JSON.stringify(canonicalAliases) !== JSON.stringify(aliases) ||
    JSON.stringify(canonicalAliases.toSorted()) !==
      JSON.stringify(canonicalAliases)
  ) {
    throw new Error("Production generated-alias topology is malformed");
  }

  const {
    generatedGitMainAlias,
    generatedProjectAlias,
    generatedProjectSlug,
    generatedScopeSlug,
  } = contract;
  if (
    canonicalizeHostname(generatedGitMainAlias) !== generatedGitMainAlias ||
    generatedGitMainAlias !==
      `${generatedProjectSlug}-git-main-${generatedScopeSlug}.vercel.app` ||
    canonicalizeHostname(generatedProjectAlias) !== generatedProjectAlias ||
    generatedProjectAlias !==
      `${generatedProjectSlug}-${generatedScopeSlug}.vercel.app`
  ) {
    throw new Error("Reviewed generated project alias is malformed");
  }

  const allowedCreatorAliases = [];
  if (
    creatorUsername !== null &&
    !creatorUsesReservedNamespace(creatorUsername)
  ) {
    const authorLabel = `${generatedProjectSlug}-${creatorUsername}-${generatedScopeSlug}`;
    if (authorLabel.length <= 63) {
      allowedCreatorAliases.push(
        canonicalizeHostname(`${authorLabel}.vercel.app`),
      );
    }
  }

  const allowedAliases =
    mode === PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR
      ? new Set([
          generatedGitMainAlias,
          generatedProjectAlias,
          ...allowedCreatorAliases,
        ])
      : new Set([generatedProjectAlias, ...allowedCreatorAliases]);
  const topologyMatches =
    mode === PRODUCTION_GENERATED_ALIAS_TOPOLOGY_MODES.SERVED_PRIOR
      ? canonicalAliases.every((alias) => allowedAliases.has(alias))
      : canonicalAliases.includes(generatedProjectAlias) &&
        canonicalAliases.every((alias) => allowedAliases.has(alias));
  if (!topologyMatches) {
    throw new Error(
      `Production ${logicalTarget} ${mode} generated-alias topology mismatch: allowed ${JSON.stringify([...allowedAliases].toSorted())}; actual ${JSON.stringify(canonicalAliases)}`,
    );
  }
  return canonicalAliases;
}
