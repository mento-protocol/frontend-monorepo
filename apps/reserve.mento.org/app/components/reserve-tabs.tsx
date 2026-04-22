"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/ui";
import { useState, useEffect } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
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

// Map legacy ?tab= values (from the old separate pages) to the new enum.
const LEGACY_TAB_ALIASES: Record<string, TabType> = {
  "stablecoin-supply": TabType.stablecoins,
  "reserve-holdings": TabType.collateral,
  "reserve-addresses": TabType.addresses,
};

function resolveTab(
  params: ReadonlyURLSearchParams | URLSearchParams | null,
): TabType {
  const tabParam = params?.get("tab");
  if (!tabParam) return TabType.overview;
  const normalized = LEGACY_TAB_ALIASES[tabParam] ?? tabParam;
  return Object.values(TabType).includes(normalized as TabType)
    ? (normalized as TabType)
    : TabType.overview;
}

export function ReserveTabs({ data }: { data: ReservePageData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Initialize synchronously from the URL so direct loads of /?tab=...
  // server-render the correct panel instead of flashing Overview first.
  const [activeTab, setActiveTab] = useState(() => resolveTab(searchParams));

  useEffect(() => {
    setActiveTab(resolveTab(searchParams));
  }, [searchParams]);

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
            overview={data.overview}
            onNavigateToPositions={() => handleTabChange(TabType.positions)}
          />
        </div>
      </TabsContent>

      <TabsContent value={TabType.stablecoins} className={gradientOverlay}>
        <div className="pt-6 md:pt-12 relative z-10">
          <StablecoinsTab stablecoins={data.stablecoins} />
        </div>
      </TabsContent>

      <TabsContent value={TabType.collateral} className={gradientOverlay}>
        <div className="pt-6 md:pt-12 relative z-10">
          <CollateralTab reserve={data.reserve} />
        </div>
      </TabsContent>

      <TabsContent value={TabType.positions} className={gradientOverlay}>
        <div className="pt-6 md:pt-12 relative z-10">
          <PositionsTab reserve={data.reserve} stablecoins={data.stablecoins} />
        </div>
      </TabsContent>

      <TabsContent value={TabType.addresses} className={gradientOverlay}>
        <div className="pt-6 md:pt-12 relative z-10">
          <AddressesTab addresses={data.addresses} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
