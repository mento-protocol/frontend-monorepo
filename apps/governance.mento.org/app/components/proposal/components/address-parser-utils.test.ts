import { describe, expect, it } from "vitest";
import { isPartOfTokenPairOrRateFeed } from "./address-parser-utils";

function find(text: string, value: string, occurrence = 0): RegExpExecArray {
  const matches = Array.from(text.matchAll(new RegExp(value, "g")));
  const match = matches[occurrence];
  if (!match) throw new Error(`Missing ${value} occurrence ${occurrence}`);
  return match;
}

describe("isPartOfTokenPairOrRateFeed", () => {
  it("identifies both sides of a token pair", () => {
    const text = "Reset trading limits for AUDm on USDm/AUDm pool";

    expect(isPartOfTokenPairOrRateFeed(text, find(text, "USDm"))).toBe(true);
    expect(isPartOfTokenPairOrRateFeed(text, find(text, "AUDm", 1))).toBe(true);
  });

  it("keeps a standalone token name linkable", () => {
    const text = "Reset trading limits for AUDm on USDm/AUDm pool";

    expect(isPartOfTokenPairOrRateFeed(text, find(text, "AUDm"))).toBe(false);
  });
});
