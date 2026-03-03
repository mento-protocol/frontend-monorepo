"use client";

import { Button, Card, CardContent } from "@repo/ui";
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

  const handleSubmit = () => {
    if (
      buttonDisabledReason ||
      !address ||
      rateBigint === null ||
      upfrontFee == null
    )
      return;
    if (ownerIndex == null) return;

    // Add 5% buffer to predicted fee for maxUpfrontFee
    const maxUpfrontFee = upfrontFee + upfrontFee / 20n;

    openTrove.mutate({
      symbol: debtToken.symbol,
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
    <div className="space-y-4">
      {/* Back button */}
      <Button
        variant="ghost"
        className="gap-1 px-2"
        onClick={() => setBorrowView("dashboard")}
      >
        &larr; Back to Dashboard
      </Button>

      <div className="gap-6 lg:grid-cols-3 grid grid-cols-1">
        {/* Left: Form inputs */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-6">
              <CollateralInput
                value={formState.collAmount}
                onChange={setCollAmount}
              />
              <DebtInput
                value={formState.debtAmount}
                onChange={setDebtAmount}
                collAmount={collAmount}
              />
              <InterestRateInput
                value={formState.interestRate}
                onChange={setInterestRate}
                debtAmount={debtAmount}
              />
              <InterestRateChart selectedRate={formState.interestRate} />
            </CardContent>
          </Card>

          {/* Submit button */}
          <Button
            className="w-full"
            size="lg"
            disabled={buttonDisabledReason !== null}
            onClick={handleSubmit}
          >
            {buttonDisabledReason ?? "Open Trove"}
          </Button>
        </div>

        {/* Right: Loan summary */}
        <div>
          <LoanSummary
            collAmount={collAmount}
            debtAmount={debtAmount}
            interestRate={rateBigint ?? 0n}
          />
        </div>
      </div>
    </div>
  );
}
