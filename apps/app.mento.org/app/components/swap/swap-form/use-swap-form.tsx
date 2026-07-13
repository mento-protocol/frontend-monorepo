"use client";

import { env } from "@/env.mjs";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useSwapUrlSync } from "@/hooks/use-swap-url-sync";

import {
  CELO_EXPLORER,
  ChainId,
  chainIdToChain,
  confirmViewAtom,
  formatWithMaxDecimals,
  formValuesAtom,
  getNativeTokenSymbol,
  getPreferredUsdQuoteTokenSymbol,
  getTokenDecimals,
  getTokenOptionsByChainId,
  logger,
  parseAmount,
  parseAmountWithDefault,
  type SwapFormValues,
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
import { OctagonAlert } from "lucide-react";

import { getChainChangeSyncPlan } from "./chain-change-sync";
import {
  getAvailableTokenSymbol,
  getSelectedTokenSymbol,
} from "./token-selection";
import {
  getRouteDrivenFormStateSyncPlan,
  type LastChangedToken,
  type RouteDrivenFormState,
} from "./route-driven-state";
import {
  createWaitingForQuoteStore,
  getTokenPairKey,
} from "./waiting-for-quote-store";
import { getMaxSellAmount } from "./max-sell-amount";
import { checkTradingLimitViolation } from "./trading-limits";
import {
  getSwapFormInitialState,
  type SwapFormRouteOptions,
  useStableRouteDrivenFormState,
} from "./swap-form-initial-state";
import {
  getFormattedTokenInBalance,
  getFormattedTokenOutBalance,
  getTokenBalanceValue,
  getTradingSuspensionError,
  hasSwapAmount,
  validateSwapBalance,
} from "./swap-form-validation";
import { defaultEmptyBalances, formSchema, type FormValues } from "./types";

export function useSwapForm(opts?: SwapFormRouteOptions) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const formChainId = opts?.urlChainId ?? walletChainId ?? ChainId.Celo;
  const nativeTokenSymbol = getNativeTokenSymbol(formChainId);
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const [, setConfirmView] = useAtom(confirmViewAtom);
  const [isApprovalProcessing, setIsApprovalProcessing] = useState(false);

  const { data: balancesFromHook } = useAccountBalances({
    address,
    chainId: formChainId,
  });
  const balances = balancesFromHook || defaultEmptyBalances;

  const { allTokenOptions } = useTokenOptions(
    undefined,
    balancesFromHook,
    formChainId,
  );

  const amountRef = useRef<HTMLInputElement>(null);
  const quoteRef = useRef<HTMLInputElement>(null);
  const prevTradingSuspensionErrorRef = useRef<string | null>(null);
  const suspensionToastIdRef = useRef<string | number | null>(null);
  const prevChainIdRef = useRef<number>(formChainId);
  const availableTokens = useMemo(
    () => getTokenOptionsByChainId(formChainId),
    [formChainId],
  );
  const {
    defaultValues,
    initialTokenInSymbol,
    initialTokenOutSymbol,
    routeDrivenFormState: nextRouteDrivenFormState,
  } = getSwapFormInitialState({
    availableTokens,
    formValues,
    options: opts,
    preferredQuoteTokenSymbol: getPreferredUsdQuoteTokenSymbol(formChainId),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
    mode: "onChange",
  });
  const routeDrivenFormState = useStableRouteDrivenFormState(
    nextRouteDrivenFormState.amount,
    nextRouteDrivenFormState.tokenInSymbol,
    nextRouteDrivenFormState.tokenOutSymbol,
  );
  const lastRouteDrivenFormStateRef = useRef<RouteDrivenFormState | null>(null);

  const watchedTokenInSymbol = useWatch({
    control: form.control,
    name: "tokenInSymbol",
  });
  const watchedTokenOutSymbol = useWatch({
    control: form.control,
    name: "tokenOutSymbol",
  });
  const selectedTokenInSymbol = getSelectedTokenSymbol(
    watchedTokenInSymbol,
    initialTokenInSymbol,
    availableTokens,
  );
  const selectedTokenOutSymbol = getSelectedTokenSymbol(
    watchedTokenOutSymbol,
    initialTokenOutSymbol,
    availableTokens,
  );
  const tokenInSymbol = selectedTokenInSymbol ?? "";
  const tokenOutSymbol = selectedTokenOutSymbol ?? "";
  const amount = useWatch({ control: form.control, name: "amount" });
  const formQuote = useWatch({ control: form.control, name: "quote" });

  // Token balances
  const fromTokenBalance = useMemo(
    () =>
      getFormattedTokenInBalance({
        balances,
        chainId: formChainId,
        tokenSymbol: selectedTokenInSymbol,
      }),
    [balances, selectedTokenInSymbol, formChainId],
  );

  const toTokenBalance = useMemo(
    () =>
      getFormattedTokenOutBalance({
        balances,
        chainId: formChainId,
        tokenSymbol: selectedTokenOutSymbol,
      }),
    [balances, selectedTokenOutSymbol, formChainId],
  );

  // Trading limits
  const { data: limits, isLoading: limitsLoading } = useTradingLimits(
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    formChainId,
  );

  // Trading suspension
  const {
    isSuspended: isTradingSuspended,
    isLoading: isSuspensionCheckLoading,
  } = useTradingSuspensionCheck(
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    formChainId,
  );

  // ── Validation ──────────────────────────────────────────────────────

  const validateBalance = useCallback(
    (value: string) =>
      validateSwapBalance({
        allTokenOptions,
        balances,
        tokenInSymbol: selectedTokenInSymbol,
        value,
      }),
    [balances, selectedTokenInSymbol, allTokenOptions],
  );

  const validateLimits = useCallback(
    async (value: string) => {
      if (!value || limitsLoading || !limits || !limits.tokenToCheck)
        return true;
      if (value === "0." || value === "0") return true;

      const parsedAmount = parseAmount(value);
      if (!parsedAmount) return true;

      const violation = checkTradingLimitViolation({
        amountIn: parsedAmount,
        amountOut: parseAmountWithDefault(formQuote, 0),
        limits,
        tokenInSymbol,
        tokenOutSymbol,
      });

      return violation || true;
    },
    [limitsLoading, limits, tokenInSymbol, tokenOutSymbol, formQuote],
  );

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

  // ── Handlers ────────────────────────────────────────────────────────

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
    if (!selectedTokenInSymbol) return;

    const balanceInWei = String(
      getTokenBalanceValue(balances, selectedTokenInSymbol) || "0",
    );
    const formattedAmountWithMaxDecimals = getMaxSellAmount({
      balanceInWei,
      decimals: getTokenDecimals(selectedTokenInSymbol, formChainId),
      isNativeToken: selectedTokenInSymbol === nativeTokenSymbol,
    });
    form.setValue("amount", formattedAmountWithMaxDecimals);

    if (selectedTokenInSymbol === nativeTokenSymbol) {
      toast.success("Max balance used", {
        duration: 5000,
        description: () => (
          <>0.01 {nativeTokenSymbol} reserved for transaction fees</>
        ),
        icon: <OctagonAlert strokeWidth={1.5} size={18} className="mt-0.5" />,
      });
    }
  };

  // ── Derived state ───────────────────────────────────────────────────

  const { errors } = form.formState;
  const hasAmount = hasSwapAmount(amount);

  const balanceError = useMemo(() => {
    if (!hasAmount || !selectedTokenInSymbol) return null;

    const balanceCheck = validateBalance(amount);
    return balanceCheck !== true ? balanceCheck : null;
  }, [amount, hasAmount, selectedTokenInSymbol, validateBalance]);

  const tradingSuspensionError = useMemo(
    () =>
      getTradingSuspensionError({
        isTradingSuspended,
        tokenInSymbol,
        tokenOutSymbol,
      }),
    [isTradingSuspended, tokenInSymbol, tokenOutSymbol],
  );

  const canQuote =
    !!hasAmount &&
    !errors.amount &&
    !limitsLoading &&
    !isTradingSuspended &&
    !!selectedTokenInSymbol &&
    !!selectedTokenOutSymbol;

  // ── Quote ───────────────────────────────────────────────────────────

  const {
    isFetching: quoteFetching,
    quote,
    rate,
    isError,
    hasInsufficientLiquidityError,
    quoteErrorMessage,
    fromTokenUSDValue,
    toTokenUSDValue,
  } = useOptimizedSwapQuote(
    canQuote ? amount : "",
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    {
      chainId: formChainId,
      insufficientLiquidityFallbackUrl: env.NEXT_PUBLIC_BANNER_LINK,
    },
  );

  const lastChangedTokenRef = useRef<LastChangedToken>(null);
  const setLastChangedToken = useCallback((value: LastChangedToken) => {
    lastChangedTokenRef.current = value;
  }, []);

  // ── Side effects ────────────────────────────────────────────────────

  // Reset token selections when chain changes
  useEffect(() => {
    if (prevChainIdRef.current === formChainId) return;
    prevChainIdRef.current = formChainId;

    const availableTokens = getTokenOptionsByChainId(formChainId);
    const plan = getChainChangeSyncPlan({
      availableTokens,
      currentTokenInSymbol: form.getValues("tokenInSymbol"),
      currentTokenOutSymbol: form.getValues("tokenOutSymbol"),
      preferredQuoteTokenSymbol: getPreferredUsdQuoteTokenSymbol(formChainId),
    });

    if (plan.kind === "clear-amount-only") {
      form.setValue("amount", "");
      form.setValue("quote", "");
      setFormValues((prev) => (prev ? { ...prev, amount: "" } : prev));
      return;
    }

    form.setValue("tokenInSymbol", plan.tokenInSymbol);
    form.setValue("tokenOutSymbol", plan.tokenOutSymbol);
    form.setValue("amount", "");
    form.setValue("quote", "");

    setFormValues((prev) =>
      prev
        ? {
            ...prev,
            tokenInSymbol: getAvailableTokenSymbol(
              plan.tokenInSymbol,
              availableTokens,
            ),
            tokenOutSymbol: getAvailableTokenSymbol(
              plan.tokenOutSymbol,
              availableTokens,
            ),
            amount: "",
          }
        : prev,
    );
    setLastChangedToken(null);
  }, [form, formChainId, setFormValues, setLastChangedToken]);

  useEffect(() => {
    const previousRouteState = lastRouteDrivenFormStateRef.current;

    lastRouteDrivenFormStateRef.current = routeDrivenFormState;

    const plan = getRouteDrivenFormStateSyncPlan({
      currentValues: form.getValues(),
      formValuesSlippage: formValues?.slippage,
      previousRouteState,
      routeDrivenFormState,
    });

    if (!plan.shouldReset) return;

    form.reset(plan.resetValues);
    setLastChangedToken(plan.routeChangedTokenSide);
  }, [form, formValues?.slippage, routeDrivenFormState, setLastChangedToken]);

  useSwapUrlSync({
    amount,
    tokenInSymbol,
    tokenOutSymbol,
    urlChainId: formChainId,
  });

  useEffect(() => {
    if (isError) {
      setConfirmView(false);
    }
  }, [isError, setConfirmView]);

  const tradingLimitError = useMemo(() => {
    if (!hasAmount || !limits || limitsLoading) return null;

    return checkTradingLimitViolation({
      amountIn: parseAmountWithDefault(amount, 0),
      amountOut: parseAmountWithDefault(quote, 0),
      limits,
      tokenInSymbol,
      tokenOutSymbol,
    });
  }, [
    amount,
    quote,
    limits,
    limitsLoading,
    tokenInSymbol,
    tokenOutSymbol,
    hasAmount,
  ]);

  useEffect(() => {
    if (tradingLimitError) {
      toast.error(tradingLimitError, { duration: 20000 });
    }
  }, [tradingLimitError]);

  useEffect(() => {
    const prevError = prevTradingSuspensionErrorRef.current;
    const hasError = tradingSuspensionError !== null;
    const errorChanged = prevError !== tradingSuspensionError;

    if (hasError && errorChanged) {
      if (suspensionToastIdRef.current) {
        toast.dismiss(suspensionToastIdRef.current);
      }
      suspensionToastIdRef.current = toast.error(tradingSuspensionError, {
        duration: 20000,
      });
    } else if (prevError !== null && !hasError) {
      if (suspensionToastIdRef.current) {
        toast.dismiss(suspensionToastIdRef.current);
        suspensionToastIdRef.current = null;
      }
    }

    prevTradingSuspensionErrorRef.current = tradingSuspensionError;
  }, [tradingSuspensionError]);

  const isLoading =
    quoteFetching && canQuote && !tradingLimitError && !limitsLoading;

  const waitingForQuotePairStore = useMemo(
    () => createWaitingForQuoteStore(),
    [],
  );
  const waitingForQuotePair = useSyncExternalStore(
    waitingForQuotePairStore.subscribe,
    waitingForQuotePairStore.getSnapshot,
    waitingForQuotePairStore.getSnapshot,
  );
  const tokenPairKey = getTokenPairKey({
    tokenInSymbol: selectedTokenInSymbol,
    tokenOutSymbol: selectedTokenOutSymbol,
  });

  useEffect(() => {
    waitingForQuotePairStore.update({
      hasAmount,
      isTradingSuspended,
      quote,
      quoteFetching,
      tokenInSymbol: selectedTokenInSymbol,
      tokenOutSymbol: selectedTokenOutSymbol,
    });
  }, [
    hasAmount,
    isTradingSuspended,
    quote,
    quoteFetching,
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    waitingForQuotePairStore,
  ]);

  const isWaitingForQuote =
    tokenPairKey !== null && waitingForQuotePair === tokenPairKey;

  const isButtonLoading = useMemo(
    () =>
      !isTradingSuspended &&
      !isError &&
      (quoteFetching || isWaitingForQuote) &&
      hasAmount &&
      !!selectedTokenInSymbol &&
      !!selectedTokenOutSymbol,
    [
      quoteFetching,
      isWaitingForQuote,
      hasAmount,
      selectedTokenInSymbol,
      selectedTokenOutSymbol,
      isTradingSuspended,
      isError,
    ],
  );

  const sellUSDValue = useMemo(() => {
    return tokenInSymbol === "USDm" ? amount || "0" : fromTokenUSDValue || "0";
  }, [tokenInSymbol, amount, fromTokenUSDValue]);

  const buyUSDValue = useMemo(() => {
    return tokenOutSymbol === "USDm"
      ? formQuote || "0"
      : toTokenUSDValue || "0";
  }, [tokenOutSymbol, formQuote, toTokenUSDValue]);

  const amountInWei = useMemo(() => {
    if (!selectedTokenInSymbol) return "0";
    const parsedAmount = parseAmount(amount);
    if (!parsedAmount || !parsedAmount.gt(0)) return "0";

    return toWei(
      parsedAmount,
      getTokenDecimals(selectedTokenInSymbol, formChainId),
    ).toFixed(0);
  }, [amount, selectedTokenInSymbol, formChainId]);

  // ── Allowance & approval ────────────────────────────────────────────

  const { refetchAllowance, skipApprove } = useSwapAllowance({
    chainId: formChainId,
    tokenInSymbol: selectedTokenInSymbol,
    tokenOutSymbol: selectedTokenOutSymbol,
    approveAmount: amountInWei,
    address,
  });

  const { sendApproveTx, isApproveTxLoading } = useApproveTransaction({
    chainId: formChainId,
    tokenInSymbol: selectedTokenInSymbol,
    tokenOutSymbol: selectedTokenOutSymbol,
    amountInWei,
    accountAddress: address,
    onSuccess: (receipt) => {
      logger.info("Approval transaction confirmed");
      const chain = chainIdToChain[formChainId];
      const explorerUrl = chain?.blockExplorers?.default.url;
      const explorerName =
        chain?.blockExplorers?.default?.name || CELO_EXPLORER.name;
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
              View Transaction on {explorerName}
            </a>
          )}
        </>,
      );
      void (async () => {
        try {
          await refetchAllowance();
        } catch (error) {
          logger.error(
            "Failed to refresh swap allowance after approval",
            error,
          );
        } finally {
          setIsApprovalProcessing(false);

          const currentFormValues = form.getValues();
          const formData: SwapFormValues = {
            ...currentFormValues,
            slippage:
              formValues?.slippage || currentFormValues.slippage || "0.3",
            isAutoSlippage: formValues?.isAutoSlippage,
            deadlineMinutes: formValues?.deadlineMinutes,
            tokenInSymbol: selectedTokenInSymbol,
            tokenOutSymbol: selectedTokenOutSymbol,
            buyUSDValue,
            sellUSDValue,
          };

          setFormValues(formData);
          setConfirmView(true);
        }
      })();
    },
  });

  useEffect(() => {
    if (quote !== undefined) {
      const formattedQuote = formatWithMaxDecimals(quote, 4, false);
      if (formQuote !== formattedQuote) {
        form.setValue("quote", formattedQuote, { shouldValidate: true });
      }
    }
  }, [quote, form, formQuote]);

  useEffect(() => {
    if (
      errors.amount?.message &&
      errors.amount.message !== "Invalid input" &&
      errors.amount.message !== "Amount is required" &&
      hasAmount
    ) {
      toast.error(errors.amount.message);
    }
  }, [errors.amount, hasAmount, amount]);

  // ── Submit ──────────────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    try {
      if (!skipApprove && sendApproveTx) {
        setIsApprovalProcessing(true);
        logger.info("Approval needed, sending approve transaction");
        const hash = await sendApproveTx();

        if (!hash) {
          setIsApprovalProcessing(false);
        }

        logger.info("Waiting for approval transaction", {
          hash,
        });
      } else {
        const formData: SwapFormValues = {
          ...values,
          slippage: formValues?.slippage || form.getValues("slippage") || "0.3",
          isAutoSlippage: formValues?.isAutoSlippage,
          deadlineMinutes: formValues?.deadlineMinutes,
          tokenInSymbol: selectedTokenInSymbol,
          tokenOutSymbol: selectedTokenOutSymbol,
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

  const hasValidQuote = !!quote && Number(quote) > 0;

  const shouldApprove =
    !skipApprove && hasAmount && hasValidQuote && !isLoading && !balanceError;

  // ── Token pair validation ───────────────────────────────────────────

  const {
    data: fromTokenTradablePairs,
    isLoading: isFromTokenTradablePairsLoading,
  } = useTradablePairs(selectedTokenInSymbol, formChainId);
  const {
    data: toTokenTradablePairs,
    isLoading: isToTokenTradablePairsLoading,
  } = useTradablePairs(selectedTokenOutSymbol, formChainId);

  // Reset form fields after a successful swap (formValues.amount is cleared but tokens preserved)
  useEffect(() => {
    if (!formValues?.amount && formValues?.tokenInSymbol) {
      setLastChangedToken(null);
      form.reset({
        amount: "",
        quote: "",
        tokenInSymbol: formValues.tokenInSymbol,
        tokenOutSymbol: formValues.tokenOutSymbol || "USDm",
        slippage: formValues?.slippage || "0.3",
      });
    }
  }, [
    formValues?.amount,
    formValues?.tokenInSymbol,
    formValues?.tokenOutSymbol,
    formValues?.slippage,
    form,
    setLastChangedToken,
  ]);

  useEffect(() => {
    const lastChangedToken = lastChangedTokenRef.current;

    if (!selectedTokenInSymbol || !selectedTokenOutSymbol || !lastChangedToken)
      return;
    if (isFromTokenTradablePairsLoading || isToTokenTradablePairsLoading)
      return;
    if (!fromTokenTradablePairs || !toTokenTradablePairs) return;

    const isValidPair =
      fromTokenTradablePairs.includes(selectedTokenOutSymbol) ||
      toTokenTradablePairs.includes(selectedTokenInSymbol);

    if (!isValidPair) {
      if (lastChangedToken === "from") {
        form.setValue("tokenOutSymbol", "", { shouldValidate: false });
      } else if (lastChangedToken === "to") {
        form.setValue("tokenInSymbol", "", { shouldValidate: false });
      }
      setLastChangedToken(null);
    }
  }, [
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    fromTokenTradablePairs,
    toTokenTradablePairs,
    isFromTokenTradablePairsLoading,
    isToTokenTradablePairsLoading,
    form,
    setLastChangedToken,
  ]);

  // ── Return ──────────────────────────────────────────────────────────

  return {
    form,
    isConnected,
    formChainId,

    // Refs
    amountRef,
    quoteRef,

    // Token symbols & options
    tokenInSymbol,
    tokenOutSymbol,
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    allTokenOptions,

    // Watched values
    amount,
    formQuote,

    // Balances
    fromTokenBalance,
    toTokenBalance,

    // USD values
    sellUSDValue,
    buyUSDValue,

    // Quote data
    quote,
    rate,
    isError,
    hasInsufficientLiquidityError,
    quoteErrorMessage,
    canQuote,
    hasValidQuote,

    // Validation
    validateAmount,
    errors,
    hasAmount,
    tradingLimitError,
    balanceError,
    isTradingSuspended,
    isSuspensionCheckLoading,

    // Loading
    isLoading,
    isButtonLoading,
    isApproveTxLoading,
    isApprovalProcessing,

    // Approval
    shouldApprove,
    skipApprove,

    // Handlers
    handleReverseTokens,
    handleUseMaxBalance,
    onSubmit,
    setLastChangedToken,
  };
}
