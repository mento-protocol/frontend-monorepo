"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChainId,
  chainIdToSlug,
  getPreferredVisibleChain,
  useTestnetMode,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { SwapSkeleton } from "./swap-skeleton";

export default function SwapRedirectPage() {
  const router = useRouter();
  const chainId = useChainId();
  const [testnetMode] = useTestnetMode();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  console.info("test");
  console.info("test 2");

  useEffect(() => {
    const routeChainId = getPreferredVisibleChain({
      chainId,
      feature: "swap",
      testnetMode,
      fallbackChainId: ChainId.Celo,
    });
    const chainSlug = chainIdToSlug(routeChainId) || "celo";
    const query = search ? `?${search}` : "";
    router.replace(`/swap/${chainSlug}${query}`);
  }, [chainId, router, search, testnetMode]);

  return <SwapSkeleton />;
}
