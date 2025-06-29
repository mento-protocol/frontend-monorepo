import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { chainIdToChain } from "@/config/chains";
import { type TokenId, getTokenAddress } from "@/config/tokens";
import { toast } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useEffect } from "react";
import {
  type Address,
  usePrepareSendTransaction,
  useSendTransaction,
  useWaitForTransaction,
} from "wagmi";
import { logger } from "@/utils";

export function useApproveTransaction(
  chainId: number,
  tokenInId: TokenId,
  tokenOutId: TokenId,
  amountInWei: string,
  accountAddress?: Address,
) {
  const { error: txPrepError, data: txRequest } = useQuery(
    [
      "useApproveTransaction",
      chainId,
      tokenInId,
      tokenOutId,
      amountInWei,
      accountAddress,
    ],
    async () => {
      if (!accountAddress || new BigNumber(amountInWei).lte(0)) return null;
      const sdk = await getMentoSdk(chainId);
      const tokenInAddr = getTokenAddress(tokenInId, chainId);
      const tradablePair = await getTradablePairForTokens(
        chainId,
        tokenInId,
        tokenOutId,
      );
      const txRequest = await sdk.increaseTradingAllowance(
        tokenInAddr,
        amountInWei,
        tradablePair,
      );
      return { ...txRequest, to: tokenInAddr };
    },
    {
      retry: false,
    },
  );

  const { config, error: sendPrepError } = usePrepareSendTransaction(
    txRequest ? { request: txRequest } : undefined,
  );
  const {
    data: txResult,
    isLoading,
    isSuccess,
    error: txSendError,
    sendTransactionAsync,
  } = useSendTransaction(config);

  // Wait for transaction confirmation
  const { data: txReceipt, isSuccess: isConfirmed } = useWaitForTransaction({
    hash: txResult?.hash,
    enabled: !!txResult?.hash,
  });

  useEffect(() => {
    if (txPrepError || sendPrepError?.message) {
      toast.error("Unable to prepare approval transaction");
      logger.error(txPrepError || sendPrepError?.message);
    } else if (txSendError) {
      if (txSendError.message.includes("User rejected request")) {
        toast.error("Approval transaction rejected by user");
      } else {
        toast.error("Approval transaction failed");
      }
      logger.error(txSendError);
    } else if (isConfirmed && txReceipt && txResult?.hash) {
      logger.info(`Approval confirmed: ${txResult.hash}`);
      const currentChainConfig = chainIdToChain[chainId];
      const explorerBaseUrl = currentChainConfig?.explorerUrl;
      const explorerTxUrl = explorerBaseUrl
        ? `${explorerBaseUrl}/tx/${txResult.hash}`
        : null;

      const message = "Approve complete! Sending swap tx.";
      const detailsElement = explorerTxUrl ? (
        <a
          href={explorerTxUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "underline", color: "inherit" }}
        >
          See Details
        </a>
      ) : (
        <span>See Details</span>
      );

      toast.success(
        <>
          {message} <br /> {detailsElement}
        </>,
      );
    }
  }, [
    txPrepError,
    sendPrepError,
    txSendError,
    isConfirmed,
    txReceipt,
    txResult,
    chainId,
  ]);

  return {
    sendApproveTx: sendTransactionAsync,
    approveTxResult: txResult,
    isApproveTxLoading: isLoading,
    isApproveTxSuccess: isSuccess,
    isApproveTxConfirmed: isConfirmed,
  };
}
