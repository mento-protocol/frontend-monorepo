"use client";

import { Slider } from "@repo/ui";
import {
  type DebtTokenConfig,
  useSystemParams,
  formatDebtAmount,
} from "@repo/web3";
import { parseUnits } from "viem";
import { useMemo } from "react";

interface InterestRateInputProps {
  debtToken: DebtTokenConfig;
  value: string;
  onChange: (value: string) => void;
  debtAmount: bigint;
  maxRatePct: number;
}

const SLIDER_STEP = 0.5;

const RATE_PRESETS = [
  { rate: "1.0", label: "1.0%" },
  { rate: "3.5", label: "3.5%" },
  { rate: "6.3", label: "6.3%" },
  { rate: "10.0", label: "10.0%" },
];

function parseRateToBigint(pctString: string): bigint | null {
  const num = Number(pctString);
  if (isNaN(num) || num < 0) return null;
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

export function InterestRateInput({
  debtToken,
  value,
  onChange,
  debtAmount,
  maxRatePct,
}: InterestRateInputProps) {
  const { data: systemParams } = useSystemParams(debtToken.symbol);

  const rateBigint = parseRateToBigint(value);

  const minRatePct = systemParams?.minAnnualInterestRate
    ? bigintRateToNumber(systemParams.minAnnualInterestRate)
    : 0.5;

  const sliderValue = value ? Number(value) : minRatePct;

  const annualCost = useMemo(() => {
    if (rateBigint == null || debtAmount === 0n) return null;
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
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      onChange(raw);
    }
  };

  return (
    <div className="gap-4 flex flex-col">
      <div className="flex items-center justify-between">
        <span className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
          Annual Interest Rate
        </span>
        {annualCost !== null && (
          <span className="font-mono text-[11px] text-muted-foreground/50">
            Annual cost: {formatDebtAmount(annualCost, debtToken)}
          </span>
        )}
      </div>

      <div className="gap-4 flex items-center">
        <Slider
          min={minRatePct}
          max={maxRatePct}
          step={SLIDER_STEP}
          value={[Math.min(Math.max(sliderValue, minRatePct), maxRatePct)]}
          onValueChange={handleSliderChange}
          className="flex-1"
        />
        <div className="gap-1 px-3 py-1.5 flex items-center border border-border bg-muted/20">
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={handleInputChange}
            placeholder={minRatePct.toFixed(1)}
            className="w-9 font-mono text-base font-semibold bg-transparent text-right outline-none"
          />
          <span className="text-sm text-muted-foreground/50">%</span>
        </div>
      </div>

      <div className="gap-1.5 flex">
        {RATE_PRESETS.map((p) => {
          const isActive = value === p.rate;
          return (
            <button
              key={p.rate}
              type="button"
              className={`py-1.5 font-mono text-xs font-medium flex-1 cursor-pointer border transition-colors ${
                isActive
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground/50 hover:text-muted-foreground"
              }`}
              onClick={() => onChange(p.rate)}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
