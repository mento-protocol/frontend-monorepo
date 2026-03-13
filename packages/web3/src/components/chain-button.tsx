"use client";

import { chainIdToChain, ChainId } from "@/config/chains";
import { NetworkDialog } from "@/components/network-dialog";
import { useChainModal } from "@rainbow-me/rainbowkit";
import { Button, cn } from "@repo/ui";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import celoIcon from "@/config/chain-icons/celo.svg";
import monadIcon from "@/config/chain-icons/monad.svg";

const chainIcons: Record<number, string> = {
  [ChainId.Celo]: celoIcon,
  [ChainId.CeloSepolia]: celoIcon,
  [ChainId.Monad]: monadIcon,
  [ChainId.MonadTestnet]: monadIcon,
};

export function ChainButton() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const currentChain = chainIdToChain[chainId];
  const { openChainModal } = useChainModal();
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);

  if (!isConnected) return null;

  const iconUrl = chainIcons[chainId];

  const onClickChain = () => {
    if (openChainModal) {
      openChainModal();
    } else {
      setShowNetworkDialog(true);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "h-9 gap-2 px-3 py-2 font-medium",
          "border-border-secondary text-accent-foreground",
        )}
        onClick={onClickChain}
        data-testid="change-network-button"
      >
        {iconUrl && (
          <img
            src={iconUrl}
            alt={currentChain?.name ?? "Chain"}
            className="size-5 rounded-full"
          />
        )}
        <span className="sm:inline hidden">
          {currentChain?.name ?? "Unknown"}
        </span>
        <ChevronDown size={16} />
      </Button>
      {showNetworkDialog && (
        <NetworkDialog
          isOpen={showNetworkDialog}
          close={() => setShowNetworkDialog(false)}
        />
      )}
    </>
  );
}
