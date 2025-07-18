"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/ui";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReserveHoldingsContent } from "../reserve-holdings/components/reserve-holdings-content";
import { StablecoinSupplyContent } from "../stablecoin-supply/components/stablecoin-supply-content";
import { ReserveAddressesContent } from "../reserve-addresses/components/reserve-addresses-content";
import type {
  HoldingsApi,
  ReserveCompositionAPI,
  StableValueTokensAPI,
  ReserveAddressesResponse,
} from "../lib/types";

interface ReserveTabsProps {
  stableCoinStats: StableValueTokensAPI;
  reserveComposition: ReserveCompositionAPI;
  reserveHoldings: HoldingsApi;
  reserveAddresses: ReserveAddressesResponse;
}

export function ReserveTabs({
  stableCoinStats,
  reserveComposition,
  reserveHoldings,
  reserveAddresses,
}: ReserveTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState("stablecoin-supply");

  // Initialize tab from URL parameter
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (
      tabParam === "reserve-holdings" ||
      tabParam === "stablecoin-supply" ||
      tabParam === "reserve-addresses"
    ) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Update URL without full page navigation
    const newUrl = value === "stablecoin-supply" ? "/" : `/?tab=${value}`;
    router.replace(newUrl, { scroll: false });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="mb-8 w-full gap-0"
    >
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
        <div className="relative z-10">
          <StablecoinSupplyContent stableCoinStats={stableCoinStats} />
        </div>
      </TabsContent>

      <TabsContent
        value="reserve-holdings"
        className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
      >
        <div className="relative z-10">
          <ReserveHoldingsContent
            reserveComposition={reserveComposition}
            reserveHoldings={reserveHoldings}
          />
        </div>
      </TabsContent>

      <TabsContent
        value="reserve-addresses"
        className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
      >
        <h2 className="relative z-10 my-6 hidden text-2xl font-medium md:mb-8 md:mt-12 md:block">
          Reserve Addresses
        </h2>
        <div className="relative z-10">
          <ReserveAddressesContent reserveAddresses={reserveAddresses} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
