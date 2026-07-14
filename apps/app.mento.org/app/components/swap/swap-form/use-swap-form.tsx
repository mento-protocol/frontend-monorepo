"use client";

import { env } from "@/env.mjs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

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
  type SwapFormValues,
  useAccountBalances,
  useApproveTransaction,
  useOptimizedSwapQuote,
  useSwapAllowance,
  useTokenOptions,
} from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { useAtom } from "jotai";
import { OctagonAlert } from "lucide-react";

import {
  type ApprovalRequirement,
  canReuseConfirmedApproval,
  isSameApprovalRequirement,
  waitForSufficientAllowance,
} from "./approval-allowance";
import { isCurrentSwapQuote } from "./approval-confirmation";
import { getSelectedTokenSymbol } from "./token-selection";
import {
  type LastChangedToken,
  type RouteDrivenFormState,
} from "./route-driven-state";
import { getMaxSellAmount } from "./max-sell-amount";
import {
  getSwapFormInitialState,
  type SwapFormRouteOptions,
  useStableRouteDrivenFormState,
} from "./swap-form-initial-state";
import { getTokenBalanceValue } from "./swap-form-validation";
import { defaultEmptyBalances, formSchema, type FormValues } from "./types";
import {
  useSwapQuoteFormEffects,
  useSwapTokenPairEffects,
} from "./use-swap-form-effects";
import { useSwapFormValidation } from "./use-swap-form-validation";
import { useSwapQuoteState } from "./use-swap-quote-state";
import { useSwapFormSync } from "./use-swap-form-sync";

export function useSwapForm(opts?: SwapFormRouteOptions) {
  const { address, isConnected } = useAccount();
  const walletChainId = useChainId();
  const formChainId = opts?.urlChainId ?? walletChainId ?? ChainId.Celo;
  const nativeTokenSymbol = getNativeTokenSymbol(formChainId);
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const [, setConfirmView] = useAtom(confirmViewAtom);
  const [isApprovalProcessing, setIsApprovalProcessing] = useState(false);
  const [isApprovalVerificationPending, setIsApprovalVerificationPending] =
    useState(false);
  const allowanceVerificationInFlightRef = useRef<ApprovalRequirement | null>(
    null,
  );
  const approvalTransactionContextRef = useRef<ApprovalRequirement | null>(
    null,
  );
  const approvedSwapContextRef = useRef<ApprovalRequirement | null>(null);
  const synchronizeAllowanceAndOpenConfirmRef = useRef<() => Promise<void>>(
    async () => undefined,
  );

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

  const { errors } = form.formState;
  const {
    balanceError,
    canQuote,
    fromTokenBalance,
    hasAmount,
    isSuspensionCheckLoading,
    isTradingSuspended,
    limits,
    limitsLoading,
    toTokenBalance,
    tradingSuspensionError,
    validateAmount,
  } = useSwapFormValidation({
    allTokenOptions,
    amount,
    balances,
    chainId: formChainId,
    formQuote,
    hasAmountError: Boolean(errors.amount),
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    tokenInSymbol,
    tokenOutSymbol,
  });

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

  // ── Quote ───────────────────────────────────────────────────────────

  const {
    amountWei: quotedAmountInWei,
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

  useSwapFormSync({
    amount,
    form,
    formChainId,
    formValues,
    isQuoteError: isError,
    lastRouteDrivenFormStateRef,
    prevChainIdRef,
    routeDrivenFormState,
    setConfirmView,
    setFormValues,
    setLastChangedToken,
    tokenInSymbol,
    tokenOutSymbol,
  });

  const {
    amountInWei,
    buyUSDValue,
    isButtonLoading,
    isLoading,
    sellUSDValue,
    tradingLimitError,
  } = useSwapQuoteState({
    amount,
    canQuote,
    chainId: formChainId,
    formQuote,
    fromTokenUSDValue,
    hasAmount,
    isQuoteError: isError,
    isTradingSuspended,
    limits,
    limitsLoading,
    prevTradingSuspensionErrorRef,
    quote,
    quoteFetching,
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    suspensionToastIdRef,
    toTokenUSDValue,
    tokenInSymbol,
    tokenOutSymbol,
    tradingSuspensionError,
  });
  const hasValidQuote = !!quote && Number(quote) > 0;
  const hasCurrentQuote = isCurrentSwapQuote({
    amountInWei,
    formQuote,
    formattedQuote: formatWithMaxDecimals(quote, 4, false),
    isFetching: quoteFetching,
    quote,
    quotedAmountInWei,
  });

  // ── Allowance & approval ────────────────────────────────────────────

  const { refetchAllowance, skipApprove } = useSwapAllowance({
    chainId: formChainId,
    tokenInSymbol: selectedTokenInSymbol,
    tokenOutSymbol: selectedTokenOutSymbol,
    approveAmount: amountInWei,
    address,
  });

  const approvalIdentity = [
    formChainId,
    address ?? "",
    selectedTokenInSymbol ?? "",
    selectedTokenOutSymbol ?? "",
  ].join(":");
  const currentApprovalRequirement = useMemo<ApprovalRequirement>(
    () => ({ amount: amountInWei, identity: approvalIdentity }),
    [amountInWei, approvalIdentity],
  );
  const currentApprovalRequirementRef = useRef(currentApprovalRequirement);
  const canOpenVerifiedSwap =
    hasAmount &&
    !!selectedTokenInSymbol &&
    !!selectedTokenOutSymbol &&
    hasValidQuote &&
    hasCurrentQuote &&
    !isButtonLoading &&
    !(errors.amount && errors.amount.message !== "Amount is required") &&
    !tradingLimitError &&
    !balanceError &&
    !isTradingSuspended &&
    !isSuspensionCheckLoading &&
    !isError;

  function openSwapConfirmation(values: FormValues, includeUsdValues: boolean) {
    const formData: SwapFormValues = {
      ...values,
      slippage: formValues?.slippage || form.getValues("slippage") || "0.3",
      isAutoSlippage: formValues?.isAutoSlippage,
      deadlineMinutes: formValues?.deadlineMinutes,
      tokenInSymbol: selectedTokenInSymbol,
      tokenOutSymbol: selectedTokenOutSymbol,
      ...(includeUsdValues ? { buyUSDValue, sellUSDValue } : {}),
    };
    setFormValues(formData);
    setConfirmView(true);
  }

  // USD lookup hooks debounce independently from the primary swap quote. After
  // an asynchronous approval, let SwapConfirm recompute missing values instead
  // of persisting a stale nonzero value that would suppress its fallback.
  const currentApprovalConfirmationRef = useRef<{
    canOpen: boolean;
    open: (values: FormValues) => void;
    requirement: ApprovalRequirement;
  }>({
    canOpen: canOpenVerifiedSwap,
    open: (values) => openSwapConfirmation(values, false),
    requirement: currentApprovalRequirement,
  });
  useEffect(() => {
    currentApprovalConfirmationRef.current = {
      canOpen: canOpenVerifiedSwap,
      open: (values) => openSwapConfirmation(values, false),
      requirement: currentApprovalRequirement,
    };
  });

  function getCurrentApprovalConfirmation(
    verificationRequirement: ApprovalRequirement,
  ) {
    const confirmation = currentApprovalConfirmationRef.current;
    return confirmation.canOpen &&
      isSameApprovalRequirement(
        confirmation.requirement,
        verificationRequirement,
      )
      ? confirmation
      : null;
  }

  useEffect(() => {
    currentApprovalRequirementRef.current = currentApprovalRequirement;
    if (
      approvedSwapContextRef.current !== null &&
      !canReuseConfirmedApproval(
        approvedSwapContextRef.current,
        currentApprovalRequirement,
      )
    ) {
      approvedSwapContextRef.current = null;
      setIsApprovalVerificationPending(false);
    }
  }, [currentApprovalRequirement]);

  async function synchronizeAllowanceAndOpenConfirm() {
    const confirmedApproval = approvedSwapContextRef.current;
    const verificationRequirement = currentApprovalRequirementRef.current;
    if (
      confirmedApproval === null ||
      !canReuseConfirmedApproval(confirmedApproval, verificationRequirement) ||
      allowanceVerificationInFlightRef.current !== null
    ) {
      return;
    }

    if (getCurrentApprovalConfirmation(verificationRequirement) === null) {
      setIsApprovalProcessing(false);
      return;
    }

    allowanceVerificationInFlightRef.current = confirmedApproval;
    setIsApprovalProcessing(true);
    const isVerificationCurrent = () =>
      approvedSwapContextRef.current === confirmedApproval &&
      isSameApprovalRequirement(
        currentApprovalRequirementRef.current,
        verificationRequirement,
      ) &&
      canReuseConfirmedApproval(confirmedApproval, verificationRequirement);
    try {
      await waitForSufficientAllowance({
        requiredAmount: verificationRequirement.amount,
        isVerificationCurrent,
        readAllowance: async () => {
          const result = await refetchAllowance({ throwOnError: true });
          if (result.data === undefined) {
            throw (
              result.error ??
              new Error("Allowance refresh completed without a value")
            );
          }
          return result.data;
        },
      });

      if (!isVerificationCurrent()) return;

      if (getCurrentApprovalConfirmation(verificationRequirement) === null) {
        return;
      }

      let validatedValues: FormValues | undefined;
      await form.handleSubmit((values) => {
        if (getCurrentApprovalConfirmation(verificationRequirement) !== null) {
          validatedValues = values;
        }
      })();
      const confirmation = getCurrentApprovalConfirmation(
        verificationRequirement,
      );
      if (
        validatedValues === undefined ||
        confirmation === null ||
        !isVerificationCurrent()
      ) {
        return;
      }

      approvedSwapContextRef.current = null;
      setIsApprovalVerificationPending(false);
      confirmation.open(validatedValues);
    } catch (error) {
      if (!isVerificationCurrent()) return;

      logger.error("Failed to verify swap allowance after approval", error);
      toast.error(
        "Approval confirmed, but the updated allowance could not be verified.",
        {
          action: {
            label: "Retry",
            onClick: () => void synchronizeAllowanceAndOpenConfirmRef.current(),
          },
        },
      );
    } finally {
      if (allowanceVerificationInFlightRef.current === confirmedApproval) {
        allowanceVerificationInFlightRef.current = null;
        setIsApprovalProcessing(false);
      }
    }
  }
  useEffect(() => {
    synchronizeAllowanceAndOpenConfirmRef.current =
      synchronizeAllowanceAndOpenConfirm;
  });

  const { sendApproveTx, isApproveTxLoading } = useApproveTransaction({
    chainId: formChainId,
    tokenInSymbol: selectedTokenInSymbol,
    tokenOutSymbol: selectedTokenOutSymbol,
    amountInWei,
    accountAddress: address,
    onSuccess: (receipt) => {
      const confirmedApprovalContext = approvalTransactionContextRef.current;
      approvalTransactionContextRef.current = null;
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
      if (
        confirmedApprovalContext === null ||
        !canReuseConfirmedApproval(
          confirmedApprovalContext,
          currentApprovalRequirementRef.current,
        )
      ) {
        setIsApprovalProcessing(false);
        return;
      }

      approvedSwapContextRef.current = confirmedApprovalContext;
      setIsApprovalVerificationPending(true);
      void synchronizeAllowanceAndOpenConfirmRef.current();
    },
  });

  useSwapQuoteFormEffects({
    amount,
    amountError: errors.amount,
    form,
    formQuote,
    hasAmount,
    quote,
  });

  // ── Submit ──────────────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    try {
      if (isApprovalVerificationPending) {
        await synchronizeAllowanceAndOpenConfirmRef.current();
      } else if (!skipApprove && sendApproveTx) {
        approvalTransactionContextRef.current = currentApprovalRequirement;
        setIsApprovalProcessing(true);
        logger.info("Approval needed, sending approve transaction");
        const hash = await sendApproveTx();

        if (!hash) {
          approvalTransactionContextRef.current = null;
          setIsApprovalProcessing(false);
        }

        logger.info("Waiting for approval transaction", {
          hash,
        });
      } else {
        openSwapConfirmation(values, true);
      }
    } catch (error) {
      logger.error("Error in swap form submission", error);
      approvalTransactionContextRef.current = null;
      setIsApprovalProcessing(false);
    }
  };

  const shouldApprove =
    !isApprovalVerificationPending &&
    !skipApprove &&
    hasAmount &&
    hasValidQuote &&
    !isLoading &&
    !balanceError;

  // ── Token pair validation ───────────────────────────────────────────

  useSwapTokenPairEffects({
    chainId: formChainId,
    form,
    formValues,
    lastChangedTokenRef,
    selectedTokenInSymbol,
    selectedTokenOutSymbol,
    setLastChangedToken,
  });

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
    isApprovalVerificationPending,

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
