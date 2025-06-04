"use client";

import { env } from "@/env.mjs";
import type { ChartSegment } from "@repo/ui";
import {
  CoinCard,
  CoinCardFooter,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardLogo,
  CoinCardName,
  CoinCardSupply,
  CoinCardSymbol,
  CommunityCard,
  ReserveChart,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import Image from "next/image";
import { useState } from "react";
import type {
  HoldingsApi,
  ReserveCompositionAPI,
  ReserveCompositionEntry,
  StableValueTokensAPI,
} from "../lib/types";

interface ContentProps {
  stableCoinStats: StableValueTokensAPI;
  reserveComposition: ReserveCompositionAPI;
  reserveHoldings: HoldingsApi;
}

export function Content({
  stableCoinStats,
  reserveComposition,
  reserveHoldings,
}: ContentProps) {
  const [active, setActive] = useState<string>();
  const TOKEN_COLORS: { [key: string]: string } = {
    CELO: "#7006FC",
    CUSD: "#9A4EFD",
    CEUR: "#C69BFF",
    CREAL: "#3D42CD",
    EXOF: "#7579FF",
    BTC: "#FFFFFF",
    ETH: "#66FFB8",
    SDAI: "#99FFCF",
    USDC: "#C69BFF",
    USDT: "#0A452A",
    WBTC: "#F7F6FA",
    STEUR: "#18A061",
    USDGLO: "#082831",
    EURC: "#3D42CD",
    STETH: "#7579FF",
  };

  const getTokenColor = (tokenSymbol: string): string => {
    return TOKEN_COLORS[tokenSymbol.toUpperCase()] ?? "#fff000";
  };

  // Prepare data for ReserveChart
  const chartData: ChartSegment[] = reserveComposition.map(
    (item: ReserveCompositionEntry) => ({
      name: item.token,
      value: item.percent, // Assuming item.percent is the value to display
      color: getTokenColor(item.token),
    }),
  );

  let centerChartText = "Reserve";
  const celoComposition = reserveComposition.find(
    (item) => item.token.toUpperCase() === "CELO",
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
      <Tabs defaultValue="stablecoin-supply" className="mb-8 w-full gap-0">
        <TabsList>
          <TabsTrigger value="stablecoin-supply">Stablecoin Supply</TabsTrigger>
          <TabsTrigger value="reserve-holdings">Reserve Holdings</TabsTrigger>
        </TabsList>
        <TabsContent
          value="stablecoin-supply"
          className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
        >
          <h2 className="relative z-10 my-6 hidden text-2xl font-medium md:mb-8 md:mt-12 md:block">
            Stablecoin Supply
          </h2>
          <div className="relative z-10 flex h-full flex-wrap gap-2 md:gap-4">
            {stableCoinStats.tokens.map((token) => (
              <CoinCard key={token.token}>
                <CoinCardHeader className="justify-between">
                  <CoinCardHeaderGroup>
                    <CoinCardSymbol>{token.token}</CoinCardSymbol>
                    <CoinCardName>{token.name}</CoinCardName>
                  </CoinCardHeaderGroup>
                  <CoinCardLogo>
                    <Image
                      src={token.iconUrl || ""}
                      alt={token.token}
                      width={32}
                      height={32}
                      className="h-8 w-8"
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
        </TabsContent>
        <TabsContent
          value="reserve-holdings"
          className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
        >
          <div className="relative z-10 flex flex-col gap-2 md:mt-12 md:grid md:grid-cols-12">
            <div className="bg-card mb-2 flex h-full flex-1 flex-col p-6 md:col-span-6 md:mb-0 xl:col-span-4">
              <h2 className="relative z-10 hidden text-2xl font-medium md:block">
                Reserve Holdings
              </h2>
              <ReserveChart
                data={chartData}
                centerText={centerChartText}
                activeSegment={active}
                className="my-auto h-[288px] justify-center self-center lg:h-[320px] xl:h-[360px]"
                onSegmentClick={(segment) => setActive(segment.name)}
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-6 xl:col-span-8">
              {(() => {
                const celoDetails = reserveHoldings.celo.unfrozen;
                const celoComp = reserveComposition.find(
                  (c) => c.token === celoDetails.token,
                );

                // TODO: Confirm CELO icon path or make it dynamic if possible
                const celoIcon = "/tokens/CELO.svg"; // Placeholder icon path

                return (
                  <>
                    <div
                      key={`${celoDetails.token}-unfrozen`}
                      className={`${celoDetails.token === active ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} grid w-full grid-cols-2 gap-4 border-l-2 p-4 xl:grid-cols-12`}
                      style={{
                        borderLeftColor: getTokenColor(celoDetails.token),
                      }}
                      onMouseEnter={() => setActive(celoDetails.token)}
                      onMouseLeave={() => setActive(undefined)}
                    >
                      <div className="col-span-2 flex flex-row items-center justify-start gap-2 text-xl font-medium xl:col-span-3">
                        <Image
                          src={celoIcon}
                          alt={celoDetails.token}
                          width={24}
                          height={24}
                          className="h-9 w-9"
                        />

                        {celoDetails.token}
                      </div>
                      <div className="col-span-1 flex flex-row items-center justify-start gap-2 text-sm text-white xl:col-span-3">
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
                      <div className="text-muted-foreground col-span-2 flex flex-row items-center justify-start gap-2 text-sm xl:col-span-3">
                        {celoComp && <>{celoComp.percent.toFixed(2)}%</>}
                      </div>
                    </div>
                  </>
                );
              })()}

              {reserveHoldings.otherAssets.map((asset) => {
                const assetComp = reserveComposition.find(
                  (c) => c.token === asset.token,
                );

                const iconPath = `/tokens/${asset.token}.svg`;

                return (
                  <div
                    key={asset.token}
                    className={`${asset.token === active ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} grid w-full grid-cols-2 gap-4 border-l-2 p-4 xl:grid-cols-12`}
                    style={{
                      borderLeftColor: getTokenColor(asset.token),
                    }}
                    onMouseEnter={() => setActive(asset.token)}
                    onMouseLeave={() => setActive(undefined)}
                  >
                    <div className="col-span-2 flex flex-row items-center justify-start gap-2 text-xl font-medium xl:col-span-3">
                      <Image
                        src={iconPath}
                        alt={asset.token}
                        width={24}
                        height={24}
                        className="h-9 w-9"
                        onError={(e) => {
                          e.currentTarget.src = "/tokens/CELO.svg";
                        }}
                      />

                      {asset.token}
                    </div>
                    <div className="col-span-1 flex flex-row items-center justify-start gap-2 text-sm text-white xl:col-span-3">
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
                    <div className="text-muted-foreground col-span-2 flex flex-row items-center justify-start gap-2 text-sm xl:col-span-3">
                      {assetComp && <>{assetComp.percent.toFixed(2)}%</>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>
      <CommunityCard
        images={{
          mobile: `${env.NEXT_PUBLIC_STORAGE_URL}/cta-join-community-mobile-fiA6uAlKQFhFo6jXvHhxKQ3L74bn8v.png`,
          desktop: `${env.NEXT_PUBLIC_STORAGE_URL}/cta-join-community-ahNprbnDlm9FaDQ48D6eW7THpdoWdx.png`,
        }}
        buttonHref="http://discord.mento.org"
      />
    </>
  );
}
