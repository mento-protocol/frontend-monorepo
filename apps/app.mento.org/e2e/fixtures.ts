import { argosScreenshot } from "@argos-ci/playwright";
import { expect, test as base, type Page } from "@playwright/test";

export type Theme = "light" | "dark";

const FROZEN_TIME = new Date("2026-01-01T00:00:00Z");

const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// The whole point of the disconnected-shell approach: no wallet, no live data.
// Block every external request so a logic-only PR can't flake on RPC / subgraph
// / Merkl / Sentry / analytics / WalletConnect. Same-origin assets pass through;
// the storage CDN returns a fixed placeholder.
async function blockNetwork(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).host;
    if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
      return route.continue();
    }
    if (host.endsWith("public.blob.vercel-storage.com")) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PLACEHOLDER_PNG,
      });
    }
    return route.abort();
  });
}

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
): Promise<void> {
  await arm(page, theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await settle(page, theme);
  await argosScreenshot(page, name);
}

export { base as test };
