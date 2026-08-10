import { expect } from "@playwright/test";

import { snapshotPage, test, type Theme } from "./fixtures";

// These 6 data-free showcase pages mount the @mento-protocol/ui components in their
// default (closed/resting) states. A logic-only PR must leave all of these
// screenshots unchanged; any @mento-protocol/ui or markup change to a covered component
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

test("form components hydrates with a clock different from its build", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.clock.setFixedTime(new Date("2040-02-15T12:00:00.000Z"));
  await page.goto("/form-components", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await expect(
    page.getByRole("heading", { name: "Form Components", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("January 2026", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
