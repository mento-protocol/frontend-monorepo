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
import type { StableValueTokensAPI } from "../../lib/types";

interface StablecoinSupplyContentProps {
  stableCoinStats: StableValueTokensAPI;
}

export function StablecoinSupplyContent({
  stableCoinStats,
}: StablecoinSupplyContentProps) {
  return (
    <div className="gap-2 md:gap-4 flex h-full flex-wrap">
      {stableCoinStats.tokens.map((token) => (
        <CoinCard key={token.symbol}>
          <CoinCardHeader className="justify-between">
            <CoinCardHeaderGroup>
              <CoinCardSymbol>
                {token.address ? (
                  <a
                    href={`https://celoscan.io/token/${token.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {token.symbol}
                  </a>
                ) : (
                  token.symbol
                )}
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
