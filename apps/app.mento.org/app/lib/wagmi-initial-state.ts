import { cookieToInitialState, wagmiSsrConfig } from "@repo/web3/wagmi-ssr";

/**
 * A stale or truncated Wagmi cookie must not prevent the server from
 * rendering a public route. Wagmi's parser intentionally surfaces malformed
 * state, so treat it as an empty state at the request boundary.
 */
export function getWagmiInitialState(cookie: string | null) {
  try {
    return cookieToInitialState(wagmiSsrConfig, cookie);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
