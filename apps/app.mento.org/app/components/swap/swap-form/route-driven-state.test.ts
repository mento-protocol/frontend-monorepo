import { describe, expect, it } from "vitest";

import {
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
});
