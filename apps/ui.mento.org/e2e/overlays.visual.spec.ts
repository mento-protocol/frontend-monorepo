import { argosScreenshot } from "@argos-ci/playwright";
import { type Page } from "@playwright/test";

import { arm, settle, test, type Theme } from "./fixtures";

// Overlay/open states render only after interaction and live in portals, so the
// full-page showcase snapshots never capture them. Open each one, then snapshot
// — a visual change to these panels would otherwise produce no Argos diff.
type Overlay = {
  name: string;
  url: string;
  open: (page: Page) => Promise<void>;
};

const OVERLAYS: Overlay[] = [
  {
    name: "dialog",
    url: "/interactive-components",
    open: async (page) => {
      await page.getByRole("button", { name: "Open Dialog" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "popover",
    url: "/interactive-components",
    open: async (page) => {
      await page.getByRole("button", { name: "Open Popover" }).click();
      await page.getByRole("heading", { name: "Popover Content" }).waitFor();
    },
  },
  {
    name: "tooltip",
    url: "/interactive-components",
    open: async (page) => {
      await page.getByRole("button", { name: "Hover me" }).hover();
      await page.getByRole("tooltip").waitFor();
    },
  },
  {
    name: "dropdown-menu",
    url: "/interactive-components",
    open: async (page) => {
      await page.getByRole("button", { name: "Open Menu" }).click();
      await page.getByRole("menu").waitFor();
    },
  },
  {
    name: "select",
    url: "/form-components",
    open: async (page) => {
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Option 1" }).waitFor();
    },
  },
];

const THEMES: Theme[] = ["light", "dark"];

for (const overlay of OVERLAYS) {
  for (const theme of THEMES) {
    test(`${overlay.name} open (${theme})`, async ({ page }, testInfo) => {
      await arm(page, theme);
      await page.goto(overlay.url, { waitUntil: "domcontentloaded" });
      await settle(page, theme);
      await overlay.open(page);
      await argosScreenshot(
        page,
        `overlay-${overlay.name}-${theme}-${testInfo.project.name}`,
      );
    });
  }
}
