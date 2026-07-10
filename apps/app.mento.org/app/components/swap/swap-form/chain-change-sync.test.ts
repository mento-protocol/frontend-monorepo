import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { describe, expect, it } from "vitest";

import { getChainChangeSyncPlan } from "./chain-change-sync";

describe("getChainChangeSyncPlan", () => {
  const availableTokens = ["USDm", "cEUR", "cREAL"] as TokenSymbol[];

  it("returns a clear-amount-only plan when both tokens stay valid and distinct", () => {
    expect(
      getChainChangeSyncPlan({
        availableTokens,
        currentTokenInSymbol: "USDm",
        currentTokenOutSymbol: "cEUR",
        preferredQuoteTokenSymbol: "cREAL" as TokenSymbol,
      }),
    ).toEqual({ kind: "clear-amount-only" });
  });

  it("falls back to the preferred quote token when tokenIn is invalid", () => {
    expect(
      getChainChangeSyncPlan({
        availableTokens,
        currentTokenInSymbol: "invalid",
        currentTokenOutSymbol: "",
        preferredQuoteTokenSymbol: "cREAL" as TokenSymbol,
      }),
    ).toEqual({
      kind: "reset-tokens",
      tokenInSymbol: "cREAL",
      tokenOutSymbol: "USDm",
    });
  });

  it("preserves an unavailable preferred quote token before falling back to the first available token", () => {
    expect(
      getChainChangeSyncPlan({
        availableTokens,
        currentTokenInSymbol: "invalid",
        currentTokenOutSymbol: "",
        preferredQuoteTokenSymbol: "cUSD" as TokenSymbol,
      }),
    ).toEqual({
      kind: "reset-tokens",
      tokenInSymbol: "cUSD",
      tokenOutSymbol: "USDm",
    });
  });

  it("picks a distinct tokenOut when the resolved pair would be duplicated", () => {
    expect(
      getChainChangeSyncPlan({
        availableTokens,
        currentTokenInSymbol: "USDm",
        currentTokenOutSymbol: "USDm",
        preferredQuoteTokenSymbol: "cREAL" as TokenSymbol,
      }),
    ).toEqual({
      kind: "reset-tokens",
      tokenInSymbol: "USDm",
      tokenOutSymbol: "cEUR",
    });
  });

  it("keeps the preferred quote when no tokens are available", () => {
    expect(
      getChainChangeSyncPlan({
        availableTokens: [],
        currentTokenInSymbol: "USDm",
        currentTokenOutSymbol: "cEUR",
        preferredQuoteTokenSymbol: "cREAL" as TokenSymbol,
      }),
    ).toEqual({
      kind: "reset-tokens",
      tokenInSymbol: "cREAL",
      tokenOutSymbol: "",
    });
  });

  it("handles chains without available tokens or a preferred quote", () => {
    expect(
      getChainChangeSyncPlan({
        availableTokens: [],
        currentTokenInSymbol: "USDm",
        currentTokenOutSymbol: "cEUR",
        preferredQuoteTokenSymbol: null,
      }),
    ).toEqual({
      kind: "reset-tokens",
      tokenInSymbol: "",
      tokenOutSymbol: "",
    });
  });
});
