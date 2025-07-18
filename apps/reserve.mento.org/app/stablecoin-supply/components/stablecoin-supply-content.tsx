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
import { ChainId, getTokenAddress } from "../../lib/config/tokenConfig";
import type { StableValueTokensAPI } from "../../lib/types";

interface StablecoinSupplyContentProps {
  stableCoinStats: StableValueTokensAPI;
}

export function StablecoinSupplyContent({
  stableCoinStats,
}: StablecoinSupplyContentProps) {
  return (
    <div className="flex h-full flex-wrap gap-2 md:gap-4">
      {stableCoinStats.tokens.map((token) => (
        <CoinCard key={token.token}>
          <CoinCardHeader className="justify-between">
            <CoinCardHeaderGroup>
              <CoinCardSymbol>
                {(() => {
                  const chainId = ChainId.Celo;
                  const tokenAddress = getTokenAddress(token.token, chainId);

                  return tokenAddress ? (
                    <a
                      href={`https://celoscan.io/token/${tokenAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {token.token}
                    </a>
                  ) : (
                    token.token
                  );
                })()}
              </CoinCardSymbol>
              <CoinCardName>{token.name}</CoinCardName>
            </CoinCardHeaderGroup>
            <CoinCardLogo>
              <Image
                src={`/tokens/${token.token}.svg`}
                alt={token.token}
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
