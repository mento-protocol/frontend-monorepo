"use client";

import { useState, useMemo } from "react";
import { Button, Slider } from "@repo/ui";
import {
  useAdjustInterestRate,
  usePredictUpfrontFee,
  useRedemptionRisk,
  useSystemParams,
  selectedDebtTokenAtom,
  formatDebtAmount,
  formatInterestRate,
  type BorrowPosition,
} from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";
import { useAtomValue } from "jotai";
import { parseUnits } from "viem";
import { RiskBadge } from "../shared/risk-badge";

interface RateFormProps {
  troveId: string;
  troveData: BorrowPosition;
}

const MAX_RATE_PCT = 250;
const SLIDER_STEP = 0.5;
const PLACEHOLDER = "\u2014";

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

function bigintRateToNumber(rate: bigint): number {
  return Number(rate) / 1e16;
}

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

export function RateForm({ troveId, troveData }: RateFormProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();

  const currentRatePct = bigintRateToNumber(troveData.annualInterestRate);
  const [rateInput, setRateInput] = useState(currentRatePct.toFixed(1));

  const { data: systemParams } = useSystemParams(debtToken.symbol);
  const adjustInterestRate = useAdjustInterestRate();

  const minRatePct = systemParams?.minAnnualInterestRate
    ? bigintRateToNumber(systemParams.minAnnualInterestRate)
    : 0.5;

  const newRateBigint = parseRateToBigint(rateInput);
  const redemptionRisk = useRedemptionRisk(newRateBigint, debtToken.symbol);

  const sliderValue = rateInput ? Number(rateInput) : currentRatePct;

  // Current annual cost
  const currentAnnualCost = useMemo(() => {
    if (troveData.debt === 0n) return null;
    return (troveData.debt * troveData.annualInterestRate) / 10n ** 18n;
  }, [troveData.debt, troveData.annualInterestRate]);

  // New annual cost
  const newAnnualCost = useMemo(() => {
    if (newRateBigint == null || troveData.debt === 0n) return null;
    return (troveData.debt * newRateBigint) / 10n ** 18n;
  }, [newRateBigint, troveData.debt]);

  // Fee estimate — rate changes may trigger upfront fee
  // usePredictUpfrontFee takes (borrowAmount, interestRate, symbol)
  // For rate changes, pass 0n as borrowAmount with the new rate
  const { data: upfrontFee } = usePredictUpfrontFee(
    0n,
    newRateBigint ?? 0n,
    debtToken.symbol,
  );

  const rateChanged =
    newRateBigint != null && newRateBigint !== troveData.annualInterestRate;

  const belowMinRate =
    newRateBigint != null &&
    systemParams?.minAnnualInterestRate != null &&
    newRateBigint < systemParams.minAnnualInterestRate;

  const buttonDisabledReason = useMemo(() => {
    if (!isConnected) return "Connect wallet";
    if (!rateInput || newRateBigint == null) return "Enter a rate";
    if (!rateChanged) return "Rate unchanged";
    if (belowMinRate) return "Below minimum rate";
    if (adjustInterestRate.isPending) return "Changing rate...";
    return null;
  }, [
    isConnected,
    rateInput,
    newRateBigint,
    rateChanged,
    belowMinRate,
    adjustInterestRate.isPending,
  ]);

  const handleSliderChange = (values: number[]) => {
    const pct = values[0];
    if (pct !== undefined) {
      setRateInput(pct.toFixed(1));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      setRateInput(raw);
    }
  };

  const handleSubmit = () => {
    if (buttonDisabledReason || !address || !newRateBigint) return;

    const maxUpfrontFee =
      upfrontFee != null && upfrontFee > 0n
        ? upfrontFee + upfrontFee / 20n // 5% buffer
        : troveData.debt / 100n; // 1% fallback

    adjustInterestRate.mutate({
      symbol: debtToken.symbol,
      troveId,
      newRate: newRateBigint,
      maxUpfrontFee,
      wagmiConfig,
      account: address,
    });
  };

  return (
    <div className="space-y-6 pt-4">
      {/* Current rate */}
      <div className="gap-1 flex flex-col">
        <span className="text-xs text-muted-foreground">Current Rate</span>
        <span className="text-2xl font-semibold">
          {formatInterestRate(troveData.annualInterestRate)}
        </span>
      </div>

      {/* New rate input */}
      <div className="gap-3 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">New Interest Rate</span>
          <RiskBadge risk={redemptionRisk} />
        </div>

        <div className="gap-3 flex items-center">
          <Slider
            min={minRatePct}
            max={MAX_RATE_PCT}
            step={SLIDER_STEP}
            value={[Math.min(Math.max(sliderValue, minRatePct), MAX_RATE_PCT)]}
            onValueChange={handleSliderChange}
            className="flex-1"
          />
          <div className="gap-1 flex items-center">
            <input
              type="text"
              inputMode="decimal"
              value={rateInput}
              onChange={handleInputChange}
              placeholder={currentRatePct.toFixed(1)}
              className="h-8 w-16 px-2 text-sm shadow-xs rounded-md border border-input bg-background text-right focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Min: {formatInterestRate(systemParams?.minAnnualInterestRate ?? null)}
        </div>
      </div>

      {/* Before → After comparison */}
      {rateChanged && (
        <div className="p-3 flex flex-col divide-y rounded-md border">
          <MetricRow
            label="Interest Rate"
            before={formatInterestRate(troveData.annualInterestRate)}
            after={formatInterestRate(newRateBigint)}
          />
          <MetricRow
            label="Annual Cost"
            before={
              currentAnnualCost != null
                ? formatDebtAmount(currentAnnualCost, debtToken)
                : PLACEHOLDER
            }
            after={
              newAnnualCost != null
                ? formatDebtAmount(newAnnualCost, debtToken)
                : PLACEHOLDER
            }
          />
          {upfrontFee != null && upfrontFee > 0n && (
            <MetricRow
              label="One-time Fee"
              before={PLACEHOLDER}
              after={formatDebtAmount(upfrontFee, debtToken)}
            />
          )}
        </div>
      )}

      {belowMinRate && (
        <p className="text-xs text-destructive">
          Rate is below the minimum of{" "}
          {formatInterestRate(systemParams?.minAnnualInterestRate ?? null)}
        </p>
      )}

      {/* Submit */}
      <Button
        size="lg"
        className="w-full"
        disabled={buttonDisabledReason !== null}
        onClick={handleSubmit}
      >
        {buttonDisabledReason ?? "Change Rate"}
      </Button>
    </div>
  );
}
