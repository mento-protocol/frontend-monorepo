/**
 * Convert a URL-format trove id to the canonical subgraph entity-id shape:
 *
 *   `<troveManager-lowercase>:<collIndex>:<troveId-as-canonical-hex>`
 *
 * The subgraph mappings persist troveIds via AssemblyScript
 * `BigInt.toHexString()` — i.e. lowercase, `0x`-prefixed, no leading zeros.
 * Different URL producers in this codebase emit the route id differently
 * (today: `buildOpenTroveSuccessHref` pushes decimal via `BigInt.toString()`;
 * other flows already use hex). `BigInt(troveId)` accepts both forms, and we
 * re-derive the canonical hex shape here so the consumer is format-agnostic.
 *
 * Kept in its own no-imports file so it can be unit-tested without
 * pulling in the SDK + wagmi transitive import graph.
 */
export function formatSubgraphTroveId(
  troveManager: string,
  troveId: string,
  collIndex = 0,
): string {
  const troveIdHex = "0x" + BigInt(troveId).toString(16);
  return `${troveManager.toLowerCase()}:${collIndex}:${troveIdHex}`;
}
