import { chainIdToChain } from "@/config/chains";
import { getTradablePairForTokens } from "@/features/sdk";
import { logger } from "@/utils";
import { toViemAddress, validateAddress } from "@/utils/addresses";
import {
  TokenSymbol,
  getTokenAddress,
  getContractAddress,
} from "@mento-protocol/mento-sdk";
import { toast } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex, TransactionReceipt } from "viem";
import { encodeFunctionData } from "viem";
import {
  useEstimateGas,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";

export function useApproveTransaction({
  chainId,
  tokenInSymbol,
  tokenOutSymbol,
  amountInWei,
  accountAddress,
  onSuccess,
}: {
  chainId: number;
  tokenInSymbol: TokenSymbol;
  tokenOutSymbol: TokenSymbol;
  amountInWei: string;
  accountAddress?: Address;
  onSuccess?: (receipt: TransactionReceipt) => void;
}) {
  const { error: txPrepError, data: txRequest } = useQuery({
    queryKey: [
      "useApproveTransaction",
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
      amountInWei,
      accountAddress,
    ],
    queryFn: async () => {
      if (!accountAddress || new BigNumber(amountInWei).lte(0)) return null;

      const tokenInAddr = getTokenAddress(chainId, tokenInSymbol);
      if (!tokenInAddr) {
        throw new Error(
          `${tokenInSymbol} token address not found on chain ${chainId}`,
        );
      }

      const spender = getContractAddress(chainId, "Router");

      const data = encodeFunctionData({
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

      return { to: tokenInAddr, data };
    },
  });

  const [approveTxHash, setApproveTxHash] = useState<Address | null>(null);

  const { data, error: sendPrepError } = useEstimateGas({
    to: toViemAddress(txRequest?.to as string),
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
    sendTransactionAsync,
    reset,
  } = useSendTransaction();

  // Wait for transaction confirmation
  const { data: txReceipt, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: sendTxHash,
    });

  const isSendingRef = useRef(false);
  const lastErrorKeyRef = useRef<string | null>(null);
  const lastErrorAtRef = useRef<number>(0);

  useEffect(() => {
    if (txPrepError || sendPrepError?.message) {
      logger.error(txPrepError || sendPrepError?.message);
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
    if (isSendingRef.current || isPending) return null;
    isSendingRef.current = true;
    reset();

    if (!txRequest?.to || !txRequest?.data) {
      toast.error("Unable to prepare approval transaction");
      return null;
    }

    try {
      validateAddress(txRequest.to, "approval transaction");
      const hash = await sendTransactionAsync({
        gas: data,
        to: txRequest.to as Address,
        data: txRequest?.data as Hex,
      });

      setApproveTxHash(hash);

      return hash;
    } catch (err) {
      logger.error(err);
      const message = getApproveToastErrorMessage(
        err instanceof Error ? err.message : String(err),
      );
      const errorKey = message;
      const now = Date.now();
      if (
        lastErrorKeyRef.current !== errorKey ||
        now - lastErrorAtRef.current > 2000
      ) {
        lastErrorKeyRef.current = errorKey;
        lastErrorAtRef.current = now;
        toast.error(message);
      }
      reset();
      return null;
    } finally {
      isSendingRef.current = false;
    }
  }, [reset, sendTransactionAsync, data, txRequest, isPending]);

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
