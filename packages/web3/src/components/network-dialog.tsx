"use client";

import {
  latestBlockAtom,
  resetLatestBlockAtom,
} from "@/features/blocks/block-atoms";
import { resetSwapUiAtomsAtom } from "@/features/swap/swap-atoms";
import { allChains, chainIdToChain } from "@/config/chains";
import { logger } from "@/utils/logger";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  toast,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useChainId, useSwitchChain } from "wagmi";
import { MentoChain } from "@/types";

interface Props {
  isOpen: boolean;
  close: () => void;
}

const baseLocator = "networkModal";

export function NetworkDialog({ isOpen, close }: Props) {
  const latestBlock = useAtomValue(latestBlockAtom);
  const chainId = useChainId();
  const currentChain = chainIdToChain[chainId];
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const resetJotaiSwapState = useSetAtom(resetSwapUiAtomsAtom);
  const setResetLatestBlock = useSetAtom(resetLatestBlockAtom);

  const switchToNetwork = async (c: MentoChain) => {
    try {
      if (!switchChainAsync) throw new Error("switchChainAsync undefined");
      logger.debug("Resetting and switching to network", c.name);
      await switchChainAsync({ chainId: c.id });
      setResetLatestBlock();
      queryClient.resetQueries({ queryKey: ["accountBalances"] });
      resetJotaiSwapState();
    } catch (error) {
      logger.error("Error updating network", error);
      toast.error("Could not switch network, does wallet support switching?");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Network details</DialogTitle>
        </DialogHeader>

        <div className="inline-flex w-full items-end justify-between">
          <div className="font-inter gap-4 py-3 sm:py-4 inline-flex w-full flex-col items-center justify-start rounded-xl">
            <div className="px-3 sm:px-4 inline-flex w-full items-end justify-between">
              <div className="font-normal leading-tight sm:text-[15px] text-[14px] text-muted-foreground">
                Connected to:
              </div>
              <div
                className="font-medium leading-tight text-right text-[15px] text-foreground opacity-90"
                data-testid={`${baseLocator}_currentNetwork`}
              >
                {currentChain?.name || "Unknown"}
              </div>
            </div>
            <div className="h-[0px] w-full border-t border-border" />
            <div className="px-3 sm:px-4 inline-flex w-full items-end justify-between">
              <div className="font-normal leading-tight sm:text-[15px] text-[14px] text-muted-foreground">
                Block Number:
              </div>
              <div
                className="font-medium leading-tight sm:text-[15px] text-right text-[14px] text-foreground opacity-90"
                data-testid={`${baseLocator}_currentBlockNumber`}
              >
                {latestBlock?.number || "Unknown"}
              </div>
            </div>
            <div className="h-[0px] w-full border-t border-border" />
            <div className="px-3 sm:px-4 inline-flex w-full items-end justify-between">
              <div className="font-normal leading-tight sm:text-[15px] text-[14px] text-muted-foreground">
                Node Rpc Url:
              </div>
              <div
                className="font-medium leading-tight sm:text-[15px] text-right text-[14px] text-foreground opacity-90"
                data-testid={`${baseLocator}_currentNodeRpcUrl`}
              >
                {shortenUrl(currentChain?.rpcUrls?.default?.http[0]) ||
                  "Unknown"}
              </div>
            </div>
          </div>
        </div>

        <div className="h-[0px] w-full border-t border-border" />

        <div className="font-inter gap-2 inline-flex w-full items-start justify-center">
          {allChains.map((c) => (
            <Button
              type="button"
              onClick={() => switchToNetwork(c)}
              key={c.id}
              variant={c.id === currentChain?.id ? "default" : "outline"}
            >
              {c.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function shortenUrl(url?: string) {
  try {
    if (!url) return null;
    return new URL(url).hostname;
  } catch (error) {
    logger.error("Error parsing url", error);
    return null;
  }
}
