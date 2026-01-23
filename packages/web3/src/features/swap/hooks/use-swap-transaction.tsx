import { chainIdToChain } from "@/config/chains";
import { getTokenBySymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
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
import {
  usePublicClient,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import { confirmViewAtom, formValuesAtom } from "../swap-atoms";

export function useSwapTransaction(
  chainId: number,
  fromToken: TokenSymbol,
  toToken: TokenSymbol,
  amountInWei: string,
  accountAddress?: Address,
  isApproveConfirmed?: boolean,
  swapValues?: {
    fromAmount: string;
    toAmount: string;
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
  const publicClient = usePublicClient({ chainId });

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
        new BigNumber(amountInWei).lte(0)
      ) {
        logger.debug("Skipping swap transaction: prerequisites not met.");
        throw new Error("Swap prerequisites not met");
      }
      logger.debug("Preparing swap transaction...");

      const sdk = await getMentoSdk(chainId);

      const fromTokenAddr = getTokenAddress(chainId, fromToken);
      const toTokenAddr = getTokenAddress(chainId, toToken);
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

      const route = await getTradablePairForTokens(chainId, fromToken, toToken);

      const deadlineSeconds =
        parseInt(formValues?.deadlineMinutes || "20", 10) * 60;
      const block = await publicClient!.getBlock();
      const deadline = block.timestamp + BigInt(deadlineSeconds);

      const swapDetails = await sdk.swap.buildSwapParams(
        fromTokenAddr as `0x${string}`,
        toTokenAddr as `0x${string}`,
        BigInt(amountInWei), // exact amount of fromToken to sell
        accountAddress,
        {
          slippageTolerance: parseFloat(formValues?.slippage || "0.5"),
          deadline,
        },
        route,
      );

      logger.debug("Sending swap transaction...", { swapDetails });

      // Rely on the connected wallet's active chain. Passing `chainId` here breaks when it is undefined.
      // See https://github.com/wagmi-dev/wagmi/issues/1879 – supply only tx fields;
      if (chainId === undefined) {
        throw new Error("Chain ID is undefined");
      }
      validateAddress(swapDetails.params.to, "swap transaction");
      const txHash = await retryAsync(async () => {
        return await sendTransactionAsync({
          to: swapDetails.params.to as Address,
          data: swapDetails.params.data as `0x${string}`,
          value: BigInt(swapDetails.params.value || 0),
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
        isAutoSlippage: formValues?.isAutoSlippage ?? true,
        deadlineMinutes: formValues?.deadlineMinutes || "20",
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
function getSwapTransactionErrorMessage(error: Error | string): string {
  const errorMessage = error instanceof Error ? error.message : error;

  switch (true) {
    case errorMessage.includes(`Trading is suspended for this reference rate`):
      return "Trading temporarily paused.  " + "Please try again later.";
    case /user\s+rejected/i.test(errorMessage):
      return "Swap transaction rejected by user.";
    case /denied\s+transaction\s+signature/i.test(errorMessage):
      return "Swap transaction rejected by user.";
    case /request\s+rejected/i.test(errorMessage):
      return "Swap transaction rejected by user.";
    case errorMessage.includes("insufficient funds"):
      return "Insufficient funds for transaction.";
    case errorMessage.includes("Transaction failed"):
      return "Transaction failed on blockchain.";
    default:
      logger.warn(`Unhandled swap error for toast: ${errorMessage}`);
      return "Unable to complete swap transaction";
  }
}
