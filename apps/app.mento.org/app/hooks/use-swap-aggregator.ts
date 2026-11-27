"use client";

import { useChainId } from "@repo/web3/wagmi";
import {
  type SwapAggregator,
  swapAggregatorForChain,
} from "@/lib/external-links";

/** The swap aggregator for the chain currently selected in the app. */
export function useSwapAggregator(): SwapAggregator {
  return swapAggregatorForChain(useChainId());
}
