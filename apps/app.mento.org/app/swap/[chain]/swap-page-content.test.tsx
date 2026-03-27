/**
 * Regression tests for the SwapPageContent confirm-view / chain-navigation crash.
 *
 * Root cause: the SwapForm wrapper previously toggled between Tailwind's
 * `contents` class (display: contents) and `hidden` (display: none). In the
 * browser, display:contents removes the element from the layout tree in a way
 * that conflicts with React's internal DOM bookkeeping during a Next.js route
 * transition, producing a removeChild invariant violation.
 *
 * The fix: the wrapper is always a plain flex container; only `hidden` is
 * applied when confirm view is active. The `contents` class is never used.
 *
 * JSDOM does not reproduce the browser DOM behaviour behind the crash, so tests
 * here focus on the class-name invariants that distinguish the fixed
 * implementation from the broken one:
 *   - wrapper NEVER has class `contents` (display:contents was the crash cause)
 *   - wrapper has `hidden` only while confirmView is true
 *   - confirmView resets to false on chain navigation
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { createStore, Provider } from "jotai";

// ---------------------------------------------------------------------------
// Module mocks – must be declared before the component import so that vitest
// hoisting places them at the correct scope.
// ---------------------------------------------------------------------------

// Replace @repo/web3 with plain jotai atoms so the test has no wagmi/rainbow-kit
// dependencies to set up. The mock factory runs once; both the test and the
// component receive the SAME atom instances.
vi.mock("@repo/web3", async () => {
  const { atom } = await import("jotai");
  return {
    confirmViewAtom: atom<boolean>(false),
    formValuesAtom: atom<null>(null),
  };
});

// Stub child components that carry heavy wagmi / rainbow-kit dependencies.
vi.mock("@/components/swap/swap-settings-popover", () => ({
  SwapSettingsPopover: () => null,
}));

vi.mock("@/components/swap/swap-confirm", () => ({
  SwapConfirm: () => null,
}));

// SwapForm is rendered inside the element whose visibility we test; give it a
// stable data-testid so the test can locate it without coupling to CSS classes.
vi.mock("@/components/swap/swap-form", () => ({
  default: () => React.createElement("div", { "data-testid": "swap-form" }),
}));

vi.mock("@/components/shared/chain-mismatch-banner", () => ({
  ChainMismatchBanner: () => null,
}));

// Lightweight replacements for @repo/ui primitives.
vi.mock("@repo/ui", () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => React.createElement("button", { onClick, ...rest }, children),
  cn: (...classes: unknown[]) =>
    classes.filter((c) => typeof c === "string" && c).join(" "),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are registered
// ---------------------------------------------------------------------------
import { confirmViewAtom } from "@repo/web3";
import { SwapPageContent } from "./swap-page-content";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Derive the exact ChainId type from the component props rather than casting
// to `never`. This keeps the helper type-correct without needing to import the
// enum through the mocked @repo/web3 module.
type TestChainId = Parameters<typeof SwapPageContent>[0]["chainId"];

function renderWithStore(
  store: ReturnType<typeof createStore>,
  chainId: TestChainId,
) {
  return (
    <Provider store={store}>
      <SwapPageContent chainId={chainId} />
    </Provider>
  );
}

// Real ChainId enum values, mirrored as constants so call-sites stay readable.
const CELO = 42220 as TestChainId;
const CELO_SEPOLIA = 11142220 as TestChainId;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SwapPageContent – confirm-view navigation regression", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("resets confirmView to false when chainId prop changes while confirm is active", async () => {
    // Simulate user entering confirm view on the celo chain.
    store.set(confirmViewAtom, true);

    const { rerender } = render(renderWithStore(store, CELO));
    expect(store.get(confirmViewAtom)).toBe(true);

    // Navigate to celo sepolia – this is the route change that previously crashed.
    await act(async () => {
      rerender(renderWithStore(store, CELO_SEPOLIA));
    });

    expect(store.get(confirmViewAtom)).toBe(false);
  });

  it("SwapForm wrapper never carries the display:contents class in normal view", () => {
    // THIS is the class-level invariant that distinguishes fixed from broken.
    // The pre-fix implementation applied `contents` (display:contents) to the
    // wrapper when confirmView was false, e.g.:
    //   cn("flex flex-1 flex-col", confirmView ? "hidden" : "contents")
    // That `contents` class caused the removeChild crash during navigation.
    // This test fails on that implementation and passes only on the fix.
    const { getByTestId } = render(renderWithStore(store, CELO));

    expect(getByTestId("swap-form").parentElement?.className).not.toContain(
      "contents",
    );
  });

  it("SwapForm wrapper has no display:contents class after navigating from confirm view", async () => {
    // After chain navigation confirmView resets to false, and the wrapper must
    // be a plain flex container — not display:contents. The pre-fix toggle
    // `confirmView ? "hidden" : "contents"` would put `contents` here, which is
    // exactly the state that crashed the browser. This test catches that reversion.
    store.set(confirmViewAtom, true);

    const { getByTestId, rerender } = render(renderWithStore(store, CELO));

    // Confirm view: wrapper is hidden, never contents.
    const wrapperInConfirm = getByTestId("swap-form").parentElement;
    expect(wrapperInConfirm?.className).toContain("hidden");
    expect(wrapperInConfirm?.className).not.toContain("contents");

    // Navigate to a different chain.
    await act(async () => {
      rerender(renderWithStore(store, CELO_SEPOLIA));
    });

    // Post-navigation: confirmView is false, wrapper must be flex — not contents.
    const wrapperAfterNav = getByTestId("swap-form").parentElement;
    expect(wrapperAfterNav?.className).not.toContain("contents");
    expect(wrapperAfterNav?.className).not.toContain("hidden");
  });

  it("does not reset confirmView when chainId stays the same", () => {
    store.set(confirmViewAtom, true);

    const { rerender } = render(renderWithStore(store, CELO));

    // Re-render with the same chainId (e.g. query-param change, not chain change).
    rerender(renderWithStore(store, CELO));

    expect(store.get(confirmViewAtom)).toBe(true);
  });
});
