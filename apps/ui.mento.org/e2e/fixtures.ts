import { argosScreenshot } from "@argos-ci/playwright";
import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

export type Theme = "light" | "dark";

const FROZEN_TIME = new Date("2026-01-01T00:00:00Z");

// The animejs IconLoading spinner (the only svg with viewBox="0 0 24 25", on
// /basic-components) is JS/rAF-driven; CSS animation disabling and
// prefers-reduced-motion cannot freeze it, so we mask its region. A locator
// matching nothing on the other pages is a harmless no-op.
const animatedRegions = (page: Page): Locator[] => [
  page.locator('svg[viewBox="0 0 24 25"]'),
];

// Applied before navigation — order matters (all before app scripts run).
async function arm(page: Page, theme: Theme): Promise<void> {
  // Fix displayed time (calendar default month, any relative timestamps)
  // WITHOUT faking timers — clock.install() would stall React hydration;
  // setFixedTime only pins Date/Date.now.
  await page.clock.setFixedTime(FROZEN_TIME);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((selectedTheme) => {
    try {
      window.localStorage.setItem("theme", selectedTheme);
    } catch {
      /* localStorage may be unavailable before navigation */
    }
    // Deterministic client-side randomness (SSR-computed random is unaffected;
    // none in the showcase today).
    let seed = 0x2545f491;
    Math.random = () => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }, theme);
}

async function settle(page: Page, theme: Theme): Promise<void> {
  await page.waitForLoadState("networkidle");
  // The resolved theme must be on <html> before capture (next-themes is
  // two-phase; the SidebarProvider also shifts one frame post-hydration).
  await expect(page.locator("html")).toHaveClass(
    new RegExp(`(^|\\s)${theme}(\\s|$)`),
  );
  // Vendored Inter must be ready so text never snapshots in a fallback face.
  await page.evaluate(() => document.fonts.ready);
  // Stable scrollbar gutter — Linux/Docker scrollbars shift layout vs macOS.
  await page.addStyleTag({ content: "html{scrollbar-gutter:stable}" });
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
  await argosScreenshot(page, name, { mask: animatedRegions(page) });
}

export { base as test };
