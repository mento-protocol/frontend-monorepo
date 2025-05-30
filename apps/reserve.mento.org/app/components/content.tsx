"use client";

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
import type {
  HoldingsApi,
  ReserveCompositionAPI,
  ReserveCompositionEntry,
  StableValueTokensAPI,
} from "../lib/types";
import { useState } from "react";
import { env } from "@/env.mjs";
import { Navigation } from "@repo/ui";

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
    CUSD: "#9A4EFD", // cUSD
    CEUR: "#C69BFF", // cEUR
    CREAL: "#3D42CD", // cREAL
    EXOF: "#7579FF",
    BTC: "#F7F6FA",
    ETH: "#66FFB8",
    SDAI: "#18A061",
    USDC: "#082831",
    USDT: "#0A452A",
    WBTC: "#F7F6FA",
    STEUR: "#C69BFF",
    USDGLO: "#082831",
    EURC: "#082831",
    STETH: "#66FFB8",
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

  console.log("DATA: ", stableCoinStats);

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
          <h2 className="relative z-10 my-6 text-2xl font-medium md:mb-8 md:mt-12">
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
                      width={24}
                      height={24}
                      className="h-6 w-6"
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
              <h2 className="relative z-10 text-2xl font-medium">
                Reserve Holdings
              </h2>
              <ReserveChart
                data={chartData}
                centerText={centerChartText}
                activeSegment={active}
                className="my-auto h-[288px] justify-center self-center"
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-6 xl:col-span-8">
              {(() => {
                const celoDetails = reserveHoldings.celo.unfrozen;
                const celoComp = reserveComposition.find(
                  (c) => c.token === celoDetails.token,
                );

                // TODO: Confirm CELO icon path or make it dynamic if possible
                const celoIcon = "/icons/celo.svg"; // Placeholder icon path

                return (
                  <>
                    <div
                      key={`${celoDetails.token}-unfrozen`}
                      className="bg-card hover:bg-accent grid w-full grid-cols-2 gap-4 border-l-2 p-4 xl:grid-cols-12"
                      style={{
                        borderLeftColor: getTokenColor(celoDetails.token),
                      }}
                      onMouseEnter={() => setActive(celoDetails.token)}
                      onMouseLeave={() => setActive(undefined)}
                    >
                      <div className="col-span-2 flex flex-row items-center justify-start gap-2 text-xl font-medium xl:col-span-3">
                        {celoDetails.iconUrl && (
                          <Image
                            src={celoDetails.iconUrl}
                            alt={celoDetails.token}
                            width={24}
                            height={24}
                            className="h-12 w-12"
                          />
                        )}

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

                return (
                  <div
                    key={asset.token}
                    className="bg-card hover:bg-accent grid w-full grid-cols-2 gap-4 border-l-2 p-4 xl:grid-cols-12"
                    style={{
                      borderLeftColor: getTokenColor(asset.token),
                    }}
                    onMouseEnter={() => setActive(asset.token)}
                    onMouseLeave={() => setActive(undefined)}
                  >
                    <div className="col-span-2 flex flex-row items-center justify-start gap-2 text-xl font-medium xl:col-span-3">
                      {asset.iconUrl && (
                        <Image
                          src={asset.iconUrl}
                          alt={asset.token}
                          width={24}
                          height={24}
                          className="h-12 w-12"
                        />
                      )}

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
      />
    </>
  );
}
