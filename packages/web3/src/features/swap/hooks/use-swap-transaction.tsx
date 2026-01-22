import { chainIdToChain } from "@/config/chains";
import { getTokenBySymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { SwapDirection } from "@/features/swap/types";
import { formatWithMaxDecimals } from "@/features/swap/utils";
import { logger } from "@/utils/logger";
import { retryAsync } from "@/utils/retry";
import { validateAddress } from "@/utils/addresses";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";
import { toast } from "@repo/ui";
import * as Sentry from "@sentry/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useAtom, useSetAtom } from "jotai";
import { useEffect } from "react";
import type { Address } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { confirmViewAtom, formValuesAtom } from "../swap-atoms";
import { SWAP_ERROR_MESSAGES, USER_ERROR_MESSAGES } from "../error-handlers";

export function useSwapTransaction(
  chainId: number,
  fromToken: TokenSymbol,
  toToken: TokenSymbol,
  amountInWei: string,
  thresholdAmountInWei: string,
  direction: SwapDirection,
  accountAddress?: Address,
  isApproveConfirmed?: boolean,
  swapValues?: {
    fromAmount: string;
    toAmount: string;
    toAmountWei?: string; // Add this to receive the exact buy amount for swapOut
  },
): {
  sendSwapTx: () => Promise<Address>;
  swapTxResult: Address | undefined;
  isSwapTxLoading: boolean;
  isSwapTxReceiptLoading: boolean;
  isSwapTxSuccess: boolean;
  isSwapTxError: boolean;
  swapTxError: Error | null;
  resetSwapTx: () => void;
} {
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const setConfirmView = useSetAtom(confirmViewAtom);

  const { data: swapTxHash, sendTransactionAsync } = useSendTransaction();

  const {
    data: swapTxReceipt,
    isSuccess: isSwapTxConfirmed,
    isLoading: isSwapTxLoading,
  } = useWaitForTransactionReceipt({
    hash: swapTxHash as Address,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (
        !accountAddress ||
        !isApproveConfirmed ||
        new BigNumber(amountInWei).lte(0) ||
        new BigNumber(thresholdAmountInWei).lte(0)
      ) {
        logger.debug("Skipping swap transaction: prerequisites not met.");
        throw new Error("Swap prerequisites not met");
      }
      logger.debug("Preparing swap transaction...");
      const sdk = await getMentoSdk(chainId);
      const fromTokenAddr = getTokenAddress(fromToken, chainId);
      const toTokenAddr = getTokenAddress(toToken, chainId);
      if (!fromTokenAddr) {
        throw new Error(
          `${fromToken} token address not found on chain ${chainId}`,
        );
      }
      if (!toTokenAddr) {
        throw new Error(
          `${toToken} token address not found on chain ${chainId}`,
        );
      }
      const tradablePair = await getTradablePairForTokens(
        chainId,
        fromToken,
        toToken,
      );

      let txRequest;
      if (direction === "in") {
        // swapIn: sell exact amount of fromToken, receive at least minAmountOut of toToken
        txRequest = await sdk.swapIn(
          fromTokenAddr,
          toTokenAddr,
          amountInWei, // exact amount of fromToken to sell
          thresholdAmountInWei, // minimum amount of toToken to receive
          tradablePair,
        );
      } else {
        // swapOut: buy exact amount of toToken, sell at most maxAmountIn of fromToken
        // CRITICAL: For swapOut, the parameter order is different!
        // We need the exact buy amount from swapValues
        const exactBuyAmount = swapValues?.toAmountWei;
        if (!exactBuyAmount) {
          throw new Error("Missing toAmountWei for swapOut");
        }

        logger.debug("SwapOut parameters:", {
          fromToken: fromTokenAddr,
          toToken: toTokenAddr,
          exactBuyAmount,
          maxSellAmount: thresholdAmountInWei,
        });

        txRequest = await sdk.swapOut(
          fromTokenAddr,
          toTokenAddr,
          exactBuyAmount, // exact amount of toToken to buy
          thresholdAmountInWei, // maximum amount of fromToken to sell
          tradablePair,
        );
      }

      logger.debug("Sending swap transaction...", { txRequest });

      // Rely on the connected wallet's active chain. Passing `chainId` here breaks when it is undefined.
      // See https://github.com/wagmi-dev/wagmi/issues/1879 – supply only tx fields;
      if (chainId === undefined) {
        throw new Error("Chain ID is undefined");
      }
      validateAddress(txRequest.to, "swap transaction");
      const txHash = await retryAsync(async () => {
        return await sendTransactionAsync({
          to: txRequest.to as Address,
          data: txRequest.data as `0x${string}` | undefined,
          value: txRequest.value
            ? BigInt(txRequest.value.toString())
            : undefined,
          gas: txRequest.gasLimit
            ? BigInt(txRequest.gasLimit.toString())
            : undefined,
        });
      });

      logger.debug("Transaction sent, waiting for confirmation...", {
        hash: txHash,
      });

      // Return the transaction hash so that onSuccess receives it
      return txHash;
    },
    onError: (error: Error) => {
      if (error.message === "Swap prerequisites not met") {
        logger.debug("Swap skipped due to prerequisites not being met.");
        return;
      }
      const toastError = getSwapTransactionErrorMessage(error);
      toast.error(toastError);
      logger.error(`Swap transaction failed: ${error.message}`, error);
    },
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    if (isSwapTxConfirmed) {
      if (swapTxReceipt?.status !== "success") {
        throw new Error("Transaction failed");
      }

      logger.info("Swap transaction confirmed successfully", {
        hash: swapTxHash,
        blockNumber: swapTxReceipt.blockNumber,
      });

      if (swapValues) {
        const chain = chainIdToChain[chainId];
        const explorerUrl = chain?.blockExplorers?.default.url;
        const fromTokenObj = getTokenBySymbol(fromToken, chainId);
        const toTokenObj = getTokenBySymbol(toToken, chainId);
        const fromTokenSymbol = fromTokenObj?.symbol || "Token";
        const toTokenSymbol = toTokenObj?.symbol || "Token";

        // Format amounts for display
        const fromAmountFormatted = formatWithMaxDecimals(
          swapValues.fromAmount,
          4,
        );
        const toAmountFormatted = formatWithMaxDecimals(swapValues.toAmount, 4);

        const successMessage = `You've swapped ${fromAmountFormatted} ${fromTokenSymbol} for ${toAmountFormatted} ${toTokenSymbol}.`;

        toast.success(
          <>
            <h4>Swap Successful</h4>
            <span className="mt-2 block text-muted-foreground">
              {successMessage}
            </span>
            {explorerUrl && (
              <a
                href={`${explorerUrl}/tx/${swapTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground underline"
              >
                View Transaction on CeloScan
              </a>
            )}
          </>,
        );
      }

      setFormValues({
        slippage: formValues?.slippage || "0.5",
      });
      setConfirmView(false);

      // Invalidate account balances to ensure UI shows updated balances
      // Wrapped in async function with error handling to prevent unhandled rejections
      // when the user disconnects their wallet immediately after a successful swap
      if (accountAddress && chainId) {
        (async () => {
          try {
            // Cancel any in-flight balance queries first
            await queryClient.cancelQueries({
              queryKey: [
                "accountBalances",
                { address: accountAddress, chainId },
              ],
            });
            // Then invalidate to trigger a fresh fetch
            await queryClient.invalidateQueries({
              queryKey: [
                "accountBalances",
                { address: accountAddress, chainId },
              ],
            });
          } catch (error) {
            // This can happen if the user disconnects their wallet immediately after swap
            Sentry.captureException(`Balance refresh failed: ${error}`);
          }
        })();
      }
    }
  }, [
    accountAddress,
    chainId,
    formValues?.slippage,
    fromToken,
    isSwapTxConfirmed,
    queryClient,
    setConfirmView,
    setFormValues,
    swapTxHash,
    swapTxReceipt,
    swapValues,
    toToken,
  ]);

  return {
    sendSwapTx: mutation.mutateAsync,
    swapTxResult: mutation.data,
    isSwapTxLoading: mutation.isPending,
    isSwapTxReceiptLoading: isSwapTxLoading,
    isSwapTxSuccess: mutation.isSuccess,
    isSwapTxError: mutation.isError,
    swapTxError: mutation.error,
    resetSwapTx: mutation.reset,
  };
}

/**
 * Converts swap transaction errors to user-friendly toast messages.
 * Handles transaction-specific errors like user rejection, insufficient funds, etc.
 */
export function getSwapTransactionErrorMessage(error: Error | string): string {
  const errorMessage =
    typeof error === "string" ? error : String(error.message ?? error);

  switch (true) {
    case errorMessage.includes(
      SWAP_ERROR_MESSAGES.TRADING_SUSPENDED_REFERENCE_RATE,
    ):
      return USER_ERROR_MESSAGES.TRADING_PAUSED;
    case /user\s+rejected/i.test(errorMessage):
      return USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER;
    case /denied\s+transaction\s+signature/i.test(errorMessage):
      return USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER;
    case /request\s+rejected/i.test(errorMessage):
      return USER_ERROR_MESSAGES.SWAP_REJECTED_BY_USER;
    case errorMessage.includes("insufficient funds"):
      return USER_ERROR_MESSAGES.INSUFFICIENT_FUNDS;
    case errorMessage.includes("Transaction failed"):
      return USER_ERROR_MESSAGES.TRANSACTION_FAILED;
    default:
      logger.warn(`Unhandled swap error for toast: ${errorMessage}`);
      return USER_ERROR_MESSAGES.UNKNOWN_ERROR;
  }
}
