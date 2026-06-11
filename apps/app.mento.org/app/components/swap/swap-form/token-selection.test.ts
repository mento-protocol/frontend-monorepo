import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { describe, expect, it } from "vitest";

import { getSelectedTokenSymbol } from "./token-selection";

const availableTokens = ["USDm", "GBPm"] as TokenSymbol[];

describe("getSelectedTokenSymbol", () => {
  it("uses the fallback before the form watch value initializes", () => {
    expect(getSelectedTokenSymbol(undefined, "USDm", availableTokens)).toBe(
      "USDm",
    );
  });

  it("does not restore the fallback after the form token is cleared", () => {
    expect(getSelectedTokenSymbol("", "USDm", availableTokens)).toBeUndefined();
  });

  it("does not restore the fallback for an invalid watched token", () => {
    expect(
      getSelectedTokenSymbol("invalid-token", "USDm", availableTokens),
    ).toBeUndefined();
  });
});
