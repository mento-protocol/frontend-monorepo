import type { TradablePair } from "@mento-protocol/mento-sdk";
import { getTokenByAddress } from "@/lib/config/tokens";

/**
 * Builds a human-readable swap route string by tracing the path from input to output token
 * For debugging purposes.
 */
export function buildSwapRoute(
  tradablePair: TradablePair,
  fromTokenAddr: string,
  toTokenAddr: string,
): string {
  const { path, assets } = tradablePair;

  // Helper function to get token symbol by address
  const getTokenSymbol = (address: string): string => {
    try {
      // First try to get symbol from local token configuration (most reliable)
      const token = getTokenByAddress(address);
      return token.symbol;
    } catch {
      // Fall back to tradablePair assets if not found in local config
      const asset = assets.find(
        (a) => a.address.toLowerCase() === address.toLowerCase(),
      );
      return asset?.symbol || `${address.slice(0, 6)}...`;
    }
  };

  // For direct swaps (single hop)
  if (path.length === 1) {
    const fromSymbol = getTokenSymbol(fromTokenAddr);
    const toSymbol = getTokenSymbol(toTokenAddr);
    return `${fromSymbol} => ${toSymbol}`;
  }

  // For multi-hop swaps, trace the path
  let currentToken = fromTokenAddr.toLowerCase();
  const route: string[] = [getTokenSymbol(currentToken)];

  for (const hop of path) {
    const [addr0, addr1] = hop.assets.map((addr) => addr.toLowerCase());

    // Determine which asset is the next token in the path
    let nextToken: string;
    if (currentToken === addr0) {
      nextToken = addr1;
    } else if (currentToken === addr1) {
      nextToken = addr0;
    } else {
      // This shouldn't happen in a valid path, but handle it gracefully
      console.warn(
        `Path discontinuity at token ${currentToken} in hop [${addr0}, ${addr1}]`,
      );
      nextToken = addr0 === currentToken ? addr1 : addr0;
    }

    route.push(getTokenSymbol(nextToken));
    currentToken = nextToken;
  }

  return route.join(" => ");
}
