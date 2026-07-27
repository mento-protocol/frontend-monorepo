import { canonicalizeHostname } from "./vercel-deployment-url.mjs";

const CREATOR_USERNAME_PATTERN =
  /^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const RESERVED_CREATOR_PREFIXES = Object.freeze(["env-", "git-"]);

export const PRODUCTION_GENERATED_ALIAS_CONTRACTS = Object.freeze({
  governance: Object.freeze({
    generatedProjectAlias: "governancementoorg-mentolabs.vercel.app",
    generatedProjectSlug: "governancementoorg",
    generatedScopeSlug: "mentolabs",
  }),
  reserve: Object.freeze({
    generatedProjectAlias: "reservementoorg-mentolabs.vercel.app",
    generatedProjectSlug: "reservementoorg",
    generatedScopeSlug: "mentolabs",
  }),
  ui: Object.freeze({
    generatedProjectAlias: "uimentoorg-mentolabs.vercel.app",
    generatedProjectSlug: "uimentoorg",
    generatedScopeSlug: "mentolabs",
  }),
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
}) {
  const contract = targetContract(logicalTarget);
  assertCanonicalCreatorUsername(creatorUsername);
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

  const { generatedProjectAlias, generatedProjectSlug, generatedScopeSlug } =
    contract;
  if (
    canonicalizeHostname(generatedProjectAlias) !== generatedProjectAlias ||
    generatedProjectAlias !==
      `${generatedProjectSlug}-${generatedScopeSlug}.vercel.app`
  ) {
    throw new Error("Reviewed generated project alias is malformed");
  }

  const allowedTopologies = [[generatedProjectAlias]];
  if (
    creatorUsername !== null &&
    !creatorUsesReservedNamespace(creatorUsername)
  ) {
    const authorLabel = `${generatedProjectSlug}-${creatorUsername}-${generatedScopeSlug}`;
    if (authorLabel.length <= 63) {
      allowedTopologies.push(
        [
          generatedProjectAlias,
          canonicalizeHostname(`${authorLabel}.vercel.app`),
        ].toSorted(),
      );
    }
  }
  if (
    !allowedTopologies.some(
      (expectedAliases) =>
        JSON.stringify(canonicalAliases) === JSON.stringify(expectedAliases),
    )
  ) {
    throw new Error(
      `Production ${logicalTarget} generated-alias topology mismatch: expected one of ${JSON.stringify(allowedTopologies)}; actual ${JSON.stringify(canonicalAliases)}`,
    );
  }
  return canonicalAliases;
}
