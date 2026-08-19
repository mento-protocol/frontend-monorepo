import {
  TokenSymbol,
  encodeRoutePath,
  getTokenAddress,
} from "@mento-protocol/mento-sdk";
import { describe, expect, it } from "vitest";

import { ChainId } from "@/config/chains";
import { getSwappableTokenOptions } from "@/config/tokens";
import { getTradablePairForTokens } from "@/features/sdk";

function requireTokenAddress(symbol: TokenSymbol): `0x${string}` {
  const address = getTokenAddress(ChainId.Polygon, symbol);
  if (!address) {
    throw new Error(`${symbol} is not configured on Polygon`);
  }
  return address as `0x${string}`;
}

describe("Polygon three-hop routes", () => {
  const USDC = requireTokenAddress(TokenSymbol.USDC);
  const USDm = requireTokenAddress(TokenSymbol.USDm);
  const EURm = requireTokenAddress(TokenSymbol.EURm);
  const EUROP = requireTokenAddress(TokenSymbol.EUROP);

  it("makes EUROP selectable when USDC is selected", async () => {
    await expect(
      getSwappableTokenOptions(TokenSymbol.USDC, ChainId.Polygon),
    ).resolves.toContain(TokenSymbol.EUROP);
  });

  it("encodes USDC to EUROP through USDm and EURm", async () => {
    const route = await getTradablePairForTokens(
      ChainId.Polygon,
      TokenSymbol.USDC,
      TokenSymbol.EUROP,
    );

    expect(route.path).toHaveLength(3);
    expect(encodeRoutePath(route.path, USDC, EUROP)).toEqual([
      expect.objectContaining({ from: USDC, to: USDm }),
      expect.objectContaining({ from: USDm, to: EURm }),
      expect.objectContaining({ from: EURm, to: EUROP }),
    ]);
  });

  it("encodes the same cached route in reverse", async () => {
    const route = await getTradablePairForTokens(
      ChainId.Polygon,
      TokenSymbol.EUROP,
      TokenSymbol.USDC,
    );

    expect(route.path).toHaveLength(3);
    expect(encodeRoutePath(route.path, EUROP, USDC)).toEqual([
      expect.objectContaining({ from: EUROP, to: EURm }),
      expect.objectContaining({ from: EURm, to: USDm }),
      expect.objectContaining({ from: USDm, to: USDC }),
    ]);
  });
});
