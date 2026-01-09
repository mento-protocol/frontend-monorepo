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

enum TabType {
  stablecoinSupply = "stablecoin-supply",
  reserveHoldings = "reserve-holdings",
  reserveAddresses = "reserve-addresses",
}

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
  const [activeTab, setActiveTab] = useState(TabType.stablecoinSupply);

  // Initialize tab from URL parameter
  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (
      tabParam === TabType.reserveHoldings ||
      tabParam === TabType.stablecoinSupply ||
      tabParam === TabType.reserveAddresses
    ) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
    // Update URL without full page navigation
    const newUrl = value === TabType.stablecoinSupply ? "/" : `/?tab=${value}`;
    router.replace(newUrl, { scroll: false });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="mb-8 gap-0 w-full"
    >
      <TabsList>
        <TabsTrigger value={TabType.stablecoinSupply}>
          Stablecoin Supply
        </TabsTrigger>
        <TabsTrigger value={TabType.reserveHoldings}>
          Reserve Holdings
        </TabsTrigger>
        <TabsTrigger value={TabType.reserveAddresses}>
          Reserve Addresses
        </TabsTrigger>
      </TabsList>

      <TabsContent
        value={TabType.stablecoinSupply}
        className="before:top-0 before:h-20 relative before:absolute before:left-1/2 before:z-0 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
      >
        <h2 className="my-6 text-2xl font-medium md:mb-8 md:mt-12 md:block relative z-10 hidden">
          Stablecoin Supply
        </h2>
        <div className="relative z-10">
          <StablecoinSupplyContent stableCoinStats={stableCoinStats} />
        </div>
      </TabsContent>

      <TabsContent
        value={TabType.reserveHoldings}
        className="before:top-0 before:h-20 relative before:absolute before:left-1/2 before:z-0 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
      >
        <div className="relative z-10">
          <ReserveHoldingsContent
            reserveComposition={reserveComposition}
            reserveHoldings={reserveHoldings}
          />
        </div>
      </TabsContent>

      <TabsContent
        value={TabType.reserveAddresses}
        className="before:top-0 before:h-20 relative before:absolute before:left-1/2 before:z-0 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
      >
        <h2 className="my-6 text-2xl font-medium md:mb-8 md:mt-12 md:block relative z-10 hidden">
          Reserve Addresses
        </h2>
        <div className="relative z-10">
          <ReserveAddressesContent reserveAddresses={reserveAddresses} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
