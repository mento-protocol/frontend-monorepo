"use client";

import { useState } from "react";
import type { ChartSegment } from "@repo/ui";
import { ReserveChart } from "@repo/ui";
import Image from "next/image";
import type { V2ReserveResponse } from "@/lib/types";
import { formatUsd } from "@/lib/format";

const TOKEN_COLORS: Record<string, string> = {
  CELO: "#7006FC",
  ETH: "#66FFB8",
  BTC: "#FFFFFF",
  SUSDS: "#99FFCF",
  USDC: "#C69BFF",
  EURC: "#3D42CD",
  DAI: "#F7F6FA",
  STETH: "#7579FF",
  WBTC: "#F7F6FA",
  USDT: "#0A452A",
  USDGLO: "#082831",
  STEUR: "#18A061",
};

function getTokenColor(symbol: string): string {
  return TOKEN_COLORS[symbol.toUpperCase()] ?? "#fff000";
}

export function CollateralTab({
  reserve,
}: {
  reserve: V2ReserveResponse;
}) {
  const [active, setActive] = useState<string>();
  const { assets, total_usd } = reserve.collateral;
  const sorted = [...assets].sort((a, b) => b.usd_value - a.usd_value);

  const chartData: ChartSegment[] = sorted.map((asset) => ({
    name: asset.symbol,
    value: asset.percentage,
    color: getTokenColor(asset.symbol),
  }));

  const largestAsset = sorted[0];
  const centerText = largestAsset
    ? `${largestAsset.percentage.toFixed(2)}%`
    : "Reserve";

  return (
    <div>
      <div className="gap-2 md:mt-0 md:grid md:grid-cols-12 flex flex-col">
        <div className="mb-2 p-6 pb-20 md:col-span-6 md:mb-0 xl:col-span-4 flex h-full flex-1 flex-col bg-card">
          <h2 className="text-2xl font-medium md:block relative z-10 hidden">
            Reserve Collateral
          </h2>
          <ReserveChart
            data={chartData}
            centerText={centerText}
            activeSegment={active}
            className="lg:h-[320px] xl:h-[360px] 2xl:h-[480px] my-auto h-[288px] justify-center self-center min-[2500px]:!h-[640px]"
            onActiveChanged={(name) => {
              setActive(name);
            }}
          />
        </div>
        <div className="gap-2 md:col-span-6 xl:col-span-8 flex flex-wrap">
          {sorted.map((asset) => {
            const iconPath = `/tokens/${asset.symbol}.svg`;
            return (
              <div
                key={`${asset.symbol}-${asset.chain}`}
                className={`${asset.symbol === active ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} gap-4 p-4 xl:grid-cols-12 grid w-full grid-cols-2 border-l-4`}
                style={{
                  borderLeftColor: getTokenColor(asset.symbol),
                }}
                onMouseEnter={() => setActive(asset.symbol)}
                onMouseLeave={() => setActive(undefined)}
              >
                <div className="gap-4 text-xl font-medium xl:col-span-3 col-span-2 flex flex-row items-center justify-start">
                  <Image
                    src={iconPath}
                    alt={asset.symbol}
                    width={24}
                    height={24}
                    className="h-9 w-9"
                    onError={(e) => {
                      e.currentTarget.src = "/tokens/CELO.svg";
                    }}
                  />
                  <span>{asset.symbol}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {asset.chain === "celo"
                      ? "Celo"
                      : asset.chain === "ethereum"
                        ? "Ethereum"
                        : asset.chain === "monad"
                          ? "Monad"
                          : asset.chain}
                  </span>
                </div>
                <div className="gap-2 text-sm text-white xl:col-span-4 col-span-1 flex flex-row items-center justify-start">
                  {parseFloat(asset.balance).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="gap-2 text-sm xl:col-span-3 col-span-1 flex flex-row items-center justify-start text-muted-foreground">
                  {formatUsd(asset.usd_value)}
                </div>
                <div className="gap-2 text-sm lg:justify-end lg:pr-4 xl:col-span-2 col-span-2 flex flex-row items-center justify-start text-muted-foreground">
                  {asset.percentage.toFixed(2)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
