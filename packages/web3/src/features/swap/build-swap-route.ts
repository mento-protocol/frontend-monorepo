import { getTokenByAddress } from "@/config/tokens";
import type { Route } from "@mento-protocol/mento-sdk";

/**
 * Builds a human-readable swap route string by tracing the path from input to output token
 * For debugging purposes.
 */
export function buildSwapRoute(
  route: Route,
  fromTokenAddr: string,
  toTokenAddr: string,
  chainId: number,
): string {
  const { path, tokens } = route;

  // Helper function to get token symbol by address
  const getTokenSymbol = (address: string): string => {
    try {
      // First try to get symbol from route tokens
      const routeToken = tokens.find(
        (t) => t.address.toLowerCase() === address.toLowerCase(),
      );
      if (routeToken) return routeToken.symbol;

      // Fall back to local token configuration
      const token = getTokenByAddress(address as `0x${string}`, chainId);
      if (token) return token.symbol;
    } catch {
      // Ignore errors
    }

    return `${address.slice(0, 6)}...`;
  };

  // For direct swaps (single hop)
  if (path.length === 1) {
    const fromSymbol = getTokenSymbol(fromTokenAddr);
    const toSymbol = getTokenSymbol(toTokenAddr);
    return `${fromSymbol} => ${toSymbol}`;
  }

  // For multi-hop swaps, trace the path through pools
  let currentToken = fromTokenAddr.toLowerCase();
  const routeSteps: string[] = [getTokenSymbol(currentToken)];

  for (const pool of path) {
    // Determine next token in the path
    const nextToken =
      currentToken === pool.token0.toLowerCase() ? pool.token1 : pool.token0;

    routeSteps.push(getTokenSymbol(nextToken));
    currentToken = nextToken.toLowerCase();
  }

  return routeSteps.join(" => ");
}
