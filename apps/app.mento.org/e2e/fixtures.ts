import { argosScreenshot } from "@argos-ci/playwright";
import { expect, test as base, type Page } from "@playwright/test";

export type Theme = "light" | "dark";

const FROZEN_TIME = new Date("2026-01-01T00:00:00Z");

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Leading dot so only real subdomains of the storage host match
// (`x.public.blob.vercel-storage.com`), not `evilpublic.blob...`.
const isCdnHost = (h: string): boolean =>
  h.endsWith(".public.blob.vercel-storage.com");
const placeholder = () =>
  ({ status: 200, contentType: "image/png", body: PLACEHOLDER_PNG }) as const;

// The whole point of the disconnected-shell approach: no wallet, no live data.
// Block every external request so a logic-only PR can't flake on RPC / subgraph
// / Merkl / Sentry / analytics / WalletConnect. Same-origin assets pass through;
// the storage CDN returns a fixed placeholder.
async function blockNetwork(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const { hostname, pathname } = url;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      // Same-origin Next.js API routes (e.g. /api/merkl) proxy to live external
      // services SERVER-side, which page.route can't intercept — block them so
      // the shell renders its deterministic empty/default state.
      if (pathname.startsWith("/api/")) {
        return route.abort();
      }
      // next/image proxies remote images through /_next/image (a SERVER-side
      // fetch of the CDN), so stub the CDN-backed ones — otherwise the baseline
      // depends on live CDN content. Local images optimize deterministically.
      if (pathname === "/_next/image") {
        const target = url.searchParams.get("url") ?? "";
        const targetHost = URL.canParse(target) ? new URL(target).hostname : "";
        if (isCdnHost(targetHost)) {
          return route.fulfill(placeholder());
        }
      }
      return route.continue();
    }
    if (isCdnHost(hostname)) {
      return route.fulfill(placeholder());
    }
    return route.abort();
  });
}

// Connected-wallet specs need real backend behavior (RPC calls, tx-receipt
// polling, react-query retries) so they can't freeze time or block localhost.
// Modeled on blockNetwork above (same CDN-placeholder + localhost passthrough
// logic), with one addition: fulfill /api/sanctions with the route's clean-check
// success shape (see app/api/sanctions/route.ts + app/hooks/use-sanctions-check.ts)
// so the sanctions gate doesn't fail closed without a CHAINALYSIS_API_KEY.
async function connectedNetworkPolicy(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const { hostname, pathname } = url;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      // Fulfill the sanctions check before the generic /api/* abort below —
      // Playwright uses the most recently registered matching handler, so this
      // branch must run first, not as a second competing page.route() call.
      if (pathname.startsWith("/api/sanctions")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ isSanctioned: false }),
        });
      }
      if (pathname.startsWith("/api/")) {
        return route.abort();
      }
      if (pathname === "/_next/image") {
        const target = url.searchParams.get("url") ?? "";
        const targetHost = URL.canParse(target) ? new URL(target).hostname : "";
        if (isCdnHost(targetHost)) {
          return route.fulfill(placeholder());
        }
      }
      // Anvil's RPC (127.0.0.1:8545, path "/") and the mock connector's
      // forwarded eth_sendTransaction calls pass through here unaffected.
      return route.continue();
    }
    if (isCdnHost(hostname)) {
      return route.fulfill(placeholder());
    }
    return route.abort();
  });
}

export const connectedTest = base.extend<{ page: Page }>({
  // Playwright's fixture-provider callback's 2nd param is conventionally named
  // `use`, but that collides with React's built-in `use` hook and trips
  // eslint-plugin-react-hooks's rules-of-hooks on this non-component
  // function — renamed to `runTest` to avoid the false positive.
  page: async ({ page }, runTest) => {
    await connectedNetworkPolicy(page);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("mento_e2e_wallet", "true");
        window.localStorage.setItem("mento_e2e_eager_connect", "true");
        window.localStorage.setItem("mento_use_fork", "true");
      } catch {
        /* localStorage may be unavailable before navigation */
      }
    });
    await runTest(page);
  },
});

// Monad sibling of connectedTest, deliberately WITHOUT mento_use_fork. That
// flag only redirects the pre-switch Celo chain (chains[0], where the mock
// wallet joins before the test switches to Monad) to localhost:8545 — a port
// with no anvil in the Monad-only CI job, producing connection-refused churn.
// Monad's own RPC routing (getMonadRpcUrl() in packages/web3 chains.ts) reads
// NEXT_PUBLIC_MONAD_RPC_URL directly and is never gated on mento_use_fork, so
// the Monad spec doesn't need it: pre-switch Celo reads fall through to forno
// and are aborted by connectedNetworkPolicy's non-localhost route.abort()
// branch, and the mock wallet + eager-connect still work since they key off
// mento_e2e_wallet/mento_e2e_eager_connect, not this flag.
export const connectedMonadTest = base.extend<{ page: Page }>({
  page: async ({ page }, runTest) => {
    await connectedNetworkPolicy(page);
    // wagmi's `reconnect()` (what makes the mock wallet appear already
    // connected on load, instead of requiring a manual click) calls the
    // connector's isAuthorized() -> getAccounts(), which issues a REAL
    // `eth_accounts` JSON-RPC call against chains[0] (Celo) — the one method
    // wagmi's mock() connector does NOT synthesize locally (unlike
    // eth_chainId/eth_requestAccounts/wallet_switchEthereumChain, which it
    // answers in-process). With no mento_use_fork redirect that request goes
    // to real Celo infra, where connectedNetworkPolicy's non-localhost
    // route.abort() above turns it into a hard network failure. wagmi's
    // reconnect() has no try/catch around that call, so the failure escapes
    // as an unhandled rejection and the wallet is left stuck disconnected.
    // Registered AFTER connectedNetworkPolicy so it runs FIRST (Playwright:
    // "the most recently registered route takes precedence") and stubs just
    // this one method before the abort branch ever sees it; everything else
    // falls through unchanged via route.fallback().
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const hostname = new URL(request.url()).hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return route.fallback();
      }
      let body: unknown;
      try {
        body = request.postDataJSON();
      } catch {
        return route.fallback();
      }
      if (
        !body ||
        typeof body !== "object" ||
        (body as { method?: unknown }).method !== "eth_accounts"
      ) {
        return route.fallback();
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: (body as { id?: number }).id ?? 1,
          result: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
        }),
      });
    });
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("mento_e2e_wallet", "true");
        window.localStorage.setItem("mento_e2e_eager_connect", "true");
      } catch {
        /* localStorage may be unavailable before navigation */
      }
    });
    await runTest(page);
  },
});

async function arm(page: Page, theme: Theme): Promise<void> {
  await blockNetwork(page);
  await page.clock.setFixedTime(FROZEN_TIME);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((selectedTheme) => {
    try {
      window.localStorage.setItem("theme", selectedTheme);
    } catch {
      /* localStorage may be unavailable before navigation */
    }
    let seed = 0x2545f491;
    Math.random = () => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }, theme);
}

async function settle(page: Page, theme: Theme): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveClass(
    new RegExp(`(^|\\s)${theme}(\\s|$)`),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content:
      "html{scrollbar-gutter:stable}*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}",
  });
}

export async function snapshotPage(
  page: Page,
  url: string,
  name: string,
  theme: Theme,
  // Pages with async client-mounted content (e.g. the bridge's dynamically
  // imported Wormhole widget) must wait for it to render before capture —
  // networkidle returns early because the widget's external calls are blocked,
  // so the snapshot otherwise races the mount (loading skeleton vs full form).
  ready?: (page: Page) => Promise<void>,
): Promise<void> {
  await arm(page, theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle(page, theme);
  if (ready) {
    await ready(page);
    // The just-mounted content may pull its own webfonts/icons in.
    await page.evaluate(() => document.fonts.ready);
  }
  await argosScreenshot(page, name);
}

export { base as test };
