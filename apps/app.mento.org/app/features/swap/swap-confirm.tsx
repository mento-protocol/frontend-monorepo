"use client";
import { type SVGProps, useEffect, useRef, useState } from "react";
import { toastToYourSuccess } from "@/components/tx-success-toast";
import { Button3D } from "@/components/buttons/3-d-button";
import { Tooltip } from "@/components/tooltip/tooltip";
import { type TokenId, Tokens } from "@/lib/config/tokens";
import { Modal } from "@/components/layout/modal";
import {
  fromWeiRounded,
  getAdjustedAmount,
  toSignificant,
} from "@/lib/utils/amount";
import { logger } from "@/lib/utils/logger";
import { truncateTextByLength } from "@/lib/utils/string";
import { useAccount, useChainId } from "wagmi";
import { useSetAtom } from "jotai";
import { formValuesAtom, confirmViewAtom } from "./swap-atoms";
import { useAccountBalances } from "../accounts/use-account-balances";
import { useApproveTransaction } from "./hooks/use-approve-transaction";
import { useSwapAllowance } from "./hooks/use-swap-allowance";
import { useSwapQuote } from "./hooks/use-swap-quote";
import { useSwapTransaction } from "./hooks/use-swap-transaction";
import type { SwapFormValues } from "./types";
import { getMaxSellAmount, getMinBuyAmount } from "./utils";
import { waitForTransaction } from "wagmi/actions";

interface Props {
  formValues: SwapFormValues;
}

export function SwapConfirmCard({ formValues }: Props) {
  const { amount, direction, fromTokenId, toTokenId, slippage } = formValues;

  // Flag for if loading modal is open (visible)
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const setJotaiFormValues = useSetAtom(formValuesAtom);
  const setJotaiConfirmView = useSetAtom(confirmViewAtom);
  const { data: balances, isLoading: isBalancesLoading } = useAccountBalances({
    address,
    chainId,
  });

  // Ensure invariants are met, otherwise return to swap form
  const isConfirmValid =
    amount && fromTokenId && toTokenId && address && isConnected;
  useEffect(() => {
    if (!isConfirmValid) setJotaiFormValues(null);
  }, [isConfirmValid, setJotaiFormValues]);

  // Early return or loading state if balances are not ready
  // placeholderData should make balances available, but this is a safeguard
  if (!balances) {
    // This could be a loading spinner or a more specific message
    // For now, returning null or a simple loader to satisfy TS and prevent runtime errors.
    // Depending on UX, a full-page loader or inline might be better.
    return (
      <div className="flex h-64 items-center justify-center">
        <MentoLogoLoader skipApprove={true} />{" "}
        {/* Using existing loader component */}
      </div>
    );
  }

  const { amountWei, quote, quoteWei, rate, refetch } = useSwapQuote(
    amount,
    direction,
    fromTokenId,
    toTokenId,
  );

  // Assemble values based on swap direction
  let fromAmount: string,
    fromAmountWei: string,
    toAmount: string,
    toAmountWei: string,
    thresholdAmount: string,
    thresholdAmountWei: string,
    approveAmount: string;

  if (direction === "in") {
    fromAmount = amount.toString();
    fromAmountWei = amountWei;
    toAmount = quote;
    toAmountWei = quoteWei;
    // Check if amount is almost equal to balance max, in which case use max
    // Helps handle problems from imprecision in non-wei amount display
    fromAmountWei = getAdjustedAmount(
      fromAmountWei,
      balances[fromTokenId],
    ).toFixed(0);
    // Compute min buy amount based on slippage
    thresholdAmountWei = getMinBuyAmount(toAmountWei, slippage).toFixed(0);
    thresholdAmount = fromWeiRounded(
      thresholdAmountWei,
      Tokens[toTokenId].decimals,
      true,
    );
    // Approve amount is equal to amount being sold
    approveAmount = fromAmountWei;
  } else {
    fromAmount = quote;
    fromAmountWei = quoteWei;
    toAmount = amount.toString();
    toAmountWei = amountWei;
    // Compute max sell amount based on slippage
    thresholdAmountWei = getMaxSellAmount(fromAmountWei, slippage).toFixed(0);
    thresholdAmount = fromWeiRounded(
      thresholdAmountWei,
      Tokens[fromTokenId].decimals,
      true,
    );
    // Approve amount is equal to max sell amount
    approveAmount = thresholdAmountWei;
  }

  const { sendApproveTx, isApproveTxSuccess, isApproveTxLoading } =
    useApproveTransaction(
      chainId,
      fromTokenId,
      toTokenId,
      approveAmount,
      address,
    );
  const [isApproveConfirmed, setApproveConfirmed] = useState(false);

  const { skipApprove, isAllowanceLoading } = useSwapAllowance({
    chainId,
    fromTokenId,
    toTokenId,
    approveAmount,
    address,
  });

  useEffect(() => {
    if (skipApprove) {
      // Enables swap transaction preparation when approval isn't needed
      // See useSwapTransaction hook for more details
      setApproveConfirmed(true);
    }
  }, [skipApprove]);

  const { sendSwapTx, isSwapTxLoading, isSwapTxSuccess, swapTxResult } =
    useSwapTransaction(
      chainId,
      fromTokenId,
      toTokenId,
      amountWei,
      thresholdAmountWei,
      direction,
      address,
      isApproveConfirmed,
    );

  const onSubmit = async () => {
    if (!rate || !amountWei || !address || !isConnected) return;

    if (skipApprove && sendSwapTx) {
      try {
        logger.info("Skipping approve, sending swap tx directly");
        setIsModalOpen(true);
        const swapResult = await sendSwapTx();
        if (swapTxResult?.hash) {
          // waitForTransaction from wagmi/actions should use client from context
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
        } else {
          logger.info(
            "Swap submitted, waiting for confirmation (toast might be delayed or handled by hook)",
          );
        }
      } catch (error) {
        logger.error("Failed to execute swap (onSubmit catch block)", error);
      } finally {
        setIsModalOpen(false);
      }
      return;
    }

    if (!skipApprove && sendApproveTx) {
      try {
        logger.info("Sending approve tx");
        setIsModalOpen(true);
        const approveResult = await sendApproveTx();
        const approveReceipt = await approveResult.wait(1);
        toastToYourSuccess(
          "Approve complete! Proceeding to swap...",
          approveReceipt.transactionHash,
          chainId,
        );
        setApproveConfirmed(true);
        logger.info(
          `Tx receipt received for approve: ${approveReceipt.transactionHash}`,
        );
        if (sendSwapTx) {
          logger.info(
            "Approval successful, attempting to trigger swap transaction automatically.",
          );
          sendSwapTx().catch((swapError: Error) => {
            logger.error(
              "Automatic swap attempt after approval failed",
              swapError,
            );
          });
        } else {
          setIsModalOpen(false);
        }
      } catch (error) {
        logger.error("Failed to approve token", error);
        setIsModalOpen(false);
      }
    }
  };

  const onClickBack = () => {
    setJotaiConfirmView(false);
  };

  const onClickRefresh = () => {
    refetch().catch((e) => logger.error("Failed to refetch quote:", e));
  };

  return (
    <FloatingBox
      width="w-screen md:w-[432px] "
      padding="p-0"
      classes="border border-primary-dark dark:border-[#333336] dark:bg-[#1D1D20]"
    >
      <div className="border-primary-dark flex justify-between border-b p-6 dark:border-[#333336]">
        <button
          type="button"
          aria-label="Go back to swap form"
          onClick={onClickBack}
          className="border-primary-dark group flex h-[36px] w-[36px] items-center justify-center rounded-full border dark:border-transparent dark:bg-[#545457] dark:text-white"
        >
          <BackArrow className="transform transition-all duration-300 ease-in-out group-hover:-translate-x-[2px]" />
        </button>

        <h2 className="font-fg text-[32px] font-medium leading-[40px] dark:text-white">
          Confirm Swap
        </h2>
        <button
          type="button"
          aria-label="Refresh swap quote"
          onClick={onClickRefresh}
          className="border-primary-dark flex h-[36px] w-[36px] transform items-center justify-center rounded-full border transition-transform duration-500 ease-in-out hover:rotate-90 dark:border-transparent dark:bg-[#545457] dark:text-white"
        >
          <RefreshSpinner />
        </button>
      </div>
      <SwapConfirmSummary
        from={{
          amount: fromAmount,
          weiAmount: fromAmountWei,
          token: fromTokenId,
        }}
        to={{ amount: toAmount, weiAmount: toAmountWei, token: toTokenId }}
        rate={rate}
      />
      {/* Slippage Info */}
      <div className="mx-6 mt-6 flex flex-col items-center rounded-xl border border-[#E5E7E9] text-sm dark:border-[#303033] dark:bg-[#18181B]">
        <div className="mx-6 flex w-full items-center justify-between py-4">
          <div className="mr-6 w-32 text-right text-[#636768] dark:text-[#AAB3B6]">
            Max Slippage:
          </div>
          <div className="w-32 pr-4 text-right dark:text-white">{`${slippage}%`}</div>
        </div>
        <div className="w-full border-b border-[#E5E7E9] dark:border-[#303033]" />
        <div className="mx-6 flex w-full items-center justify-between py-4">
          <div className="mr-6 w-32 text-right text-[#636768] dark:text-[#AAB3B6]">
            {direction === "in" ? "Min Received:" : "Max Sold"}
          </div>
          <div className="w-32 pr-4 text-right dark:text-white">
            {thresholdAmount}
          </div>
        </div>
      </div>

      <div className="mt-6 flex w-full px-6 pb-6">
        <Button3D isFullWidth onClick={onSubmit}>
          {isSwapTxLoading || isApproveTxLoading
            ? "Loading..."
            : "Confirm Swap"}
        </Button3D>
      </div>
      <Modal
        isOpen={isModalOpen}
        title="Performing Swap"
        close={() => setIsModalOpen(false)}
        width="max-w-[432px]"
      >
        <MentoLogoLoader skipApprove={skipApprove} />
      </Modal>
    </FloatingBox>
  );
}

interface SwapConfirmSummaryProps {
  from: { amount: string; weiAmount: string; token: TokenId };
  to: { amount: string; weiAmount: string; token: TokenId };
  rate?: string;
}

export function SwapConfirmSummary({
  from,
  to,
  rate,
}: SwapConfirmSummaryProps) {
  const maxAmountLength = 8;
  const fromToken = Tokens[from.token];
  const toToken = Tokens[to.token];

  const handleAmount = (amount: string) => {
    const shouldTruncate = amount.length > maxAmountLength;
    const displayedAmount = shouldTruncate
      ? truncateTextByLength(maxAmountLength, amount)
      : amount;

    return shouldTruncate ? (
      <div className="group relative text-center text-lg font-semibold leading-6 dark:text-white">
        <span> {displayedAmount}</span>
        <Tooltip text={amount}></Tooltip>
      </div>
    ) : (
      <div className="group relative text-center text-lg font-semibold leading-6 dark:text-white">
        <span> {displayedAmount}</span>
      </div>
    );
  };

  return (
    <div className="mx-6 mt-6 rounded-xl bg-[#EFF1F3] dark:bg-[#18181B]">
      <div className="relative flex items-center justify-between gap-3 rounded-xl border border-[#E5E7E9] bg-white p-[5px] dark:border-transparent dark:bg-[#303033]">
        <div className="flex h-[70px] flex-1 items-center rounded-lg bg-[#EFF1F3] pl-3 dark:bg-[#18181B]">
          <div className="my-[15px]">
            {/* <TokenIcon size="l" token={fromToken} /> */}
          </div>
          <div className="flex flex-1 flex-col items-center px-2">
            <div className="text-center text-sm dark:text-[#AAB3B6]">
              {fromToken.symbol}
            </div>
            {handleAmount(toSignificant(from.amount))}
          </div>
        </div>
        <div className="dark:text-[#AAB3B6]">
          <ChevronRight />
        </div>
        <div className="flex h-[70px] flex-1 items-center rounded-lg bg-[#EFF1F3] pr-3 dark:bg-[#18181B]">
          <div className="flex flex-1 flex-col items-center px-2">
            <div className="text-center text-sm dark:text-[#AAB3B6]">
              {toToken.symbol}
            </div>
            {handleAmount(toSignificant(to.amount) || "0")}
          </div>
          <div className="my-[15px]">
            <TokenIcon size="l" token={toToken} />
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center rounded-b py-2 text-sm text-[#AAB3B6]">
        {rate ? `${rate} ${from.token} : 1 ${to.token}` : "Loading..."}
      </div>
    </div>
  );
}

const ChevronRight = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth={1.33}
      d="m8.5 5.5 4 4.5-4 4.5"
    />
  </svg>
);

const MentoLogoLoader = ({ skipApprove }: { skipApprove: boolean }) => {
  const { connector } = useAccount();

  return (
    <>
      <div className="border-y border-[#E5E7E9] dark:border-[#333336]">
        <div className="mx-auto my-6 h-[124px] w-[124px] dark:hidden"></div>
        <div className="mx-auto my-6 hidden h-[124px] w-[124px] dark:block"></div>
      </div>

      <div className="my-6">
        <div className="text-center text-sm text-[#636768] dark:text-[#AAB3B6]">
          {skipApprove
            ? "Sending swap transaction"
            : "Sending two transactions: Approve and Swap"}
        </div>
        <div className="mt-3 text-center text-sm text-[#636768] dark:text-[#AAB3B6]">
          {`Sign with ${connector?.name || "wallet"} to proceed`}
        </div>
      </div>
    </>
  );
};

const BackArrow = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={7}
    height={12}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth={1.33}
      d="M5.5 10.5 1.5 6l4-4.5"
    />
  </svg>
);

const RefreshSpinner = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeWidth={1.33}
      d="M16.113 7.333a6.669 6.669 0 0 0-12.746 2"
    />
    <path
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={1.33}
      d="M13.335 7.333h2.933a.4.4 0 0 0 .4-.4V4M3.922 12.667a6.67 6.67 0 0 0 12.746-2"
    />
    <path
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth={1.33}
      d="M6.7 12.667H3.768a.4.4 0 0 0-.4.4V16"
    />
  </svg>
);
