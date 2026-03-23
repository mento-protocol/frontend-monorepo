"use client";

import { use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { chainSlugToId, usePoolsList, type ChainId } from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { LiquidityPanel } from "@/components/pools/liquidity-panel";
import { LiquidityFlowDialog } from "@/components/pools/liquidity-flow-dialog";
import { ChainMismatchBanner } from "@/components/shared/chain-mismatch-banner";
import { getOpportunityBackLink } from "@/lib/opportunity-navigation";
import { Skeleton } from "@repo/ui";
import { ArrowLeft, Droplets } from "lucide-react";
import Link from "next/link";

export default function PoolDetailPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = use(params);
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "manage" ? "manage" : "deposit";
  const backLink = getOpportunityBackLink(searchParams.get("source"));

  const chainId = chainSlugToId(chain);

  if (!chainId) {
    return (
      <PoolError
        backHref={backLink.href}
        backLabel={backLink.label}
        title="Unknown network"
        description={`"${chain}" is not a supported network. Try celo, celo-sepolia, monad, or monad-testnet.`}
      />
    );
  }

  return (
    <PoolDetailContent
      chainId={chainId}
      address={address}
      mode={mode as "deposit" | "manage"}
      backHref={backLink.href}
      backLabel={backLink.label}
    />
  );
}

function PoolDetailContent({
  chainId,
  address,
  mode,
  backHref,
  backLabel,
}: {
  chainId: ChainId;
  address: string;
  mode: "deposit" | "manage";
  backHref: "/earn" | "/pools";
  backLabel: "Back to Earn" | "Back to Pools";
}) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { data: pools, isLoading, isError } = usePoolsList(chainId);
  const isWrongChain = isConnected && walletChainId !== chainId;

  if (isLoading && !pools) {
    return <PoolDetailSkeleton />;
  }

  if (isError && !pools) {
    return (
      <PoolError
        backHref={backHref}
        backLabel={backLabel}
        title="Failed to load pool"
        description="Could not fetch pool data. Please check your connection and try again."
      />
    );
  }

  const pool = pools?.find(
    (p) => p.poolAddr.toLowerCase() === address.toLowerCase(),
  );

  if (!pool) {
    return (
      <PoolError
        backHref={backHref}
        backLabel={backLabel}
        title="Pool not found"
        description={`No pool found at address ${address} on this network.`}
      />
    );
  }

  if (pool.poolType === "Legacy") {
    return (
      <PoolError
        backHref={backHref}
        backLabel={backLabel}
        title="Legacy pool"
        description="Liquidity actions are not available for legacy pools. These pools are planned for migration to FPMM."
      />
    );
  }

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="mb-6 max-w-5xl px-4 pt-6 md:px-0 md:pt-0 space-y-5 min-h-[550px] w-full">
        <ChainMismatchBanner targetChainId={chainId} />
        <LiquidityPanel
          pool={pool}
          mode={mode}
          onClose={() => router.push(backHref)}
          backLabel={backLabel}
          disabled={isWrongChain}
          chainId={chainId}
        />
      </div>
      <LiquidityFlowDialog />
    </div>
  );
}

function PoolDetailSkeleton() {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="mb-6 max-w-5xl px-4 pt-6 md:px-0 md:pt-0 space-y-5 min-h-[550px] w-full">
        <div className="h-5 w-28">
          <Skeleton className="h-full w-full" />
        </div>
        <div className="gap-4 px-6 py-5 flex items-center rounded-xl border border-border bg-card">
          <div className="-space-x-2.5 flex">
            <Skeleton className="h-[38px] w-[38px] rounded-full" />
            <Skeleton className="h-[38px] w-[38px] rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="gap-4 grid grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="px-4 py-3 space-y-2 rounded-xl border border-border bg-card"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

function PoolError({
  backHref,
  backLabel,
  title,
  description,
}: {
  backHref: "/earn" | "/pools";
  backLabel: "Back to Earn" | "Back to Pools";
  title: string;
  description: string;
}) {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="max-w-5xl px-4 pt-6 md:px-0 md:pt-0 w-full">
        <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
          <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-destructive/50 to-transparent" />
          <div className="mb-7 flex justify-center">
            <div className="h-14 w-14 flex items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <Droplets className="h-7 w-7" />
            </div>
          </div>
          <h2 className="mb-2.5 text-xl font-bold tracking-tight">{title}</h2>
          <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
            {description}
          </p>
          <Link
            href={backHref}
            className="gap-1.5 text-sm font-medium inline-flex items-center text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
