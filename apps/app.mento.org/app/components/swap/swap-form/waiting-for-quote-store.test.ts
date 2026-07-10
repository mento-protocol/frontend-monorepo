import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  type WaitingForQuoteUpdate,
  createWaitingForQuoteStore,
  getTokenPairKey,
  getWaitingForQuoteTransition,
} from "./waiting-for-quote-store";

const usd = "USDm" as TokenSymbol;
const gbp = "GBPm" as TokenSymbol;
const update = (
  overrides: Partial<WaitingForQuoteUpdate> = {},
): WaitingForQuoteUpdate => ({
  hasAmount: true,
  isTradingSuspended: false,
  quote: null,
  quoteFetching: true,
  tokenInSymbol: usd,
  tokenOutSymbol: gbp,
  ...overrides,
});

describe("getTokenPairKey", () => {
  it("returns null until both tokens are selected", () => {
    expect(
      getTokenPairKey({ tokenInSymbol: usd, tokenOutSymbol: undefined }),
    ).toBe(null);
    expect(getTokenPairKey({ tokenInSymbol: usd, tokenOutSymbol: gbp })).toBe(
      "USDm:GBPm",
    );
  });
});

describe("getWaitingForQuoteTransition", () => {
  it("handles the waiting transitions for pair changes, clear conditions, and valid quotes", () => {
    expect(
      getWaitingForQuoteTransition(
        { tokenInSymbol: undefined, tokenOutSymbol: undefined },
        null,
        update(),
      ),
    ).toEqual({
      nextPreviousTokenPair: { tokenInSymbol: usd, tokenOutSymbol: gbp },
      nextWaitingForQuotePair: "USDm:GBPm",
    });
    expect(
      getWaitingForQuoteTransition(
        { tokenInSymbol: usd, tokenOutSymbol: gbp },
        "USDm:GBPm",
        update({ hasAmount: false }),
      ).nextWaitingForQuotePair,
    ).toBe(null);
    expect(
      getWaitingForQuoteTransition(
        { tokenInSymbol: usd, tokenOutSymbol: gbp },
        "USDm:GBPm",
        update({ tokenOutSymbol: undefined }),
      ).nextWaitingForQuotePair,
    ).toBe(null);
    expect(
      getWaitingForQuoteTransition(
        { tokenInSymbol: usd, tokenOutSymbol: gbp },
        "USDm:GBPm",
        update({ isTradingSuspended: true }),
      ).nextWaitingForQuotePair,
    ).toBe(null);
    expect(
      getWaitingForQuoteTransition(
        { tokenInSymbol: usd, tokenOutSymbol: gbp },
        "USDm:GBPm",
        update({ quote: "1.25", quoteFetching: false }),
      ).nextWaitingForQuotePair,
    ).toBe(null);
    expect(
      getWaitingForQuoteTransition(
        { tokenInSymbol: usd, tokenOutSymbol: gbp },
        "USDm:GBPm",
        update({ quote: "0", quoteFetching: false }),
      ).nextWaitingForQuotePair,
    ).toBe("USDm:GBPm");
  });
});

describe("createWaitingForQuoteStore", () => {
  it("notifies subscribers when waiting is set and cleared, and stops after unsubscribe", () => {
    const store = createWaitingForQuoteStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.update(update());
    expect(store.getSnapshot()).toBe("USDm:GBPm");
    expect(listener).toHaveBeenCalledTimes(1);

    store.update(update({ quote: "1.5", quoteFetching: false }));
    expect(store.getSnapshot()).toBe(null);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.update(update({ tokenInSymbol: gbp, tokenOutSymbol: usd }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("preserves the local-store Object.is no-notify guard", () => {
    const store = createWaitingForQuoteStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.update(
      update({
        hasAmount: false,
        quoteFetching: false,
        tokenInSymbol: undefined,
        tokenOutSymbol: undefined,
      }),
    );

    expect(store.getSnapshot()).toBe(null);
    expect(listener).not.toHaveBeenCalled();
  });
});
