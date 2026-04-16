"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/ui";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OverviewTab } from "./tabs/overview-tab";
import { StablecoinsTab } from "./tabs/stablecoins-tab";
import { CollateralTab } from "./tabs/collateral-tab";
import { PositionsTab } from "./tabs/positions-tab";
import { AddressesTab } from "./tabs/addresses-tab";
import type { ReservePageData } from "@/lib/types";

enum TabType {
  overview = "overview",
  stablecoins = "stablecoins",
  collateral = "collateral",
  positions = "positions",
  addresses = "addresses",
}

export function ReserveTabs({ data }: { data: ReservePageData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(TabType.overview);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && Object.values(TabType).includes(tabParam as TabType)) {
      setActiveTab(tabParam as TabType);
    }
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabType);
    const newUrl =
      value === TabType.overview ? "/" : `/?tab=${value}`;
    router.replace(newUrl, { scroll: false });
  };

  const gradientOverlay =
    "before:top-0 before:h-20 relative before:absolute before:left-1/2 before:z-0 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]";

  return (
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
        <div className="relative z-10 pt-6 md:pt-12">
          <OverviewTab
            overview={data.overview}
            onNavigateToPositions={() => handleTabChange(TabType.positions)}
          />
        </div>
      </TabsContent>

      <TabsContent value={TabType.stablecoins} className={gradientOverlay}>
        <div className="relative z-10 pt-6 md:pt-12">
          <StablecoinsTab stablecoins={data.stablecoins} />
        </div>
      </TabsContent>

      <TabsContent value={TabType.collateral} className={gradientOverlay}>
        <div className="relative z-10 pt-6 md:pt-12">
          <CollateralTab reserve={data.reserve} />
        </div>
      </TabsContent>

      <TabsContent value={TabType.positions} className={gradientOverlay}>
        <div className="relative z-10 pt-6 md:pt-12">
          <PositionsTab reserve={data.reserve} stablecoins={data.stablecoins} />
        </div>
      </TabsContent>

      <TabsContent value={TabType.addresses} className={gradientOverlay}>
        <div className="relative z-10 pt-6 md:pt-12">
          <AddressesTab addresses={data.addresses} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
