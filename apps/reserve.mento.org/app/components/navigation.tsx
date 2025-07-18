"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/ui";

// Define tab configuration for easy maintenance
const TABS = [
  {
    value: "stablecoin-supply",
    href: "/stablecoin-supply",
    label: "Stablecoin Supply",
  },
  {
    value: "reserve-holdings",
    href: "/reserve-holdings",
    label: "Reserve Holdings",
  },
  // Add new tabs here when needed
] as const;

interface NavigationProps {
  children: React.ReactNode;
}

export function Navigation({ children }: NavigationProps) {
  const pathname = usePathname();

  // Determine current value based on pathname
  const currentValue =
    TABS.find((tab) => tab.href === pathname)?.value || TABS[0].value;

  return (
    <Tabs value={currentValue} className="mb-8 w-full gap-0">
      <TabsList>
        {TABS.map((tab) => (
          <Link key={tab.value} href={tab.href} scroll={false} prefetch={true}>
            <TabsTrigger value={tab.value}>{tab.label}</TabsTrigger>
          </Link>
        ))}
      </TabsList>
      <TabsContent
        value={currentValue}
        className="relative before:absolute before:left-1/2 before:top-0 before:z-0 before:h-20 before:w-screen before:-translate-x-1/2 before:bg-gradient-to-b before:from-[#15111B] before:to-[#070010]"
      >
        {children}
      </TabsContent>
    </Tabs>
  );
}
