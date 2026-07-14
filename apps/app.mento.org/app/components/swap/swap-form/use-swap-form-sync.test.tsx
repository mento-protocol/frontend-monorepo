import { renderHook } from "@testing-library/react";
import type { ChainId, SwapFormValues } from "@repo/web3";
import type { UseFormReturn } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RouteDrivenFormState } from "./route-driven-state";
import type { FormValues } from "./types";

const web3Mocks = vi.hoisted(() => ({
  getPreferredUsdQuoteTokenSymbol: vi.fn(() => "USDm"),
  getTokenOptionsByChainId: vi.fn(() => ["CELO", "USDm"]),
}));
const syncPlanMocks = vi.hoisted(() => ({
  getChainChangeSyncPlan: vi.fn(),
  getRouteDrivenFormStateSyncPlan: vi.fn(),
}));
const urlSyncMocks = vi.hoisted(() => ({ useSwapUrlSync: vi.fn() }));

vi.mock("@repo/web3", () => web3Mocks);
vi.mock("@/hooks/use-swap-url-sync", () => urlSyncMocks);
vi.mock("./chain-change-sync", () => ({
  getChainChangeSyncPlan: syncPlanMocks.getChainChangeSyncPlan,
}));
vi.mock("./route-driven-state", () => ({
  getRouteDrivenFormStateSyncPlan:
    syncPlanMocks.getRouteDrivenFormStateSyncPlan,
}));

import { useSwapFormSync } from "./use-swap-form-sync";

const celoChainId = 42220 as ChainId;
const monadChainId = 143 as ChainId;
const initialRouteState: RouteDrivenFormState = {
  amount: "1",
  tokenInSymbol: "CELO",
  tokenOutSymbol: "USDm",
};

function createHarness() {
  const currentValues: FormValues = {
    amount: "1",
    quote: "2",
    slippage: "0.3",
    tokenInSymbol: "CELO",
    tokenOutSymbol: "USDm",
  };
  const form = {
    getValues: vi.fn((name?: keyof FormValues) =>
      name ? currentValues[name] : currentValues,
    ),
    reset: vi.fn(),
    setValue: vi.fn(),
  } as unknown as UseFormReturn<FormValues>;

  return {
    form,
    lastRouteDrivenFormStateRef: {
      current: null,
    } as { current: RouteDrivenFormState | null },
    prevChainIdRef: { current: celoChainId } as { current: number },
    setConfirmView: vi.fn(),
    setFormValues: vi.fn(),
    setLastChangedToken: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  syncPlanMocks.getChainChangeSyncPlan.mockReturnValue({
    kind: "clear-amount-only",
  });
  syncPlanMocks.getRouteDrivenFormStateSyncPlan.mockReturnValue({
    shouldReset: false,
  });
});

describe("useSwapFormSync", () => {
  it("keeps chain sync a mount no-op, then clears amount via functional atom update", () => {
    const harness = createHarness();
    const { rerender } = renderHook(
      ({ formChainId }) =>
        useSwapFormSync({
          ...harness,
          amount: "1",
          formChainId,
          formValues: { slippage: "0.3" },
          isQuoteError: false,
          routeDrivenFormState: initialRouteState,
          tokenInSymbol: "CELO",
          tokenOutSymbol: "USDm",
        }),
      { initialProps: { formChainId: celoChainId } },
    );

    expect(harness.form.setValue).not.toHaveBeenCalled();
    rerender({ formChainId: monadChainId });

    expect(harness.form.setValue).toHaveBeenNthCalledWith(1, "amount", "");
    expect(harness.form.setValue).toHaveBeenNthCalledWith(2, "quote", "");
    const update = harness.setFormValues.mock.calls[0]?.[0] as (
      previous: SwapFormValues | null,
    ) => SwapFormValues | null;
    expect(update(null)).toBeNull();
    expect(update({ amount: "1", slippage: "0.3" })).toEqual({
      amount: "",
      slippage: "0.3",
    });
  });

  it("applies route resets and records the route-changed token side", () => {
    const harness = createHarness();
    const resetValues: FormValues = {
      ...initialRouteState,
      amount: "2",
      quote: "",
      slippage: "0.3",
    };
    syncPlanMocks.getRouteDrivenFormStateSyncPlan
      .mockReturnValueOnce({ shouldReset: false })
      .mockReturnValueOnce({
        resetValues,
        routeChangedTokenSide: "from",
        shouldReset: true,
      });
    const { rerender } = renderHook(
      ({ routeDrivenFormState }) =>
        useSwapFormSync({
          ...harness,
          amount: routeDrivenFormState.amount,
          formChainId: celoChainId,
          formValues: { slippage: "0.3" },
          isQuoteError: false,
          routeDrivenFormState,
          tokenInSymbol: "CELO",
          tokenOutSymbol: "USDm",
        }),
      { initialProps: { routeDrivenFormState: initialRouteState } },
    );

    rerender({
      routeDrivenFormState: { ...initialRouteState, amount: "2" },
    });
    expect(harness.form.reset).toHaveBeenCalledWith(resetValues);
    expect(harness.setLastChangedToken).toHaveBeenCalledWith("from");
  });

  it("forwards URL state and exits confirm view on quote errors", () => {
    const harness = createHarness();
    renderHook(() =>
      useSwapFormSync({
        ...harness,
        amount: "1",
        formChainId: celoChainId,
        formValues: null,
        isQuoteError: true,
        routeDrivenFormState: initialRouteState,
        tokenInSymbol: "CELO",
        tokenOutSymbol: "USDm",
      }),
    );

    expect(urlSyncMocks.useSwapUrlSync).toHaveBeenCalledWith({
      amount: "1",
      tokenInSymbol: "CELO",
      tokenOutSymbol: "USDm",
      urlChainId: celoChainId,
    });
    expect(harness.setConfirmView).toHaveBeenCalledWith(false);
  });
});
