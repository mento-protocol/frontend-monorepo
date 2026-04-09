"use client";

import { Button } from "@repo/ui";
import {
  getDebtTokenConfig,
  useLoanDetails,
  useNextAvailableOwnerIndex,
  useOpenTrove,
  usePredictUpfrontFee,
  useSystemParams,
  tryParseUnits,
  type DebtTokenConfig,
} from "@repo/web3";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
} from "@repo/web3/wagmi";
import { parseUnits, erc20Abi, type Address } from "viem";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupportedCollaterals,
  getSupportedDebtTokens,
} from "@/lib/stability-route";
import { CollateralInput } from "./collateral-input";
import { DebtInput } from "./debt-input";
import { InterestRateInput } from "./interest-rate-input";
import {
  MAX_INTEREST_RATE_PCT,
  MAX_INTEREST_RATE_WAD,
} from "../shared/interest-rate-limits";
import { LoanSummary } from "./loan-summary";
import { LTVBar } from "./ltv-bar";
import { TokenDropdown } from "../shared/debt-token-selector";

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

function getInitialDebtToken(tokens: DebtTokenConfig[]): DebtTokenConfig {
  return tokens.find((token) => token.symbol === "GBPm") ?? tokens[0]!;
}

export function OpenTroveForm() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wagmiConfig = useConfig();
  const supportedDebtTokens = useMemo(
    () => getSupportedDebtTokens(chainId),
    [chainId],
  );
  const [selectedDebtToken, setSelectedDebtToken] = useState<DebtTokenConfig>(
    () =>
      supportedDebtTokens.length > 0
        ? getInitialDebtToken(supportedDebtTokens)
        : getDebtTokenConfig("GBPm"),
  );
  const [formState, setFormState] = useState({
    collAmount: "",
    debtAmount: "",
    interestRate: "",
  });

  useEffect(() => {
    if (supportedDebtTokens.length === 0) return;
    setSelectedDebtToken((current) => {
      const next =
        supportedDebtTokens.find((token) => token.symbol === current.symbol) ??
        getInitialDebtToken(supportedDebtTokens);
      return next.symbol === current.symbol ? current : next;
    });
  }, [supportedDebtTokens]);

  const collateralOptions = useMemo(
    () =>
      getSupportedCollaterals(chainId, selectedDebtToken.symbol).map(
        (symbol) => ({
          symbol,
          disabled: true,
        }),
      ),
    [chainId, selectedDebtToken.symbol],
  );
  const collateralSymbol = collateralOptions[0]?.symbol ?? "USDm";

  const { data: systemParams } = useSystemParams(selectedDebtToken.symbol);
  const {
    data: ownerIndex,
    isError: ownerIndexError,
    isFetching: ownerIndexFetching,
  } = useNextAvailableOwnerIndex(selectedDebtToken.symbol);
  const openTrove = useOpenTrove();

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

  const {
    data: upfrontFee,
    isError: upfrontFeeError,
    isFetching: upfrontFeeFetching,
  } = usePredictUpfrontFee(
    debtAmount,
    rateBigint ?? 0n,
    selectedDebtToken.symbol,
  );

  const loanDetails = useLoanDetails(
    collAmount > 0n ? collAmount : null,
    debtAmount > 0n ? debtAmount : null,
    rateBigint,
    selectedDebtToken.symbol,
  );

  const ltvNumber = useMemo(() => {
    if (!loanDetails?.ltv) return 0;
    return Number(loanDetails.ltv) / 1e16;
  }, [loanDetails]);

  const maxLtvNumber = useMemo(() => {
    if (!loanDetails?.maxLtv) return 90;
    return Number(loanDetails.maxLtv) / 1e16;
  }, [loanDetails]);

  const collateralAddress = getTokenAddress(
    chainId,
    collateralSymbol as TokenSymbol,
  ) as Address | undefined;

  const { data: collateralBalance } = useReadContract({
    address: collateralAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!collateralAddress },
  });

  const setCollAmount = useCallback(
    (value: string) => setFormState((prev) => ({ ...prev, collAmount: value })),
    [],
  );
  const setDebtAmount = useCallback(
    (value: string) => setFormState((prev) => ({ ...prev, debtAmount: value })),
    [],
  );
  const setInterestRate = useCallback(
    (value: string) =>
      setFormState((prev) => ({ ...prev, interestRate: value })),
    [],
  );

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

  const aboveMaxRate = rateBigint != null && rateBigint > MAX_INTEREST_RATE_WAD;

  const liquidatablePosition =
    loanDetails?.status === "liquidatable" ||
    loanDetails?.status === "underwater";

  const inputsEmpty =
    formState.collAmount === "" ||
    formState.debtAmount === "" ||
    formState.interestRate === "";

  const needsUpfrontFee = debtAmount > 0n && rateBigint != null;

  const buttonDisabledReason = useMemo(() => {
    if (supportedDebtTokens.length === 0) return "Borrow unavailable";
    if (!isConnected) return "Connect wallet";
    if (ownerIndex == null) {
      return ownerIndexError
        ? "Unable to prepare trove id"
        : ownerIndexFetching
          ? "Preparing trove id..."
          : "Preparing trove id...";
    }
    if (inputsEmpty) return "Enter all fields";
    if (collAmount === 0n || debtAmount === 0n) return "Enter valid amounts";
    if (rateBigint === null) return "Enter valid interest rate";
    if (belowMinRate) return "Interest rate below minimum";
    if (aboveMaxRate) return `Interest rate above ${MAX_INTEREST_RATE_PCT}%`;
    if (insufficientBalance) return `Insufficient ${collateralSymbol} balance`;
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
    supportedDebtTokens.length,
    isConnected,
    ownerIndex,
    ownerIndexError,
    ownerIndexFetching,
    inputsEmpty,
    collAmount,
    debtAmount,
    rateBigint,
    belowMinRate,
    aboveMaxRate,
    insufficientBalance,
    collateralSymbol,
    belowMinDebt,
    liquidatablePosition,
    needsUpfrontFee,
    upfrontFee,
    upfrontFeeError,
    upfrontFeeFetching,
    openTrove.isPending,
  ]);

  const buttonLabel = useMemo(() => {
    if (!isConnected) return "Connect wallet";
    if (collAmount === 0n) return "Enter collateral amount";
    if (belowMinDebt) return "Min. borrow too low";
    if (liquidatablePosition) return "LTV too high - add more collateral";
    return buttonDisabledReason ?? "Open Trove";
  }, [
    isConnected,
    collAmount,
    belowMinDebt,
    liquidatablePosition,
    buttonDisabledReason,
  ]);

  const handleDebtTokenChange = (symbol: string) => {
    const nextDebtToken = supportedDebtTokens.find(
      (token) => token.symbol === symbol,
    );
    if (!nextDebtToken || nextDebtToken.symbol === selectedDebtToken.symbol) {
      return;
    }

    setSelectedDebtToken(nextDebtToken);
    setFormState((prev) => ({
      collAmount: prev.collAmount,
      debtAmount: "",
      interestRate: "",
    }));
  };

  const handleSubmit = () => {
    if (
      buttonDisabledReason ||
      !address ||
      ownerIndex == null ||
      rateBigint === null ||
      upfrontFee == null
    ) {
      return;
    }

    const maxUpfrontFee = upfrontFee + upfrontFee / 20n;

    openTrove.mutate({
      symbol: selectedDebtToken.symbol,
      params: {
        owner: address,
        ownerIndex,
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
      <button
        type="button"
        className="gap-2 font-medium flex cursor-pointer items-center text-[13px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        onClick={() => router.push("/borrow")}
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

      <div className="p-6 border border-border/50 bg-card">
        <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground/50 uppercase">
          New Position
        </span>
        <div className="mt-4 gap-4 md:grid-cols-2 grid">
          <label className="space-y-2">
            <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground/50 uppercase">
              Collateral
            </span>
            <TokenDropdown
              value={collateralSymbol}
              onValueChange={() => {}}
              options={collateralOptions}
              disabled
              triggerClassName="w-full gap-2 border border-border bg-transparent px-3 py-2 font-medium shadow-none"
            />
          </label>
          <label className="space-y-2">
            <span className="font-mono font-medium tracking-widest text-[11px] text-muted-foreground/50 uppercase">
              Borrow
            </span>
            <TokenDropdown
              value={selectedDebtToken.symbol}
              onValueChange={handleDebtTokenChange}
              options={supportedDebtTokens.map((token) => ({
                symbol: token.symbol,
              }))}
              triggerClassName="w-full gap-2 border border-border bg-transparent px-3 py-2 font-medium shadow-none"
            />
          </label>
        </div>
        <h1 className="mt-6 font-bold tracking-tight text-3xl">Open a Trove</h1>
        <p className="mt-1 leading-relaxed text-[15px] text-muted-foreground/60">
          Deposit {collateralSymbol} as collateral and borrow{" "}
          {selectedDebtToken.symbol} against it.
        </p>
      </div>

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

      <div className="gap-6 lg:grid-cols-[1fr_340px] grid grid-cols-1">
        <div className="gap-6 flex flex-col">
          <div className="space-y-6 p-7 border border-border/50 bg-card">
            <CollateralInput
              debtToken={selectedDebtToken}
              collateralSymbol={collateralSymbol}
              value={formState.collAmount}
              onChange={setCollAmount}
            />

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
              debtToken={selectedDebtToken}
              value={formState.debtAmount}
              onChange={setDebtAmount}
              collAmount={collAmount}
            />
          </div>

          <div className="space-y-6 p-7 border border-border/50 bg-card">
            <InterestRateInput
              debtToken={selectedDebtToken}
              value={formState.interestRate}
              onChange={setInterestRate}
              debtAmount={debtAmount}
              maxRatePct={MAX_INTEREST_RATE_PCT}
            />
          </div>
        </div>

        <div className="gap-4 flex flex-col">
          <LoanSummary
            debtToken={selectedDebtToken}
            collateralSymbol={collateralSymbol}
            collAmount={collAmount}
            debtAmount={debtAmount}
            interestRate={rateBigint ?? 0n}
          />

          <Button
            className="py-5 text-base font-semibold w-full"
            size="lg"
            disabled={buttonDisabledReason !== null}
            onClick={handleSubmit}
          >
            {buttonLabel}
          </Button>

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
