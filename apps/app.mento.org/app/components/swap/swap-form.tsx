"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconLoading, TokenIcon } from "@repo/ui";
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

import { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  chainIdToChain,
  confirmViewAtom,
  ConnectButton,
  formatBalance,
  formatWithMaxDecimals,
  formValuesAtom,
  fromWeiRounded,
  getTokenDecimals,
  logger,
  MIN_ROUNDED_VALUE,
  parseAmount,
  parseAmountWithDefault,
  SwapFormValues,
  toWei,
  useAccountBalances,
  useApproveTransaction,
  useOptimizedSwapQuote,
  useSwapAllowance,
  useTokenOptions,
  useTradablePairs,
  useTradingLimits,
  useTradingSuspensionCheck,
} from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { useAtom } from "jotai";
import { ArrowUpDown, ChevronDown, OctagonAlert } from "lucide-react";
import TokenDialog from "./token-dialog";

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
  tokenInSymbol: z.string().min(1, { message: "From token is required" }),
  quote: z.string(),
  tokenOutSymbol: z.string().min(1, { message: "To token is required" }),
  slippage: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// Default empty balances object
const defaultEmptyBalances = {};

const tokenButtonClassName =
  "ring-offset-background placeholder:text-muted-foreground focus:ring-ring bg-outlier hover:border-border-secondary mt-[22px] flex h-10 w-full max-w-32 min-w-[116px] items-center justify-between gap-2 rounded-none border-solid border-1 border-[var(--border)] px-3 py-2 text-sm transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export default function SwapForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId() ?? 42220; // Default to Celo mainnet
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const [, setConfirmView] = useAtom(confirmViewAtom);
  const [isApprovalProcessing, setIsApprovalProcessing] = useState(false);

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });
  const balances = balancesFromHook || defaultEmptyBalances;

  const { allTokenOptions } = useTokenOptions(undefined, balancesFromHook);

  const amountRef = useRef<HTMLInputElement>(null);
  const quoteRef = useRef<HTMLInputElement>(null);
  const prevTradingSuspensionErrorRef = useRef<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: formValues?.amount || "",
      quote: formValues?.quote || "",
      tokenInSymbol: formValues?.tokenInSymbol || "CELO",
      tokenOutSymbol: formValues?.tokenOutSymbol || "USDm",
      slippage: formValues?.slippage || "0.5",
    },
    mode: "onChange", // Important for field-level validation
  });

  const tokenInSymbol = useWatch({
    control: form.control,
    name: "tokenInSymbol",
  }) as TokenSymbol;
  const tokenOutSymbol = useWatch({
    control: form.control,
    name: "tokenOutSymbol",
  }) as TokenSymbol;
  const amount = useWatch({ control: form.control, name: "amount" });
  const formQuote = useWatch({ control: form.control, name: "quote" });

  // Get token balances
  const fromTokenBalance = useMemo(() => {
    const balanceValue = balances[tokenInSymbol as keyof typeof balances];
    const balance = formatBalance(
      balanceValue,
      getTokenDecimals(tokenInSymbol, chainId),
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, tokenInSymbol, chainId]);

  const toTokenBalance = useMemo(() => {
    const balanceValue = balances[tokenOutSymbol as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      getTokenDecimals(tokenOutSymbol, chainId),
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, tokenOutSymbol, chainId]);

  // Get trading limits
  const { data: limits, isLoading: limitsLoading } = useTradingLimits(
    tokenInSymbol,
    tokenOutSymbol,
    chainId,
  );

  // Check for trading suspension
  const {
    isSuspended: isTradingSuspended,
    isLoading: isSuspensionCheckLoading,
  } = useTradingSuspensionCheck(tokenInSymbol, tokenOutSymbol);

  // Balance validation
  const validateBalance = useCallback(
    (value: string) => {
      if (!value || !tokenInSymbol) return true;

      // Allow "0" or "0." while user is typing
      if (value === "0." || value === "0") return true;

      // Parse the amount
      const parsedAmount = parseAmount(value);
      if (!parsedAmount) return true;

      // Check minimum amount
      if (parsedAmount.lte(MIN_ROUNDED_VALUE) && !parsedAmount.isZero()) {
        return "Amount too small";
      }

      const tokenInfo = allTokenOptions.find((t) => t.symbol === tokenInSymbol);
      if (!tokenInfo) return "Invalid token";

      const balance = balances[tokenInSymbol as keyof typeof balances];
      if (typeof balance === "undefined") return "Balance unavailable";

      const amountInWei = toWei(parsedAmount, tokenInfo.decimals || 18);
      const balanceInWei = parseAmountWithDefault(balance, "0");

      // Check if amount exceeds balance
      if (
        amountInWei.gt(0) &&
        (balanceInWei.isZero() || balanceInWei.lt(amountInWei))
      ) {
        return "Insufficient balance";
      }

      return true;
    },
    [balances, tokenInSymbol, allTokenOptions],
  );

  // Shared function for limit validation logic
  // Only supports "in" direction - selling exact amount of tokenIn to receive tokenOut
  const checkTradingLimitViolation = useCallback(
    (
      numericAmount: number,
      numericQuote: number,
      limits: NonNullable<ReturnType<typeof useTradingLimits>["data"]>,
      tokenInSymbol: string,
      tokenOutSymbol: string,
    ) => {
      const { L0, L1, LG, tokenToCheck } = limits;

      let amountToCheck: number;
      let exceeds = false;
      let limit = 0;
      let total = 0;
      let timestamp = 0;
      let exceededTier: "L0" | "L1" | "LG" | null = null;
      let isImplicitLimit = false;

      if (tokenToCheck === tokenInSymbol) {
        // Direct limit on input token - check the sell amount
        amountToCheck = numericAmount;
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
      } else if (tokenToCheck === tokenOutSymbol) {
        // Limit on output token - check the quote amount (how much we'll receive)
        amountToCheck = numericQuote;

        // Selling tokenIn for tokenOut - check if we're trying to take out too much tokenOut
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
        tokenInSymbol,
        tokenOutSymbol,
      );

      return violation || true;
    },
    [
      limitsLoading,
      limits,
      checkTradingLimitViolation,
      tokenInSymbol,
      tokenOutSymbol,
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

  // Function to handle token swap
  const handleReverseTokens = () => {
    const currentTokenInSymbol = form.getValues("tokenInSymbol");
    const currentTokenOutSymbol = form.getValues("tokenOutSymbol");
    const currentAmount = form.getValues("amount");

    form.setValue("tokenInSymbol", currentTokenOutSymbol);
    form.setValue("tokenOutSymbol", currentTokenInSymbol);
    form.setValue("amount", currentAmount);
    form.setValue("quote", "");
  };

  const handleUseMaxBalance = () => {
    const maxAmountInWei =
      balances[tokenInSymbol as keyof typeof balances] || "0";
    const maxAmountBigInt = BigInt(maxAmountInWei);
    const decimals = getTokenDecimals(tokenInSymbol, chainId);

    const formattedAmount = formatBalance(maxAmountBigInt.toString(), decimals);
    const formattedAmountWithMaxDecimals = formatWithMaxDecimals(
      formattedAmount,
      4,
      false,
    );
    form.setValue("amount", formattedAmountWithMaxDecimals);

    if (tokenInSymbol === "CELO") {
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
    !!amount &&
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

  // Trading suspension error message
  const tradingSuspensionError = useMemo(() => {
    if (!isTradingSuspended) return null;
    return `Trading temporarily paused for ${tokenInSymbol} -> ${tokenOutSymbol}. Unable to determine accurate exchange rate now. Please try again later.`;
  }, [isTradingSuspended, tokenInSymbol, tokenOutSymbol]);

  const canQuote =
    !!hasAmount && !errors.amount && !limitsLoading && !isTradingSuspended; // Don't fetch quotes for suspended pairs

  const {
    isFetching: quoteFetching,
    quote,
    rate,
    isError,
    fromTokenUSDValue,
    toTokenUSDValue,
  } = useOptimizedSwapQuote(
    canQuote ? amount : "",
    tokenInSymbol,
    tokenOutSymbol,
  );

  useEffect(() => {
    setTradingLimitError(null);
  }, [amount, quote]);

  // Check balance in real-time
  useEffect(() => {
    const checkBalance = async () => {
      if (!hasAmount || !tokenInSymbol) {
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
  }, [amount, hasAmount, tokenInSymbol, validateBalance]);

  useEffect(() => {
    if (!hasAmount || !limits || limitsLoading) return;

    const numericAmount = Number(parseAmount(amount) ?? 0);
    const numericQuote = Number(quote || 0);

    const violation = checkTradingLimitViolation(
      numericAmount,
      numericQuote,
      limits,
      tokenInSymbol,
      tokenOutSymbol,
    );

    setTradingLimitError((v) => (v === violation ? v : violation));
  }, [
    amount,
    quote,
    limits,
    limitsLoading,
    tokenInSymbol,
    tokenOutSymbol,
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

  // Show trading suspension error toast and dismiss it when switching to a tradable pair
  useEffect(() => {
    const prevError = prevTradingSuspensionErrorRef.current;
    const hasError = tradingSuspensionError !== null;
    const errorChanged = prevError !== tradingSuspensionError;

    // Only show toast if error changed (not on every render)
    if (hasError && errorChanged) {
      toast.error(tradingSuspensionError, {
        duration: 20000,
      });
    } else if (prevError !== null && !hasError) {
      // Dismiss error toast when switching from suspended to tradable pair
      toast.dismiss();
    }

    prevTradingSuspensionErrorRef.current = tradingSuspensionError;
  }, [tradingSuspensionError]);

  // Override loading state when we have validation errors
  const isLoading =
    quoteFetching && canQuote && !tradingLimitError && !limitsLoading;

  // Track previous token pair to detect token changes and manage waiting state
  const prevTokenPairRef = useRef<{
    tokenInSymbol: TokenSymbol | undefined;
    tokenOutSymbol: TokenSymbol | undefined;
  }>({ tokenInSymbol: undefined, tokenOutSymbol: undefined });

  // Track if we're waiting for quote after token change
  const [isWaitingForQuote, setIsWaitingForQuote] = useState(false);

  // Handle token changes and quote arrival
  useEffect(() => {
    const tokensChanged =
      prevTokenPairRef.current.tokenInSymbol !== tokenInSymbol ||
      prevTokenPairRef.current.tokenOutSymbol !== tokenOutSymbol;

    if (tokensChanged) {
      prevTokenPairRef.current = { tokenInSymbol, tokenOutSymbol };
      // Start waiting when tokens change and we have inputs
      if (hasAmount && !!tokenInSymbol && !!tokenOutSymbol) {
        setIsWaitingForQuote(true);
      }
    }

    // Clear waiting flag when trading is suspended (no quote will be fetched)
    if (isTradingSuspended && isWaitingForQuote) {
      setIsWaitingForQuote(false);
    }

    // Clear waiting flag when we have a valid quote and fetching is done
    if (
      isWaitingForQuote &&
      quote &&
      quote !== "0" &&
      Number(quote) > 0 &&
      !quoteFetching
    ) {
      setIsWaitingForQuote(false);
    }
  }, [
    tokenInSymbol,
    tokenOutSymbol,
    hasAmount,
    isWaitingForQuote,
    quote,
    quoteFetching,
    isTradingSuspended,
  ]);

  // Button loading state: show loading when quote is being fetched or waiting after token change
  // Don't show loading when trading is suspended (no quote will be fetched)
  const isButtonLoading = useMemo(
    () =>
      !isTradingSuspended &&
      (quoteFetching || isWaitingForQuote) &&
      hasAmount &&
      !!tokenInSymbol &&
      !!tokenOutSymbol,
    [
      quoteFetching,
      isWaitingForQuote,
      hasAmount,
      tokenInSymbol,
      tokenOutSymbol,
      isTradingSuspended,
    ],
  );

  // Direction is always "in" - selling exact amount of tokenIn to receive tokenOut
  const sellUSDValue = useMemo(() => {
    return tokenInSymbol === "USDm" ? amount || "0" : fromTokenUSDValue || "0";
  }, [tokenInSymbol, amount, fromTokenUSDValue]);

  const buyUSDValue = useMemo(() => {
    return tokenOutSymbol === "USDm"
      ? formQuote || "0"
      : toTokenUSDValue || "0";
  }, [tokenOutSymbol, formQuote, toTokenUSDValue]);

  const amountInWei = useMemo(() => {
    if (!tokenInSymbol) return "0";

    return amount
      ? toWei(amount, getTokenDecimals(tokenInSymbol, chainId)).toFixed(0)
      : "0";
  }, [amount, tokenInSymbol, chainId]);

  // Check if approval is needed
  const { skipApprove } = useSwapAllowance({
    chainId,
    tokenInSymbol,
    tokenOutSymbol,
    approveAmount: amountInWei,
    address,
  });

  // Approval transaction hook
  const { sendApproveTx, isApproveTxLoading, approveTxHash } =
    useApproveTransaction({
      chainId,
      tokenInSymbol,
      tokenOutSymbol,
      amountInWei,
      accountAddress: address,
      onSuccess: (receipt) => {
        logger.info("Approval transaction confirmed");
        const explorerUrl =
          chainIdToChain[chainId]?.blockExplorers?.default.url;
        toast.success(
          <>
            <h4>Approve Successful</h4>
            <span className="mt-2 block text-muted-foreground">
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
          slippage: formValues?.slippage || currentFormValues.slippage || "0.5",
          isAutoSlippage: formValues?.isAutoSlippage,
          deadlineMinutes: formValues?.deadlineMinutes,
          tokenInSymbol,
          tokenOutSymbol,
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
      }
    }
  }, [quote, form, formQuote]);

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
          slippage: formValues?.slippage || form.getValues("slippage") || "0.5",
          isAutoSlippage: formValues?.isAutoSlippage,
          deadlineMinutes: formValues?.deadlineMinutes,
          tokenInSymbol,
          tokenOutSymbol,
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

  const shouldApprove =
    !skipApprove && hasAmount && quote && !isLoading && !balanceError;

  // Get tradable pairs for both tokens
  const { data: fromTokenTradablePairs } = useTradablePairs(tokenInSymbol);
  const { data: toTokenTradablePairs } = useTradablePairs(tokenOutSymbol);

  const [lastChangedToken, setLastChangedToken] = useState<
    "from" | "to" | null
  >(null);

  // Handle token pair validation - reset opposite token if an invalid pair is selected
  useEffect(() => {
    if (!tokenInSymbol || !tokenOutSymbol || !lastChangedToken) return;

    const isValidPair =
      fromTokenTradablePairs?.includes(tokenOutSymbol) ||
      toTokenTradablePairs?.includes(tokenInSymbol);

    // If an invalid pair is selected, reset the opposite token
    if (!isValidPair) {
      if (lastChangedToken === "from") {
        form.setValue("tokenOutSymbol", "", { shouldValidate: false });
      } else if (lastChangedToken === "to") {
        form.setValue("tokenInSymbol", "", { shouldValidate: false });
      }
      setLastChangedToken(null);
    }
  }, [
    tokenInSymbol,
    tokenOutSymbol,
    fromTokenTradablePairs,
    toTokenTradablePairs,
    lastChangedToken,
    form,
  ]);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="max-w-3xl gap-6 flex h-full flex-col"
      >
        <div className="gap-0 flex flex-col">
          <div
            className="maybe-hover:border-border-secondary gap-4 p-4 grid grid-cols-12 border border-border bg-incard transition-colors focus-within:!border-primary dark:border-input dark:focus-within:!border-primary"
            onClick={() => {
              amountRef.current?.focus();
            }}
          >
            <div className="col-span-8">
              <Controller
                control={form.control}
                name="amount"
                rules={{
                  validate: validateAmount,
                }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sell</FormLabel>
                    <FormControl>
                      <CoinInput
                        ref={amountRef}
                        data-testid="sellAmountInput"
                        placeholder="0"
                        value={field.value}
                        onChange={(e) => {
                          const val =
                            typeof e === "string" ? e : e.target.value;
                          field.onChange(val);
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
                name="tokenInSymbol"
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
                        excludeTokenSymbol={tokenOutSymbol}
                        filterByTokenSymbol={tokenOutSymbol}
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
                                (token) => token.symbol === field.value,
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
                        className="p-0 cursor-pointer border-none bg-transparent text-inherit underline"
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

          <div className="flex w-full items-center justify-center border-x border-border dark:border-input">
            <Button
              data-testid="swapInputsButton"
              variant="outline"
              onClick={handleReverseTokens}
              size="icon"
              className="!border-y-0"
              type="button"
            >
              <ArrowUpDown className="rotate-180 transition-transform" />
            </Button>
          </div>

          <div
            className="maybe-hover:border-border-secondary gap-4 p-4 grid grid-cols-12 border border-border bg-incard transition-colors focus-within:!border-primary dark:border-input dark:focus-within:!border-primary"
            onClick={() => {
              quoteRef.current?.focus();
            }}
          >
            <div className="col-span-8">
              <Controller
                control={form.control}
                name="quote"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>Buy</FormLabel>
                    <FormControl>
                      <CoinInput
                        ref={quoteRef}
                        data-testid="buyAmountInput"
                        placeholder="0"
                        value={
                          formQuote && formQuote !== "0" && formQuote !== "0.00"
                            ? formQuote
                            : ""
                        }
                        readOnly
                        disabled
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
                name="tokenOutSymbol"
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
                        excludeTokenSymbol={tokenInSymbol}
                        filterByTokenSymbol={tokenInSymbol}
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
                                (token) => token.symbol === field.value,
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

        <div className="gap-2 flex flex-col">
          {rate && (
            <div className="space-y-2 flex w-full flex-col items-start justify-start">
              <div className="flex w-full flex-row items-center justify-between">
                <span className="text-muted-foreground">Rate</span>
                <span data-testid="rateLabel">{`${rate && Number(rate) > 0 ? Number(rate).toFixed(4) : "0"} ${tokenInSymbol} ~ 1 ${tokenOutSymbol}`}</span>
              </div>
            </div>
          )}
        </div>

        {isConnected ? (
          <Button
            data-testid={defineButtonLocator({
              balanceError,
              tradingLimitError,
              isTradingSuspended,
              shouldApprove,
              tokenInSymbol: tokenInSymbol,
              tokenOutSymbol: tokenOutSymbol,
            })}
            className="mt-auto w-full"
            size="lg"
            clipped="lg"
            type="submit"
            disabled={
              !hasAmount ||
              !tokenOutSymbol ||
              !tokenInSymbol ||
              !quote || // Require quote to be fetched
              !!(
                errors.amount && errors.amount.message !== "Amount is required"
              ) ||
              isButtonLoading || // Disable button when quote is loading
              isApproveTxLoading ||
              isApprovalProcessing ||
              !!tradingLimitError ||
              !!balanceError ||
              isTradingSuspended || // Disable when trading is suspended
              isSuspensionCheckLoading || // Disable while checking suspension
              (isError && hasAmount && canQuote) // Disable when unable to fetch quote
            }
          >
            {isButtonLoading ? ( // Show loading when quote is being fetched
              <IconLoading />
            ) : !tokenInSymbol ? (
              "Select token to sell"
            ) : !tokenOutSymbol ? (
              "Select token to buy"
            ) : isTradingSuspended ? (
              `Trading suspended for ${tokenInSymbol} -> ${tokenOutSymbol}`
            ) : tradingLimitError ? (
              "Swap exceeds trading limits"
            ) : balanceError ? (
              "Insufficient balance"
            ) : isError && hasAmount && canQuote ? (
              "Unable to fetch quote"
            ) : errors.amount?.message &&
              errors.amount?.message !== "Amount is required" ? (
              errors.amount?.message
            ) : isApproveTxLoading || isApprovalProcessing ? (
              <IconLoading />
            ) : shouldApprove ? (
              `Approve ${allTokenOptions.find((t) => t.symbol === tokenInSymbol)?.symbol || tokenInSymbol}`
            ) : (
              "Swap"
            )}
          </Button>
        ) : (
          <ConnectButton
            size="lg"
            text="Connect"
            fullWidth
            shouldShowAddress={false}
          />
        )}
      </form>
    </Form>
  );
}

function defineButtonLocator({
  balanceError,
  tradingLimitError,
  isTradingSuspended,
  shouldApprove,
  tokenInSymbol,
  tokenOutSymbol,
}: {
  balanceError: string | null;
  tradingLimitError: string | null;
  isTradingSuspended: boolean;
  shouldApprove: string | boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
}) {
  switch (true) {
    case Boolean(isTradingSuspended):
      return "tradingSuspendedButton";
    case Boolean(balanceError && !tradingLimitError):
      return "insufficientBalanceButton";
    case Boolean(tradingLimitError):
      return "swapsExceedsTradingLimitButton";
    case Boolean(shouldApprove && tokenInSymbol && tokenOutSymbol):
      return "approveButton";
    case !tokenInSymbol:
      return "selectTokenToSellButton";
    case !tokenOutSymbol:
      return "selectTokenToBuyButton";
    default:
      return "swapButton";
  }
}
