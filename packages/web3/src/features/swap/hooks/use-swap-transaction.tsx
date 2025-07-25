import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { SwapDirection } from "@/features/swap/types";
import { formatWithMaxDecimals } from "@/features/swap/utils";
import { chainIdToChain } from "@/config/chains";
import { TokenId, getTokenAddress, Tokens } from "@/config/tokens";
import { logger } from "@/utils/logger";
import { useMutation } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useAtom, useSetAtom } from "jotai";
import { toast } from "@repo/ui";
import type { Address } from "wagmi";
import { sendTransaction, waitForTransaction } from "wagmi/actions";
import { confirmViewAtom, formValuesAtom } from "../swap-atoms";

export function useSwapTransaction(
  chainId: number,
  fromToken: TokenId,
  toToken: TokenId,
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
  sendSwapTx: () => Promise<{
    hash: `0x${string}`;
    receipt: unknown;
  }>;
  swapTxResult: { hash: `0x${string}`; receipt: unknown } | undefined;
  isSwapTxLoading: boolean;
  isSwapTxSuccess: boolean;
  isSwapTxError: boolean;
  swapTxError: Error | null;
  resetSwapTx: () => void;
} {
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const setConfirmView = useSetAtom(confirmViewAtom);

  const mutation = useMutation(
    async () => {
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
          exactBuyAmount, // This should be 4.55 cKES in wei
          maxSellAmount: thresholdAmountInWei, // This should be 149.964 cCOP + slippage in wei
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
      const txHash = await sendTransaction({
        chainId,
        mode: "recklesslyUnprepared",
        request: {
          to: txRequest.to as Address,
          data: txRequest.data as `0x${string}` | undefined,
          value: txRequest.value
            ? BigInt(txRequest.value.toString())
            : undefined,
          gasLimit: txRequest.gasLimit
            ? BigInt(txRequest.gasLimit.toString())
            : undefined,
        },
      });

      logger.debug("Transaction sent, waiting for confirmation...", {
        hash: txHash.hash,
      });

      // Wait for transaction confirmation
      const receipt = await waitForTransaction({ hash: txHash.hash });

      if (receipt.status !== 1) {
        throw new Error("Transaction failed");
      }

      logger.info("Swap transaction confirmed successfully", {
        hash: txHash.hash,
        blockNumber: receipt.blockNumber,
      });

      return { hash: txHash.hash, receipt };
    },
    {
      onSuccess: (data) => {
        logger.info("Swap transaction successful", {
          hash: data.hash,
        });

        // Show success toast with transaction details
        if (swapValues) {
          const chain = chainIdToChain[chainId];
          const explorerUrl = chain?.explorerUrl;
          const fromTokenObj = Tokens[fromToken];
          const toTokenObj = Tokens[toToken];
          const fromTokenSymbol = fromTokenObj?.symbol || "Token";
          const toTokenSymbol = toTokenObj?.symbol || "Token";

          // Format amounts for display
          const fromAmountFormatted = formatWithMaxDecimals(
            swapValues.fromAmount,
            4,
          );
          const toAmountFormatted = formatWithMaxDecimals(
            swapValues.toAmount,
            4,
          );

          const successMessage = `You've swapped ${fromAmountFormatted} ${fromTokenSymbol} for ${toAmountFormatted} ${toTokenSymbol}.`;

          toast.success(
            <>
              <h4>Swap Successful</h4>
              <span className="text-muted-foreground mt-2 block">
                {successMessage}
              </span>
              {explorerUrl && (
                <a
                  href={`${explorerUrl}/tx/${data.hash}`}
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

        // Reset form and close confirm view only after successful confirmation
        setFormValues({
          slippage: formValues?.slippage || "0.5",
        });
        setConfirmView(false);
      },
      onError: (error: Error) => {
        if (error.message === "Swap prerequisites not met") {
          logger.debug("Swap skipped due to prerequisites.");
          return;
        }
        const toastError = getToastErrorMessage(error.message);
        toast.error(toastError);
        logger.error(`Swap transaction failed: ${error.message}`, error);
      },
    },
  );

  return {
    sendSwapTx: mutation.mutateAsync,
    swapTxResult: mutation.data,
    isSwapTxLoading: mutation.isLoading,
    isSwapTxSuccess: mutation.isSuccess,
    isSwapTxError: mutation.isError,
    swapTxError: mutation.error,
    resetSwapTx: mutation.reset,
  };
}

function getToastErrorMessage(errorMessage: string): string {
  switch (true) {
    case errorMessage.includes(`Trading is suspended for this reference rate`):
      return "Trading temporarily paused.  " + "Please try again later.";
    case errorMessage.includes("User rejected request"):
      return "Swap transaction rejected by user.";
    case errorMessage.includes(
      "MetaMask Tx Signature: User denied transaction signature",
    ):
      return "Transaction signature denied in MetaMask.";
    case errorMessage.includes("insufficient funds"):
      return "Insufficient funds for transaction.";
    case errorMessage.includes("Transaction failed"):
      return "Transaction failed on blockchain.";
    default:
      logger.warn(`Unhandled swap error for toast: ${errorMessage}`);
      return "Unable to complete swap transaction";
  }
}
