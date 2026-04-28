"use client";

import { chainIdToChain, ChainId } from "@/config/chains";
import { resetLatestBlockAtom } from "@/features/blocks/block-atoms";
import { resetSwapUiAtomsAtom } from "@/features/swap/swap-atoms";
import { useVisibleChains } from "@/config/testnet-mode";
import { logger } from "@/utils/logger";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
  toast,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { MentoChain } from "@/types";
import celoIcon from "@/config/chain-icons/celo.svg";
import monadIcon from "@/config/chain-icons/monad.svg";

const chainIcons: Record<number, string> = {
  [ChainId.Celo]: celoIcon,
  [ChainId.CeloSepolia]: celoIcon,
  [ChainId.Monad]: monadIcon,
  [ChainId.MonadTestnet]: monadIcon,
};

function resolveChainIconUrl(chain?: MentoChain): string | undefined {
  if (!chain) return undefined;

  const iconUrl = chainIcons[chain.id] ?? chain.iconUrl;
  return typeof iconUrl === "string" ? iconUrl : undefined;
}

interface ChainButtonProps {
  chains?: MentoChain[];
}

export function ChainButton({ chains }: ChainButtonProps = {}) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const currentChain = chainIdToChain[chainId];
  const visibleChainIds = useVisibleChains();
  const [open, setOpen] = useState(false);
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const resetJotaiSwapState = useSetAtom(resetSwapUiAtomsAtom);
  const setResetLatestBlock = useSetAtom(resetLatestBlockAtom);

  const availableChains = useMemo(
    () =>
      chains ??
      visibleChainIds
        .map((visibleChainId) => chainIdToChain[visibleChainId])
        .filter((chain): chain is MentoChain => Boolean(chain)),
    [chains, visibleChainIds],
  );

  if (!isConnected) return null;

  const iconUrl = resolveChainIconUrl(currentChain);

  const switchToNetwork = async (chain: MentoChain) => {
    if (chain.id === currentChain?.id) {
      setOpen(false);
      return;
    }

    try {
      if (!switchChainAsync) throw new Error("switchChainAsync undefined");
      logger.debug("Resetting and switching to network", chain.name);
      await switchChainAsync({ chainId: chain.id });
      setResetLatestBlock();
      queryClient.resetQueries({ queryKey: ["accountBalances"] });
      resetJotaiSwapState();
      setOpen(false);
    } catch (error) {
      logger.error("Error updating network", error);
      toast.error("Could not switch network, does wallet support switching?");
    }
  };

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 px-3 py-2 font-medium",
            "border-border-secondary text-accent-foreground",
          )}
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 p-2 max-h-[min(70vh,26rem)] overflow-y-auto"
      >
        {availableChains.map((chain) => {
          const isCurrent = chain.id === currentChain?.id;
          const chainIconUrl = resolveChainIconUrl(chain);

          return (
            <DropdownMenuItem
              key={chain.id}
              onClick={() => void switchToNetwork(chain)}
              className={cn(
                "gap-3 px-3 py-3 cursor-pointer rounded-md",
                isCurrent && "bg-accent text-accent-foreground",
              )}
            >
              {chainIconUrl ? (
                <img
                  src={chainIconUrl}
                  alt={chain.name}
                  className="size-5 shrink-0 rounded-full"
                />
              ) : (
                <div className="size-5 shrink-0 rounded-full bg-muted" />
              )}
              <span className="flex-1 truncate">{chain.name}</span>
              {isCurrent && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
