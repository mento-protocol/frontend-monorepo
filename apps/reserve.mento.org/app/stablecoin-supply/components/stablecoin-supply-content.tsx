"use client";

import {
  CoinCard,
  CoinCardFooter,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardLogo,
  CoinCardName,
  CoinCardSupply,
  CoinCardSymbol,
} from "@repo/ui";
import Image from "next/image";
import { getTokenAddress } from "@mento-protocol/mento-sdk";
import type { StableValueTokensAPI } from "../../lib/types";

interface StablecoinSupplyContentProps {
  stableCoinStats: StableValueTokensAPI;
}

// NOTE: Conscious duplication of ChainId to avoid having to install @repo/web3
// as a dependency of this app.
enum ChainId {
  CeloSepolia = 11142220,
  Celo = 42220,
}

export function StablecoinSupplyContent({
  stableCoinStats,
}: StablecoinSupplyContentProps) {
  return (
    <div className="flex h-full flex-wrap gap-2 md:gap-4">
      {stableCoinStats.tokens.map((token) => (
        <CoinCard key={token.symbol}>
          <CoinCardHeader className="justify-between">
            <CoinCardHeaderGroup>
              <CoinCardSymbol>
                {(() => {
                  const chainId = ChainId.Celo;
                  const tokenAddress = getTokenAddress(token.symbol, chainId);
                  if (!tokenAddress) {
                    throw new Error(
                      `${token.symbol} token address not found on chain ${chainId}`,
                    );
                  }

                  return tokenAddress ? (
                    <a
                      href={`https://celoscan.io/token/${tokenAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {token.symbol}
                    </a>
                  ) : (
                    token.symbol
                  );
                })()}
              </CoinCardSymbol>
              <CoinCardName>{token.name}</CoinCardName>
            </CoinCardHeaderGroup>
            <CoinCardLogo>
              <Image
                src={`/tokens/${token.symbol}.svg`}
                alt={token.symbol}
                width={32}
                height={32}
                className="h-8 w-8"
                onError={(e) => {
                  e.currentTarget.src = "/tokens/CELO.svg";
                }}
              />
            </CoinCardLogo>
          </CoinCardHeader>
          <CoinCardFooter>
            <CoinCardSupply>
              {token.value.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
              })}
            </CoinCardSupply>
          </CoinCardFooter>
        </CoinCard>
      ))}
    </div>
  );
}
