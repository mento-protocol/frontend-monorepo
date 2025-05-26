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

  return (
    <>
      <Tabs defaultValue="stablecoin-supply" className="mb-8 w-full md:mt-20">
        <TabsList>
          <TabsTrigger value="stablecoin-supply">Stablecoin Supply</TabsTrigger>
          <TabsTrigger value="reserve-holdings">Reserve Holdings</TabsTrigger>
        </TabsList>
        <TabsContent value="stablecoin-supply">
          <h2 className="my-6 text-2xl font-medium md:mb-8 md:mt-12">
            Stablecoin Supply
          </h2>
          <div className="flex h-full flex-wrap gap-2 md:gap-4">
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
        <TabsContent value="reserve-holdings">
          <div className="flex flex-col gap-2 md:mt-12 md:grid md:grid-cols-12">
            <div className="bg-card mb-2 flex h-full flex-1 flex-col p-6 md:col-span-4 md:mb-0">
              <h2 className="text-2xl font-medium">Reserve Holdings</h2>
              <ReserveChart
                data={chartData}
                centerText={centerChartText}
                activeSegment={active}
                className="my-auto h-[288px] justify-center self-center"
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-8">
              {(() => {
                const celoDetails = reserveHoldings.celo.unfrozen;
                const celoComp = reserveComposition.find(
                  (c) => c.token === celoDetails.token,
                );

                // TODO: Confirm CELO icon path or make it dynamic if possible
                const celoIcon = "/icons/celo.svg"; // Placeholder icon path

                return (
                  <CoinCard
                    key={`${celoDetails.token}-unfrozen`}
                    variant="horizontal"
                    className="border-l-2"
                    style={{
                      borderLeftColor: getTokenColor(celoDetails.token),
                    }}
                    onMouseEnter={() => setActive(celoDetails.token)}
                    onMouseLeave={() => setActive(undefined)}
                  >
                    <CoinCardHeader className="items-center md:justify-between md:gap-4">
                      <CoinCardLogo className="h-12 w-12">
                        <Image
                          src={celoIcon} // Replace with actual CELO icon path or dynamic URL
                          alt={celoDetails.token}
                          width={24}
                          height={24}
                          className="h-6 w-6"
                        />
                      </CoinCardLogo>
                      <CoinCardHeaderGroup>
                        <CoinCardSymbol>{celoDetails.token}</CoinCardSymbol>
                      </CoinCardHeaderGroup>
                    </CoinCardHeader>
                    <CoinCardFooter>
                      <span>
                        {celoDetails.units.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      <span className="font-medium">
                        {celoDetails.value.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })}
                      </span>
                      {celoComp && (
                        <div className="text-muted-foreground text-sm">
                          {celoComp.percent.toFixed(2)}%
                        </div>
                      )}
                    </CoinCardFooter>
                  </CoinCard>
                );
              })()}

              {reserveHoldings.otherAssets.map((asset) => {
                const assetComp = reserveComposition.find(
                  (c) => c.token === asset.token,
                );

                return (
                  <CoinCard
                    key={asset.token}
                    variant="horizontal"
                    className="border-l-2"
                    style={{
                      borderLeftColor: getTokenColor(asset.token),
                    }}
                    onMouseEnter={() => setActive(asset.token)}
                    onMouseLeave={() => setActive(undefined)}
                  >
                    <CoinCardHeader className="md:justify-between md:gap-4">
                      {asset.iconUrl && (
                        <CoinCardLogo className="h-12 w-12">
                          <Image
                            src={asset.iconUrl}
                            alt={asset.token}
                            width={24}
                            height={24}
                            className="h-6 w-6"
                          />
                        </CoinCardLogo>
                      )}
                      <CoinCardHeaderGroup>
                        <CoinCardSymbol>{asset.token}</CoinCardSymbol>
                      </CoinCardHeaderGroup>
                    </CoinCardHeader>
                    <CoinCardFooter className="flex w-full md:justify-between">
                      <span>
                        {asset.units.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      <span className="text-muted-foreground font-medium">
                        {asset.value.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                        })}
                      </span>
                      {assetComp && (
                        <div className="text-muted-foreground">
                          {assetComp.percent.toFixed(2)}%
                        </div>
                      )}
                    </CoinCardFooter>
                  </CoinCard>
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
