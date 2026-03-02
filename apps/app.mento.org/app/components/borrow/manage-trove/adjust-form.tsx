"use client";

import { useState, useMemo, useCallback } from "react";
import { Button, CoinInput } from "@repo/ui";
import {
  useAdjustTrove,
  useLoanDetails,
  usePredictUpfrontFee,
  useSystemParams,
  selectedDebtTokenAtom,
  formatCollateralAmount,
  formatDebtAmount,
  formatLtv,
  formatPrice,
  formatCompactBalance,
  tryParseUnits,
  type BorrowPosition,
} from "@repo/web3";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
} from "@repo/web3/wagmi";
import { useAtomValue } from "jotai";
import { erc20Abi, formatUnits, type Address } from "viem";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { RiskBadge } from "../shared/risk-badge";

type CollDirection = "add" | "remove";
type DebtDirection = "borrow" | "repay";

interface AdjustFormProps {
  troveId: string;
  troveData: BorrowPosition;
}

const PLACEHOLDER = "\u2014";

function MetricRow({
  label,
  before,
  after,
}: {
  label: string;
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  return (
    <div className="py-1.5 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="gap-2 text-sm flex items-center">
        <span className="text-muted-foreground">{before}</span>
        <span className="text-muted-foreground">&rarr;</span>
        <span className="font-medium">{after}</span>
      </span>
    </div>
  );
}

export function AdjustForm({ troveId, troveData }: AdjustFormProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wagmiConfig = useConfig();

  const [collDirection, setCollDirection] = useState<CollDirection>("add");
  const [debtDirection, setDebtDirection] = useState<DebtDirection>("borrow");
  const [collInput, setCollInput] = useState("");
  const [debtInput, setDebtInput] = useState("");

  const { data: systemParams } = useSystemParams(debtToken.symbol);
  const adjustTrove = useAdjustTrove();

  // Wallet balance for collateral (needed when adding)
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

  // Parse input values
  const collChange = useMemo(
    () => tryParseUnits(collInput, 18) ?? 0n,
    [collInput],
  );
  const debtChange = useMemo(
    () => tryParseUnits(debtInput, 18) ?? 0n,
    [debtInput],
  );

  // Compute new collateral and debt
  const newCollateral = useMemo(() => {
    if (collChange === 0n) return troveData.collateral;
    return collDirection === "add"
      ? troveData.collateral + collChange
      : troveData.collateral > collChange
        ? troveData.collateral - collChange
        : 0n;
  }, [troveData.collateral, collChange, collDirection]);

  const newDebt = useMemo(() => {
    if (debtChange === 0n) return troveData.debt;
    return debtDirection === "borrow"
      ? troveData.debt + debtChange
      : troveData.debt > debtChange
        ? troveData.debt - debtChange
        : 0n;
  }, [troveData.debt, debtChange, debtDirection]);

  // Loan details for before and after
  const currentLoanDetails = useLoanDetails(
    troveData.collateral,
    troveData.debt,
    troveData.annualInterestRate,
    debtToken.symbol,
  );

  const newLoanDetails = useLoanDetails(
    newCollateral,
    newDebt,
    troveData.annualInterestRate,
    debtToken.symbol,
  );

  // Upfront fee (only when borrowing more)
  const isDebtIncrease = debtDirection === "borrow" && debtChange > 0n;
  const { data: upfrontFee } = usePredictUpfrontFee(
    isDebtIncrease ? debtChange : 0n,
    troveData.annualInterestRate,
    debtToken.symbol,
  );

  const hasChanges = collChange > 0n || debtChange > 0n;

  // Collateral limit label
  const collLimitLabel = useMemo(() => {
    if (collDirection === "add") {
      const bal = collateralBalance ? formatUnits(collateralBalance, 18) : "0";
      return `Balance: ${formatCompactBalance(bal)}`;
    }
    return `Current: ${formatCollateralAmount(troveData.collateral)}`;
  }, [collDirection, collateralBalance, troveData.collateral]);

  // Max collateral handler
  const handleMaxColl = useCallback(() => {
    if (collDirection === "add" && collateralBalance) {
      setCollInput(formatUnits(collateralBalance, 18));
    } else if (collDirection === "remove") {
      setCollInput(formatUnits(troveData.collateral, 18));
    }
  }, [collDirection, collateralBalance, troveData.collateral]);

  // Max debt handler
  const handleMaxDebt = useCallback(() => {
    if (debtDirection === "repay") {
      setDebtInput(formatUnits(troveData.debt, 18));
    }
  }, [debtDirection, troveData.debt]);

  // Validation
  const insufficientCollBalance =
    collDirection === "add" &&
    collChange > 0n &&
    collateralBalance !== undefined &&
    collChange > collateralBalance;

  const exceedsCurrentCollateral =
    collDirection === "remove" &&
    collChange > 0n &&
    collChange > troveData.collateral;

  const belowMinDebt =
    newDebt > 0n &&
    systemParams?.minDebt != null &&
    newDebt < systemParams.minDebt;

  const buttonDisabledReason = useMemo(() => {
    if (!isConnected) return "Connect wallet";
    if (!hasChanges) return "Enter an amount";
    if (insufficientCollBalance) return "Insufficient USDm balance";
    if (exceedsCurrentCollateral) return "Exceeds current collateral";
    if (belowMinDebt) return "Below minimum debt";
    if (adjustTrove.isPending) return "Adjusting position...";
    return null;
  }, [
    isConnected,
    hasChanges,
    insufficientCollBalance,
    exceedsCurrentCollateral,
    belowMinDebt,
    adjustTrove.isPending,
  ]);

  const handleSubmit = () => {
    if (buttonDisabledReason || !address) return;

    const maxUpfrontFee =
      isDebtIncrease && upfrontFee != null
        ? upfrontFee + upfrontFee / 20n // 5% buffer
        : isDebtIncrease
          ? debtChange / 100n // 1% fallback
          : 0n;

    adjustTrove.mutate({
      symbol: debtToken.symbol,
      params: {
        troveId,
        collChange,
        isCollIncrease: collDirection === "add",
        debtChange,
        isDebtIncrease,
        maxUpfrontFee,
      },
      wagmiConfig,
      account: address,
    });
  };

  return (
    <div className="space-y-6 pt-4">
      {/* Collateral adjustment */}
      <div className="gap-2 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="gap-2 flex items-center">
            <span className="text-sm font-medium">Collateral</span>
            <span className="text-sm text-muted-foreground">USDm</span>
          </div>
          <div className="gap-1 flex">
            <button
              type="button"
              className={`px-3 py-1 text-xs font-medium cursor-pointer rounded-l-md border transition-colors ${
                collDirection === "add"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
              onClick={() => setCollDirection("add")}
            >
              Add
            </button>
            <button
              type="button"
              className={`px-3 py-1 text-xs font-medium cursor-pointer rounded-r-md border border-l-0 transition-colors ${
                collDirection === "remove"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
              onClick={() => setCollDirection("remove")}
            >
              Remove
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {collLimitLabel}
          </span>
          <button
            type="button"
            className="text-xs font-medium cursor-pointer text-primary hover:underline"
            onClick={handleMaxColl}
          >
            MAX
          </button>
        </div>
        <CoinInput
          value={collInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setCollInput(e.target.value)
          }
          placeholder="0"
          className={`shadow-xs h-10 px-3 text-sm placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
            insufficientCollBalance || exceedsCurrentCollateral
              ? "border-destructive"
              : ""
          }`}
        />
        {insufficientCollBalance && (
          <p className="text-xs text-destructive">Insufficient USDm balance</p>
        )}
        {exceedsCurrentCollateral && (
          <p className="text-xs text-destructive">Exceeds current collateral</p>
        )}
      </div>

      {/* Debt adjustment */}
      <div className="gap-2 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="gap-2 flex items-center">
            <span className="text-sm font-medium">Debt</span>
            <span className="text-sm text-muted-foreground">
              {debtToken.symbol}
            </span>
          </div>
          <div className="gap-1 flex">
            <button
              type="button"
              className={`px-3 py-1 text-xs font-medium cursor-pointer rounded-l-md border transition-colors ${
                debtDirection === "borrow"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
              onClick={() => setDebtDirection("borrow")}
            >
              Borrow more
            </button>
            <button
              type="button"
              className={`px-3 py-1 text-xs font-medium cursor-pointer rounded-r-md border border-l-0 transition-colors ${
                debtDirection === "repay"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
              onClick={() => setDebtDirection("repay")}
            >
              Repay
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Current: {formatDebtAmount(troveData.debt, debtToken)}
          </span>
          {debtDirection === "repay" && (
            <button
              type="button"
              className="text-xs font-medium cursor-pointer text-primary hover:underline"
              onClick={handleMaxDebt}
            >
              MAX
            </button>
          )}
        </div>
        <CoinInput
          value={debtInput}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDebtInput(e.target.value)
          }
          placeholder="0"
          className="shadow-xs h-10 px-3 text-sm placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {systemParams?.minDebt && (
          <p className="text-xs text-muted-foreground">
            Min debt: {formatDebtAmount(systemParams.minDebt, debtToken)}
          </p>
        )}
        {belowMinDebt && (
          <p className="text-xs text-destructive">
            New debt would be below minimum
          </p>
        )}
      </div>

      {/* Before → After comparison */}
      {hasChanges && (
        <div className="p-3 flex flex-col divide-y rounded-md border">
          <MetricRow
            label="LTV"
            before={
              <span className="gap-1 flex items-center">
                {currentLoanDetails
                  ? formatLtv(currentLoanDetails.ltv)
                  : PLACEHOLDER}
              </span>
            }
            after={
              <span className="gap-1 flex items-center">
                {newLoanDetails ? formatLtv(newLoanDetails.ltv) : PLACEHOLDER}
                {newLoanDetails?.liquidationRisk && (
                  <RiskBadge risk={newLoanDetails.liquidationRisk} />
                )}
              </span>
            }
          />
          <MetricRow
            label="Liquidation Price"
            before={
              currentLoanDetails
                ? formatPrice(currentLoanDetails.liquidationPrice, debtToken)
                : PLACEHOLDER
            }
            after={
              newLoanDetails
                ? formatPrice(newLoanDetails.liquidationPrice, debtToken)
                : PLACEHOLDER
            }
          />
          <MetricRow
            label="Collateral"
            before={formatCollateralAmount(troveData.collateral)}
            after={formatCollateralAmount(newCollateral)}
          />
          <MetricRow
            label="Debt"
            before={formatDebtAmount(troveData.debt, debtToken)}
            after={formatDebtAmount(newDebt, debtToken)}
          />
          {isDebtIncrease && upfrontFee != null && (
            <MetricRow
              label="One-time Fee"
              before={PLACEHOLDER}
              after={formatDebtAmount(upfrontFee, debtToken)}
            />
          )}
        </div>
      )}

      {/* Submit */}
      <Button
        className="w-full"
        disabled={buttonDisabledReason !== null}
        onClick={handleSubmit}
      >
        {buttonDisabledReason ?? "Adjust Trove"}
      </Button>
    </div>
  );
}
