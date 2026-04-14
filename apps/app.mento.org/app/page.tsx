"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ChainId,
  chainIdToSlug,
  getPreferredVisibleChain,
  useTestnetMode,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { SwapSkeleton } from "./swap/swap-skeleton";

export default function HomePage() {
  const router = useRouter();
  const chainId = useChainId();
  const [testnetMode] = useTestnetMode();

  console.info("test 1");
  console.info("test 2");

  useEffect(() => {
    const routeChainId = getPreferredVisibleChain({
      chainId,
      feature: "swap",
      testnetMode,
      fallbackChainId: ChainId.Celo,
    });
    const chainSlug = chainIdToSlug(routeChainId) || "celo";
    router.replace(`/swap/${chainSlug}`);
  }, [chainId, router, testnetMode]);

  return <SwapSkeleton />;
}
