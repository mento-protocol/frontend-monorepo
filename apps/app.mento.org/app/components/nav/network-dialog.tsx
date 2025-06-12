"use client";

import {
  latestBlockAtom,
  resetLatestBlockAtom,
} from "@/features/blocks/block-atoms";
import { resetSwapUiAtomsAtom } from "@/features/swap/swap-atoms";
import {
  type ChainMetadata,
  allChains,
  chainIdToChain,
} from "@/lib/config/chains";
import { cleanupStaleWalletSessions } from "@/lib/config/wallets";
import { logger } from "@/lib/utils/logger";
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
import { useChainId, useSwitchNetwork } from "wagmi";

interface Props {
  isOpen: boolean;
  close: () => void;
}

const baseLocator = "networkModal";

export function NetworkDialog({ isOpen, close }: Props) {
  const latestBlock = useAtomValue(latestBlockAtom);
  const chainId = useChainId();
  const currentChain = chainIdToChain[chainId];
  const { switchNetworkAsync } = useSwitchNetwork();
  const queryClient = useQueryClient();
  const resetJotaiSwapState = useSetAtom(resetSwapUiAtomsAtom);
  const setResetLatestBlock = useSetAtom(resetLatestBlockAtom);

  const switchToNetwork = async (c: ChainMetadata) => {
    try {
      if (!switchNetworkAsync) throw new Error("switchNetworkAsync undefined");
      logger.debug("Resetting and switching to network", c.name);
      cleanupStaleWalletSessions();
      await switchNetworkAsync(c.chainId);
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
          <div className="font-inter inline-flex w-full flex-col items-center justify-start gap-4 rounded-xl py-3 sm:py-4">
            <div className="inline-flex w-full items-end justify-between px-3 sm:px-4">
              <div className="text-muted-foreground text-[14px] font-normal leading-tight sm:text-[15px]">
                Connected to:
              </div>
              <div
                className="text-foreground text-right text-[15px] font-medium leading-tight opacity-90"
                data-testid={`${baseLocator}_currentNetwork`}
              >
                {currentChain?.name || "Unknown"}
              </div>
            </div>
            <div className="border-border h-[0px] w-full border-t" />
            <div className="inline-flex w-full items-end justify-between px-3 sm:px-4">
              <div className="text-muted-foreground text-[14px] font-normal leading-tight sm:text-[15px]">
                Block Number:
              </div>
              <div
                className="text-foreground text-right text-[14px] font-medium leading-tight opacity-90 sm:text-[15px]"
                data-testid={`${baseLocator}_currentBlockNumber`}
              >
                {latestBlock?.number || "Unknown"}
              </div>
            </div>
            <div className="border-border h-[0px] w-full border-t" />
            <div className="inline-flex w-full items-end justify-between px-3 sm:px-4">
              <div className="text-muted-foreground text-[14px] font-normal leading-tight sm:text-[15px]">
                Node Rpc Url:
              </div>
              <div
                className="text-foreground text-right text-[14px] font-medium leading-tight opacity-90 sm:text-[15px]"
                data-testid={`${baseLocator}_currentNodeRpcUrl`}
              >
                {shortenUrl(currentChain?.rpcUrl) || "Unknown"}
              </div>
            </div>
          </div>
        </div>

        <div className="border-border h-[0px] w-full border-t" />

        <div className="font-inter inline-flex w-full items-start justify-center gap-2">
          {allChains.map((c) => (
            <Button
              type="button"
              onClick={() => switchToNetwork(c)}
              key={c.chainId}
              variant={
                c.chainId === currentChain.chainId ? "default" : "outline"
              }
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
