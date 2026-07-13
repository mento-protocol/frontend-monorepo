import { describe, expect, it } from "vitest";

import {
  getRouteDrivenFormStateSyncPlan,
  getRouteChangedTokenSide,
  hasRouteDrivenFormStateChanged,
  type RouteDrivenFormState,
} from "./route-driven-state";

const fullRouteState: RouteDrivenFormState = {
  amount: "1",
  tokenInSymbol: "USDm",
  tokenOutSymbol: "GBPm",
};

describe("route-driven swap form state", () => {
  it("treats the initial route state as unapplied", () => {
    expect(hasRouteDrivenFormStateChanged(null, fullRouteState)).toBe(true);
  });

  it("detects unchanged route state after the first application", () => {
    expect(hasRouteDrivenFormStateChanged(fullRouteState, fullRouteState)).toBe(
      false,
    );
  });

  it("returns no reset plan when the route state is unchanged", () => {
    expect(
      getRouteDrivenFormStateSyncPlan({
        currentValues: {
          amount: "2",
          quote: "123",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
          slippage: "0.5",
        },
        formValuesSlippage: "0.4",
        previousRouteState: fullRouteState,
        routeDrivenFormState: fullRouteState,
      }),
    ).toEqual({ shouldReset: false });
  });

  it("returns no reset plan when the form already matches the route state", () => {
    expect(
      getRouteDrivenFormStateSyncPlan({
        currentValues: {
          amount: "1",
          quote: "123",
          tokenInSymbol: "USDm",
          tokenOutSymbol: "GBPm",
          slippage: "0.5",
        },
        formValuesSlippage: "0.4",
        previousRouteState: {
          amount: "2",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
        },
        routeDrivenFormState: fullRouteState,
      }),
    ).toEqual({ shouldReset: false });
  });

  it("builds a reset payload from the route state and current form values", () => {
    expect(
      getRouteDrivenFormStateSyncPlan({
        currentValues: {
          amount: "2",
          quote: "123",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
          slippage: "0.5",
        },
        formValuesSlippage: "0.4",
        previousRouteState: {
          amount: "2",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
        },
        routeDrivenFormState: fullRouteState,
      }),
    ).toEqual({
      shouldReset: true,
      resetValues: {
        amount: "1",
        quote: "",
        tokenInSymbol: "USDm",
        tokenOutSymbol: "GBPm",
        slippage: "0.5",
      },
      routeChangedTokenSide: "from",
    });
  });

  it("falls back to stored slippage when the current form has none", () => {
    expect(
      getRouteDrivenFormStateSyncPlan({
        currentValues: {
          amount: "2",
          quote: "123",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
          slippage: "",
        },
        formValuesSlippage: "0.4",
        previousRouteState: {
          amount: "2",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
        },
        routeDrivenFormState: fullRouteState,
      }),
    ).toEqual({
      shouldReset: true,
      resetValues: {
        amount: "1",
        quote: "",
        tokenInSymbol: "USDm",
        tokenOutSymbol: "GBPm",
        slippage: "0.4",
      },
      routeChangedTokenSide: "from",
    });
  });

  it('falls back to "0.3" slippage when neither source has a value', () => {
    expect(
      getRouteDrivenFormStateSyncPlan({
        currentValues: {
          amount: "2",
          quote: "123",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
          slippage: "",
        },
        previousRouteState: {
          amount: "2",
          tokenInSymbol: "CELO",
          tokenOutSymbol: "cUSD",
        },
        routeDrivenFormState: fullRouteState,
      }),
    ).toEqual({
      shouldReset: true,
      resetValues: {
        amount: "1",
        quote: "",
        tokenInSymbol: "USDm",
        tokenOutSymbol: "GBPm",
        slippage: "0.3",
      },
      routeChangedTokenSide: "from",
    });
  });

  it("marks a one-sided from route as a from-side change", () => {
    expect(
      getRouteChangedTokenSide(null, {
        amount: "1",
        tokenInSymbol: "USDm",
        tokenOutSymbol: "",
      }),
    ).toBe("from");
  });

  it("marks a one-sided to route as a to-side change", () => {
    expect(
      getRouteChangedTokenSide(null, {
        amount: "1",
        tokenInSymbol: "",
        tokenOutSymbol: "GBPm",
      }),
    ).toBe("to");
  });

  it("marks a changed to token as a to-side change", () => {
    expect(
      getRouteChangedTokenSide(
        {
          amount: "1",
          tokenInSymbol: "USDm",
          tokenOutSymbol: "cEUR",
        },
        fullRouteState,
      ),
    ).toBe("to");
  });

  it("marks a changed amount with both route tokens present as a from-side change", () => {
    expect(
      getRouteChangedTokenSide(
        {
          amount: "2",
          tokenInSymbol: "USDm",
          tokenOutSymbol: "GBPm",
        },
        fullRouteState,
      ),
    ).toBe("from");
  });
});
