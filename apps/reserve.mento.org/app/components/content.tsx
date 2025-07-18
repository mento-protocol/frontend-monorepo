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
import { useState, useRef, useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AddressSection } from "./address-section";
import { ChainId, getTokenAddress } from "../lib/config/tokenConfig";
import type {
  HoldingsApi,
  ReserveCompositionAPI,
  ReserveCompositionEntry,
  StableValueTokensAPI,
  ReserveAddressesResponse,
} from "../lib/types";

interface ContentProps {
  stableCoinStats: StableValueTokensAPI;
  reserveComposition: ReserveCompositionAPI;
  reserveHoldings: HoldingsApi;
  reserveAddresses: ReserveAddressesResponse;
}

export default function Content({
  stableCoinStats,
  reserveComposition,
  reserveHoldings,
  reserveAddresses,
}: ContentProps) {
  const [expandedToken, setExpandedToken] = useState<string | undefined>(
    undefined,
  );
  const [copiedAddresses, setCopiedAddresses] = useState<Set<string>>(
    new Set(),
  );

  // Track active timeouts to prevent memory leaks
  const copyTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Constants
  const CLIPBOARD_COPY_FEEDBACK_DURATION = 500;

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      copyTimeoutsRef.current.forEach((timeout) => {
        clearTimeout(timeout);
      });
      copyTimeoutsRef.current.clear();
    };
  }, []);

  // Function to get DeBank portfolio URL for any address
  const getDebankUrl = (address: string): string => {
    return `https://debank.com/profile/${address}`;
  };

  const handleCopyAddress = async (
    address: string,
    category: string,
    network: string,
  ) => {
    try {
      await navigator.clipboard.writeText(address);
      const uniqueKey = `${category}-${network}-${address}`;
      setCopiedAddresses((prev) => new Set(prev).add(uniqueKey));

      // Clear any existing timeout for this address
      const existingTimeout = copyTimeoutsRef.current.get(uniqueKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Remove the copied state after the feedback duration
      const timeoutId = setTimeout(() => {
        setCopiedAddresses((prev) => {
          const newSet = new Set(prev);
          newSet.delete(uniqueKey);
          return newSet;
        });
        // Clean up the timeout reference
        copyTimeoutsRef.current.delete(uniqueKey);
      }, CLIPBOARD_COPY_FEEDBACK_DURATION);

      // Store the timeout reference
      copyTimeoutsRef.current.set(uniqueKey, timeoutId);
    } catch (error) {
      Sentry.captureException(error, {
        tags: {
          operation: "clipboard_copy",
          category,
          network,
        },
        extra: {
          address,
        },
      });
    }
  };

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
          <TabsTrigger value="reserve-addresses">Reserve Addresses</TabsTrigger>
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
                    <CoinCardSymbol>
                      {(() => {
                        const chainId = ChainId.Celo;
                        const tokenAddress = getTokenAddress(
                          token.token,
                          chainId,
                        );

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
            <div className="bg-card mb-2 flex h-full flex-1 flex-col p-6 pb-20 md:col-span-6 md:mb-0 xl:col-span-4">
              <h2 className="relative z-10 hidden text-2xl font-medium md:block">
                Reserve Holdings
              </h2>
              <ReserveChart
                data={chartData}
                centerText={centerChartText}
                activeSegment={expandedToken}
                className="my-auto h-[288px] justify-center self-center lg:h-[320px] xl:h-[360px] 2xl:h-[480px] min-[2500px]:!h-[640px]"
                onActiveChanged={(name) => {
                  setExpandedToken(name);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2 md:col-span-6 xl:col-span-8">
              {(() => {
                const celoDetails = reserveHoldings.celo.unfrozen;
                const celoComp = reserveComposition.find(
                  (c) => c.token === celoDetails.token,
                );

                const celoIcon = "/tokens/CELO.svg";

                return (
                  <>
                    <div
                      key={`${celoDetails.token}-unfrozen`}
                      className={`${celoDetails.token === expandedToken ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} grid w-full grid-cols-2 gap-4 border-l-4 p-4 xl:grid-cols-12`}
                      style={{
                        borderLeftColor: getTokenColor(celoDetails.token),
                      }}
                      onMouseEnter={() => setExpandedToken(celoDetails.token)}
                      onMouseLeave={() => setExpandedToken(undefined)}
                    >
                      <div className="col-span-2 flex flex-row items-center justify-start gap-4 text-xl font-medium xl:col-span-3">
                        <Image
                          src={celoIcon}
                          alt={celoDetails.token}
                          width={24}
                          height={24}
                          className="h-9 w-9"
                        />

                        {celoDetails.token}
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
                  (c) => c.token === asset.token,
                );

                const iconPath = `/tokens/${asset.token}.svg`;

                return (
                  <div
                    key={asset.token}
                    className={`${asset.token === expandedToken ? "bg-accent hover:bg-accent" : "bg-card hover:bg-accent"} grid w-full grid-cols-2 gap-4 border-l-4 p-4 xl:grid-cols-12`}
                    style={{
                      borderLeftColor: getTokenColor(asset.token),
                    }}
                    onMouseEnter={() => setExpandedToken(asset.token)}
                    onMouseLeave={() => setExpandedToken(undefined)}
                  >
                    <div className="col-span-2 flex flex-row items-center justify-start gap-4 text-xl font-medium xl:col-span-3">
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
        </TabsContent>
        <TabsContent
          value="reserve-addresses"
          className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
        >
          <h2 className="relative z-10 my-6 hidden text-2xl font-medium md:mb-8 md:mt-12 md:block">
            Reserve Addresses
          </h2>
          <div className="relative z-10 flex h-full flex-col gap-4 md:gap-8">
            <div className="flex flex-col gap-2">
              <AddressSection
                groups={reserveAddresses.addresses.filter(
                  (group) => group.category === "Mento Reserve",
                )}
                getDebankUrl={getDebankUrl}
                handleCopyAddress={handleCopyAddress}
                copiedAddresses={copiedAddresses}
              />

              <AddressSection
                groups={reserveAddresses.addresses.filter(
                  (group) => group.category !== "Mento Reserve",
                )}
                getDebankUrl={getDebankUrl}
                handleCopyAddress={handleCopyAddress}
                copiedAddresses={copiedAddresses}
              />
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
