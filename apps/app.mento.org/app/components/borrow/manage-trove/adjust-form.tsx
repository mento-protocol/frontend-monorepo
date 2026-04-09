"use client";

import { useState, useMemo, useCallback } from "react";
import { Button, CoinInput } from "@repo/ui";
import {
  type DebtTokenConfig,
  useAdjustTrove,
  useLoanDetails,
  usePredictUpfrontFee,
  useSystemParams,
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
import { erc20Abi, formatUnits, type Address } from "viem";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { RiskBadge } from "../shared/risk-badge";

type CollDirection = "add" | "remove";
type DebtDirection = "borrow" | "repay";

interface AdjustFormProps {
  troveId: string;
  troveData: BorrowPosition;
  debtToken: DebtTokenConfig;
  collateralSymbol: string;
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

function ToggleButtons({
  options,
  active,
  onChange,
}: {
  options: { value: string; label: string }[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="gap-0.5 p-0.5 flex rounded-lg bg-muted/50">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-xs font-semibold cursor-pointer rounded-md transition-colors ${
            active === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function AdjustForm({
  troveId,
  troveData,
  debtToken,
  collateralSymbol,
}: AdjustFormProps) {
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
      return `Wallet: ${formatCompactBalance(bal)}`;
    }
    return `Deposited: ${formatCollateralAmount(troveData.collateral, collateralSymbol)}`;
  }, [
    collDirection,
    collateralBalance,
    collateralSymbol,
    troveData.collateral,
  ]);

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
    if (insufficientCollBalance) {
      return `Insufficient ${collateralSymbol} balance`;
    }
    if (exceedsCurrentCollateral) return "Exceeds current collateral";
    if (belowMinDebt) return "Below minimum debt";
    if (adjustTrove.isPending) return "Adjusting position...";
    return null;
  }, [
    isConnected,
    hasChanges,
    insufficientCollBalance,
    collateralSymbol,
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
      troveStatus: troveData.status,
      wagmiConfig,
      account: address,
      successHref: "/borrow",
    });
  };

  return (
    <div className="space-y-6">
      {/* Collateral section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            Collateral
          </span>
          <ToggleButtons
            options={[
              { value: "add", label: "Add" },
              { value: "remove", label: "Remove" },
            ]}
            active={collDirection}
            onChange={(v) => setCollDirection(v as CollDirection)}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {collDirection === "add" ? "Add" : "Remove"} Collateral
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {collLimitLabel}
          </span>
        </div>

        <div className="gap-2 p-1 pl-4 flex items-center rounded-lg border border-border bg-muted/20 focus-within:border-primary">
          <CoinInput
            value={collInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCollInput(e.target.value)
            }
            placeholder="0.00"
            className={`p-0 text-xl font-semibold flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 ${
              insufficientCollBalance || exceedsCurrentCollateral
                ? "text-destructive"
                : ""
            }`}
          />
          <button
            type="button"
            className="px-2 py-1 font-bold font-mono tracking-wider cursor-pointer rounded-md bg-primary/10 text-[11px] text-primary transition-colors hover:bg-primary/20"
            onClick={handleMaxColl}
          >
            MAX
          </button>
          <div className="px-3 py-2 rounded-lg bg-muted/50">
            <span className="text-sm font-semibold">{collateralSymbol}</span>
          </div>
        </div>

        {insufficientCollBalance && (
          <p className="text-xs text-destructive">
            Insufficient {collateralSymbol} balance
          </p>
        )}
        {exceedsCurrentCollateral && (
          <p className="text-xs text-destructive">Exceeds current collateral</p>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Debt section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
            Debt
          </span>
          <ToggleButtons
            options={[
              { value: "borrow", label: "Borrow More" },
              { value: "repay", label: "Repay" },
            ]}
            active={debtDirection}
            onChange={(v) => setDebtDirection(v as DebtDirection)}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {debtDirection === "borrow" ? "Borrow More" : "Repay Debt"}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {debtDirection === "repay"
              ? `Current debt: ${formatDebtAmount(troveData.debt, debtToken)}`
              : `Available: ${PLACEHOLDER}`}
          </span>
        </div>

        <div className="gap-2 p-1 pl-4 flex items-center rounded-lg border border-border bg-muted/20 focus-within:border-primary">
          <CoinInput
            value={debtInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setDebtInput(e.target.value)
            }
            placeholder="0.00"
            className="p-0 text-xl font-semibold flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {debtDirection === "repay" && (
            <button
              type="button"
              className="px-2 py-1 font-bold font-mono tracking-wider cursor-pointer rounded-md bg-primary/10 text-[11px] text-primary transition-colors hover:bg-primary/20"
              onClick={handleMaxDebt}
            >
              MAX
            </button>
          )}
          <div className="px-3 py-2 rounded-lg bg-muted/50">
            <span className="text-sm font-semibold">{debtToken.symbol}</span>
          </div>
        </div>

        {systemParams?.minDebt && (
          <p className="font-mono text-[11px] text-muted-foreground">
            Min. debt: {formatDebtAmount(systemParams.minDebt, debtToken)}
          </p>
        )}
        {belowMinDebt && (
          <p className="text-xs text-destructive">
            New debt would be below minimum
          </p>
        )}
      </div>

      {/* Before -> After comparison */}
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
                ? formatPrice(
                    currentLoanDetails.liquidationPrice,
                    debtToken,
                    collateralSymbol,
                  )
                : PLACEHOLDER
            }
            after={
              newLoanDetails
                ? formatPrice(
                    newLoanDetails.liquidationPrice,
                    debtToken,
                    collateralSymbol,
                  )
                : PLACEHOLDER
            }
          />
          <MetricRow
            label="Collateral"
            before={formatCollateralAmount(
              troveData.collateral,
              collateralSymbol,
            )}
            after={formatCollateralAmount(newCollateral, collateralSymbol)}
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
        size="lg"
        className="w-full"
        disabled={buttonDisabledReason !== null}
        onClick={handleSubmit}
      >
        {buttonDisabledReason ?? "Confirm Adjustment"}
      </Button>
    </div>
  );
}
