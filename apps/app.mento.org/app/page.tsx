"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAtomValue } from "jotai";
import { chainIdToSlug } from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { activeTabAtom } from "@/atoms/navigation";

import { DebugPopup } from "@repo/ui";
import { PoolsView } from "./components/pools/pools-view";
import { BorrowView } from "./components/borrow/borrow-view";
import { EarnView } from "./components/borrow/earn/earn-view";
import { BridgeView } from "./components/bridge/bridge-view";

export default function HomePage() {
  const activeTab = useAtomValue(activeTabAtom);
  const router = useRouter();
  const pathname = usePathname();
  const chainId = useChainId();
  const shouldEnableDebug = process.env.NEXT_PUBLIC_ENABLE_DEBUG === "true";

  // Redirect to /swap/[chain] when swap tab is active on root
  useEffect(() => {
    if (pathname === "/" && activeTab === "swap") {
      const chainSlug = chainIdToSlug(chainId) || "celo";
      router.replace(`/swap/${chainSlug}`);
    }
  }, [pathname, activeTab, chainId, router]);

  // Show nothing while redirecting to swap
  if (activeTab === "swap") {
    return null;
  }

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      {shouldEnableDebug && <DebugPopup />}
      {activeTab === "pool" && <PoolsView />}
      {activeTab === "borrow" && <BorrowView />}
      {activeTab === "earn" && <EarnView />}
      {activeTab === "bridge" && <BridgeView />}
    </div>
  );
}
