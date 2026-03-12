"use client";

import { chainIdToChain, type ChainId } from "@repo/web3";
import { useAccount, useChainId, useSwitchChain } from "@repo/web3/wagmi";
import { Button } from "@repo/ui";
import { ArrowRightLeft } from "lucide-react";

export function ChainMismatchBanner({
  targetChainId,
}: {
  targetChainId: ChainId;
}) {
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  if (!isConnected || walletChainId === targetChainId) return null;

  const walletChain = chainIdToChain[walletChainId as ChainId];
  const targetChain = chainIdToChain[targetChainId];
  const walletName = walletChain?.name ?? `Chain ${walletChainId}`;
  const targetName = targetChain?.name ?? `Chain ${targetChainId}`;

  const handleSwitch = async () => {
    try {
      await switchChainAsync({ chainId: targetChainId });
    } catch {
      // wallet rejected or doesn't support switching
    }
  };

  return (
    <div className="p-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5">
      <div>
        <p className="font-medium text-sm">Wrong network</p>
        <p className="text-sm text-muted-foreground">
          You&apos;re connected to {walletName}. Switch to {targetName} to
          continue.
        </p>
      </div>
      <Button onClick={handleSwitch} size="sm" className="ml-4 gap-2 shrink-0">
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Switch to {targetName}
      </Button>
    </div>
  );
}
