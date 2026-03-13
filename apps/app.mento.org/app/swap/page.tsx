"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { chainIdToSlug } from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { SwapSkeleton } from "./swap-skeleton";

export default function SwapRedirectPage() {
  const router = useRouter();
  const chainId = useChainId();

  useEffect(() => {
    const chainSlug = chainIdToSlug(chainId) || "celo";
    router.replace(`/swap/${chainSlug}`);
  }, [chainId, router]);

  return <SwapSkeleton />;
}
