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
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import {
  useConfig,
  usePublicClient,
  useSendCalls,
  useWaitForCallsStatus,
} from "wagmi";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { confirmViewAtom, formValuesAtom } from "../swap-atoms";
import { getSwapTransactionErrorMessage } from "./swap-transaction-error";

function parseDeadlineMinutes(deadlineMinutes?: string): number {
  const parsed = Number.parseInt(deadlineMinutes ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return parsed;
}

function isSendCallsUnsupported(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : String(error));
  return /sendCalls.*not supported|not supported.*sendCalls|method.*not.*found|method does not exist|wallet_sendCalls/i.test(
    msg,
  );
}

function isUserRejection(error: unknown): boolean {
  const msg = String(error instanceof Error ? error.message : String(error));
  return /user\s+rejected|denied\s+transaction|request\s+rejected/i.test(msg);
}

type MutationResult =
  | { mode: "batch"; id: string }
  | { mode: "sequential"; txHash: string };

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
  sendBatchSwapTx: () => Promise<void>;
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
  const wagmiConfig = useConfig();

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

  const fireSuccess = useCallback(
    (txHash?: string) => {
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

        toast.success(
          <>
            <h4>Swap Successful</h4>
            <span className="mt-2 block text-muted-foreground">
              You&apos;ve swapped {fromAmountFormatted}{" "}
              {fromTokenObj?.symbol || "Token"} for {toAmountFormatted}{" "}
              {toTokenObj?.symbol || "Token"}.
            </span>
            {explorerUrl && txHash && (
              <a
                href={`${explorerUrl}/tx/${txHash}`}
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
              queryKey: [
                "accountBalances",
                { address: accountAddress, chainId },
              ],
            });
            await queryClient.invalidateQueries({
              queryKey: [
                "accountBalances",
                { address: accountAddress, chainId },
              ],
            });
          } catch (error) {
            logger.warn("Balance refresh failed after swap", { error });
          }
        })();
      }
    },
    [
      accountAddress,
      chainId,
      formValues?.deadlineMinutes,
      formValues?.isAutoDeadline,
      formValues?.isAutoSlippage,
      formValues?.slippage,
      fromToken,
      queryClient,
      setConfirmView,
      setFormValues,
      swapValues,
      toToken,
    ],
  );

  const mutation = useMutation<MutationResult, Error>({
    mutationFn: async (): Promise<MutationResult> => {
      if (!accountAddress || new BigNumber(amountInWei).lte(0)) {
        throw new Error("Swap prerequisites not met");
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

      const approveTx = {
        to: tokenInAddr as Address,
        data: approveData,
      };
      const swapTx = {
        to: swapDetails.params.to as Address,
        data: swapDetails.params.data as Hex,
        value: BigInt(swapDetails.params.value || 0),
      };

      // Try wallet_sendCalls first
      try {
        logger.debug("Attempting approve+swap via wallet_sendCalls...");
        const result = await sendCallsAsync({
          calls: [approveTx, swapTx],
        });
        setCallsId(result.id);
        return { mode: "batch", id: result.id };
      } catch (batchError) {
        if (isUserRejection(batchError)) throw batchError;
        if (!isSendCallsUnsupported(batchError)) throw batchError;
        logger.info(
          "wallet_sendCalls not supported, falling back to sequential approve+swap",
        );
      }

      // Sequential fallback: approve then swap
      logger.debug("Sending approve transaction...");
      const approveHash = await sendTransaction(wagmiConfig, {
        to: approveTx.to,
        data: approveTx.data,
        chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });

      logger.debug("Sending swap transaction...");
      const swapHash = await sendTransaction(wagmiConfig, {
        to: swapTx.to,
        data: swapTx.data,
        value: swapTx.value,
        chainId,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: swapHash });

      return { mode: "sequential", txHash: swapHash };
    },
    onSuccess: (result) => {
      if (result.mode === "sequential") {
        fireSuccess(result.txHash);
      }
      // Batch success is handled by the useEffect watching isCallsConfirmed
    },
    onError: (error: Error) => {
      const toastError = getSwapTransactionErrorMessage(
        error,
        { fromTokenSymbol: fromToken, toTokenSymbol: toToken, chainId },
        insufficientLiquidityFallbackUrl,
      );
      toast.error(toastError);
      logger.error(`Swap transaction failed: ${error.message}`, error);
    },
  });

  // Handle on-chain confirmation for the batch path
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

    const lastReceipt = callsStatus.receipts?.[callsStatus.receipts.length - 1];
    fireSuccess(lastReceipt?.transactionHash);
  }, [callsId, callsStatus, fireSuccess, isCallsConfirmed, setConfirmView]);

  return {
    sendBatchSwapTx: async () => {
      await mutation.mutateAsync();
    },
    isBatchSwapLoading: mutation.isPending,
    isBatchSwapReceiptLoading: isCallsStatusLoading && !!callsId,
    isBatchSwapSuccess:
      (mutation.isSuccess && mutation.data?.mode === "sequential") ||
      (isCallsConfirmed && callsStatus?.status === "success"),
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
