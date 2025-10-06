"use client";

import type { ChartSegment } from "@repo/ui";
import { ReserveChart } from "@repo/ui";
import Image from "next/image";
import { useState } from "react";
import type {
  HoldingsApi,
  ReserveAssetSymbol,
  ReserveCompositionAPI,
  ReserveCompositionEntry,
} from "../../lib/types";

interface ReserveHoldingsContentProps {
  reserveComposition: ReserveCompositionAPI;
  reserveHoldings: HoldingsApi;
}

export function ReserveHoldingsContent({
  reserveComposition,
  reserveHoldings,
}: ReserveHoldingsContentProps) {
  const [active, setActive] = useState<string>();

  const TOKEN_COLORS: { [key: string]: string } = {
    CELO: "#7006FC",
    CUSD: "#9A4EFD",
    CEUR: "#C69BFF",
    CREAL: "#3D42CD",
    EXOF: "#7579FF",
    BTC: "#FFFFFF",
    ETH: "#66FFB8",
    SUSDS: "#99FFCF",
    USDC: "#C69BFF",
    USDT: "#0A452A",
    WBTC: "#F7F6FA",
    STEUR: "#18A061",
    USDGLO: "#082831",
    EURC: "#3D42CD",
    STETH: "#7579FF",
  };

  const getTokenColor = (tokenSymbol: ReserveAssetSymbol): string => {
    return TOKEN_COLORS[tokenSymbol.toUpperCase()] ?? "#fff000";
  };

  // Prepare data for ReserveChart
  const chartData: ChartSegment[] = reserveComposition.map(
    (item: ReserveCompositionEntry) => ({
      name: item.symbol,
      value: item.percent, // Assuming item.percent is the value to display
      color: getTokenColor(item.symbol),
    }),
  );

  let centerChartText = "Reserve";
  const celoComposition = reserveComposition.find(
    (item) => item.symbol.toUpperCase() === "CELO",
  );
  if (celoComposition) {
    centerChartText = `${celoComposition.percent.toFixed(2)}%`;
  } else if (chartData.length > 0) {
    // Fallback to the largest component's percentage if CELO is not found
    const largestComponent = chartData.reduce(
      (max, item) => (item.value > max.value ? item : max),
      chartData[0],
    );
    centerChartText = `${largestComponent.value.toFixed(2)}%`;
  }

  return (
    <>
      <div className="flex flex-col gap-2 md:mt-12 md:grid md:grid-cols-12">
        <div className="bg-card mb-2 flex h-full flex-1 flex-col p-6 pb-20 md:col-span-6 md:mb-0 xl:col-span-4">
          <h2 className="relative z-10 hidden text-2xl font-medium md:block">
            Reserve Holdings
          </h2>
          <ReserveChart
            data={chartData}
            centerText={centerChartText}
            activeSegment={active}
            className="my-auto h-[288px] justify-center self-center lg:h-[320px] xl:h-[360px] 2xl:h-[480px] min-[2500px]:!h-[640px]"
            onActiveChanged={(name) => {
              setActive(name);
            }}
          />
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-6 xl:col-span-8">
          {(() => {
            const celoDetails = reserveHoldings.celo.unfrozen;
            const celoComp = reserveComposition.find(
              (c) => c.symbol === celoDetails.symbol,
            );

            const celoIcon = "/tokens/CELO.svg";

            return (
              <>
                <div
                  key={`${celoDetails.symbol}-unfrozen`}
                  className={`${celoDetails.symbol === active ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} grid w-full grid-cols-2 gap-4 border-l-4 p-4 xl:grid-cols-12`}
                  style={{
                    borderLeftColor: getTokenColor(celoDetails.symbol),
                  }}
                  onMouseEnter={() => setActive(celoDetails.symbol)}
                  onMouseLeave={() => setActive(undefined)}
                >
                  <div className="col-span-2 flex flex-row items-center justify-start gap-4 text-xl font-medium xl:col-span-3">
                    <Image
                      src={celoIcon}
                      alt={celoDetails.symbol}
                      width={24}
                      height={24}
                      className="h-9 w-9"
                    />
                    {celoDetails.symbol}
                  </div>
                  <div className="col-span-1 flex flex-row items-center justify-start gap-2 text-sm text-white xl:col-span-4">
                    {celoDetails.units.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div className="text-muted-foreground col-span-1 flex flex-row items-center justify-start gap-2 text-sm xl:col-span-3">
                    {celoDetails.value.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                    })}
                  </div>
                  <div className="text-muted-foreground col-span-2 flex flex-row items-center justify-start gap-2 text-sm lg:justify-end lg:pr-4 xl:col-span-2">
                    {celoComp && <>{celoComp.percent.toFixed(2)}%</>}
                  </div>
                </div>
              </>
            );
          })()}

          {reserveHoldings.otherAssets.map((asset) => {
            const assetComp = reserveComposition.find(
              (c) => c.symbol === asset.symbol,
            );

            const iconPath = `/tokens/${asset.symbol}.svg`;

            return (
              <div
                key={asset.symbol}
                className={`${asset.symbol === active ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} grid w-full grid-cols-2 gap-4 border-l-4 p-4 xl:grid-cols-12`}
                style={{
                  borderLeftColor: getTokenColor(asset.symbol),
                }}
                onMouseEnter={() => setActive(asset.symbol)}
                onMouseLeave={() => setActive(undefined)}
              >
                <div className="col-span-2 flex flex-row items-center justify-start gap-4 text-xl font-medium xl:col-span-3">
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
                  {asset.symbol}
                </div>
                <div className="col-span-1 flex flex-row items-center justify-start gap-2 text-sm text-white xl:col-span-4">
                  {asset.units.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-muted-foreground col-span-1 flex flex-row items-center justify-start gap-2 text-sm xl:col-span-3">
                  {asset.value.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  })}
                </div>
                <div className="text-muted-foreground col-span-2 flex flex-row items-center justify-start gap-2 text-sm lg:justify-end lg:pr-4 xl:col-span-2">
                  {assetComp && <>{assetComp.percent.toFixed(2)}%</>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
