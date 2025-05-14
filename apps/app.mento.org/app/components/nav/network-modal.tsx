"use client";

import { toast } from "react-toastify";
import {
  type ChainMetadata,
  allChains,
  chainIdToChain,
} from "@/lib/config/chains";
import { cleanupStaleWalletSessions } from "@/lib/config/wallets";
import { Modal } from "@/components/layout/modal";
import { logger } from "@/lib/utils/logger";
import { useChainId, useSwitchNetwork } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom, useAtomValue } from "jotai";
import { resetSwapUiAtomsAtom } from "@/features/swap/swap-atoms";
import {
  latestBlockAtom,
  resetLatestBlockAtom,
} from "@/features/blocks/block-atoms";
import { resetTokenPricesAtom } from "@/features/chart/token-price-atoms";

interface Props {
  isOpen: boolean;
  close: () => void;
}

export function NetworkModal({ isOpen, close }: Props) {
  const baseLocator = "networkModal";
  const latestBlock = useAtomValue(latestBlockAtom);
  const chainId = useChainId();
  const currentChain = chainIdToChain[chainId];
  const { switchNetworkAsync } = useSwitchNetwork();
  const queryClient = useQueryClient();
  const resetJotaiSwapState = useSetAtom(resetSwapUiAtomsAtom);
  const setResetLatestBlock = useSetAtom(resetLatestBlockAtom);
  const setResetTokenPrices = useSetAtom(resetTokenPricesAtom);

  const switchToNetwork = async (c: ChainMetadata) => {
    try {
      if (!switchNetworkAsync) throw new Error("switchNetworkAsync undefined");
      logger.debug("Resetting and switching to network", c.name);
      cleanupStaleWalletSessions();
      await switchNetworkAsync(c.chainId);
      setResetLatestBlock();
      queryClient.resetQueries({ queryKey: ["accountBalances"] });
      resetJotaiSwapState();
      setResetTokenPrices();
    } catch (error) {
      logger.error("Error updating network", error);
      toast.error("Could not switch network, does wallet support switching?");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      close={close}
      title="Network details"
      width="max-w-md"
    >
      <div className="inline-flex w-full items-end justify-between px-4 sm:px-6">
        <div className="font-inter inline-flex w-full flex-col items-center justify-start gap-4 rounded-xl border border-gray-200 bg-gray-100 py-3 sm:py-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="inline-flex w-full items-end justify-between px-3 sm:px-4">
            <div className="text-[14px] font-normal leading-tight text-neutral-500 sm:text-[15px] dark:text-gray-400">
              Connected to:
            </div>
            <div className="text-right text-[15px] font-medium leading-tight text-gray-950 opacity-90 dark:text-white">
              {currentChain?.name || "Unknown"}
            </div>
          </div>
          <div className="h-[0px] w-full border-t border-gray-200 dark:border-zinc-800" />
          <div className="inline-flex w-full items-end justify-between px-3 sm:px-4">
            <div className="text-[14px] font-normal leading-tight text-neutral-500 sm:text-[15px] dark:text-gray-400">
              Block Number:
            </div>
            <div className="text-right text-[14px] font-medium leading-tight text-gray-950 opacity-90 sm:text-[15px] dark:text-white">
              {latestBlock?.number || "Unknown"}
            </div>
          </div>
          <div className="h-[0px] w-full border-t border-gray-200 dark:border-zinc-800" />
          <div className="inline-flex w-full items-end justify-between px-3 sm:px-4">
            <div className="text-[14px] font-normal leading-tight text-neutral-500 sm:text-[15px] dark:text-gray-400">
              Node Rpc Url:
            </div>
            <div className="text-right text-[14px] font-medium leading-tight text-gray-950 opacity-90 sm:text-[15px] dark:text-white">
              {shortenUrl(currentChain?.rpcUrl) || "Unknown"}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 h-[0px] w-full border-t border-gray-200 sm:mt-6 dark:border-zinc-800" />
      <div className="font-inter inline-flex w-full items-start justify-start gap-4 px-4 py-4 sm:px-6 sm:py-6">
        {allChains.map((c) => (
          <button
            type="button"
            onClick={() => switchToNetwork(c)}
            key={c.chainId}
            className={`flex h-[42px] shrink grow basis-0 items-center justify-center rounded-lg border border-gray-950 px-4 py-3 text-[14px] font-semibold leading-relaxed sm:h-[50px] sm:text-[16px] ${
              c.chainId === currentChain.chainId
                ? "border-gray-950 bg-cyan-200 text-gray-950 dark:border-cyan-200 dark:bg-transparent dark:text-cyan-200"
                : "dark:border-zinc-600 dark:bg-zinc-600 dark:text-white"
            } hover:bg-cyan-200 active:border-cyan-200 active:bg-cyan-200 dark:hover:border-cyan-200 dark:active:border-zinc-800`}
          >
            {c.name}
          </button>
        ))}
      </div>
    </Modal>
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
