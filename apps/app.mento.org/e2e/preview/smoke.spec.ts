import { expect, test, type Page } from "@playwright/test";

// Walletless + mock-wallet smoke against a REAL deployed preview (real forno
// reads, no fork, no transactions). Run via
// `PREVIEW_URL=<url> pnpm --filter app.mento.org test:preview`. See
// docs/wallet-testing.md's "Preview smoke" section and the secretless reusable
// .github/workflows/_vercel-preview-smoke.yml. The temporary native adapter and
// GitHub-built workers both call that same target-bound implementation.

const BLOCK_SCREEN_HEADINGS = ["Access Restricted", "Verification unavailable"];
const MAXIMUM_BROWSER_FAILURES = 100;
const browserFailures = new WeakMap<Page, string[]>();

function concise(value: unknown) {
  return String(value).replaceAll(/\s+/g, " ").trim().slice(0, 500);
}

function isExpectedNextNavigationAbort(
  urlValue: string,
  resourceType: string,
  errorText: string,
  expectedOrigin: string,
) {
  try {
    const url = new URL(urlValue);
    return (
      url.origin === expectedOrigin &&
      url.searchParams.has("_rsc") &&
      errorText === "net::ERR_ABORTED" &&
      (resourceType === "fetch" || resourceType === "xhr")
    );
  } catch {
    return false;
  }
}

function attachBrowserFailureMonitor(page: Page, expectedOrigin: string) {
  const failures: string[] = [];
  browserFailures.set(page, failures);
  const record = (failure: string) => {
    if (failures.length < MAXIMUM_BROWSER_FAILURES) failures.push(failure);
  };
  const sameOrigin = (value: string) => {
    try {
      return new URL(value).origin === expectedOrigin;
    } catch {
      return false;
    }
  };

  page.on("pageerror", (error) => {
    record(`page error: ${concise(error.message)}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      record(`console error: ${concise(message.text())}`);
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown error";
    if (
      !sameOrigin(request.url()) ||
      isExpectedNextNavigationAbort(
        request.url(),
        request.resourceType(),
        errorText,
        expectedOrigin,
      )
    ) {
      return;
    }
    record(
      `same-origin request failed: ${request.method()} ${concise(request.url())} (${concise(errorText)})`,
    );
  });
  page.on("response", (response) => {
    if (sameOrigin(response.url()) && response.status() >= 400) {
      record(
        `same-origin response failed: HTTP ${response.status()} ${concise(response.url())}`,
      );
    }
  });
}

// Preflight: playwright.preview.config.ts deliberately does NOT validate
// PREVIEW_URL at config-load time (that would break knip's static config
// introspection) — fail fast here instead, same convention as the anvil
// preflight in e2e/connected/swap.spec.ts.
test.beforeAll(() => {
  if (!process.env.PREVIEW_URL) {
    throw new Error(
      "PREVIEW_URL env var is required — e.g. PREVIEW_URL=https://appmento-<hash>-mentolabs.vercel.app pnpm --filter app.mento.org test:preview",
    );
  }
});

test.beforeEach(({ page }) => {
  attachBrowserFailureMonitor(
    page,
    new URL(process.env.PREVIEW_URL as string).origin,
  );
});

test.afterEach(async ({ page }) => {
  // Capture failures emitted by hydration or wallet state updates immediately
  // after the final visible assertion, not only during initial page load.
  await page.waitForTimeout(250);
  const failures = browserFailures.get(page) ?? [];
  expect(failures, `Preview browser failures:\n${failures.join("\n")}`).toEqual(
    [],
  );
});

test("deployed bundle boots and lists real wallets", async ({ page }) => {
  await page.goto("/");

  // The header renders both a mobile (`md:hidden`) and a desktop
  // (`md:block hidden`) ConnectButton simultaneously (see
  // packages/web3/src/components/connect-button.tsx: text="Connect" on
  // mobile, default "Connect Wallet" on desktop) — filter to the one
  // actually visible at this project's 1280x900 viewport, same technique as
  // e2e/connected/swap.spec.ts uses for the connected address. Scoped to the
  // header landmark: the disconnected swap form ALSO renders its own inline
  // ConnectButton (text="Connect", swap-submit-button.tsx), which is not
  // viewport-gated and would otherwise make this locator ambiguous.
  const connectButton = page
    .getByRole("banner")
    .getByRole("button", { name: "Connect" })
    .filter({ visible: true });
  await expect(connectButton).toBeVisible({ timeout: 20_000 });
  await connectButton.click();

  // No E2E flags are set on this run, so the real RainbowKit wallet list
  // renders (packages/web3/src/config/wagmi.ts) instead of the mock connector.
  await expect(page.getByText("MetaMask")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("WalletConnect")).toBeVisible();
  await expect(page.getByText("E2E Test Wallet")).toHaveCount(0);
});

test("mock wallet connects on a preview host", async ({ page }) => {
  // Deliberately do NOT set mento_use_fork — this must hit real forno reads,
  // not a local anvil fork. mento_e2e_eager_connect is still set (documented
  // activation flag, harmless here) but this spec does NOT rely on it to
  // actually establish the connection — see the click below for why.
  await page.addInitScript(() => {
    window.localStorage.setItem("mento_e2e_wallet", "true");
    window.localStorage.setItem("mento_e2e_eager_connect", "true");
  });

  await page.goto("/");

  // Explicit click rather than relying on eager auto-reconnect: wagmi's
  // reconnect-on-mount calls the mock connector's isAuthorized(), which
  // calls getAccounts() -> an `eth_accounts` RPC request. The mock connector
  // only special-cases `eth_requestAccounts` (used by connect()), so
  // `eth_accounts` falls through to a REAL RPC call — and public nodes
  // (forno included; verified directly) return `[]` for `eth_accounts` (no
  // unlocked accounts), so isAuthorized() is always false off of anvil.
  // Eager-connect only works paired with mento_use_fork (anvil DOES answer
  // eth_accounts) — exactly why e2e/fixtures.ts always sets both together.
  // Since this spec must stay off the fork, connect explicitly instead.
  await page
    .getByRole("banner")
    .getByRole("button", { name: "Connect" })
    .filter({ visible: true })
    .click();
  await page.getByText("E2E Test Wallet").click();

  // Short address for anvil junk account 0
  // (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266) — dual mobile/desktop header
  // copies again, filter to the visible one.
  await expect(
    page.getByText("0xf39F...2266").filter({ visible: true }),
  ).toBeVisible({ timeout: 20_000 });

  // The preview env has CHAINALYSIS_API_KEY configured and the junk address
  // is not sanctioned — if this block screen appears, that's a genuine smoke
  // failure (sanctions-guard.tsx), not a flake.
  for (const heading of BLOCK_SCREEN_HEADINGS) {
    await expect(page.getByText(heading)).toHaveCount(0);
  }
});
