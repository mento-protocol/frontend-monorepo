"use client";

import { useEffect, useCallback } from "react";
import { toast } from "react-toastify";
import { STATUS_POLLER_DELAY } from "@/lib/config/consts";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@/lib/utils/logger";
import { useInterval } from "@/lib/utils/timeout";
import { useAccount, useChainId } from "wagmi";
import { useSetAtom } from "jotai";
import { getProvider } from "@/features/providers";
import type { BlockStub } from "@/features/blocks/types";
import { latestBlockAtom } from "@/features/blocks/block-atoms";

const FAST_INTERVAL = 15_000; // 15 seconds, block time

export function PollingWorker() {
  const queryClient = useQueryClient();
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const setLatestBlock = useSetAtom(latestBlockAtom);

  // TODO debounce toast errors

  const onPoll = useCallback(async () => {
    if (status !== "connected" || !chainId) return;

    logger.debug("Polling for latest block and balances");
    try {
      const provider = getProvider(chainId);
      const latest = await provider.getBlock("latest");
      if (latest) {
        const blockStub: BlockStub = {
          hash: latest.hash,
          parentHash: latest.parentHash,
          number: latest.number,
          timestamp: latest.timestamp,
          nonce: latest.nonce,
        };
        setLatestBlock(blockStub);
      } else {
        setLatestBlock(null);
      }
    } catch (error) {
      logger.error("Failed to fetch latest block:", error);
      setLatestBlock(null);
    }

    if (address && isConnected && chainId) {
      queryClient.invalidateQueries({
        queryKey: ["accountBalances", address, chainId],
      });
    }
  }, [address, isConnected, chainId, queryClient, status, setLatestBlock]);

  useEffect(() => {
    onPoll();
  }, [onPoll]);

  useInterval(onPoll, FAST_INTERVAL);

  return null;
}
