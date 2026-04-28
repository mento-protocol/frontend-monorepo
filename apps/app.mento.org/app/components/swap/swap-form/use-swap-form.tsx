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
import { createLocalStore } from "@/lib/utils/local-store";

import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import {
  CELO_EXPLORER,
  chainIdToChain,
  type ChainId,
  confirmViewAtom,
  formatBalance,
  formatWithMaxDecimals,
  formValuesAtom,
  fromWeiRounded,
  getNativeTokenSymbol,
  getPreferredUsdQuoteTokenSymbol,
  getTokenDecimals,
  getTokenOptionsByChainId,
  logger,
  MIN_ROUNDED_VALUE,
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

import { defaultEmptyBalances, formSchema, type FormValues } from "./types";

interface UseSwapFormOptions {
  initialFrom?: string;
  initialTo?: string;
  initialAmount?: string;
  urlChainId?: ChainId;
}

type RouteDrivenFormState = {
  amount: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
};

type LastChangedToken = "from" | "to" | null;

function sanitizeRouteAmount(value?: string): string {
  if (!value) return "";
  const trimmedValue = value.trim();
  if (!trimmedValue) return "";
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmedValue)) return "";

  const parsedValue = parseAmount(trimmedValue);
  if (!parsedValue || parsedValue.isNegative()) return "";

  return trimmedValue;
}

export function useSwapForm(opts?: UseSwapFormOptions) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const formChainId = opts?.urlChainId ?? walletChainId ?? 42220;
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
  const hasUrlParams = Boolean(
    opts?.initialFrom || opts?.initialTo || opts?.initialAmount,
  );
  const availableTokens = useMemo(
    () => getTokenOptionsByChainId(formChainId),
    [formChainId],
  );

  // Validate URL tokens exist on current chain, fall back to defaults if not
  const validatedInitialFrom =
    opts?.initialFrom &&
    availableTokens.includes(opts.initialFrom as TokenSymbol)
      ? (opts.initialFrom as TokenSymbol)
      : undefined;

  const validatedInitialTo =
    opts?.initialTo && availableTokens.includes(opts.initialTo as TokenSymbol)
      ? (opts.initialTo as TokenSymbol)
      : undefined;

  const storedTokenInSymbol =
    !hasUrlParams &&
    formValues?.tokenInSymbol &&
    availableTokens.includes(formValues.tokenInSymbol as TokenSymbol)
      ? (formValues.tokenInSymbol as TokenSymbol)
      : undefined;

  const storedTokenOutSymbol =
    !hasUrlParams &&
    formValues?.tokenOutSymbol &&
    availableTokens.includes(formValues.tokenOutSymbol as TokenSymbol)
      ? (formValues.tokenOutSymbol as TokenSymbol)
      : undefined;

  const defaultTokenInSymbol =
    getPreferredUsdQuoteTokenSymbol(formChainId) ||
    availableTokens[0] ||
    ("USDC" as TokenSymbol);

  const initialTokenInSymbol =
    validatedInitialFrom || storedTokenInSymbol || defaultTokenInSymbol;

  const requestedTokenOut = validatedInitialTo || storedTokenOutSymbol;
  const initialTokenOutSymbol =
    requestedTokenOut && requestedTokenOut !== initialTokenInSymbol
      ? requestedTokenOut
      : availableTokens.find((token) => token !== initialTokenInSymbol) || "";
  const sanitizedInitialAmount = sanitizeRouteAmount(opts?.initialAmount);
  const hasRequestedRouteTokens = Boolean(opts?.initialFrom || opts?.initialTo);
  const routeUsesRequestedTokens =
    (!opts?.initialFrom || validatedInitialFrom === initialTokenInSymbol) &&
    (!opts?.initialTo || validatedInitialTo === initialTokenOutSymbol);

  const canReuseStoredDraft =
    !hasUrlParams &&
    storedTokenInSymbol === initialTokenInSymbol &&
    storedTokenOutSymbol === initialTokenOutSymbol;

  const initialAmount = hasUrlParams
    ? !hasRequestedRouteTokens || routeUsesRequestedTokens
      ? sanitizedInitialAmount
      : ""
    : canReuseStoredDraft
      ? formValues?.amount || ""
      : "";

  const initialQuote = canReuseStoredDraft ? formValues?.quote || "" : "";

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: initialAmount,
      quote: initialQuote,
      tokenInSymbol: initialTokenInSymbol,
      tokenOutSymbol: initialTokenOutSymbol,
      slippage: formValues?.slippage || "0.3",
    },
    mode: "onChange",
  });

  const routeDrivenFormState = useMemo<RouteDrivenFormState>(
    () => ({
      amount: initialAmount,
      tokenInSymbol: initialTokenInSymbol,
      tokenOutSymbol: initialTokenOutSymbol,
    }),
    [initialAmount, initialTokenInSymbol, initialTokenOutSymbol],
  );
  const lastRouteDrivenFormStateRef = useRef<RouteDrivenFormState | null>(null);

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

  useSwapUrlSync({
    amount,
    tokenInSymbol,
    tokenOutSymbol,
    urlChainId: formChainId,
  });

  // Token balances
  const fromTokenBalance = useMemo(() => {
    const balanceValue = balances[tokenInSymbol as keyof typeof balances];
    const balance = formatBalance(
      balanceValue,
      getTokenDecimals(tokenInSymbol, formChainId),
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, tokenInSymbol, formChainId]);

  const toTokenBalance = useMemo(() => {
    const balanceValue = balances[tokenOutSymbol as keyof typeof balances];
    const balance = fromWeiRounded(
      balanceValue,
      getTokenDecimals(tokenOutSymbol, formChainId),
    );
    return formatWithMaxDecimals(balance || "0.00");
  }, [balances, tokenOutSymbol, formChainId]);

  // Trading limits
  const { data: limits, isLoading: limitsLoading } = useTradingLimits(
    tokenInSymbol,
    tokenOutSymbol,
    formChainId,
  );

  // Trading suspension
  const {
    isSuspended: isTradingSuspended,
    isLoading: isSuspensionCheckLoading,
  } = useTradingSuspensionCheck(tokenInSymbol, tokenOutSymbol, formChainId);

  // ── Validation ──────────────────────────────────────────────────────

  const validateBalance = useCallback(
    (value: string) => {
      if (!value || !tokenInSymbol) return true;
      if (value === "0." || value === "0") return true;

      const parsedAmount = parseAmount(value);
      if (!parsedAmount) return true;

      if (parsedAmount.lte(MIN_ROUNDED_VALUE) && !parsedAmount.isZero()) {
        return "Amount too small";
      }

      const tokenInfo = allTokenOptions.find((t) => t.symbol === tokenInSymbol);
      if (!tokenInfo) return "Invalid token";

      const balance = balances[tokenInSymbol as keyof typeof balances];
      if (typeof balance === "undefined") return "Balance unavailable";

      const amountInWei = toWei(parsedAmount, tokenInfo.decimals || 18);
      const balanceInWei = parseAmountWithDefault(balance, "0");

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
        amountToCheck = numericQuote;

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
        if (isImplicitLimit) {
          if (exceededTier === "LG") {
            return `Cannot buy more than ${limit.toLocaleString()} ${tokenToCheck}. This exceeds the global trading limit.`;
          } else {
            const date = new Date(timestamp * 1000).toLocaleString();
            const timeframe = exceededTier === "L0" ? "5min" : "1d";
            return `Cannot buy more than ${limit.toLocaleString()} ${tokenToCheck} within ${timeframe}. The limit will reset to ${total.toLocaleString()} ${tokenToCheck} at ${date}.`;
          }
        } else {
          if (exceededTier === "LG") {
            return `The ${tokenToCheck} amount exceeds the global trading limit of ${limit.toLocaleString()} ${tokenToCheck}.`;
          } else {
            const date = new Date(timestamp * 1000).toLocaleString();
            const timeframe = exceededTier === "L0" ? "5min" : "1d";
            return `The ${tokenToCheck} amount exceeds the current trading limit of ${limit.toLocaleString()} ${tokenToCheck} within ${timeframe}. It will be reset again to ${total.toLocaleString()} ${tokenToCheck} at ${date}.`;
          }
        }
      }

      return null;
    },
    [],
  );

  const validateLimits = useCallback(
    async (value: string) => {
      if (!value || limitsLoading || !limits || !limits.tokenToCheck)
        return true;
      if (value === "0." || value === "0") return true;

      const parsedAmount = parseAmount(value);
      if (!parsedAmount) return true;

      const numericAmount = Number(parsedAmount.toString()) || 0;
      const numericQuote = Number(formQuote) || 0;

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
    let maxAmountInWei: string = String(
      balances[tokenInSymbol as keyof typeof balances] || "0",
    );
    const decimals = getTokenDecimals(tokenInSymbol, formChainId);

    if (tokenInSymbol === nativeTokenSymbol) {
      const gasReserveWei = BigInt("10000000000000000"); // 0.01 CELO
      const balance = BigInt(maxAmountInWei);
      if (balance > gasReserveWei) {
        maxAmountInWei = (balance - gasReserveWei).toString();
      }
    }

    const formattedAmount = formatBalance(maxAmountInWei, decimals);
    const formattedAmountWithMaxDecimals = formatWithMaxDecimals(
      formattedAmount,
      4,
      false,
    );
    form.setValue("amount", formattedAmountWithMaxDecimals);

    if (tokenInSymbol === nativeTokenSymbol) {
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
  const hasAmount =
    !!amount &&
    amount !== "" &&
    amount !== "0" &&
    amount !== "0." &&
    Number(amount) > 0;

  const balanceError = useMemo(() => {
    if (!hasAmount || !tokenInSymbol) return null;

    const balanceCheck = validateBalance(amount);
    return balanceCheck !== true ? balanceCheck : null;
  }, [amount, hasAmount, tokenInSymbol, validateBalance]);

  const tradingSuspensionError = useMemo(() => {
    if (!isTradingSuspended) return null;
    return `Trading temporarily paused for ${tokenInSymbol} -> ${tokenOutSymbol}. Unable to determine accurate exchange rate now. Please try again later.`;
  }, [isTradingSuspended, tokenInSymbol, tokenOutSymbol]);

  const canQuote =
    !!hasAmount && !errors.amount && !limitsLoading && !isTradingSuspended;

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
    tokenInSymbol,
    tokenOutSymbol,
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
    const availableSet = new Set<TokenSymbol>(availableTokens);

    const currentTokenIn = form.getValues("tokenInSymbol") as TokenSymbol;
    const currentTokenOut = form.getValues("tokenOutSymbol") as TokenSymbol;

    const tokenInValid = availableSet.has(currentTokenIn);
    const tokenOutValid = availableSet.has(currentTokenOut);

    // If both tokens are valid on the new chain, just clear amount/quote
    if (tokenInValid && tokenOutValid && currentTokenIn !== currentTokenOut) {
      form.setValue("amount", "");
      form.setValue("quote", "");
      setFormValues((prev) => (prev ? { ...prev, amount: "" } : prev));
      return;
    }

    const preferredQuote = getPreferredUsdQuoteTokenSymbol(formChainId);

    const newTokenIn: string = tokenInValid
      ? currentTokenIn
      : preferredQuote || availableTokens[0] || "";
    let newTokenOut: string = tokenOutValid ? currentTokenOut : "";

    // Ensure tokenIn !== tokenOut
    if (newTokenIn && newTokenOut && newTokenIn === newTokenOut) {
      newTokenOut = "";
    }

    // Pick a default tokenOut if needed
    if (!newTokenOut && availableTokens.length > 1) {
      newTokenOut = availableTokens.find((t) => t !== newTokenIn) || "";
    }

    form.setValue("tokenInSymbol", newTokenIn);
    form.setValue("tokenOutSymbol", newTokenOut);
    form.setValue("amount", "");
    form.setValue("quote", "");

    setFormValues((prev) =>
      prev
        ? {
            ...prev,
            tokenInSymbol: newTokenIn as TokenSymbol,
            tokenOutSymbol: newTokenOut as TokenSymbol,
            amount: "",
          }
        : prev,
    );
    setLastChangedToken(null);
  }, [form, formChainId, setFormValues, setLastChangedToken]);

  useEffect(() => {
    const previousRouteState = lastRouteDrivenFormStateRef.current;
    const routeStateChanged =
      !previousRouteState ||
      previousRouteState.amount !== routeDrivenFormState.amount ||
      previousRouteState.tokenInSymbol !== routeDrivenFormState.tokenInSymbol ||
      previousRouteState.tokenOutSymbol !== routeDrivenFormState.tokenOutSymbol;

    lastRouteDrivenFormStateRef.current = routeDrivenFormState;

    if (!routeStateChanged) return;

    const currentValues = form.getValues();
    const formAlreadyMatchesRoute =
      currentValues.amount === routeDrivenFormState.amount &&
      currentValues.tokenInSymbol === routeDrivenFormState.tokenInSymbol &&
      currentValues.tokenOutSymbol === routeDrivenFormState.tokenOutSymbol;

    if (formAlreadyMatchesRoute) return;

    const routeChangedTokenSide =
      previousRouteState?.tokenInSymbol !== routeDrivenFormState.tokenInSymbol
        ? "from"
        : previousRouteState?.tokenOutSymbol !==
            routeDrivenFormState.tokenOutSymbol
          ? "to"
          : routeDrivenFormState.tokenInSymbol &&
              routeDrivenFormState.tokenOutSymbol
            ? "from"
            : null;

    form.reset({
      ...currentValues,
      amount: routeDrivenFormState.amount,
      quote: "",
      tokenInSymbol: routeDrivenFormState.tokenInSymbol,
      tokenOutSymbol: routeDrivenFormState.tokenOutSymbol,
      slippage: currentValues.slippage || formValues?.slippage || "0.3",
    });
    setLastChangedToken(routeChangedTokenSide);
  }, [form, formValues?.slippage, routeDrivenFormState, setLastChangedToken]);

  useEffect(() => {
    if (isError) {
      setConfirmView(false);
    }
  }, [isError, setConfirmView]);

  const tradingLimitError = useMemo(() => {
    if (!hasAmount || !limits || limitsLoading) return null;

    const numericAmount = Number(parseAmount(amount) ?? 0);
    const numericQuote = Number(quote || 0);

    return checkTradingLimitViolation(
      numericAmount,
      numericQuote,
      limits,
      tokenInSymbol,
      tokenOutSymbol,
    );
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

  const prevTokenPairRef = useRef<{
    tokenInSymbol: TokenSymbol | undefined;
    tokenOutSymbol: TokenSymbol | undefined;
  }>({ tokenInSymbol: undefined, tokenOutSymbol: undefined });
  const waitingForQuotePairStore = useMemo(
    () => createLocalStore<string | null>(null),
    [],
  );
  const waitingForQuotePair = useSyncExternalStore(
    waitingForQuotePairStore.subscribe,
    waitingForQuotePairStore.getSnapshot,
    waitingForQuotePairStore.getSnapshot,
  );
  const tokenPairKey =
    tokenInSymbol && tokenOutSymbol
      ? `${tokenInSymbol}:${tokenOutSymbol}`
      : null;

  useEffect(() => {
    const tokensChanged =
      prevTokenPairRef.current.tokenInSymbol !== tokenInSymbol ||
      prevTokenPairRef.current.tokenOutSymbol !== tokenOutSymbol;

    if (tokensChanged) {
      prevTokenPairRef.current = { tokenInSymbol, tokenOutSymbol };
      waitingForQuotePairStore.set(
        hasAmount && tokenPairKey ? tokenPairKey : null,
      );
      return;
    }

    if (!hasAmount || !tokenPairKey || isTradingSuspended) {
      waitingForQuotePairStore.set(null);
      return;
    }

    if (
      waitingForQuotePair === tokenPairKey &&
      quote &&
      quote !== "0" &&
      Number(quote) > 0 &&
      !quoteFetching
    ) {
      waitingForQuotePairStore.set(null);
    }
  }, [
    hasAmount,
    isTradingSuspended,
    quote,
    quoteFetching,
    tokenInSymbol,
    tokenOutSymbol,
    tokenPairKey,
    waitingForQuotePair,
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
      !!tokenInSymbol &&
      !!tokenOutSymbol,
    [
      quoteFetching,
      isWaitingForQuote,
      hasAmount,
      tokenInSymbol,
      tokenOutSymbol,
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
    if (!tokenInSymbol) return "0";
    const parsedAmount = parseAmount(amount);
    if (!parsedAmount || !parsedAmount.gt(0)) return "0";

    return toWei(
      parsedAmount,
      getTokenDecimals(tokenInSymbol, formChainId),
    ).toFixed(0);
  }, [amount, tokenInSymbol, formChainId]);

  // ── Allowance & approval ────────────────────────────────────────────

  const { skipApprove } = useSwapAllowance({
    chainId: formChainId,
    tokenInSymbol,
    tokenOutSymbol,
    approveAmount: amountInWei,
    address,
  });

  const { sendApproveTx, isApproveTxLoading } = useApproveTransaction({
    chainId: formChainId,
    tokenInSymbol,
    tokenOutSymbol,
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
      setIsApprovalProcessing(false);

      const currentFormValues = form.getValues();
      const formData: SwapFormValues = {
        ...currentFormValues,
        slippage: formValues?.slippage || currentFormValues.slippage || "0.3",
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

  const hasValidQuote = !!quote && Number(quote) > 0;

  const shouldApprove =
    !skipApprove && hasAmount && hasValidQuote && !isLoading && !balanceError;

  // ── Token pair validation ───────────────────────────────────────────

  const {
    data: fromTokenTradablePairs,
    isLoading: isFromTokenTradablePairsLoading,
  } = useTradablePairs(tokenInSymbol, formChainId);
  const {
    data: toTokenTradablePairs,
    isLoading: isToTokenTradablePairsLoading,
  } = useTradablePairs(tokenOutSymbol, formChainId);

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

    if (!tokenInSymbol || !tokenOutSymbol || !lastChangedToken) return;
    if (isFromTokenTradablePairsLoading || isToTokenTradablePairsLoading)
      return;
    if (!fromTokenTradablePairs || !toTokenTradablePairs) return;

    const isValidPair =
      fromTokenTradablePairs.includes(tokenOutSymbol) ||
      toTokenTradablePairs.includes(tokenInSymbol);

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
