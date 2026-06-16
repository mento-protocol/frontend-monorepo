import { snapshotPage, test, type Theme } from "./fixtures";

// These 6 data-free showcase pages mount the @repo/ui components in their
// default (closed/resting) states. A logic-only PR must leave all of these
// screenshots unchanged; any @repo/ui or markup change to a covered component
// surfaces as a reviewable Argos diff. Coverage is not exhaustive: some
// exported components are not mounted here, and overlay/open states (dialog,
// popover, tooltip, dropdown, select) render only behind closed triggers.
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
