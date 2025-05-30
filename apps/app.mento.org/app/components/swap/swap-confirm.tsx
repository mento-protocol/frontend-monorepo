"use client";

import { Button, TokenIcon } from "@repo/ui";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useState, useMemo } from "react";
import { useAccount, useChainId } from "wagmi";
import { waitForTransaction } from "wagmi/actions";
import { formValuesAtom, confirmViewAtom } from "@/features/swap/swap-atoms";
import { fromWeiRounded, getAdjustedAmount } from "@/lib/utils/amount";
import { Tokens, TokenId } from "@/lib/config/tokens";
import { logger } from "@/lib/utils/logger";
import { toastToYourSuccess } from "@/components/tx-success-toast";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { useApproveTransaction } from "@/features/swap/hooks/use-approve-transaction";
import { useSwapAllowance } from "@/features/swap/hooks/use-swap-allowance";
import { useSwapQuote } from "@/features/swap/hooks/use-swap-quote";
import { useSwapTransaction } from "@/features/swap/hooks/use-swap-transaction";
import { getMaxSellAmount, getMinBuyAmount } from "@/features/swap/utils";
import { ArrowRight } from "lucide-react";

export function SwapConfirm() {
  const [formValues] = useAtom(formValuesAtom);
  const setJotaiConfirmView = useSetAtom(confirmViewAtom);

  // Loading modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isApproveConfirmed, setApproveConfirmed] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const { data: balances } = useAccountBalances({
    address,
    chainId,
  });

  // Extract form values with defaults to avoid conditional hook calls
  const amount = formValues?.amount || "";
  const direction = formValues?.direction || "in";
  const fromTokenId = formValues?.fromTokenId || TokenId.cUSD;
  const toTokenId = formValues?.toTokenId || TokenId.CELO;
  const slippage = formValues?.slippage || "0.5";

  const { amountWei, quote, quoteWei, rate } = useSwapQuote(
    amount,
    direction,
    fromTokenId,
    toTokenId,
  );

  // Assemble values based on swap direction
  const swapValues = useMemo(() => {
    let computedFromAmountWei = amountWei;
    let computedApproveAmount = amountWei;
    let computedThresholdAmountWei: string;

    if (direction === "in") {
      // Check if amount is almost equal to balance max, in which case use max
      if (balances?.[fromTokenId]) {
        computedFromAmountWei = getAdjustedAmount(
          amountWei,
          balances[fromTokenId],
        ).toFixed(0);
        computedApproveAmount = computedFromAmountWei;
      }
      // Compute min buy amount based on slippage
      computedThresholdAmountWei = getMinBuyAmount(quoteWei, slippage).toFixed(
        0,
      );

      return {
        fromAmount: Number(amount).toFixed(2),
        fromAmountWei: computedFromAmountWei,
        toAmount: Number(quote).toFixed(2),
        toAmountWei: quoteWei,
        thresholdAmountWei: computedThresholdAmountWei,
        approveAmount: computedApproveAmount,
      };
    }

    // direction === "out"
    computedFromAmountWei = quoteWei;
    // Compute max sell amount based on slippage
    computedThresholdAmountWei = getMaxSellAmount(quoteWei, slippage).toFixed(
      0,
    );
    computedApproveAmount = computedThresholdAmountWei;

    return {
      fromAmount: quote,
      fromAmountWei: computedFromAmountWei,
      toAmount: amount.toString(),
      toAmountWei: amountWei,
      thresholdAmountWei: computedThresholdAmountWei,
      approveAmount: computedApproveAmount,
    };
  }, [
    direction,
    amount,
    amountWei,
    quote,
    quoteWei,
    slippage,
    balances,
    fromTokenId,
  ]);

  const {
    fromAmount,
    fromAmountWei,
    toAmount,
    toAmountWei,
    thresholdAmountWei,
    approveAmount,
  } = swapValues;

  const { sendApproveTx, isApproveTxLoading } = useApproveTransaction(
    chainId,
    fromTokenId,
    toTokenId,
    approveAmount,
    address,
  );

  const { skipApprove } = useSwapAllowance({
    chainId,
    fromTokenId,
    toTokenId,
    approveAmount,
    address,
  });

  useEffect(() => {
    logger.info("useEffect skipApprove changed:", { skipApprove });
    if (skipApprove) {
      // Enables swap transaction preparation when approval isn't needed
      setApproveConfirmed(true);
      logger.info("Set isApproveConfirmed to true because skipApprove is true");
    } else {
      // Reset approval confirmation when approval is needed
      setApproveConfirmed(false);
      logger.info(
        "Set isApproveConfirmed to false because skipApprove is false",
      );
    }
  }, [skipApprove]);

  const { sendSwapTx, isSwapTxLoading, swapTxResult } = useSwapTransaction(
    chainId,
    fromTokenId,
    toTokenId,
    amountWei,
    thresholdAmountWei,
    direction,
    address,
    isApproveConfirmed,
  );

  // Early return after all hooks are called
  if (!formValues || !address || !isConnected || !balances) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex h-64 items-center justify-center">
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  async function onSubmit() {
    if (!rate || !amountWei || !address || !isConnected) return;

    // Debug logging to understand the issue
    logger.info("onSubmit called with:", {
      address,
      isApproveConfirmed,
      amountWei,
      thresholdAmountWei,
      skipApprove,
    });

    setIsModalOpen(true);

    try {
      if (skipApprove) {
        // Skip approval and go directly to swap
        logger.info("Skipping approve, sending swap tx directly");
        if (sendSwapTx) {
          await sendSwapTx();
          if (swapTxResult?.hash) {
            const swapReceipt = await waitForTransaction({
              hash: swapTxResult.hash,
              confirmations: 1,
              chainId,
            });
            logger.info(
              `Tx receipt received for swap: ${swapReceipt?.transactionHash}`,
            );
            toastToYourSuccess(
              "Swap Complete!",
              swapReceipt?.transactionHash,
              chainId,
            );
            // Reset form and go back to swap form
            setJotaiConfirmView(false);
          } else {
            logger.info("Swap submitted, waiting for confirmation");
          }
        }
      } else {
        // Need approval first
        if (!sendApproveTx) {
          logger.error("Approve transaction function not available");
          return;
        }

        logger.info("Sending approve tx");
        const approveResult = await sendApproveTx();
        const approveReceipt = await approveResult.wait(1);

        toastToYourSuccess(
          "Approve complete! Proceeding to swap...",
          approveReceipt.transactionHash,
          chainId,
        );

        logger.info(
          `Tx receipt received for approve: ${approveReceipt.transactionHash}`,
        );

        // Set approval confirmed and wait a bit for state to update
        setApproveConfirmed(true);

        // Small delay to ensure state is updated
        await new Promise((resolve) => setTimeout(resolve, 100));

        if (sendSwapTx) {
          logger.info("Approval successful, sending swap transaction");
          await sendSwapTx();
          if (swapTxResult?.hash) {
            const swapReceipt = await waitForTransaction({
              hash: swapTxResult.hash,
              confirmations: 1,
              chainId,
            });
            toastToYourSuccess(
              "Swap Complete!",
              swapReceipt?.transactionHash,
              chainId,
            );
            // Reset form and go back to swap form
            setJotaiConfirmView(false);
          }
        }
      }
    } catch (error) {
      logger.error("Failed to execute transaction", error);
    } finally {
      setIsModalOpen(false);
    }
  }

  const isLoading = isApproveTxLoading || isSwapTxLoading || isModalOpen;
  const buttonText = skipApprove ? "Confirm Swap" : "Approve & Swap";

  const fromToken = Tokens[formValues?.fromTokenId as keyof typeof Tokens];
  const toToken = Tokens[formValues?.toTokenId as keyof typeof Tokens];

  return (
    <div className="space-y-6">
      <div className="flex w-full flex-row items-center justify-between">
        <div className="bg-incard flex aspect-square h-32 flex-col items-center justify-center gap-2 md:h-52">
          <TokenIcon
            token={fromToken}
            className="h-10 w-10 bg-transparent md:h-14 md:w-14"
            size={56}
          />
          <span
            className="text-center text-xl font-medium md:text-3xl"
            data-testid="truncatedAmount"
          >
            {fromAmount} {fromToken.symbol}
          </span>
          <span className="text-muted-foreground text-sm md:text-base">
            ~$
            {fromWeiRounded(fromAmountWei, fromToken.decimals)}
          </span>
        </div>
        <div className="bg-incard text-muted-foreground hidden h-10 w-10 items-center justify-center p-3 md:flex">
          <ArrowRight size={24} className="shrink-0" />
        </div>
        <div className="bg-incard flex aspect-square h-32 flex-col items-center justify-center gap-2 md:h-52">
          <TokenIcon
            token={toToken}
            className="h-10 w-10 bg-transparent md:h-14 md:w-14"
            size={56}
          />
          <span className="text-center text-xl font-medium md:text-3xl">
            {toAmount} {toToken.symbol}
          </span>
          <span className="text-muted-foreground">
            ~$
            {fromWeiRounded(toAmountWei, toToken.decimals)}
          </span>
        </div>
      </div>

      <div className="flex w-full flex-col items-start justify-start space-y-2">
        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Quote</span>
          <span>
            1 {fromToken.symbol} = {rate} {toToken.symbol}
          </span>
        </div>

        {/* <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Fee</span>
          <span>
            {fromWeiRounded(
              "0", // Fee calculation would need to be implemented
              Tokens[formValues?.fromTokenId as keyof typeof Tokens].decimals,
            )}
          </span>
        </div>

        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Gas Price</span>
          <span>
            {fromWeiRounded(
              "0", // Gas price calculation would need to be implemented
              18, // ETH decimals for gas
            )}
          </span>
        </div> */}

        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Slippage</span>
          <span>{formValues?.slippage}%</span>
        </div>
      </div>

      <Button
        clipped="lg"
        size="lg"
        className="w-full"
        onClick={onSubmit}
        disabled={isLoading}
      >
        {isLoading ? "Processing..." : buttonText}
      </Button>
    </div>
  );
}
