import type { Page } from "@playwright/test";

import { snapshotPage, test, type Theme } from "./fixtures";

// The bridge shows a connect prompt until a wallet is connected in the app, so
// a disconnected visitor never mounts the Wormhole widget. Wait for the prompt's
// heading so the snapshot is deterministic.
const waitForBridgeConnectState = async (page: Page): Promise<void> => {
  await page
    .getByRole("heading", { name: /connect your wallet to bridge/i })
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
  { url: "/bridge", name: "bridge", ready: waitForBridgeConnectState },
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
