/**
 * Regression tests for the SwapPageContent confirm-view / chain-navigation crash.
 *
 * Previously, the SwapForm wrapper used `display: contents` which caused React to
 * hit a DOM removeChild invariant when the component was hidden during a route
 * transition while confirm view was active. The fix keeps SwapForm always mounted
 * but hidden via Tailwind's `hidden` class (`display: none`).
 *
 * These tests cover the exact navigation path that previously crashed:
 *   1. User opens confirm view.
 *   2. User navigates to a different [chain] swap route.
 *   3. Assert: no error thrown AND confirmView atom is reset to false.
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
type ChainId = number; // runtime type; the real branded type lives in @repo/web3

function renderWithStore(
  store: ReturnType<typeof createStore>,
  chainId: ChainId,
) {
  return (
    <Provider store={store}>
      {/* Cast is safe: ChainId is structurally a number */}
      <SwapPageContent chainId={chainId as unknown as never} />
    </Provider>
  );
}

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

    const { rerender } = render(renderWithStore(store, 42220));
    expect(store.get(confirmViewAtom)).toBe(true);

    // Navigate to the alfajores chain – this is the route change that previously crashed.
    await act(async () => {
      rerender(renderWithStore(store, 44787));
    });

    expect(store.get(confirmViewAtom)).toBe(false);
  });

  it("does not throw during chain navigation while confirm view is active", async () => {
    store.set(confirmViewAtom, true);

    const { rerender } = render(renderWithStore(store, 42220));

    await act(async () => {
      rerender(renderWithStore(store, 44787));
    });
  });

  it("keeps SwapForm mounted in the DOM while confirm view is active", () => {
    // The fix: the SwapForm wrapper uses `hidden` (display: none) rather than
    // conditional rendering. The element must remain in the DOM to prevent the
    // removeChild invariant violation when React reconciles during a transition.
    store.set(confirmViewAtom, true);

    const { getByTestId } = render(renderWithStore(store, 42220));

    const swapForm = getByTestId("swap-form");
    expect(swapForm).toBeDefined();

    // The wrapper div should carry the `hidden` class (not be unmounted).
    // Changing this to conditional rendering is what caused the crash.
    const wrapper = swapForm.parentElement;
    expect(wrapper?.className).toContain("hidden");
  });

  it("does not reset confirmView when chainId stays the same", () => {
    store.set(confirmViewAtom, true);

    const { rerender } = render(renderWithStore(store, 42220));

    // Re-render with the same chainId (e.g. query-param change, not chain change).
    rerender(renderWithStore(store, 42220));

    expect(store.get(confirmViewAtom)).toBe(true);
  });
});
