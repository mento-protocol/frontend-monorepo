// The Graph's decentralized-network gateway is the only subgraph host that
// takes the API key. Subgraph Studio dev endpoints are unauthenticated, and a
// Studio URL is exactly where NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA is headed
// (the network has no Celo Sepolia allocations). Keying the header off the
// resolved URL's host, rather than off which chain is being queried, is what
// lets that switch be a pure env change — and stops the gateway key being
// handed to a host that never asked for it. Mirrors the trove-history helper
// in @repo/web3 (troves-subgraph.ts).
const GRAPH_GATEWAY_HOSTNAME = "gateway.thegraph.com";

export function isGraphGatewayUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    // https only: a Bearer token must never go out in cleartext, even if an
    // env var is mistyped as http://.
    return protocol === "https:" && hostname === GRAPH_GATEWAY_HOSTNAME;
  } catch {
    // A malformed env value shouldn't throw during render or SSR; the fetch
    // itself will fail and surface through the query's error state.
    return false;
  }
}

/**
 * Bearer token for a subgraph request, or `undefined` when the destination
 * is not the gateway (or no key is configured).
 */
export function getGraphAuthorization(
  url: string | undefined,
  apiKey: string | undefined,
): string | undefined {
  const key = apiKey?.trim();
  if (!key || !isGraphGatewayUrl(url)) return undefined;
  return `Bearer ${key}`;
}

/**
 * The gateway signals "I cannot serve this subgraph right now" as an HTTP 200
 * with a GraphQL `errors` array and no `data` — e.g.
 * `bad indexers: {…: Unavailable}` or `subgraph not found: no allocations`.
 * That is the primary being unavailable, not the query being wrong. (A wrong
 * query also gets `errors`, but a fallback returns the same error for it,
 * which is harmless.) Transport failures (5xx, network) are separate.
 */
export function isPrimaryUnavailable(result: {
  data?: unknown;
  errors?: ReadonlyArray<unknown>;
}): boolean {
  return (
    result.data == null &&
    Array.isArray(result.errors) &&
    result.errors.length > 0
  );
}
