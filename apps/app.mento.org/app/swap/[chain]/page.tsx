"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { chainSlugToId } from "@repo/web3";
import { ArrowLeft, ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { SwapPageContent } from "./swap-page-content";

export default function SwapPage({
  params,
}: {
  params: Promise<{ chain: string }>;
}) {
  const { chain } = use(params);
  const searchParams = useSearchParams();

  const chainId = chainSlugToId(chain);

  if (!chainId) {
    return <SwapError chain={chain} />;
  }

  const initialFrom = searchParams.get("from") || undefined;
  const initialTo = searchParams.get("to") || undefined;
  const initialAmount = searchParams.get("amount") || undefined;

  return (
    <SwapPageContent
      chainId={chainId}
      initialFrom={initialFrom}
      initialTo={initialTo}
      initialAmount={initialAmount}
    />
  );
}

function SwapError({ chain }: { chain: string }) {
  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <div className="px-4 md:px-0 w-full max-w-[568px]">
        <div className="px-6 py-14 relative overflow-hidden border border-border bg-card text-center">
          <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-destructive/50 to-transparent" />
          <div className="mb-7 flex justify-center">
            <div className="h-14 w-14 flex items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ArrowRightLeft className="h-7 w-7" />
            </div>
          </div>
          <h2 className="mb-2.5 text-xl font-bold tracking-tight">
            Unknown network
          </h2>
          <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
            &quot;{chain}&quot; is not a supported network. Try celo,
            celo-sepolia, monad, or monad-testnet.
          </p>
          <Link
            href="/swap/celo"
            className="gap-1.5 text-sm font-medium inline-flex items-center text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Go to Swap
          </Link>
        </div>
      </div>
    </div>
  );
}
