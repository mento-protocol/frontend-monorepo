import { snapshotPage, test, type Theme } from "./fixtures";

// Disconnected (no-wallet) default states — live data fetching is gated on a
// connected account, so these shells are deterministic with the network blocked.
const PAGES = [
  { url: "/swap/celo", name: "swap-celo" },
  { url: "/borrow/open", name: "borrow-open" },
  { url: "/earn", name: "earn" },
  { url: "/pools", name: "pools" },
  { url: "/bridge", name: "bridge" },
];

const THEMES: Theme[] = ["dark", "light"];

for (const { url, name } of PAGES) {
  for (const theme of THEMES) {
    test(`${name} disconnected (${theme})`, async ({ page }, testInfo) => {
      await snapshotPage(
        page,
        url,
        `${name}-disconnected-${theme}-${testInfo.project.name}`,
        theme,
      );
    });
  }
}
