"use client";

import { CoinInput } from "@repo/ui";
import {
  useDebtSuggestions,
  useSystemParams,
  formatDebtAmount,
  selectedDebtTokenAtom,
} from "@repo/web3";
import { useAtomValue } from "jotai";
import { formatUnits } from "viem";
import type { RiskLevel } from "@repo/web3";

interface DebtInputProps {
  value: string;
  onChange: (value: string) => void;
  collAmount: bigint;
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Safe",
  medium: "Moderate",
  high: "Risky",
};

export function DebtInput({ value, onChange, collAmount }: DebtInputProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { data: systemParams } = useSystemParams(debtToken.symbol);
  const suggestions = useDebtSuggestions(
    collAmount > 0n ? collAmount : null,
    debtToken.symbol,
  );

  const minDebtFormatted = systemParams?.minDebt
    ? formatDebtAmount(systemParams.minDebt, debtToken)
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Borrow</span>
          <span className="text-sm text-muted-foreground">
            {debtToken.symbol}
          </span>
        </div>
      </div>
      <CoinInput
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
        placeholder="0"
        className="shadow-xs h-10 px-3 text-sm placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {minDebtFormatted && (
        <p className="text-xs text-muted-foreground">
          Min: {minDebtFormatted}
        </p>
      )}
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.risk}
              type="button"
              className="cursor-pointer rounded-full border border-input bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => onChange(formatUnits(s.amount, 18))}
            >
              {formatDebtAmount(s.amount, debtToken)} ({RISK_LABEL[s.risk]})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
