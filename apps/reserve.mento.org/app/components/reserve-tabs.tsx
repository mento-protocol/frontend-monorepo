"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/ui";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { OverviewTab } from "./tabs/overview-tab";
import { StablecoinsTab } from "./tabs/stablecoins-tab";
import { CollateralTab } from "./tabs/collateral-tab";
import { PositionsTab } from "./tabs/positions-tab";
import { AddressesTab } from "./tabs/addresses-tab";
import { StalenessBanner } from "./staleness-banner";
import {
  TAB_ENDPOINTS,
  TabType,
  V2_ENDPOINTS,
  fetchV2,
  resolveTab,
  v2QueryKey,
} from "@/lib/queries";

interface ReserveTabsProps {
  initialTab: TabType;
}

export function ReserveTabs({ initialTab }: ReserveTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  useEffect(() => {
    setActiveTab(resolveTab(searchParams?.get("tab")));
  }, [searchParams]);

  // After hydration, warm up queries the server didn't prefetch so
  // switching tabs feels instant. Staggered to avoid a thundering herd.
  useEffect(() => {
    const eager = new Set(TAB_ENDPOINTS[initialTab]);
    const deferred = V2_ENDPOINTS.filter((endpoint) => !eager.has(endpoint));
    const timers = deferred.map((endpoint, index) =>
      setTimeout(() => {
        void queryClient.prefetchQuery({
          queryKey: v2QueryKey(endpoint),
          queryFn: () => fetchV2(endpoint),
        });
      }, index * 150),
    );
    return () => timers.forEach(clearTimeout);
  }, [initialTab, queryClient]);

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === TabType.overview) params.delete("tab");
    else params.set("tab", value);
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  };

  const gradientOverlay =
    "before:top-0 before:h-20 relative before:absolute before:left-1/2 before:z-0 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]";

  return (
    <>
      <StalenessBanner />
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="mb-8 gap-0 w-full"
      >
        <TabsList>
          <TabsTrigger value={TabType.overview}>Overview</TabsTrigger>
          <TabsTrigger value={TabType.stablecoins}>Supply</TabsTrigger>
          <TabsTrigger value={TabType.collateral}>Collateral</TabsTrigger>
          <TabsTrigger value={TabType.positions}>Positions</TabsTrigger>
          <TabsTrigger value={TabType.addresses}>Addresses</TabsTrigger>
        </TabsList>

        <TabsContent value={TabType.overview} className={gradientOverlay}>
          <div className="pt-6 md:pt-12 relative z-10">
            <OverviewTab
              onNavigateToPositions={() => handleTabChange(TabType.positions)}
            />
          </div>
        </TabsContent>

        <TabsContent value={TabType.stablecoins} className={gradientOverlay}>
          <div className="pt-6 md:pt-12 relative z-10">
            <StablecoinsTab />
          </div>
        </TabsContent>

        <TabsContent value={TabType.collateral} className={gradientOverlay}>
          <div className="pt-6 md:pt-12 relative z-10">
            <CollateralTab />
          </div>
        </TabsContent>

        <TabsContent value={TabType.positions} className={gradientOverlay}>
          <div className="pt-6 md:pt-12 relative z-10">
            <PositionsTab />
          </div>
        </TabsContent>

        <TabsContent value={TabType.addresses} className={gradientOverlay}>
          <div className="pt-6 md:pt-12 relative z-10">
            <AddressesTab />
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
