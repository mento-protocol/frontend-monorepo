"use client";

import { Button } from "@repo/ui";
import {
  openTroveFormAtom,
  selectedDebtTokenAtom,
  useLoanDetails,
  useNextOwnerIndex,
  useOpenTrove,
  usePredictUpfrontFee,
  useSystemParams,
  tryParseUnits,
} from "@repo/web3";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
} from "@repo/web3/wagmi";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { parseUnits, erc20Abi, type Address } from "viem";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { useMemo, useCallback } from "react";
import { borrowViewAtom } from "../atoms/borrow-navigation";
import { CollateralInput } from "./collateral-input";
import { DebtInput } from "./debt-input";
import { InterestRateInput } from "./interest-rate-input";
import { InterestRateChart } from "./interest-rate-chart";
import { LoanSummary } from "./loan-summary";
import { LTVBar } from "./ltv-bar";

const MAX_RATE_PCT = 15;
const MAX_RATE = parseUnits("0.15", 18);

function parseRateToBigint(pctString: string): bigint | null {
  const num = Number(pctString);
  if (isNaN(num) || num <= 0) return null;
  const decimalStr = (num / 100).toFixed(18);
  try {
    return parseUnits(decimalStr, 18);
  } catch {
    return null;
  }
}

export function OpenTroveForm() {
  const [formState, setFormState] = useAtom(openTroveFormAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wagmiConfig = useConfig();

  // Hooks
  const { data: systemParams } = useSystemParams(debtToken.symbol);
  const { data: ownerIndex } = useNextOwnerIndex(debtToken.symbol);
  const openTrove = useOpenTrove();

  // Parse form values to bigints
  const collAmount = useMemo(
    () => tryParseUnits(formState.collAmount, 18) ?? 0n,
    [formState.collAmount],
  );
  const debtAmount = useMemo(
    () => tryParseUnits(formState.debtAmount, 18) ?? 0n,
    [formState.debtAmount],
  );
  const rateBigint = useMemo(
    () => parseRateToBigint(formState.interestRate),
    [formState.interestRate],
  );

  // Upfront fee for maxUpfrontFee calculation
  const {
    data: upfrontFee,
    isError: upfrontFeeError,
    isFetching: upfrontFeeFetching,
  } = usePredictUpfrontFee(debtAmount, rateBigint ?? 0n, debtToken.symbol);

  const loanDetails = useLoanDetails(
    collAmount > 0n ? collAmount : null,
    debtAmount > 0n ? debtAmount : null,
    rateBigint,
    debtToken.symbol,
  );

  // Compute LTV as a number for the bar
  const ltvNumber = useMemo(() => {
    if (!loanDetails?.ltv) return 0;
    return Number(loanDetails.ltv) / 1e16;
  }, [loanDetails]);

  const maxLtvNumber = useMemo(() => {
    if (!loanDetails?.maxLtv) return 90;
    return Number(loanDetails.maxLtv) / 1e16;
  }, [loanDetails]);

  // Collateral balance check
  const collateralAddress = getTokenAddress(chainId, "USDm" as TokenSymbol) as
    | Address
    | undefined;

  const { data: collateralBalance } = useReadContract({
    address: collateralAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!collateralAddress },
  });

  // Form field handlers
  const setCollAmount = useCallback(
    (value: string) => setFormState((prev) => ({ ...prev, collAmount: value })),
    [setFormState],
  );
  const setDebtAmount = useCallback(
    (value: string) => setFormState((prev) => ({ ...prev, debtAmount: value })),
    [setFormState],
  );
  const setInterestRate = useCallback(
    (value: string) =>
      setFormState((prev) => ({ ...prev, interestRate: value })),
    [setFormState],
  );

  // Validation
  const insufficientBalance =
    collAmount > 0n &&
    collateralBalance !== undefined &&
    collAmount > collateralBalance;

  const belowMinDebt =
    debtAmount > 0n &&
    systemParams?.minDebt != null &&
    debtAmount < systemParams.minDebt;

  const belowMinRate =
    rateBigint != null &&
    systemParams?.minAnnualInterestRate != null &&
    rateBigint < systemParams.minAnnualInterestRate;

  const aboveMaxRate = rateBigint != null && rateBigint > MAX_RATE;

  const liquidatablePosition =
    loanDetails?.status === "liquidatable" ||
    loanDetails?.status === "underwater";

  const inputsEmpty =
    formState.collAmount === "" ||
    formState.debtAmount === "" ||
    formState.interestRate === "";

  const needsUpfrontFee = debtAmount > 0n && rateBigint != null;

  const buttonDisabledReason = useMemo(() => {
    if (!isConnected) return "Connect wallet";
    if (inputsEmpty) return "Enter all fields";
    if (collAmount === 0n || debtAmount === 0n) return "Enter valid amounts";
    if (rateBigint === null) return "Enter valid interest rate";
    if (belowMinRate) return "Interest rate below minimum";
    if (aboveMaxRate) return `Interest rate above ${MAX_RATE_PCT}%`;
    if (insufficientBalance) return "Insufficient USDm balance";
    if (belowMinDebt) return "Below minimum debt";
    if (liquidatablePosition) return "Position would be liquidatable";
    if (needsUpfrontFee && upfrontFee == null) {
      return upfrontFeeError
        ? "Unable to quote upfront fee"
        : upfrontFeeFetching
          ? "Calculating upfront fee..."
          : "Upfront fee unavailable";
    }
    if (openTrove.isPending) return "Opening position...";
    return null;
  }, [
    isConnected,
    inputsEmpty,
    collAmount,
    debtAmount,
    rateBigint,
    belowMinRate,
    aboveMaxRate,
    insufficientBalance,
    belowMinDebt,
    liquidatablePosition,
    needsUpfrontFee,
    upfrontFee,
    upfrontFeeError,
    upfrontFeeFetching,
    openTrove.isPending,
  ]);

  // Dynamic button label matching mockup
  const buttonLabel = useMemo(() => {
    if (!isConnected) return "Connect wallet";
    if (collAmount === 0n) return "Enter collateral amount";
    if (belowMinDebt) return "Min. borrow too low";
    if (liquidatablePosition) return "LTV too high \u2014 add more collateral";
    return buttonDisabledReason ?? "Open Trove";
  }, [
    isConnected,
    collAmount,
    belowMinDebt,
    liquidatablePosition,
    buttonDisabledReason,
  ]);

  const handleSubmit = () => {
    if (
      buttonDisabledReason ||
      !address ||
      rateBigint === null ||
      upfrontFee == null
    )
      return;

    const nowIndex = Date.now();
    const safeOwnerIndex =
      ownerIndex != null ? Math.max(ownerIndex + 1, nowIndex) : nowIndex;

    // Add 5% buffer to predicted fee for maxUpfrontFee
    const maxUpfrontFee = upfrontFee + upfrontFee / 20n;

    openTrove.mutate({
      symbol: debtToken.symbol,
      params: {
        owner: address,
        ownerIndex: safeOwnerIndex,
        collAmount,
        boldAmount: debtAmount,
        annualInterestRate: rateBigint,
        maxUpfrontFee,
      },
      wagmiConfig,
    });
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        type="button"
        className="gap-2 font-medium flex cursor-pointer items-center text-[13px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        onClick={() => setBorrowView("dashboard")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M10 4l-4 4 4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Back to Dashboard
      </button>

      {/* Header */}
      <div className="p-6 border border-border/50 bg-card">
        <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground/50 uppercase">
          New Position
        </span>
        <h1 className="mt-2 font-bold tracking-tight text-3xl">Open a Trove</h1>
        <p className="mt-1 leading-relaxed text-[15px] text-muted-foreground/60">
          Deposit USDm as collateral and borrow {debtToken.symbol} against it.
        </p>
      </div>

      {/* LTV Health Bar — hero */}
      <div className="p-6 border border-border/50 bg-card">
        <div className="mb-3 font-mono font-medium tracking-widest text-[11px] text-muted-foreground/40 uppercase">
          Loan-to-Value
        </div>
        <LTVBar
          ltv={ltvNumber}
          maxLtv={maxLtvNumber}
          risk={loanDetails?.liquidationRisk ?? null}
        />
      </div>

      {/* Main two-column layout */}
      <div className="gap-6 lg:grid-cols-[1fr_340px] grid grid-cols-1">
        {/* Left: Form inputs */}
        <div className="gap-6 flex flex-col">
          {/* Collateral & Borrow Card */}
          <div className="p-7 space-y-6 border border-border/50 bg-card">
            <CollateralInput
              value={formState.collAmount}
              onChange={setCollAmount}
            />

            {/* Divider with arrow */}
            <div className="-my-2 flex justify-center">
              <div className="h-8 w-8 flex items-center justify-center border border-border/50 bg-muted/30">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  className="text-muted-foreground/40"
                >
                  <path
                    d="M7 3v8M4 8l3 3 3-3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            <DebtInput
              value={formState.debtAmount}
              onChange={setDebtAmount}
              collAmount={collAmount}
            />
          </div>

          {/* Interest Rate Card */}
          <div className="p-7 space-y-6 border border-border/50 bg-card">
            <InterestRateInput
              value={formState.interestRate}
              onChange={setInterestRate}
              debtAmount={debtAmount}
            />
            <InterestRateChart selectedRate={formState.interestRate} />
          </div>
        </div>

        {/* Right: Summary sidebar */}
        <div className="gap-4 flex flex-col">
          <LoanSummary
            collAmount={collAmount}
            debtAmount={debtAmount}
            interestRate={rateBigint ?? 0n}
          />

          {/* Open Trove button */}
          <Button
            className="py-5 text-base font-semibold w-full"
            size="lg"
            disabled={buttonDisabledReason !== null}
            onClick={handleSubmit}
          >
            {buttonLabel}
          </Button>

          {/* Liquidation warning */}
          {liquidatablePosition && ltvNumber > 0 && (
            <div className="gap-2.5 p-3 flex items-start border border-destructive/20 bg-destructive/5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="mt-0.5 shrink-0 text-destructive/70"
              >
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M8 5.5v3M8 10.5h.005"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-xs leading-relaxed text-destructive/70">
                This position would be immediately liquidatable. Reduce your
                borrow amount or add more collateral.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
