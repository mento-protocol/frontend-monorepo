import { cookieToInitialState, wagmiSsrConfig } from "@repo/web3/wagmi-ssr";

const NULL_WAGMI_STATE_ERROR =
  /^Cannot read properties of null \(reading ['"]state['"]\)$/;

/**
 * A stale or truncated Wagmi cookie must not prevent the server from
 * rendering a public route. Wagmi's parser intentionally surfaces malformed
 * state, so treat it as an empty state at the request boundary.
 */
export function getWagmiInitialState(cookie: string | null) {
  try {
    return cookieToInitialState(wagmiSsrConfig, cookie);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof TypeError && NULL_WAGMI_STATE_ERROR.test(error.message))
    ) {
      return undefined;
    }
    throw error;
  }
}
