import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { describe, expect, it } from "vitest";

import {
  getDefaultTokenInSymbol,
  getSelectedTokenSymbol,
} from "./token-selection";

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

describe("getDefaultTokenInSymbol", () => {
  it("uses the preferred USD quote token when it is available", () => {
    expect(
      getDefaultTokenInSymbol("USDm" as TokenSymbol, availableTokens),
    ).toBe("USDm");
  });

  it("uses the first available token when no preferred quote token is available", () => {
    expect(
      getDefaultTokenInSymbol(null, ["cREAL", "USDm"] as TokenSymbol[]),
    ).toBe("cREAL");
  });

  it("does not throw when no tokens are configured for the chain", () => {
    expect(getDefaultTokenInSymbol(null, [])).toBeUndefined();
  });
});
