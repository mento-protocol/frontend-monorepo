import { chainIdToChain, CELO_EXPLORER } from "@/config/chains";
import { getTokenBySymbol } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import {
  extractFullErrorString,
  isInsufficientLiquidityError,
  SWAP_INSUFFICIENT_LIQUIDITY_LABEL,
} from "@/features/swap/error-handlers";
import { formatWithMaxDecimals } from "@/features/swap/utils";
import { validateAddress } from "@/utils/addresses";
import { logger } from "@/utils/logger";
import { TokenSymbol, getTokenAddress } from "@mento-protocol/mento-sdk";
import { toast } from "@repo/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useAtom, useSetAtom } from "jotai";
import { useEffect } from "react";
import type { Address, Hex } from "viem";
import {
  usePublicClient,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import { getSwapTransactionErrorMessage } from "./swap-transaction-error";
import { confirmViewAtom, formValuesAtom } from "../swap-atoms";

function parseDeadlineMinutes(deadlineMinutes?: string): number {
  const parsed = Number.parseInt(deadlineMinutes ?? "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }

  return parsed;
}

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
  insufficientLiquidityFallbackUrl?: string,
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
        parseDeadlineMinutes(formValues?.deadlineMinutes) * 60;
      if (!publicClient) {
        throw new Error("Public client not available");
      }
      const block = await publicClient.getBlock();
      const deadline = block.timestamp + BigInt(deadlineSeconds);

      const swapDetails = await sdk.swap.buildSwapParams(
        fromTokenAddr as `0x${string}`,
        toTokenAddr as `0x${string}`,
        BigInt(amountInWei),
        accountAddress,
        {
          slippageTolerance: parseFloat(formValues?.slippage || "0.3"),
          deadline,
        },
        route,
      );

      logger.debug("Sending swap transaction...", { swapDetails });

      if (chainId === undefined) {
        throw new Error("Chain ID is undefined");
      }
      validateAddress(swapDetails.params.to, "swap transaction");

      // Preflight estimate to surface revert reasons in-app before wallet submit.
      try {
        await publicClient.estimateGas({
          account: accountAddress,
          to: swapDetails.params.to as Address,
          data: swapDetails.params.data as Hex,
          value: BigInt(swapDetails.params.value || 0),
        });
      } catch (estimateError) {
        const estimateMessage = extractFullErrorString(estimateError);

        if (isInsufficientLiquidityError(estimateMessage)) {
          throw new Error(SWAP_INSUFFICIENT_LIQUIDITY_LABEL);
        }

        if (
          estimateMessage.includes("No route found for tokens") ||
          estimateMessage.includes("tradable path")
        ) {
          throw new Error("No route found for this token pair.");
        }

        throw estimateError;
      }

      const txHash = await sendTransactionAsync({
        to: swapDetails.params.to as Address,
        data: swapDetails.params.data as `0x${string}`,
        value: BigInt(swapDetails.params.value || 0),
      });

      logger.debug("Transaction sent, waiting for confirmation...", {
        hash: txHash,
      });

      return txHash;
    },
    onError: (error: Error) => {
      if (error.message === "Swap prerequisites not met") {
        logger.debug("Swap skipped due to prerequisites not being met.");
        return;
      }
      const toastError = getSwapTransactionErrorMessage(
        error,
        {
          fromTokenSymbol: fromToken,
          toTokenSymbol: toToken,
          chainId,
        },
        insufficientLiquidityFallbackUrl,
      );
      toast.error(toastError);
      logger.error(`Swap transaction failed: ${error.message}`, error);
    },
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    if (isSwapTxConfirmed) {
      if (swapTxReceipt?.status !== "success") {
        logger.error("Swap transaction reverted on-chain", {
          hash: swapTxHash,
          receiptStatus: swapTxReceipt?.status,
        });
        toast.error("Swap transaction failed on-chain.");
        setConfirmView(false);
        return;
      }

      logger.info("Swap transaction confirmed successfully", {
        hash: swapTxHash,
        blockNumber: swapTxReceipt.blockNumber,
      });

      if (swapValues) {
        const chain = chainIdToChain[chainId];
        const explorerUrl = chain?.blockExplorers?.default.url;
        const explorerName =
          chain?.blockExplorers?.default?.name || CELO_EXPLORER.name;
        const fromTokenObj = getTokenBySymbol(fromToken, chainId);
        const toTokenObj = getTokenBySymbol(toToken, chainId);
        const fromTokenSymbol = fromTokenObj?.symbol || "Token";
        const toTokenSymbol = toTokenObj?.symbol || "Token";

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
            logger.warn("Balance refresh invalidation failed after swap", {
              error,
            });
          }
        })();
      }
    }
  }, [
    accountAddress,
    chainId,
    formValues?.slippage,
    formValues?.isAutoSlippage,
    formValues?.deadlineMinutes,
    formValues?.isAutoDeadline,
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
