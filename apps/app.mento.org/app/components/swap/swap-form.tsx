"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn, IconLoading, TokenIcon } from "@repo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  areAmountsNearlyEqual,
  chainIdToChain,
  confirmViewAtom,
  ConnectButton,
  formatWithMaxDecimals,
  formValuesAtom,
  fromWeiRounded,
  logger,
  MIN_ROUNDED_VALUE,
  parseAmount,
  SwapFormValues,
  TokenId,
  Tokens,
  toWei,
  useAccountBalances,
  useApproveTransaction,
  useOptimizedSwapQuote,
  useSwapAllowance,
  useTokenOptions,
  useTradablePairs,
  useTradingLimits,
} from "@repo/web3";
import { useAtom } from "jotai";
import { ArrowUpDown, ChevronDown, OctagonAlert } from "lucide-react";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import TokenDialog from "./token-dialog";

type SwapDirection = "in" | "out";

// Helper functions for token operations
const getTokenDecimals = (tokenId: string) =>
  Tokens[tokenId as TokenId]?.decimals;
const getTokenInfo = (tokenId: string) => Tokens[tokenId as TokenId];

// Layer 1: Keep Zod for static checks only
const formSchema = z.object({
  amount: z
    .string()
    .min(1, { message: "Amount is required" })
    .refine((v) => {
      // Allow "0." as valid input (user is typing)
      if (v === "0." || v === "0") return true;
      const parsed = parseAmount(v);
      return parsed !== null && parsed.gt(0);
    }),
  direction: z.enum(["in", "out"]),
  tokenInId: z.string().min(1, { message: "From token is required" }),
  quote: z.string(),
  tokenOutId: z.string().min(1, { message: "To token is required" }),
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

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });
  const balances = balancesFromHook || defaultEmptyBalances;

  const { allTokenOptions } = useTokenOptions(undefined, balancesFromHook);

  const amountRef = useRef<HTMLInputElement>(null);
  const quoteRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      direction: formValues?.direction || "in",
      amount: formValues?.amount || "",
      quote: formValues?.quote || "",
      tokenInId: formValues?.tokenInId || "CELO",
      tokenOutId: formValues?.tokenOutId || "cUSD",
      slippage: formValues?.slippage || "0.5",
    },
    mode: "onChange", // Important for field-level validation
  });

  const tokenInId = useWatch({ control: form.control, name: "tokenInId" });
  const tokenOutId = useWatch({ control: form.control, name: "tokenOutId" });
  const amount = useWatch({ control: form.control, name: "amount" });
  const formDirection = useWatch({ control: form.control, name: "direction" });
  const formQuote = useWatch({ control: form.control, name: "quote" });

  // Get token balances
  const fromTokenBalance = useMemo(() => {
    const balanceValue = balances[tokenInId as keyof typeof balances];
    const balance = fromWeiRounded(balanceValue, getTokenDecimals(tokenInId));
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, tokenInId]);

  const toTokenBalance = useMemo(() => {
    const balanceValue = balances[tokenOutId as keyof typeof balances];
    const balance = fromWeiRounded(balanceValue, getTokenDecimals(tokenOutId));
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, tokenOutId]);

  // Get trading limits
  const { data: limits, isLoading: limitsLoading } = useTradingLimits(
    tokenInId,
    tokenOutId,
    chainId,
  );

  // Layer 2: Field-level sync validation (balance)
  const validateBalance = useCallback(
    (value: string) => {
      if (!value || !tokenInId) return true;

      // Allow "0." as user is typing
      if (value === "0." || value === "0") return true;

      const parsedAmount = parseAmount(value);

      if (!parsedAmount) return true;

      // Check minimum amount
      if (parsedAmount.lte(MIN_ROUNDED_VALUE) && !parsedAmount.isZero()) {
        return "Amount too small";
      }

      const tokenInfo = getTokenInfo(tokenInId);
      if (!tokenInfo) return "Invalid token";

      const tokenBalance = balances[tokenInId as keyof typeof balances];
      if (typeof tokenBalance === "undefined") return "Balance unavailable";

      const amountInWei = toWei(parsedAmount, tokenInfo.decimals);

      // Use areAmountsNearlyEqual to allow for small rounding differences
      if (
        amountInWei.gt(tokenBalance) &&
        !areAmountsNearlyEqual(amountInWei, tokenBalance)
      ) {
        return "Insufficient balance";
      }

      return true;
    },
    [balances, tokenInId],
  );

  // Shared function for limit validation logic
  const checkTradingLimitViolation = useCallback(
    (
      numericAmount: number,
      numericQuote: number,
      limits: NonNullable<ReturnType<typeof useTradingLimits>["data"]>,
      formDirection: string,
      tokenInId: string,
      tokenOutId: string,
    ) => {
      const { L0, L1, LG, tokenToCheck } = limits;

      let amountToCheck: number;
      let exceeds = false;
      let limit = 0;
      let total = 0;
      let timestamp = 0;
      let exceededTier: "L0" | "L1" | "LG" | null = null;
      let isImplicitLimit = false;

      if (tokenToCheck === tokenInId) {
        // Direct limit on input token
        amountToCheck = formDirection === "in" ? numericAmount : numericQuote;
        if (LG?.maxIn && amountToCheck > LG.maxIn) {
          exceeds = true;
          limit = LG.maxIn;
          timestamp = LG.until || 0;
          exceededTier = "LG";
          total = LG.total || 0;
        } else if (L1?.maxIn && amountToCheck > L1.maxIn) {
          exceeds = true;
          limit = L1.maxIn;
          timestamp = L1.until || 0;
          exceededTier = "L1";
          total = L1.total || 0;
        } else if (L0?.maxIn && amountToCheck > L0.maxIn) {
          exceeds = true;
          limit = L0.maxIn;
          timestamp = L0.until || 0;
          exceededTier = "L0";
          total = L0.total || 0;
        }
      } else if (tokenToCheck === tokenOutId) {
        // Direct limit on output token OR implicit limit when output token has limits
        amountToCheck = formDirection === "in" ? numericQuote : numericAmount;

        // When tokenToCheck is the output token, we need to check both:
        // 1. Direct maxOut limits (can't take out more than X)
        // 2. Implicit limits from maxOut (can't put in more than X worth)

        if (formDirection === "in") {
          // Selling tokenIn for tokenOut
          // Check if we're trying to take out too much tokenOut (use maxOut)
          if (LG?.maxOut && amountToCheck > LG.maxOut) {
            exceeds = true;
            limit = LG.maxOut;
            timestamp = LG.until || 0;
            exceededTier = "LG";
            total = LG.total || 0;
          } else if (L1?.maxOut && amountToCheck > L1.maxOut) {
            exceeds = true;
            limit = L1.maxOut;
            timestamp = L1.until || 0;
            exceededTier = "L1";
            total = L1.total || 0;
          } else if (L0?.maxOut && amountToCheck > L0.maxOut) {
            exceeds = true;
            limit = L0.maxOut;
            timestamp = L0.until || 0;
            exceededTier = "L0";
            total = L0.total || 0;
          }
          isImplicitLimit = true;
        } else {
          // Direction is "out" - buying exact amount of tokenOut with tokenIn
          // Check if we're trying to put in too much tokenIn (use maxIn)
          if (LG?.maxIn && amountToCheck > LG.maxIn) {
            exceeds = true;
            limit = LG.maxIn;
            timestamp = LG.until || 0;
            exceededTier = "LG";
            total = LG.total || 0;
          } else if (L1?.maxIn && amountToCheck > L1.maxIn) {
            exceeds = true;
            limit = L1.maxIn;
            timestamp = L1.until || 0;
            exceededTier = "L1";
            total = L1.total || 0;
          } else if (L0?.maxIn && amountToCheck > L0.maxIn) {
            exceeds = true;
            limit = L0.maxIn;
            timestamp = L0.until || 0;
            exceededTier = "L0";
            total = L0.total || 0;
          }
        }
      }

      if (exceeds) {
        // Adjust message based on whether it's an implicit limit
        if (isImplicitLimit) {
          // For implicit limits, explain that you can't get more than X tokenOut
          if (exceededTier === "LG") {
            return `Cannot buy more than ${limit.toLocaleString()} ${tokenToCheck}. This exceeds the global trading limit.`;
          } else {
            const date = new Date(timestamp * 1000).toLocaleString();
            const timeframe = exceededTier === "L0" ? "5min" : "1d";
            return `Cannot buy more than ${limit.toLocaleString()} ${tokenToCheck} within ${timeframe}. The limit will reset to ${total.toLocaleString()} ${tokenToCheck} at ${date}.`;
          }
        } else {
          // Direct limit message (existing logic)
          if (exceededTier === "LG") {
            return `The ${tokenToCheck} amount exceeds the global trading limit of ${limit.toLocaleString()} ${tokenToCheck}.`;
          } else {
            const date = new Date(timestamp * 1000).toLocaleString();
            const timeframe = exceededTier === "L0" ? "5min" : "1d";
            return `The ${tokenToCheck} amount exceeds the current trading limit of ${limit.toLocaleString()} ${tokenToCheck} within ${timeframe}. It will be reset again to ${total.toLocaleString()} ${tokenToCheck} at ${date}.`;
          }
        }
      }

      return null; // No violation
    },
    [],
  );

  // Layer 3: Field-level async validation (trading limits)
  const validateLimits = useCallback(
    async (value: string) => {
      if (!value || limitsLoading || !limits || !limits.tokenToCheck)
        return true;

      // Allow "0." as user is typing
      if (value === "0." || value === "0") return true;

      const parsedAmount = parseAmount(value);
      if (!parsedAmount) return true;

      const numericAmount = Number(parsedAmount.toString());
      const numericQuote = Number(formQuote);

      const violation = checkTradingLimitViolation(
        numericAmount,
        numericQuote,
        limits,
        formDirection,
        tokenInId,
        tokenOutId,
      );

      return violation || true;
    },
    [
      limitsLoading,
      limits,
      checkTradingLimitViolation,
      formDirection,
      tokenInId,
      tokenOutId,
      formQuote,
    ],
  );

  // Combined validation for amount field
  const validateAmount = useCallback(
    async (value: string) => {
      const balanceCheck = validateBalance(value);
      if (balanceCheck !== true) return balanceCheck;

      const limitsCheck = await validateLimits(value);
      if (limitsCheck !== true) return limitsCheck;

      return true;
    },
    [validateBalance, validateLimits],
  );

  // Validation for quote field when direction is "out"
  const validateQuoteBalance = useCallback(
    (value: string) => {
      if (formDirection !== "out" || !value || !tokenInId) return true;

      return validateBalance(value);
    },
    [validateBalance, formDirection, tokenInId],
  );

  // Function to handle token swap
  const handleReverseTokens = () => {
    const currentTokenInId = form.getValues("tokenInId");
    const currentTokenOutId = form.getValues("tokenOutId");
    const currentAmount = form.getValues("amount");

    form.setValue("tokenInId", currentTokenOutId);
    form.setValue("tokenOutId", currentTokenInId);
    form.setValue("amount", currentAmount);
    form.setValue("direction", "in");
    form.setValue("quote", "");
  };

  const handleUseMaxBalance = () => {
    const maxAmountInWei = balances[tokenInId as keyof typeof balances] || "0";
    const maxAmountBigInt = BigInt(maxAmountInWei);
    const decimals = getTokenDecimals(tokenInId);

    const formattedAmount = fromWeiRounded(
      maxAmountBigInt.toString(),
      decimals,
    );
    form.setValue("amount", formatWithMaxDecimals(formattedAmount, 4, false));
    form.setValue("direction", "in");

    if (tokenInId === "CELO") {
      toast.success("Max balance used", {
        duration: 5000,
        description: () => <>Consider keeping some CELO for transaction fees</>,
        icon: <OctagonAlert strokeWidth={1.5} size={18} className="mt-0.5" />,
      });
    }
  };

  // Get form state
  const { errors } = form.formState;
  const hasAmount =
    amount &&
    amount !== "" &&
    amount !== "0" &&
    amount !== "0." &&
    Number(amount) > 0;

  // Check if we have a trading limit error
  const [tradingLimitError, setTradingLimitError] = useState<string | null>(
    null,
  );

  // Check for balance error
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const canQuote = !!hasAmount && !errors.amount && !limitsLoading;

  const {
    isLoading: quoteLoading,
    quote,
    rate,
    isError,
    fromTokenUSDValue,
    toTokenUSDValue,
  } = useOptimizedSwapQuote(
    canQuote ? amount : "",
    formDirection as SwapDirection,
    tokenInId as TokenId,
    tokenOutId as TokenId,
  );

  useEffect(() => {
    setTradingLimitError(null);
  }, [amount, quote]);

  // Check balance in real-time
  useEffect(() => {
    const checkBalance = async () => {
      if (!hasAmount || !tokenInId) {
        setBalanceError(null);
        return;
      }

      const balanceCheck = validateBalance(amount);
      if (balanceCheck !== true) {
        setBalanceError(balanceCheck);
      } else {
        setBalanceError(null);
      }
    };

    checkBalance();
  }, [amount, hasAmount, tokenInId, formDirection, validateBalance]);

  useEffect(() => {
    if (!hasAmount || !limits || limitsLoading) return;

    const numericAmount = Number(parseAmount(amount) ?? 0);
    const numericQuote = Number(quote || 0);

    const violation = checkTradingLimitViolation(
      numericAmount,
      numericQuote,
      limits,
      formDirection,
      tokenInId,
      tokenOutId,
    );

    setTradingLimitError((v) => (v === violation ? v : violation));
  }, [
    amount,
    quote,
    limits,
    limitsLoading,
    formDirection,
    tokenInId,
    tokenOutId,
    hasAmount,
    checkTradingLimitViolation,
  ]);

  useEffect(() => {
    if (tradingLimitError) {
      toast.error(tradingLimitError, {
        duration: 20000,
      });
    }
  }, [tradingLimitError]);

  // Override loading state when we have validation errors
  const isLoading =
    quoteLoading && canQuote && !tradingLimitError && !limitsLoading;

  const sellUSDValue = useMemo(() => {
    if (formDirection === "in") {
      return tokenInId === "cUSD" ? amount || "0" : fromTokenUSDValue || "0";
    } else {
      return tokenInId === "cUSD" ? formQuote || "0" : fromTokenUSDValue || "0";
    }
  }, [formDirection, tokenInId, amount, formQuote, fromTokenUSDValue]);

  const buyUSDValue = useMemo(() => {
    if (formDirection === "in") {
      return tokenOutId === "cUSD" ? formQuote || "0" : toTokenUSDValue || "0";
    } else {
      return tokenOutId === "cUSD" ? amount || "0" : toTokenUSDValue || "0";
    }
  }, [formDirection, tokenOutId, amount, formQuote, toTokenUSDValue]);

  const amountInWei = useMemo(() => {
    if (!tokenInId) return "0";

    if (formDirection === "in") {
      return amount
        ? toWei(amount, getTokenDecimals(tokenInId)).toFixed(0)
        : "0";
    }

    return formQuote
      ? toWei(formQuote, getTokenDecimals(tokenInId)).toFixed(0)
      : "0";
  }, [amount, formQuote, formDirection, tokenInId]);

  // Check if approval is needed
  const { skipApprove } = useSwapAllowance({
    chainId,
    tokenInId: tokenInId as TokenId,
    tokenOutId: tokenOutId as TokenId,
    approveAmount: amountInWei,
    address,
  });

  // Approval transaction hook
  const { sendApproveTx, isApproveTxLoading, approveTxHash } =
    useApproveTransaction({
      chainId,
      tokenInId: tokenInId as TokenId,
      tokenOutId: tokenOutId as TokenId,
      amountInWei,
      accountAddress: address,
      onSuccess: (receipt) => {
        logger.info("Approval transaction confirmed");
        const explorerUrl =
          chainIdToChain[chainId]?.blockExplorers?.default.url;
        toast.success(
          <>
            <h4>Approve Successful</h4>
            <span className="text-muted-foreground mt-2 block">
              Token allowance for swap approved
            </span>
            {explorerUrl && (
              <a
                href={`${explorerUrl}/tx/${receipt.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground underline"
              >
                View Transaction on CeloScan
              </a>
            )}
          </>,
        );
        setIsApprovalProcessing(false);

        const currentFormValues = form.getValues();
        const formData: SwapFormValues = {
          ...currentFormValues,
          slippage: currentFormValues.slippage || "0.5",
          tokenInId: tokenInId as TokenId,
          tokenOutId: tokenOutId as TokenId,
          buyUSDValue,
          sellUSDValue,
        };

        setFormValues(formData);
        setConfirmView(true);
      },
    });

  useEffect(() => {
    if (quote !== undefined) {
      const formattedQuote = formatWithMaxDecimals(quote, 4, false);
      if (formQuote !== formattedQuote) {
        form.setValue("quote", formattedQuote, {
          shouldValidate: true,
        });

        if (formDirection === "out" && formattedQuote !== "0") {
          setTimeout(() => {
            form.trigger("amount");
          }, 50);
        }
      }
    }
  }, [quote, form, formQuote, formDirection]);

  // Show error toasts based on form errors
  useEffect(() => {
    // Don't show toast for "0." input
    if (
      errors.amount?.message &&
      errors.amount.message !== "Invalid input" &&
      errors.amount.message !== "Amount is required" &&
      hasAmount
    ) {
      toast.error(errors.amount.message);
    }
  }, [errors.amount, hasAmount, amount]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (!skipApprove && sendApproveTx) {
        setIsApprovalProcessing(true);
        logger.info("Approval needed, sending approve transaction");
        const hash = await sendApproveTx();

        if (!hash) {
          setIsApprovalProcessing(false);
        }

        logger.info("Waiting for approval transaction", {
          hash: approveTxHash,
        });
      } else {
        const formData: SwapFormValues = {
          ...values,
          slippage: form.getValues("slippage") || "0.5",
          tokenInId: tokenInId as TokenId,
          tokenOutId: tokenOutId as TokenId,
          buyUSDValue,
          sellUSDValue,
        };
        setFormValues(formData);
        setConfirmView(true);
      }
    } catch (error) {
      logger.error("Error in swap form submission", error);
      setIsApprovalProcessing(false);
    }
  };

  const shouldApprove = !skipApprove && hasAmount && quote && !isLoading;

  // Get tradable pairs for both tokens
  const { data: fromTokenTradablePairs } = useTradablePairs(
    tokenInId as TokenId,
  );
  const { data: toTokenTradablePairs } = useTradablePairs(
    tokenOutId as TokenId,
  );

  const [lastChangedToken, setLastChangedToken] = useState<
    "from" | "to" | null
  >(null);

  // Handle token pair validation - reset opposite token if an invalid pair is selected
  useEffect(() => {
    if (!tokenInId || !tokenOutId || !lastChangedToken) return;

    const isValidPair =
      fromTokenTradablePairs?.includes(tokenOutId as TokenId) ||
      toTokenTradablePairs?.includes(tokenInId as TokenId);

    // If an invalid pair is selected, reset the opposite token
    if (!isValidPair) {
      if (lastChangedToken === "from") {
        form.setValue("tokenOutId", "", { shouldValidate: false });
      } else if (lastChangedToken === "to") {
        form.setValue("tokenInId", "", { shouldValidate: false });
      }
      setLastChangedToken(null);
    }
  }, [
    tokenInId,
    tokenOutId,
    fromTokenTradablePairs,
    toTokenTradablePairs,
    lastChangedToken,
    form,
  ]);

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
                rules={{
                  validate: formDirection === "in" ? validateAmount : undefined,
                }}
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
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          field.onChange(val);
                          if (formDirection !== "in") {
                            form.setValue("direction", "in", {
                              shouldValidate: true,
                            });
                          }
                        }}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormDescription data-testid="sellUsdAmountLabel">
                      ~${formatWithMaxDecimals(sellUSDValue)}
                    </FormDescription>
                  </FormItem>
                )}
              />
            </div>

            <div className="col-span-4 flex flex-row items-center justify-end">
              <FormField
                control={form.control}
                name="tokenInId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          setLastChangedToken("from");
                        }}
                        title="Select asset to sell"
                        excludeTokenId={tokenOutId}
                        filterByTokenId={tokenOutId as TokenId}
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

                            <span>{field.value || "Select"}</span>
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
                rules={{
                  validate: {
                    ...(formDirection === "out"
                      ? {
                          amount: validateAmount,
                          balance: validateQuoteBalance,
                        }
                      : {}),
                  },
                }}
                render={({ field, fieldState }) => (
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
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          form.setValue("amount", val, {
                            shouldValidate: true,
                          });
                          if (formDirection !== "out") {
                            form.setValue("direction", "out", {
                              shouldValidate: true,
                            });
                          }
                        }}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormDescription data-testid="buyUsdAmountLabel">
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
                name="tokenOutId"
                render={({ field }) => (
                  <FormItem className="flex flex-col items-end justify-end">
                    <FormControl>
                      <TokenDialog
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          setLastChangedToken("to");
                        }}
                        title="Select asset to buy"
                        excludeTokenId={tokenInId}
                        filterByTokenId={tokenInId as TokenId}
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
                            <span>{field.value || "Select"}</span>
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
                <span data-testid="rateLabel">{`${rate && Number(rate) > 0 ? Number(rate).toFixed(4) : "0"} ${tokenInId} ~ 1 ${tokenOutId}`}</span>
              </div>
            </div>
          )}
        </div>

        {isConnected ? (
          <Button
            data-testid={defineButtonLocator({
              balanceError,
              tradingLimitError,
              shouldApprove,
              tokenInId,
              tokenOutId,
            })}
            className="mt-auto w-full"
            size="lg"
            clipped="lg"
            type="submit"
            disabled={
              !hasAmount ||
              !tokenOutId ||
              !tokenInId ||
              !quote || // Require quote to be fetched
              (formDirection === "in"
                ? !!(
                    errors.amount &&
                    errors.amount.message !== "Amount is required"
                  )
                : !!(
                    errors.quote &&
                    errors.quote.message !== "Amount is required"
                  )) ||
              (isLoading && hasAmount) || // Only consider loading if there's an amount
              isApproveTxLoading ||
              isApprovalProcessing ||
              !!tradingLimitError ||
              !!balanceError ||
              (isError && hasAmount && canQuote) // Disable when unable to fetch quote
            }
          >
            {isLoading && hasAmount ? ( // Only show loading if there's an amount
              <IconLoading />
            ) : !tokenInId ? (
              "Select token to sell"
            ) : !tokenOutId ? (
              "Select token to buy"
            ) : tradingLimitError ? (
              "Swap exceeds trading limits"
            ) : balanceError ? (
              "Insufficient balance"
            ) : isError && hasAmount && canQuote ? (
              "Unable to fetch quote"
            ) : (errors.amount?.message &&
                errors.amount?.message !== "Amount is required") ||
              (formDirection === "out" && errors.quote?.message) ? (
              errors.amount?.message || errors.quote?.message
            ) : isApproveTxLoading || isApprovalProcessing ? (
              <IconLoading />
            ) : shouldApprove ? (
              `Approve ${getTokenInfo(tokenInId)?.symbol || tokenInId}`
            ) : (
              "Swap"
            )}
          </Button>
        ) : (
          <ConnectButton size="lg" text="Connect" fullWidth />
        )}
      </form>
    </Form>
  );
}

function defineButtonLocator({
  balanceError,
  tradingLimitError,
  shouldApprove,
  tokenInId,
  tokenOutId,
}: {
  balanceError: string | null;
  tradingLimitError: string | null;
  shouldApprove: string | boolean;
  tokenInId: string;
  tokenOutId: string;
}) {
  switch (true) {
    case Boolean(balanceError && !tradingLimitError):
      return "insufficientBalanceButton";
    case Boolean(tradingLimitError):
      return "swapsExceedsTradingLimitButton";
    case Boolean(shouldApprove && tokenInId && tokenOutId):
      return "approveButton";
    case !tokenInId:
      return "selectTokenToSellButton";
    case !tokenOutId:
      return "selectTokenToBuyButton";
    default:
      return "swapButton";
  }
}
