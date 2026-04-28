"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@repo/ui";
import { ChainId, chainIdToChain, useTestnetMode } from "@repo/web3";
import { useSwitchChain } from "@repo/web3/wagmi";
import { ArrowRightLeft, FlaskConical } from "lucide-react";

interface HiddenTestnetStateProps {
  title: string;
  description: string;
  enableLabel?: string;
  fallbackHref?: string;
  fallbackLabel?: string;
  switchChainId?: ChainId;
  refreshOnEnable?: boolean;
}

export function HiddenTestnetState({
  title,
  description,
  enableLabel = "Enable Testnet Mode",
  fallbackHref,
  fallbackLabel,
  switchChainId,
  refreshOnEnable = false,
}: HiddenTestnetStateProps) {
  const router = useRouter();
  const [, setTestnetMode] = useTestnetMode();
  const { switchChainAsync } = useSwitchChain();
  const [isSwitching, setIsSwitching] = useState(false);

  const handleEnable = async () => {
    setTestnetMode(true);

    if (refreshOnEnable) {
      router.refresh();
    }
  };

  const handleSwitch = async () => {
    if (!switchChainAsync || !switchChainId) return;

    try {
      setIsSwitching(true);
      await switchChainAsync({ chainId: switchChainId });
    } catch {
      // wallet rejected or doesn't support switching
    } finally {
      setIsSwitching(false);
    }
  };

  const switchLabel = switchChainId
    ? `Switch to ${chainIdToChain[switchChainId]?.name ?? "mainnet"}`
    : undefined;

  return (
    <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
      <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

      <div className="mb-7 flex justify-center">
        <div className="h-14 w-14 flex items-center justify-center rounded-full bg-primary/10 text-primary">
          <FlaskConical className="h-7 w-7" />
        </div>
      </div>

      <h2 className="mb-2.5 text-xl font-bold tracking-tight">{title}</h2>
      <p className="mb-8 max-w-md text-sm leading-relaxed mx-auto text-muted-foreground">
        {description}
      </p>

      <div className="gap-3 flex flex-wrap items-center justify-center">
        <Button onClick={() => void handleEnable()} size="lg">
          {enableLabel}
        </Button>
        {switchChainId && (
          <Button
            variant="outline"
            size="lg"
            onClick={() => void handleSwitch()}
            disabled={isSwitching}
          >
            <ArrowRightLeft className="h-4 w-4" />
            {switchLabel}
          </Button>
        )}
        {fallbackHref && fallbackLabel && (
          <Button variant="outline" size="lg" asChild>
            <Link href={fallbackHref}>{fallbackLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
