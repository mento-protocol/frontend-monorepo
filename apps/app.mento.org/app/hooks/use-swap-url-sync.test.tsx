// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/swap/celo",
  query: new URLSearchParams(),
  replace: vi.fn(),
  routeChain: 42220,
  slug: "celo" as string | undefined,
  testnetMode: false,
  walletChainId: 42220,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.query,
}));

vi.mock("@repo/web3", () => ({
  ChainId: { Celo: 42220 },
  chainIdToSlug: () => mocks.slug,
  getPreferredVisibleChain: () => mocks.routeChain,
  useTestnetMode: () => [mocks.testnetMode],
}));

vi.mock("@repo/web3/wagmi", () => ({
  useChainId: () => mocks.walletChainId,
}));

import { useSwapUrlSync } from "./use-swap-url-sync";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  Object.assign(mocks, {
    pathname: "/swap/celo",
    query: new URLSearchParams(),
    routeChain: 42220,
    slug: "celo",
    testnetMode: false,
    walletChainId: 42220,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useSwapUrlSync", () => {
  it("ignores routes and empty form state outside swap pages", () => {
    mocks.pathname = "/pools";
    const { rerender } = renderHook(
      (props: {
        amount?: string;
        tokenInSymbol?: string;
        tokenOutSymbol?: string;
      }) => useSwapUrlSync({ ...props, urlChainId: 42220 }),
      { initialProps: {} },
    );
    rerender({ amount: "1", tokenInSymbol: "CELO", tokenOutSymbol: "USDm" });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("preserves an empty or matching incoming URL on initialization", () => {
    const { unmount } = renderHook(() =>
      useSwapUrlSync({
        amount: "",
        tokenInSymbol: "",
        tokenOutSymbol: "",
        urlChainId: 42220,
      }),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    unmount();

    mocks.query = new URLSearchParams("from=CELO&to=USDm&amount=2");
    renderHook(() =>
      useSwapUrlSync({
        amount: "2",
        tokenInSymbol: "CELO",
        tokenOutSymbol: "USDm",
        urlChainId: 42220,
      }),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("replaces a mismatched incoming query and uses the fallback slug", () => {
    mocks.query = new URLSearchParams("from=EURm");
    mocks.slug = undefined;
    renderHook(() =>
      useSwapUrlSync({
        amount: "0",
        tokenInSymbol: "CELO",
        tokenOutSymbol: "",
        urlChainId: 42220,
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/swap/celo?from=CELO");
  });

  it("updates token changes immediately and debounces amount changes", () => {
    const { rerender, unmount } = renderHook(
      (props: {
        amount: string;
        tokenInSymbol: string;
        tokenOutSymbol: string;
      }) => useSwapUrlSync({ ...props, urlChainId: 42220 }),
      {
        initialProps: {
          amount: "1",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "USDm",
        },
      },
    );
    rerender({ amount: "1", tokenInSymbol: "EURm", tokenOutSymbol: "USDm" });
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/swap/celo?from=EURm&to=USDm&amount=1",
    );

    rerender({ amount: "2", tokenInSymbol: "EURm", tokenOutSymbol: "USDm" });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    rerender({ amount: "3", tokenInSymbol: "EURm", tokenOutSymbol: "USDm" });
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/swap/celo?from=EURm&to=USDm&amount=3",
    );

    rerender({ amount: "3", tokenInSymbol: "EURm", tokenOutSymbol: "USDm" });
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("navigates only after an active wallet chain change", () => {
    const { rerender } = renderHook(
      (props: {
        amount: string;
        tokenInSymbol: string;
        tokenOutSymbol: string;
      }) => useSwapUrlSync({ ...props, urlChainId: 42220 }),
      {
        initialProps: {
          amount: "1",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "USDm",
        },
      },
    );
    expect(mocks.replace).not.toHaveBeenCalled();

    mocks.walletChainId = 143;
    mocks.slug = "monad";
    rerender({ amount: "1", tokenInSymbol: "CELO", tokenOutSymbol: "USDm" });
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/swap/monad?from=CELO&to=USDm&amount=1",
    );

    mocks.walletChainId = 11142220;
    mocks.slug = undefined;
    rerender({ amount: "", tokenInSymbol: "", tokenOutSymbol: "" });
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    expect(mocks.replace).toHaveBeenLastCalledWith("/swap/celo");
  });

  it("builds a chain-change URL without zero amount or empty token params", () => {
    const { rerender } = renderHook(() =>
      useSwapUrlSync({
        amount: "0",
        tokenInSymbol: "",
        tokenOutSymbol: "",
        urlChainId: 42220,
      }),
    );
    mocks.walletChainId = 143;
    mocks.slug = "monad";
    rerender();
    expect(mocks.replace).toHaveBeenCalledWith("/swap/monad");
  });
});
