import type { Page } from "@playwright/test";

import { snapshotPage, test, type Theme } from "./fixtures";

// The bridge form is the Wormhole widget, dynamically imported (ssr:false) with
// a loading-dot fallback. It mounts client-side after `networkidle` (its blocked
// external calls abort instantly), so wait for its disconnected "Connect source
// wallet" CTA to render — otherwise the snapshot races the skeleton vs the form.
const waitForBridgeWidget = async (page: Page): Promise<void> => {
  await page
    .locator(".bridge-widget")
    .getByText(/connect source wallet/i)
    .first()
    .waitFor();
};

// Disconnected (no-wallet) default states — live data fetching is gated on a
// connected account, so these shells are deterministic with the network blocked.
const PAGES: {
  url: string;
  name: string;
  ready?: (page: Page) => Promise<void>;
}[] = [
  { url: "/swap/celo", name: "swap-celo" },
  { url: "/borrow/open", name: "borrow-open" },
  { url: "/earn", name: "earn" },
  { url: "/pools", name: "pools" },
  { url: "/bridge", name: "bridge", ready: waitForBridgeWidget },
];

const THEMES: Theme[] = ["dark", "light"];

for (const { url, name, ready } of PAGES) {
  for (const theme of THEMES) {
    test(`${name} disconnected (${theme})`, async ({ page }, testInfo) => {
      await snapshotPage(
        page,
        url,
        `${name}-disconnected-${theme}-${testInfo.project.name}`,
        theme,
        ready,
      );
    });
  }
}
