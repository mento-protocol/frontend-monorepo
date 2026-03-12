"use client";

import { env } from "@/env.mjs";
import { Button, Form } from "@repo/ui";
import { chainIdToChain, type ChainId } from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { ArrowUpDown } from "lucide-react";
import { SwapInsufficientLiquidityNotice } from "../insufficient-liquidity-notice";
import { BuyTokenInput } from "./buy-token-input";
import { SellTokenInput } from "./sell-token-input";
import { SwapSubmitButton } from "./swap-submit-button";
import { useSwapForm } from "./use-swap-form";

interface SwapFormProps {
  initialFrom?: string;
  initialTo?: string;
  initialAmount?: string;
  targetChainId?: ChainId;
}

export default function SwapForm({
  initialFrom,
  initialTo,
  initialAmount,
  targetChainId,
}: SwapFormProps = {}) {
  const swap = useSwapForm({ initialFrom, initialTo, initialAmount });
  const walletChainId = useChainId();

  // Determine if user is on the wrong chain for this swap URL
  const wrongChainName =
    targetChainId && walletChainId !== targetChainId
      ? (chainIdToChain[targetChainId]?.name ?? `Chain ${targetChainId}`)
      : undefined;

  return (
    <Form {...swap.form}>
      <form
        onSubmit={swap.form.handleSubmit(swap.onSubmit)}
        className="max-w-3xl gap-6 flex h-full flex-col"
      >
        <div className="gap-0 flex flex-col">
          <SellTokenInput
            form={swap.form}
            amountRef={swap.amountRef}
            validateAmount={swap.validateAmount}
            sellUSDValue={swap.sellUSDValue}
            fromTokenBalance={swap.fromTokenBalance}
            handleUseMaxBalance={swap.handleUseMaxBalance}
            tokenOutSymbol={swap.tokenOutSymbol}
            allTokenOptions={swap.allTokenOptions}
            setLastChangedToken={swap.setLastChangedToken}
          />

          <SwapDirectionButton onReverse={swap.handleReverseTokens} />

          <BuyTokenInput
            form={swap.form}
            quoteRef={swap.quoteRef}
            formQuote={swap.formQuote}
            buyUSDValue={swap.buyUSDValue}
            toTokenBalance={swap.toTokenBalance}
            tokenInSymbol={swap.tokenInSymbol}
            allTokenOptions={swap.allTokenOptions}
            setLastChangedToken={swap.setLastChangedToken}
          />
        </div>

        <SwapRateDisplay
          rate={swap.rate}
          tokenInSymbol={swap.tokenInSymbol}
          tokenOutSymbol={swap.tokenOutSymbol}
        />

        {swap.hasInsufficientLiquidityError && (
          <SwapInsufficientLiquidityNotice
            fallbackUrl={env.NEXT_PUBLIC_BANNER_LINK}
          />
        )}

        <SwapSubmitButton
          isConnected={swap.isConnected}
          hasAmount={swap.hasAmount}
          tokenInSymbol={swap.tokenInSymbol}
          tokenOutSymbol={swap.tokenOutSymbol}
          errors={swap.errors}
          isButtonLoading={swap.isButtonLoading}
          isApproveTxLoading={swap.isApproveTxLoading}
          isApprovalProcessing={swap.isApprovalProcessing}
          tradingLimitError={swap.tradingLimitError}
          balanceError={swap.balanceError}
          isTradingSuspended={swap.isTradingSuspended}
          isSuspensionCheckLoading={swap.isSuspensionCheckLoading}
          isError={swap.isError}
          hasInsufficientLiquidityError={swap.hasInsufficientLiquidityError}
          quoteErrorMessage={swap.quoteErrorMessage}
          hasValidQuote={swap.hasValidQuote}
          shouldApprove={swap.shouldApprove}
          allTokenOptions={swap.allTokenOptions}
          wrongChainName={wrongChainName}
        />
      </form>
    </Form>
  );
}

function SwapDirectionButton({ onReverse }: { onReverse: () => void }) {
  return (
    <div className="flex w-full items-center justify-center border-x border-border dark:border-input">
      <Button
        data-testid="swapInputsButton"
        variant="outline"
        onClick={onReverse}
        size="icon"
        className="!border-y-0"
        type="button"
      >
        <ArrowUpDown className="rotate-180 transition-transform" />
      </Button>
    </div>
  );
}

function SwapRateDisplay({
  rate,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  rate: string | undefined;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}) {
  if (!rate) return null;

  return (
    <div className="gap-2 flex flex-col">
      <div className="space-y-2 flex w-full flex-col items-start justify-start">
        <div className="flex w-full flex-row items-center justify-between">
          <span className="text-muted-foreground">Rate</span>
          <span data-testid="rateLabel">{`${rate && Number(rate) > 0 ? Number(rate).toFixed(4) : "0"} ${tokenInSymbol} ~ 1 ${tokenOutSymbol}`}</span>
        </div>
      </div>
    </div>
  );
}
