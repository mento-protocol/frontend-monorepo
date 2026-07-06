"use client";

import { toast } from "@repo/ui";
import { useSwitchChain } from "wagmi";
import { chainIdToChain } from "../../config/chains";

export interface UseSwitchChainWithFeedbackOptions {
  onFailure?: "silent" | "toast";
}

/**
 * Hook to switch the connected wallet's chain, with configurable UX on failure
 * (e.g. wallet rejection or an unsupported chain).
 */
export function useSwitchChainWithFeedback(
  options: UseSwitchChainWithFeedbackOptions = {},
) {
  const { onFailure = "silent" } = options;
  const { switchChainAsync, isPending } = useSwitchChain();

  const switchToChain = async (chainId: number): Promise<boolean> => {
    try {
      await switchChainAsync({ chainId });
      return true;
    } catch {
      if (onFailure === "toast") {
        const chainName = chainIdToChain[chainId]?.name ?? `chain ${chainId}`;
        toast.error(
          `Could not switch to ${chainName}. Please switch networks in your wallet.`,
        );
      }
      return false;
    }
  };

  return { switchToChain, isSwitching: isPending };
}
