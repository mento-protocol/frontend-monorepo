"use client";

import { chainIdToChain, CELO_EXPLORER } from "@/config/chains";
import { getTokenBySymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { formatWithMaxDecimals } from "@/features/swap/utils";
import { logger } from "@/utils/logger";
import {
  getContractAddress,
  getTokenAddress,
  TokenSymbol,
} from "@mento-protocol/mento-sdk";
import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { usePublicClient, useSendCalls, useWaitForCallsStatus } from "wagmi";
import { confirmViewAtom, formValuesAtom } from "../swap-atoms";
import { getSwapTransactionErrorMessage } from "./swap-transaction-error";

function parseDeadlineMinutes(deadlineMinutes?: string): number {
  const parsed = Number.parseInt(deadlineMinutes ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return parsed;
}

export function useBatchSwapTransaction(
  chainId: number,
  fromToken: TokenSymbol,
  toToken: TokenSymbol,
  amountInWei: string,
  accountAddress?: Address,
  swapValues?: {
    fromAmount: string;
    toAmount: string;
  },
  insufficientLiquidityFallbackUrl?: string,
): {
  sendBatchSwapTx: () => Promise<string>;
  isBatchSwapLoading: boolean;
  isBatchSwapReceiptLoading: boolean;
  isBatchSwapSuccess: boolean;
  isBatchSwapError: boolean;
  batchSwapError: Error | null;
  resetBatchSwapTx: () => void;
} {
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const setConfirmView = useSetAtom(confirmViewAtom);
  const publicClient = usePublicClient({ chainId });
  const queryClient = useQueryClient();

  const [callsId, setCallsId] = useState<string | undefined>(undefined);
  const successFiredForIdRef = useRef<string | null>(null);

  const { sendCallsAsync } = useSendCalls();

  const {
    data: callsStatus,
    isSuccess: isCallsConfirmed,
    isLoading: isCallsStatusLoading,
  } = useWaitForCallsStatus({
    id: callsId ?? "",
    query: { enabled: !!callsId },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!accountAddress || new BigNumber(amountInWei).lte(0)) {
        throw new Error("Batch swap prerequisites not met");
      }

      // Build approve call
      const tokenInAddr = getTokenAddress(chainId, fromToken);
      if (!tokenInAddr) {
        throw new Error(`${fromToken} address not found on chain ${chainId}`);
      }
      const spender = getContractAddress(chainId, "Router");
      const approveData = encodeFunctionData({
        abi: [
          {
            name: "approve",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "spender", type: "address" },
              { name: "amount", type: "uint256" },
            ],
            outputs: [{ type: "bool" }],
          },
        ],
        functionName: "approve",
        args: [spender as Address, BigInt(amountInWei)],
      });

      // Build swap call
      const sdk = await getMentoSdk(chainId);
      const toTokenAddr = getTokenAddress(chainId, toToken);
      if (!toTokenAddr) {
        throw new Error(`${toToken} address not found on chain ${chainId}`);
      }
      const route = await getTradablePairForTokens(chainId, fromToken, toToken);
      if (!publicClient) throw new Error("Public client not available");
      const block = await publicClient.getBlock();
      const deadlineSeconds =
        parseDeadlineMinutes(formValues?.deadlineMinutes) * 60;
      const deadline = block.timestamp * 2n + BigInt(deadlineSeconds);

      const swapDetails = await sdk.swap.buildSwapParams(
        tokenInAddr as `0x${string}`,
        toTokenAddr as `0x${string}`,
        BigInt(amountInWei),
        accountAddress,
        {
          slippageTolerance: parseFloat(formValues?.slippage || "0.3"),
          deadline,
        },
        route,
      );

      logger.debug("Sending batch approve+swap transaction...");

      const result = await sendCallsAsync({
        calls: [
          {
            to: tokenInAddr as Address,
            data: approveData,
          },
          {
            to: swapDetails.params.to as Address,
            data: swapDetails.params.data as Hex,
            value: BigInt(swapDetails.params.value || 0),
          },
        ],
      });

      setCallsId(result.id);
      return result.id;
    },
    onError: (error: Error) => {
      const toastError = getSwapTransactionErrorMessage(
        error,
        { fromTokenSymbol: fromToken, toTokenSymbol: toToken, chainId },
        insufficientLiquidityFallbackUrl,
      );
      toast.error(toastError);
      logger.error(`Batch swap transaction failed: ${error.message}`, error);
    },
  });

  useEffect(() => {
    if (
      !isCallsConfirmed ||
      !callsStatus ||
      !callsId ||
      successFiredForIdRef.current === callsId
    ) {
      return;
    }

    successFiredForIdRef.current = callsId;

    if (callsStatus.status !== "success") {
      toast.error("Batch transaction failed on-chain.");
      setConfirmView(false);
      return;
    }

    logger.info("Batch approve+swap confirmed successfully");

    if (swapValues) {
      const chain = chainIdToChain[chainId];
      const explorerUrl = chain?.blockExplorers?.default.url;
      const explorerName =
        chain?.blockExplorers?.default?.name || CELO_EXPLORER.name;
      const fromTokenObj = getTokenBySymbol(fromToken, chainId);
      const toTokenObj = getTokenBySymbol(toToken, chainId);
      const fromAmountFormatted = formatWithMaxDecimals(
        swapValues.fromAmount,
        4,
      );
      const toAmountFormatted = formatWithMaxDecimals(swapValues.toAmount, 4);
      const lastReceipt =
        callsStatus.receipts?.[callsStatus.receipts.length - 1];

      toast.success(
        <>
          <h4>Swap Successful</h4>
          <span className="mt-2 block text-muted-foreground">
            You&apos;ve swapped {fromAmountFormatted}{" "}
            {fromTokenObj?.symbol || "Token"} for {toAmountFormatted}{" "}
            {toTokenObj?.symbol || "Token"}.
          </span>
          {explorerUrl && lastReceipt?.transactionHash && (
            <a
              href={`${explorerUrl}/tx/${lastReceipt.transactionHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground underline"
            >
              View Transaction on {explorerName}
            </a>
          )}
        </>,
      );
    }

    setFormValues({
      tokenInSymbol: fromToken,
      tokenOutSymbol: toToken,
      slippage: formValues?.slippage || "0.3",
      isAutoSlippage: formValues?.isAutoSlippage ?? true,
      deadlineMinutes: formValues?.deadlineMinutes || "5",
      isAutoDeadline: formValues?.isAutoDeadline ?? true,
    });
    setConfirmView(false);

    if (accountAddress && chainId) {
      (async () => {
        try {
          await queryClient.cancelQueries({
            queryKey: ["accountBalances", { address: accountAddress, chainId }],
          });
          await queryClient.invalidateQueries({
            queryKey: ["accountBalances", { address: accountAddress, chainId }],
          });
        } catch (error) {
          logger.warn("Balance refresh failed after batch swap", { error });
        }
      })();
    }
  }, [
    accountAddress,
    callsId,
    callsStatus,
    chainId,
    formValues?.deadlineMinutes,
    formValues?.isAutoDeadline,
    formValues?.isAutoSlippage,
    formValues?.slippage,
    fromToken,
    isCallsConfirmed,
    queryClient,
    setConfirmView,
    setFormValues,
    swapValues,
    toToken,
  ]);

  return {
    sendBatchSwapTx: mutation.mutateAsync,
    isBatchSwapLoading: mutation.isPending,
    isBatchSwapReceiptLoading: isCallsStatusLoading && !!callsId,
    isBatchSwapSuccess: isCallsConfirmed && callsStatus?.status === "success",
    isBatchSwapError:
      mutation.isError ||
      (isCallsConfirmed && callsStatus?.status === "failure"),
    batchSwapError: mutation.error,
    resetBatchSwapTx: () => {
      mutation.reset();
      setCallsId(undefined);
    },
  };
}
