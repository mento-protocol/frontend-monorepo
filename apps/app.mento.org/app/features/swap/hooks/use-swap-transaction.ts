import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { SwapDirection } from "@/features/swap/types";
import { TokenId, getTokenAddress } from "@/lib/config/tokens";
import { logger } from "@/lib/utils/logger";
import { useMutation } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useSetAtom } from "jotai";
import { toast } from "react-toastify";
import type { Address } from "wagmi";
import { sendTransaction } from "wagmi/actions";
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
) {
  const setFormValues = useSetAtom(formValuesAtom);
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
      const swapFn =
        direction === "in" ? sdk.swapIn.bind(sdk) : sdk.swapOut.bind(sdk);
      const txRequest = await swapFn(
        fromTokenAddr,
        toTokenAddr,
        amountInWei,
        thresholdAmountInWei,
        tradablePair,
      );

      if (!txRequest.to) {
        throw new Error(
          "Swap transaction 'to' address is undefined after SDK preparation",
        );
      }

      logger.debug("Sending swap transaction...", { txRequest });
      return sendTransaction({
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
    },
    {
      onSuccess: (data) => {
        logger.info("Swap transaction successful (useMutation)", {
          hash: data.hash,
        });
        setFormValues(null);
        setConfirmView(false);
      },
      onError: (error: Error) => {
        if (error.message === "Swap prerequisites not met") {
          logger.debug("Swap skipped due to prerequisites.");
          return;
        }
        const toastError = getToastErrorMessage(error.message);
        toast.error(toastError);
        logger.error(
          `Swap transaction failed (useMutation): ${error.message}`,
          error,
        );
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
    case errorMessage.includes("User rejected the request"):
      return "Transaction rejected by user.";
    case errorMessage.includes(
      "MetaMask Tx Signature: User denied transaction signature",
    ):
      return "Transaction signature denied in MetaMask.";
    case errorMessage.includes("insufficient funds"):
      return "Insufficient funds for transaction.";
    default:
      logger.warn(`Unhandled swap error for toast: ${errorMessage}`);
      return "Unable to complete swap transaction";
  }
}
