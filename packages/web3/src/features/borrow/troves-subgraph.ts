import { ChainId } from "@/config/chains";

// Mento V3 trove-history subgraph endpoints, keyed by chainId.
//
// Celo Sepolia stays on Subgraph Studio permanently — The Graph's
// decentralized network doesn't support that testnet. Celo mainnet is on
// Studio until the subgraph is published to the decentralized network, at
// which point it moves to a `https://gateway.thegraph.com/api/subgraphs/id/…`
// URL via the env override below, with no code change needed.
//
// Why the endpoints are overridable at all: a Studio URL embeds a version
// label, and that label is mutable state living only in the Studio account —
// it is recorded in no repository. Studio archives the previous version on
// every deploy and archived versions stop answering queries, so redeploying
// the subgraph in mento-protocol/bold
// (`subgraph/deploy-subgraph <network> --version vX.Y.Z`) silently breaks a
// hardcoded URL. Overriding via env turns that into a Vercel config change
// rather than a code release. Issue #865 was this exact failure: the URLs
// were pinned to `/version/latest`, which Studio resolves as a literal
// version label and rejects with `deployment … does not exist`.
//
// The defaults are the currently-deployed labels, so an unset (or blank)
// override keeps the app working rather than silently disabling the panel.
const DEFAULT_TROVES_SUBGRAPH_URLS: Partial<Record<ChainId, string>> = {
  [ChainId.Celo]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo/v0.0.1",
  [ChainId.CeloSepolia]:
    "https://api.studio.thegraph.com/query/1724470/mento-troves-celo-sepolia/v0.0.1",
};

// Literal reads — Next.js inlines NEXT_PUBLIC_* at build time. Do NOT rewrite
// as dynamic access (process.env[name]) or route through t3-env; either breaks
// build-time inlining (@repo/web3 is bundled into the app, and t3-env isn't
// reachable from this package).
const TROVES_SUBGRAPH_URL_OVERRIDES: Partial<Record<ChainId, string>> = {
  [ChainId.Celo]: process.env.NEXT_PUBLIC_TROVES_SUBGRAPH_URL,
  [ChainId.CeloSepolia]:
    process.env.NEXT_PUBLIC_TROVES_SUBGRAPH_URL_CELO_SEPOLIA,
};

// Host whose queries are authenticated with a Graph API key. Studio dev
// endpoints are unauthenticated; the decentralized-network gateway is not.
const GRAPH_GATEWAY_HOSTNAME = "gateway.thegraph.com";

/**
 * Resolve the trove-history subgraph endpoint for a chain, preferring the
 * env override and falling back to the currently-deployed default.
 *
 * Returns `undefined` only for chains that have no trove-history subgraph at
 * all (every chain outside Celo / Celo Sepolia). Callers treat that as
 * "unsupported chain", so a blank override must NOT collapse to `undefined`
 * — that would render "not indexed on this network yet" and hide a config
 * mistake behind a plausible-looking message.
 */
export function getTrovesSubgraphUrl(chainId: number): string | undefined {
  const chain = chainId as ChainId;
  const fallback = DEFAULT_TROVES_SUBGRAPH_URLS[chain];
  if (!fallback) return undefined;
  return TROVES_SUBGRAPH_URL_OVERRIDES[chain]?.trim() || fallback;
}

/**
 * Request headers for a trove-history query.
 *
 * The decentralized-network gateway requires a Graph API key; Studio does
 * not, and must not be sent one. Keying off the resolved URL's host is what
 * lets the mainnet Studio → gateway switch be a pure env change.
 */
export function getTrovesSubgraphHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const apiKey = process.env.NEXT_PUBLIC_GRAPH_API_KEY?.trim();
  if (apiKey && isGraphGatewayUrl(url)) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function isGraphGatewayUrl(url: string): boolean {
  try {
    return new URL(url).hostname === GRAPH_GATEWAY_HOSTNAME;
  } catch {
    // A malformed override shouldn't throw during render; the fetch itself
    // will fail and surface through the query's error state.
    return false;
  }
}
