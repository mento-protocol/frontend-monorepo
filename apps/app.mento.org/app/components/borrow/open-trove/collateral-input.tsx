"use client";

import { CoinInput, TokenIcon } from "@repo/ui";
import {
  formatCompactBalance,
  tryParseUnits,
  useCollateralPrice,
  selectedDebtTokenAtom,
} from "@repo/web3";
import { useAccount, useReadContract, useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAtomValue } from "jotai";
import { useMemo } from "react";

function trimDecimals(value: string, dp: number): string {
  const dotIndex = value.indexOf(".");
  if (dotIndex === -1) return value;
  return value.slice(0, dotIndex + dp + 1).replace(/\.?0+$/, "");
}

interface CollateralInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function CollateralInput({ value, onChange }: CollateralInputProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const debtToken = useAtomValue(selectedDebtTokenAtom);

  const collateralAddress = getTokenAddress(chainId, "USDm" as TokenSymbol) as
    | Address
    | undefined;

  const { data: balance } = useReadContract({
    address: collateralAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!collateralAddress },
  });

  const { data: collPrice } = useCollateralPrice(debtToken.symbol);

  const formattedBalance = balance ? formatUnits(balance, 18) : "0";

  const parsedAmount = tryParseUnits(value, 18);
  const insufficient =
    parsedAmount !== null && balance !== undefined && parsedAmount > balance;

  const debtCurrencyValue = useMemo(() => {
    if (!parsedAmount || parsedAmount === 0n || !collPrice) return null;
    const valueInDebt = (parsedAmount * collPrice) / 10n ** 18n;
    const num = Number(valueInDebt) / 1e18;
    return new Intl.NumberFormat(debtToken.locale, {
      style: "currency",
      currency: debtToken.currencyCode,
      maximumFractionDigits: 2,
    }).format(num);
  }, [parsedAmount, collPrice, debtToken]);

  const handleMax = () => {
    onChange(trimDecimals(formattedBalance, 4));
  };

  return (
    <div className="gap-2 flex flex-col">
      <div className="flex items-center justify-between">
        <span className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
          Collateral
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          Balance:{" "}
          <span className="text-muted-foreground/70">
            {formatCompactBalance(formattedBalance)}
          </span>{" "}
          USDm
        </span>
      </div>
      <div
        className={`gap-2 p-1 pl-4 flex items-center border bg-muted/20 focus-within:border-primary ${
          insufficient ? "border-destructive" : "border-border"
        }`}
      >
        <CoinInput
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(e.target.value)
          }
          placeholder="0.00"
          className="p-0 text-sm font-mono flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <button
          type="button"
          className="px-2 py-1 font-mono font-bold tracking-wider cursor-pointer bg-primary/10 text-[11px] text-primary transition-colors hover:bg-primary/20"
          onClick={handleMax}
        >
          MAX
        </button>
        <div className="gap-1.5 px-3 py-2 flex items-center bg-muted/50">
          {collateralAddress ? (
            <TokenIcon
              token={{ address: collateralAddress, symbol: "USDm" }}
              size={20}
              className="shrink-0 rounded-full"
            />
          ) : (
            <div className="h-5 w-5 font-bold from-emerald-500 to-emerald-700 flex shrink-0 items-center justify-center rounded-full bg-linear-to-br text-[9px]">
              $
            </div>
          )}
          <span className="text-sm font-semibold text-muted-foreground/70">
            USDm
          </span>
        </div>
      </div>
      {debtCurrencyValue && (
        <p className="pl-0.5 font-mono text-[11px] text-muted-foreground/40">
          ≈ {debtCurrencyValue}
        </p>
      )}
      {insufficient && (
        <p className="text-xs text-destructive">Insufficient USDm balance</p>
      )}
    </div>
  );
}
