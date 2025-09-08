import { chainIdToChain } from "@/config/chains";
import { type TokenId, getTokenAddress } from "@/config/tokens";
import { getMentoSdk, getTradablePairForTokens } from "@/features/sdk";
import { logger } from "@/utils";
import { toast } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex, TransactionReceipt } from "viem";
import {
  useEstimateGas,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";

export function useApproveTransaction({
  chainId,
  tokenInId,
  tokenOutId,
  amountInWei,
  accountAddress,
  onSuccess,
}: {
  chainId: number;
  tokenInId: TokenId;
  tokenOutId: TokenId;
  amountInWei: string;
  accountAddress?: Address;
  onSuccess?: (receipt: TransactionReceipt) => void;
}) {
  const { error: txPrepError, data: txRequest } = useQuery({
    queryKey: [
      "useApproveTransaction",
      chainId,
      tokenInId,
      tokenOutId,
      amountInWei,
      accountAddress,
    ],
    queryFn: async () => {
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
  });

  const [approveTxHash, setApproveTxHash] = useState<Address | null>(null);

  const { data, error: sendPrepError } = useEstimateGas({
    to: txRequest?.to as Address | undefined,
    data: txRequest?.data as Hex | undefined,
  });

  const { data: approveTxReceipt, isSuccess: isApproveTxConfirmed } =
    useWaitForTransactionReceipt({
      hash: approveTxHash as Address,
    });

  const {
    data: sendTxHash,
    isPending,
    isSuccess,
    error: txSendError,
    sendTransactionAsync,
  } = useSendTransaction();

  // Wait for transaction confirmation
  const { data: txReceipt, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: sendTxHash,
    });

  useEffect(() => {
    if (txPrepError || sendPrepError?.message) {
      toast.error("Unable to prepare approval transaction");
      logger.error(txPrepError || sendPrepError?.message);
    } else if (txSendError) {
      logger.error(txSendError);
      const message = getApproveToastErrorMessage(
        txSendError instanceof Error
          ? txSendError.message
          : String(txSendError),
      );
      toast.error(message);
    } else if (isConfirmed && txReceipt && sendTxHash && !onSuccess) {
      logger.info(`Approval confirmed: ${sendTxHash}`);
      const currentChainConfig = chainIdToChain[chainId];
      const explorerBaseUrl = currentChainConfig?.blockExplorers?.default?.url;
      const explorerTxUrl = explorerBaseUrl
        ? `${explorerBaseUrl}/tx/${sendTxHash}`
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
    sendTxHash,
    chainId,
    onSuccess,
  ]);

  useEffect(() => {
    if (isApproveTxConfirmed && onSuccess) {
      onSuccess(approveTxReceipt);
    }
  }, [isApproveTxConfirmed, approveTxReceipt, onSuccess]);

  const sendApproveTx = useCallback(async () => {
    const hash = await sendTransactionAsync({
      gas: data,
      to: txRequest?.to as Address | undefined,
      data: txRequest?.data as Hex | undefined,
    });

    setApproveTxHash(hash);

    return hash;
  }, [sendTransactionAsync, data, txRequest]);

  return {
    sendApproveTx,
    approveTxHash: sendTxHash,
    isApproveTxLoading: isPending,
    isApproveTxSuccess: isSuccess,
    isApproveTxConfirmed: isConfirmed,
  };
}

function getApproveToastErrorMessage(errorMessage: string): string {
  switch (true) {
    // Normalize user rejection messages across wallets (MetaMask, Rabby, Valora/WalletConnect)
    case /user\s+rejected/i.test(errorMessage):
      return "Approval transaction rejected by user.";
    case /denied\s+transaction\s+signature/i.test(errorMessage):
      return "Approval transaction rejected by user.";
    case /request\s+rejected/i.test(errorMessage):
      return "Approval transaction rejected by user.";
    case /insufficient\s+funds/i.test(errorMessage):
      return "Insufficient funds for transaction.";
    default:
      return "Unable to complete approval transaction";
  }
}
