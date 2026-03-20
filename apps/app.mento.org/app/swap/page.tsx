"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { chainIdToSlug } from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { SwapSkeleton } from "./swap-skeleton";

export default function SwapRedirectPage() {
  const router = useRouter();
  const chainId = useChainId();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    const chainSlug = chainIdToSlug(chainId) || "celo";
    const query = search ? `?${search}` : "";
    router.replace(`/swap/${chainSlug}${query}`);
  }, [chainId, router, search]);

  return <SwapSkeleton />;
}
