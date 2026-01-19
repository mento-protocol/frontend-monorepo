"use client";

import { latestBlockAtom } from "@/features/blocks/block-atoms";
import type { BlockStub } from "@/features/blocks/types";
import { getProvider } from "@/features/providers";
import { logger } from "@/utils/logger";
import { useInterval } from "@/utils/timeout";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import * as Sentry from "@sentry/nextjs";

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

    // This can fail if the user disconnects or RPC has issues
    if (address && isConnected && chainId) {
      try {
        await queryClient.invalidateQueries({
          queryKey: ["accountBalances", { address, chainId }],
        });
      } catch (error) {
        Sentry.captureException(`Balance refresh failed: ${error}`);
      }
    }
  }, [address, isConnected, chainId, queryClient, status, setLatestBlock]);

  useEffect(() => {
    onPoll();
  }, [onPoll]);

  useInterval(onPoll, FAST_INTERVAL);

  return null;
}
