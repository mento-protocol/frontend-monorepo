import { argosScreenshot } from "@argos-ci/playwright";
import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

export type Theme = "light" | "dark";

const FROZEN_TIME = new Date("2026-01-01T00:00:00Z");

// 1x1 PNG — deterministic stand-in for remote CDN images. CommunityCard on
// /specialized-components loads NEXT_PUBLIC_STORAGE_URL assets; without this the
// baseline would depend on live storage content/availability. `object-cover`
// stretches it to fill the CSS-sized container.
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// The animejs IconLoading spinner (the only svg with viewBox="0 0 24 25", on
// /basic-components) is JS/rAF-driven; CSS animation disabling and
// prefers-reduced-motion cannot freeze it, so we mask its region. A locator
// matching nothing on the other pages is a harmless no-op.
const animatedRegions = (page: Page): Locator[] => [
  page.locator('svg[viewBox="0 0 24 25"]'),
];

// Applied before navigation — order matters (all before app scripts run).
export async function arm(page: Page, theme: Theme): Promise<void> {
  // Fix displayed time (calendar default month, any relative timestamps)
  // WITHOUT faking timers — clock.install() would stall React hydration;
  // setFixedTime only pins Date/Date.now.
  await page.clock.setFixedTime(FROZEN_TIME);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  // Stub remote CDN images so baselines don't depend on live storage content.
  await page.route(/\.public\.blob\.vercel-storage\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PLACEHOLDER_PNG,
    }),
  );
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

export async function settle(page: Page, theme: Theme): Promise<void> {
  await page.waitForLoadState("networkidle");
  // The resolved theme must be on <html> before capture (next-themes is
  // two-phase; the SidebarProvider also shifts one frame post-hydration).
  await expect(page.locator("html")).toHaveClass(
    new RegExp(`(^|\\s)${theme}(\\s|$)`),
  );
  // Vendored Inter must be ready so text never snapshots in a fallback face.
  await page.evaluate(() => document.fonts.ready);
  // Stable scrollbar gutter (Linux/Docker scrollbars shift layout vs macOS) +
  // kill animations/transitions so opened overlays (Radix dialogs/menus/
  // popovers) snap to their final state instead of being caught mid-animation.
  await page.addStyleTag({
    content:
      "html{scrollbar-gutter:stable}*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}",
  });
}

// Radix popper overlays (popover/tooltip/dropdown/select/datepicker) mount
// their content — which is when `getByRole(...).waitFor()` resolves — BEFORE
// floating-ui commits the final `transform: translate()` on the popper wrapper
// a frame or two later. Snapshotting in that window catches the panel at a
// transient position (ghosted/offset text vs a settled baseline). Animations
// are already zeroed in settle(); this closes the *positional* settle gap by
// waiting until every open overlay's box stops moving across consecutive frames.
export async function stabilizeOverlay(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const boxes = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-radix-popper-content-wrapper],[data-slot$='-content'],[role='dialog'],[role='tooltip'],[role='menu']",
        ),
      )
        .map((node) => {
          const r = node.getBoundingClientRect();
          return `${r.x},${r.y},${r.width},${r.height}`;
        })
        .join("|");
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let previous = boxes();
    // Stop once positions hold steady for two consecutive frames (cap at 30
    // frames ~0.5s so a perpetually-animating element can't hang the run).
    for (let stable = 0, i = 0; stable < 2 && i < 30; i++) {
      await frame();
      const next = boxes();
      stable = next === previous ? stable + 1 : 0;
      previous = next;
    }
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
  await argosScreenshot(page, name, { mask: animatedRegions(page) });
}

export { base as test };
