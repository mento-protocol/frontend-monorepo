"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn, TokenIcon, IconLoading } from "@repo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import {
  Button,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@repo/ui";

import { CoinInput } from "@repo/ui";

import { ConnectButton } from "@/components/nav/connect-button";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { useApproveTransaction } from "@/features/swap/hooks/use-approve-transaction";
import { useSwapAllowance } from "@/features/swap/hooks/use-swap-allowance";
import { useSwapQuote } from "@/features/swap/hooks/use-swap-quote";
import { useTokenOptions } from "@/features/swap/hooks/use-token-options";
import { confirmViewAtom, formValuesAtom } from "@/features/swap/swap-atoms";
import type { SwapFormValues } from "@/features/swap/types";
import { formatWithMaxDecimals } from "@/features/swap/utils";
import { checkTradingLimits } from "@/features/swap/utils/check-trading-limits";
import { type TokenId, Tokens } from "@/lib/config/tokens";
import { fromWeiRounded, toWei } from "@/lib/utils/amount";
import { useDebounce } from "@/lib/utils/debounce";
import { logger } from "@/lib/utils/logger";
import { useAtom } from "jotai";
import { ArrowUpDown, ChevronDown, OctagonAlert } from "lucide-react";
import { useAccount, useChainId } from "wagmi";
import { waitForTransaction } from "wagmi/actions";
import TokenDialog from "./token-dialog";

type SwapDirection = "in" | "out";

const formSchema = z.object({
  amount: z.string().min(1, { message: "Amount is required" }),
  direction: z.enum(["in", "out"]),
  fromTokenId: z.string().min(1, { message: "From token is required" }),
  quote: z.string(),
  toTokenId: z.string().min(1, { message: "To token is required" }),
  slippage: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Default empty balances object
const defaultEmptyBalances = {};

const tokenButtonClassName =
  "ring-offset-background placeholder:text-muted-foreground focus:ring-ring bg-outlier hover:border-border-secondary mt-[22px] flex h-10 w-full max-w-32 min-w-[116px] items-center justify-between gap-2 rounded-none border-solid border-1 border-[var(--border)] px-3 py-2 text-sm transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export default function SwapForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const [, setConfirmView] = useAtom(confirmViewAtom);
  const [isApprovalProcessing, setIsApprovalProcessing] = useState(false);
  const [isCheckingTradingLimits, setIsCheckingTradingLimits] = useState(false);
  const [tradingLimitError, setTradingLimitError] = useState<{
    exceeds: boolean;
    errorMsg: string;
  } | null>(null);

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });

  const { allTokenOptions } = useTokenOptions(undefined, balancesFromHook);

  const amountRef = useRef<HTMLInputElement>(null);
  const quoteRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      direction: formValues?.direction || "in",
      amount: formValues?.amount || "",
      quote: formValues?.quote || "",
      fromTokenId: formValues?.fromTokenId || "CELO",
      toTokenId: formValues?.toTokenId || "cUSD",
      slippage: formValues?.slippage || "0.5",
    },
  });

  const fromTokenId = useWatch({ control: form.control, name: "fromTokenId" });
  const toTokenId = useWatch({ control: form.control, name: "toTokenId" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const formDirection = useWatch({ control: form.control, name: "direction" });
  const formQuote = useWatch({ control: form.control, name: "quote" });

  // Get token balances from the hook
  const balances = balancesFromHook || defaultEmptyBalances;
  const fromTokenBalance = useMemo(() => {
    const balanceValue = balances[fromTokenId as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      Tokens[fromTokenId as TokenId]?.decimals,
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, fromTokenId]);
  const toTokenBalance = useMemo(() => {
    const balanceValue = balances[toTokenId as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      Tokens[toTokenId as TokenId]?.decimals,
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, toTokenId]);

  const hasAmount = amount && amount !== "" && amount !== "0";

  // Check if amount exceeds balance
  const amountExceedsBalance = useMemo(() => {
    if (!hasAmount || !fromTokenBalance) return false;

    // When direction is "in", we're selling the fromToken
    if (formDirection === "in") {
      const numericAmount = Number.parseFloat(amount.replace(/,/g, ""));
      const numericBalance = Number.parseFloat(
        fromTokenBalance.replace(/,/g, ""),
      );
      return numericAmount > numericBalance;
    }

    // When direction is "out", we need to check if the calculated quote exceeds the fromToken balance
    if (formDirection === "out" && formQuote) {
      const numericQuote = Number.parseFloat(formQuote.replace(/,/g, ""));
      const numericBalance = Number.parseFloat(
        fromTokenBalance.replace(/,/g, ""),
      );
      return numericQuote > numericBalance;
    }

    return false;
  }, [amount, hasAmount, fromTokenBalance, formDirection, formQuote]);

  // Check if we should skip quote requests due to balance issues
  const shouldSkipQuoteRequest = useMemo(() => {
    if (!hasAmount) return true;

    // For "out" direction (buying), estimate if the required sell amount would exceed balance
    if (formDirection === "out") {
      const numericBuyAmount = Number.parseFloat(amount.replace(/,/g, ""));
      const numericBalance = Number.parseFloat(
        fromTokenBalance.replace(/,/g, ""),
      );

      // If buy amount is significantly higher than available balance, skip quote request
      // This prevents the infinite loop when user enters unrealistic buy amounts
      if (numericBuyAmount > numericBalance * 10) {
        return true;
      }
    }

    // For "in" direction, check if sell amount exceeds balance
    if (formDirection === "in") {
      const numericAmount = Number.parseFloat(amount.replace(/,/g, ""));
      const numericBalance = Number.parseFloat(
        fromTokenBalance.replace(/,/g, ""),
      );
      if (numericAmount > numericBalance) {
        return true;
      }
    }

    return false;
  }, [hasAmount, formDirection, amount, fromTokenBalance]);

  const debouncedAmount = useDebounce(amount, 350);

  // Check trading limits when relevant values change
  useEffect(() => {
    const checkLimits = async () => {
      // Only check if we have all required values and user is connected
      if (
        !isConnected ||
        !balancesFromHook ||
        !amount ||
        !fromTokenId ||
        !toTokenId
      ) {
        setTradingLimitError(null);
        setIsCheckingTradingLimits(false);
        return;
      }

      try {
        setIsCheckingTradingLimits(true);
        const result = await checkTradingLimits(
          {
            amount,
            fromTokenId: fromTokenId as TokenId,
            toTokenId: toTokenId as TokenId,
            direction: formDirection,
            quote: formQuote,
            slippage: formValues?.slippage || "0.5",
          },
          chainId,
        );

        setTradingLimitError(result);

        // Show toast if there's an error
        if (result.exceeds && result.errorMsg) {
          toast.error("Swap exceeds trading limits", {
            description: result.errorMsg,
            duration: 10000, // Show for 10 seconds since it's important
          });
        }
      } catch (error) {
        console.error("Error checking trading limits:", error);
        setTradingLimitError(null);
      } finally {
        setIsCheckingTradingLimits(false);
      }
    };

    // Only check when amount is stable (debounced)
    if (debouncedAmount === amount) {
      checkLimits();
    }
  }, [
    amount,
    debouncedAmount,
    fromTokenId,
    toTokenId,
    formDirection,
    formQuote,
    chainId,
    isConnected,
    balancesFromHook,
    formValues?.slippage,
  ]);

  // Show toast error when balance is exceeded
  useEffect(() => {
    if (shouldSkipQuoteRequest && hasAmount && debouncedAmount === amount) {
      const sellTokenSymbol =
        Tokens[fromTokenId as TokenId]?.symbol || fromTokenId;
      const buyTokenSymbol = Tokens[toTokenId as TokenId]?.symbol || toTokenId;

      let errorMessage = "";
      if (formDirection === "in") {
        errorMessage = `Not enough ${sellTokenSymbol} to sell ${formatWithMaxDecimals(amount)}`;
      } else {
        errorMessage = `Not enough ${sellTokenSymbol} to buy ${formatWithMaxDecimals(amount)} ${buyTokenSymbol}`;
      }

      toast.error(errorMessage);
    }
  }, [
    shouldSkipQuoteRequest,
    hasAmount,
    formDirection,
    fromTokenId,
    toTokenId,
    amount,
    debouncedAmount,
  ]);

  // Get insufficient balance message
  const insufficientBalanceMessage = useMemo(() => {
    if (!amountExceedsBalance && !shouldSkipQuoteRequest) return null;

    return "Insufficient Balance";
  }, [amountExceedsBalance, shouldSkipQuoteRequest]);

  // Function to handle token swap
  const handleReverseTokens = () => {
    const currentFromTokenId = form.getValues("fromTokenId");
    const currentToTokenId = form.getValues("toTokenId");
    const currentAmount = form.getValues("amount");

    // Swap token IDs
    form.setValue("fromTokenId", currentToTokenId);
    form.setValue("toTokenId", currentFromTokenId);

    // Keep the current amount value and direction as "in" (top field)
    form.setValue("amount", currentAmount);
    form.setValue("direction", "in");

    // Clear the quote to trigger recalculation
    form.setValue("quote", "");
  };

  const handleUseMaxBalance = () => {
    const maxAmountWei = balances[fromTokenId as keyof typeof balances] || "0";
    console.log("maxAmountWei", maxAmountWei);
    // Use the full balance amount
    const maxAmountBigInt = BigInt(maxAmountWei);
    const decimals = Tokens[fromTokenId as TokenId]?.decimals;

    const formattedAmount = fromWeiRounded(
      maxAmountBigInt.toString(),
      decimals,
    );
    // Use formatWithMaxDecimals without thousand separators for form input
    form.setValue("amount", formatWithMaxDecimals(formattedAmount, 4, false));
    form.setValue("direction", "in");

    // Show warning toast specifically for CELO token
    if (fromTokenId === "CELO") {
      toast.success("Max balance used", {
        duration: 5000,
        description: () => <>Consider keeping some CELO for transaction fees</>,
        icon: <OctagonAlert strokeWidth={1.5} size={18} className="mt-0.5" />,
      });
    }
  };

  // Type assertion is needed because the form values are strings
  // but the hook expects specific types
  const { isLoading, quote, rate, isError } = useSwapQuote(
    shouldSkipQuoteRequest ? "" : amount,
    formDirection as SwapDirection,
    fromTokenId as TokenId,
    toTokenId as TokenId,
  );

  // Get rate from fromToken to cUSD for USD value calculation
  const { quote: fromTokenUSDValue } = useSwapQuote(
    fromTokenId === "cUSD"
      ? "0"
      : formDirection === "in"
        ? amount || "0"
        : formQuote || "0",
    "in" as SwapDirection,
    fromTokenId as TokenId,
    "cUSD" as TokenId,
  );

  // Get rate from toToken to cUSD for USD value calculation
  const { quote: toTokenUSDValue } = useSwapQuote(
    toTokenId === "cUSD"
      ? "0"
      : formDirection === "out"
        ? amount || "0"
        : formQuote || "0",
    "in" as SwapDirection,
    toTokenId as TokenId,
    "cUSD" as TokenId,
  );

  const sellUSDValue = useMemo(() => {
    if (formDirection === "in") {
      // selling from-token
      return fromTokenId === "cUSD" ? amount || "0" : fromTokenUSDValue || "0";
    } else {
      // still selling from-token (but user typed in Buy first)
      return fromTokenId === "cUSD"
        ? formQuote || "0"
        : fromTokenUSDValue || "0";
    }
  }, [formDirection, fromTokenId, amount, formQuote, fromTokenUSDValue]);

  const buyUSDValue = useMemo(() => {
    if (formDirection === "in") {
      return toTokenId === "cUSD" ? formQuote || "0" : toTokenUSDValue || "0";
    } else {
      // we're buying the to-token
      return toTokenId === "cUSD" ? amount || "0" : toTokenUSDValue || "0";
    }
  }, [formDirection, toTokenId, amount, formQuote, toTokenUSDValue]);

  const amountWei = useMemo(() => {
    if (!fromTokenId) return "0";

    // When direction is "in", we're selling the exact amount entered
    if (formDirection === "in") {
      return amount
        ? toWei(amount, Tokens[fromTokenId as TokenId]?.decimals).toFixed(0)
        : "0";
    }

    // When direction is "out", we're selling the calculated quote amount
    return formQuote
      ? toWei(formQuote, Tokens[fromTokenId as TokenId]?.decimals).toFixed(0)
      : "0";
  }, [amount, formQuote, formDirection, fromTokenId]);

  // Check if approval is needed
  const { skipApprove } = useSwapAllowance({
    chainId,
    fromTokenId: fromTokenId as TokenId,
    toTokenId: toTokenId as TokenId,
    approveAmount: amountWei,
    address,
  });

  // Approval transaction hook
  const { sendApproveTx, isApproveTxLoading } = useApproveTransaction(
    chainId,
    fromTokenId as TokenId,
    toTokenId as TokenId,
    amountWei,
    address,
  );

  // Update the quote field when the calculated quote changes
  useEffect(() => {
    if (quote !== undefined && formQuote !== quote) {
      form.setValue("quote", quote, {
        shouldValidate: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      // If approval is needed, do it first
      if (!skipApprove && sendApproveTx) {
        setIsApprovalProcessing(true);
        logger.info("Approval needed, sending approve transaction");
        const approveTx = await sendApproveTx();

        if (!approveTx?.hash) {
          setIsApprovalProcessing(false);
          throw new Error("Approval transaction failed");
        }

        logger.info("Waiting for approval transaction", {
          hash: approveTx.hash,
        });
        await waitForTransaction({ hash: approveTx.hash });
        logger.info("Approval transaction confirmed");
        setIsApprovalProcessing(false);
      }

      // Set form values and navigate to confirmation
      const formData: SwapFormValues = {
        ...values,
        slippage: formValues?.slippage || "0.5",
        fromTokenId: fromTokenId as TokenId,
        toTokenId: toTokenId as TokenId,
        buyUSDValue,
        sellUSDValue,
      };

      setFormValues(formData);
      setConfirmView(true);
    } catch (error) {
      logger.error("Error in swap form submission", error);
      setIsApprovalProcessing(false);

      // Check if user rejected the transaction
      const errorMessage = error instanceof Error ? error.message : "";
      const isUserRejection =
        errorMessage.includes("User rejected request") ||
        errorMessage.includes("User denied transaction signature") ||
        errorMessage.includes("user rejected transaction");

      const toastTitle = isUserRejection
        ? "User rejected transaction"
        : "Transaction failed";
      const toastDescription = isUserRejection
        ? "Transaction was cancelled by user"
        : error instanceof Error
          ? error.message
          : "Unknown error occurred";

      toast.error(toastTitle, {
        description: toastDescription,
      });
    }
  };
  const shouldApprove =
    debouncedAmount === amount &&
    !skipApprove &&
    hasAmount &&
    quote &&
    !isLoading;

  // Check if there's a trading limit error
  const hasTradingLimitError = tradingLimitError?.exceeds || false;

  // Determine if button should be disabled
  const isButtonDisabled =
    !hasAmount ||
    isLoading ||
    (!quote && !shouldSkipQuoteRequest) ||
    amountExceedsBalance ||
    shouldSkipQuoteRequest ||
    isApproveTxLoading ||
    isApprovalProcessing ||
    debouncedAmount !== amount ||
    isCheckingTradingLimits ||
    hasTradingLimitError;

  // Determine button text
  const getButtonText = () => {
    if (
      isLoading ||
      (hasAmount && !quote && !shouldSkipQuoteRequest) ||
      debouncedAmount !== amount ||
      isCheckingTradingLimits
    ) {
      return <IconLoading />;
    }

    if (hasTradingLimitError) {
      return "Swap exceeds trading limits";
    }

    if (hasAmount && (amountExceedsBalance || shouldSkipQuoteRequest)) {
      return insufficientBalanceMessage || "Insufficient Balance";
    }

    if (isError && hasAmount) {
      return "Unable to fetch quote";
    }

    if (isApproveTxLoading || isApprovalProcessing) {
      return <IconLoading />;
    }

    if (shouldApprove) {
      return `Approve ${Tokens[fromTokenId as TokenId]?.symbol || fromTokenId}`;
    }

    return "Swap";
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex h-full max-w-3xl flex-col gap-6"
      >
        <div className="flex flex-col gap-0">
          <div
            className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary grid grid-cols-12 gap-4 border p-4 transition-colors"
            onClick={() => {
              amountRef.current?.focus();
            }}
          >
            <div className="col-span-8">
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sell</FormLabel>
                    <FormControl>
                      <CoinInput
                        ref={amountRef}
                        data-testid="sellAmountInput"
                        placeholder="0"
                        value={formDirection === "in" ? field.value : formQuote}
                        onChange={(e) => {
                          // Handle both string and event inputs
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          field.onChange(val);
                          // When changing the sell field, ensure direction is set to "in"
                          if (formDirection !== "in") {
                            form.setValue("direction", "in", {
                              shouldValidate: true,
                            });
                          }
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      ~${formatWithMaxDecimals(sellUSDValue)}
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-4 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="fromTokenId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={field.onChange}
                        title="Select asset to sell"
                        excludeTokenId={toTokenId}
                        onClose={() => {
                          setTimeout(() => {
                            amountRef.current?.focus();
                          }, 500);
                        }}
                        trigger={
                          <button
                            type="button"
                            className={tokenButtonClassName}
                            data-testid="selectSellTokenButton"
                          >
                            <TokenIcon
                              token={allTokenOptions.find(
                                (token) => token.id === field.value,
                              )}
                              className="mr-2"
                              size={20}
                            />

                            <span>{field.value || "Select token"}</span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                        }
                      />
                    </FormControl>
                    <FormDescription className="w-fit whitespace-nowrap">
                      Balance: {fromTokenBalance}{" "}
                      <button
                        type="button"
                        className="cursor-pointer border-none bg-transparent p-0 text-inherit underline"
                        onClick={handleUseMaxBalance}
                      >
                        MAX
                      </button>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="dark:border-input border-border flex w-full items-center justify-center border-x">
            <Button
              data-testid="swapInputsButton"
              variant="outline"
              onClick={handleReverseTokens}
              size="icon"
              className="!border-y-0"
              type="button"
            >
              <ArrowUpDown
                className={cn(
                  "rotate-180 transition-transform",
                  formDirection === "in" ? "rotate-0" : "rotate-180",
                )}
              />
            </Button>
          </div>

          <div
            className="bg-incard border-border dark:border-input maybe-hover:border-border-secondary focus-within:!border-primary dark:focus-within:!border-primary grid grid-cols-12 gap-4 border p-4 transition-colors"
            onClick={() => {
              quoteRef.current?.focus();
            }}
          >
            <div className="col-span-8">
              <Controller
                control={form.control}
                name="quote"
                render={({ fieldState }) => (
                  <FormItem>
                    <FormLabel>Buy</FormLabel>
                    <FormControl>
                      <CoinInput
                        ref={quoteRef}
                        data-testid="buyAmountInput"
                        placeholder="0"
                        value={
                          formDirection === "out"
                            ? amount
                            : formQuote &&
                                formQuote !== "0" &&
                                formQuote !== "0.00"
                              ? formQuote
                              : ""
                        }
                        onChange={(e) => {
                          // Handle both string and event inputs
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          // When changing this field, update amount and direction
                          form.setValue("amount", val, {
                            shouldValidate: true,
                          });
                          if (formDirection !== "out") {
                            form.setValue("direction", "out", {
                              shouldValidate: true,
                            });
                          }
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      ~${formatWithMaxDecimals(buyUSDValue)}
                    </FormDescription>
                    <FormMessage>{fieldState.error?.message}</FormMessage>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-4 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="toTokenId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={field.onChange}
                        title="Select asset to buy"
                        excludeTokenId={fromTokenId}
                        onClose={() => {
                          setTimeout(() => {
                            quoteRef.current?.focus();
                          }, 500);
                        }}
                        trigger={
                          <button
                            type="button"
                            className={tokenButtonClassName}
                            data-testid="selectBuyTokenButton"
                          >
                            <TokenIcon
                              token={allTokenOptions.find(
                                (token) => token.id === field.value,
                              )}
                              className="mr-2"
                              size={20}
                            />
                            <span>{field.value || "Select token"}</span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </button>
                        }
                      />
                    </FormControl>
                    <FormDescription className="w-fit whitespace-nowrap">
                      Balance: {toTokenBalance}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {rate && (
            <div className="flex w-full flex-col items-start justify-start space-y-2">
              <div className="flex w-full flex-row items-center justify-between">
                <span className="text-muted-foreground">Rate</span>
                <span data-testid="rateLabel">{`${rate && Number(rate) > 0 ? Number(rate).toFixed(4) : "0"} ${fromTokenId} ~ 1 ${toTokenId}`}</span>
              </div>
            </div>
          )}
        </div>

        {isConnected ? (
          <Button
            data-testid={shouldApprove ? "approveButton" : "swapButton"}
            className="mt-auto w-full"
            size="lg"
            clipped="lg"
            type="submit"
            disabled={isButtonDisabled}
          >
            {getButtonText()}
          </Button>
        ) : (
          <ConnectButton size="lg" text="Connect" />
        )}
      </form>
    </Form>
  );
}
