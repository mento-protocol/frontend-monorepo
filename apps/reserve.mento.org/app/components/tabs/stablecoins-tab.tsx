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
import type { V2StablecoinsResponse } from "@/lib/types";
import { formatUsd, formatNumber, formatPercent } from "@/lib/format";

export function StablecoinsTab({
  stablecoins,
}: {
  stablecoins: V2StablecoinsResponse;
}) {
  const sorted = [...stablecoins.stablecoins].sort(
    (a, b) => b.supply.total_usd - a.supply.total_usd,
  );

  return (
    <div>
      <h2 className="my-6 text-2xl font-medium md:mb-8 hidden md:block">
        Mento Stablecoins
      </h2>
      <p className="mb-6 max-w-xl text-sm text-muted-foreground">
        Debt is the circulating supply redeemable by the public. Reserve-held
        supply sits in reserve wallets and LP positions and is not counted as a
        liability.
      </p>

      <div className="gap-2 md:gap-4 flex h-full flex-wrap">
        {sorted.map((coin) => (
          <CoinCard key={coin.symbol}>
            <CoinCardHeader className="justify-between">
              <CoinCardHeaderGroup>
                <CoinCardSymbol>
                  <span className="flex items-center gap-2">
                    {coin.symbol}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        coin.backing_type === "cdp"
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-[#8c35fd]/20 text-[#8c35fd]"
                      }`}
                    >
                      {coin.backing_type === "cdp" ? "CDP" : "Reserve"}
                    </span>
                  </span>
                </CoinCardSymbol>
                <CoinCardName>{coin.name}</CoinCardName>
              </CoinCardHeaderGroup>
              <CoinCardLogo>
                <Image
                  src={`/tokens/${coin.symbol}.svg`}
                  alt={coin.symbol}
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
                {formatUsd(coin.supply.total_usd)}
              </CoinCardSupply>
              <div className="mt-2 gap-x-4 gap-y-1 grid grid-cols-2 text-xs text-muted-foreground">
                <span>
                  Debt: {formatNumber(coin.supply.debt)}
                </span>
                <span>
                  Held: {formatNumber(coin.supply.reserve_held)}
                </span>
                <span>
                  Networks: {coin.networks.map((n) => n === "celo" ? "Celo" : n === "monad" ? "Monad" : n === "ethereum" ? "ETH" : n).join(", ")}
                </span>
                <span>
                  MCap: {formatPercent(coin.market_cap_percentage)}
                </span>
              </div>
            </CoinCardFooter>
          </CoinCard>
        ))}
      </div>
    </div>
  );
}
