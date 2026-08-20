import {
  cookieToInitialState,
  deserialize,
  wagmiSsrConfig,
} from "@repo/web3/wagmi-ssr";

function getWagmiCookiePayload(cookie: string | null): string | undefined {
  const storageKey = wagmiSsrConfig.storage?.key;
  if (!storageKey || !cookie) return undefined;

  const cookieName = `${storageKey}.store=`;
  const cookieEntry = cookie
    .split("; ")
    .find((part) => part.startsWith(cookieName));

  return cookieEntry?.slice(cookieName.length);
}

/**
 * A stale or truncated Wagmi cookie must not prevent the server from
 * rendering a public route. Wagmi's parser intentionally surfaces malformed
 * state, so treat it as an empty state at the request boundary.
 */
export function getWagmiInitialState(cookie: string | null) {
  const payload = getWagmiCookiePayload(cookie);
  if (payload !== undefined) {
    try {
      const parsedPayload = deserialize(payload);
      if (
        parsedPayload === null ||
        typeof parsedPayload !== "object" ||
        !("state" in parsedPayload) ||
        parsedPayload.state === null ||
        typeof parsedPayload.state !== "object"
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }

  return cookieToInitialState(wagmiSsrConfig, cookie);
}
