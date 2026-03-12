"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { chainIdToSlug } from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";

export default function HomePage() {
  const router = useRouter();
  const chainId = useChainId();

  // Redirect to /swap/[chain] (server-side redirect in next.config.ts handles most cases,
  // this is a fallback for client-side navigation to "/")
  useEffect(() => {
    const chainSlug = chainIdToSlug(chainId) || "celo";
    router.replace(`/swap/${chainSlug}`);
  }, [chainId, router]);

  return null;
}
