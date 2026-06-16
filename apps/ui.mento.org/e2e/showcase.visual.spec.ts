import { snapshotPage, test, type Theme } from "./fixtures";

// Every @repo/ui component is mounted across these 6 data-free showcase pages.
// A logic-only PR must leave all of these screenshots unchanged; any @repo/ui
// or markup change surfaces as a reviewable Argos diff.
const PAGES = [
  { url: "/basic-components", name: "basic-components" },
  { url: "/form-components", name: "form-components" },
  { url: "/interactive-components", name: "interactive-components" },
  { url: "/layout-components", name: "layout-components" },
  { url: "/navigation-components", name: "navigation-components" },
  { url: "/specialized-components", name: "specialized-components" },
];

const THEMES: Theme[] = ["light", "dark"];

for (const { url, name } of PAGES) {
  for (const theme of THEMES) {
    test(`${name} (${theme})`, async ({ page }, testInfo) => {
      await snapshotPage(
        page,
        url,
        `${name}-${theme}-${testInfo.project.name}`,
        theme,
      );
    });
  }
}
