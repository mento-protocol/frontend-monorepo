"use client";

import { CoinInput, TokenIcon } from "@repo/ui";
import {
  useDebtSuggestions,
  useSystemParams,
  formatDebtAmount,
  selectedDebtTokenAtom,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { useAtomValue } from "jotai";
import { formatUnits, type Address } from "viem";
import type { RiskLevel } from "@repo/web3";

function trimDecimals(value: string, dp: number): string {
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) return value;
  return value.slice(0, dotIndex + dp + 1).replace(/\.?0+$/, "");
}

interface DebtInputProps {
  value: string;
  onChange: (value: string) => void;
  collAmount: bigint;
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Safe",
  medium: "Moderate",
  high: "Aggressive",
};

const RISK_STYLE: Record<RiskLevel, { active: string; inactive: string }> = {
  low: {
    active: "border-green-400/40 bg-green-400/10 text-green-400",
    inactive: "border-border text-muted-foreground/50",
  },
  medium: {
    active: "border-amber-400/40 bg-amber-400/10 text-amber-400",
    inactive: "border-border text-muted-foreground/50",
  },
  high: {
    active: "border-orange-400/40 bg-orange-400/10 text-orange-400",
    inactive: "border-border text-muted-foreground/50",
  },
};

function formatCompactDebt(amount: bigint): string {
  const num = Number(amount) / 1e18;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return num.toFixed(0);
}

export function DebtInput({ value, onChange, collAmount }: DebtInputProps) {
  const chainId = useChainId();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { data: systemParams } = useSystemParams(debtToken.symbol);

  const debtTokenAddress = (() => {
    try {
      return getTokenAddress(
        chainId,
        debtToken.symbol as TokenSymbol,
      ) as Address;
    } catch {
      return undefined;
    }
  })();
  const suggestions = useDebtSuggestions(
    collAmount > 0n ? collAmount : null,
    debtToken.symbol,
  );

  const minDebtFormatted = systemParams?.minDebt
    ? formatDebtAmount(systemParams.minDebt, debtToken)
    : null;

  const parsedValue = value ? Number(value) : 0;

  return (
    <div className="gap-2 flex flex-col">
      <div className="flex items-center justify-between">
        <span className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
          Borrow
        </span>
        {minDebtFormatted && (
          <span className="font-mono text-[11px] text-muted-foreground/50">
            Min: {minDebtFormatted}
          </span>
        )}
      </div>
      <div className="gap-2 p-1 pl-4 flex items-center border border-border bg-muted/20 focus-within:border-primary">
        <CoinInput
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
          placeholder="0.00"
          className="p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="gap-1.5 px-3 py-2 flex items-center bg-muted/50">
          {debtTokenAddress ? (
            <TokenIcon
              token={{ address: debtTokenAddress, symbol: debtToken.symbol }}
              size={20}
              className="shrink-0 rounded-full"
            />
          ) : (
            <div className="h-5 w-5 font-bold from-indigo-500 to-purple-600 flex shrink-0 items-center justify-center rounded-full bg-linear-to-br text-[7px] leading-none">
              {debtToken.symbol}
            </div>
          )}
          <span className="text-sm font-semibold text-muted-foreground/70">
            {debtToken.symbol}
          </span>
        </div>
      </div>

      {/* Borrow presets */}
      {suggestions && suggestions.length > 0 && (
        <div className="gap-1.5 flex">
          {suggestions.map((s) => {
            const sNum = Number(s.amount) / 1e18;
            const isActive =
              parsedValue > 0 && Math.abs(parsedValue - sNum) < 1;
            const style = RISK_STYLE[s.risk];
            return (
              <button
                key={s.risk}
                type="button"
                className={`gap-0.5 py-2 font-mono font-semibold flex flex-1 cursor-pointer flex-col items-center border text-[11px] transition-colors ${
                  isActive ? style.active : style.inactive
                }`}
                onClick={() =>
                  onChange(trimDecimals(formatUnits(s.amount, 18), 4))
                }
              >
                <span>{RISK_LABEL[s.risk]}</span>
                <span className="text-[10px] opacity-70">
                  {formatCompactDebt(s.amount)} {debtToken.symbol}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
