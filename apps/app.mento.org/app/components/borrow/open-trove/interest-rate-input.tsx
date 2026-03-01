"use client";

import { Slider } from "@repo/ui";
import {
  useSystemParams,
  useRedemptionRisk,
  formatDebtAmount,
  formatInterestRate,
  selectedDebtTokenAtom,
} from "@repo/web3";
import { useAtomValue } from "jotai";
import { parseUnits } from "viem";
import { useMemo } from "react";
import { RiskBadge } from "../shared/risk-badge";

interface InterestRateInputProps {
  value: string;
  onChange: (value: string) => void;
  debtAmount: bigint;
}

const MAX_RATE_PCT = 15;
const SLIDER_STEP = 0.1;

function parseRateToBigint(pctString: string): bigint | null {
  const num = Number(pctString);
  if (isNaN(num) || num < 0) return null;
  // Convert percentage to 18-decimal fraction: 5% → 0.05 → 5n * 10n**16n
  // Use parseUnits on the decimal form
  const decimalStr = (num / 100).toFixed(18);
  try {
    return parseUnits(decimalStr, 18);
  } catch {
    return null;
  }
}

function bigintRateToNumber(rate: bigint): number {
  // 18-decimal fraction → percentage: 5 * 10^16 → 5.0
  return Number(rate) / 1e16;
}

export function InterestRateInput({
  value,
  onChange,
  debtAmount,
}: InterestRateInputProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { data: systemParams } = useSystemParams(debtToken.symbol);

  const rateBigint = parseRateToBigint(value);
  const redemptionRisk = useRedemptionRisk(rateBigint, debtToken.symbol);

  const minRatePct = systemParams?.minAnnualInterestRate
    ? bigintRateToNumber(systemParams.minAnnualInterestRate)
    : 0.5;

  const sliderValue = value ? Number(value) : minRatePct;

  const annualCost = useMemo(() => {
    if (rateBigint == null || debtAmount === 0n) return null;
    // annualCost = debtAmount * rate (both 18-decimal) / 10^18
    return (debtAmount * rateBigint) / 10n ** 18n;
  }, [rateBigint, debtAmount]);

  const handleSliderChange = (values: number[]) => {
    const pct = values[0];
    if (pct !== undefined) {
      onChange(pct.toFixed(1));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow empty, or valid numeric strings
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      onChange(raw);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Annual Interest Rate</span>
        <RiskBadge risk={redemptionRisk} />
      </div>

      <div className="flex items-center gap-3">
        <Slider
          min={minRatePct}
          max={MAX_RATE_PCT}
          step={SLIDER_STEP}
          value={[Math.min(Math.max(sliderValue, minRatePct), MAX_RATE_PCT)]}
          onValueChange={handleSliderChange}
          className="flex-1"
        />
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={handleInputChange}
            placeholder={minRatePct.toFixed(1)}
            className="h-8 w-16 rounded-md border border-input bg-background px-2 text-right text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Min: {formatInterestRate(systemParams?.minAnnualInterestRate ?? null)}
        </span>
        {annualCost !== null && (
          <span>
            Annual cost: {formatDebtAmount(annualCost, debtToken)}
          </span>
        )}
      </div>
    </div>
  );
}
