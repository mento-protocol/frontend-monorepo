"use client";

import { useEffect, useState } from "react";
import { Button, CoinInput, TokenIcon } from "@repo/ui";
import {
  useSpWithdraw,
  formatCompactBalance,
  tryParseUnits,
  type ChainId,
  type DebtTokenConfig,
} from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { formatUnits, type Address } from "viem";

interface WithdrawFormProps {
  deposit: bigint | null;
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
  debtToken: DebtTokenConfig;
  targetChainId: ChainId;
  disabled?: boolean;
}

export function WithdrawForm({
  deposit,
  collateralGain,
  debtTokenGain,
  debtToken,
  targetChainId,
  disabled = false,
}: WithdrawFormProps) {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const spWithdraw = useSpWithdraw();

  const [value, setValue] = useState("");
  const [hasCustomClaimPreference, setHasCustomClaimPreference] =
    useState(false);

  const hasRewards =
    (collateralGain != null && collateralGain > 0n) ||
    (debtTokenGain != null && debtTokenGain > 0n);
  const [doClaim, setDoClaim] = useState(hasRewards);

  useEffect(() => {
    if (!hasCustomClaimPreference) {
      setDoClaim(hasRewards);
    }
  }, [hasCustomClaimPreference, hasRewards]);

  const tokenAddress = getTokenAddress(
    targetChainId,
    debtToken.symbol as TokenSymbol,
  ) as Address | undefined;

  const formattedDeposit = deposit ? formatUnits(deposit, 18) : "0";

  const parsedAmount = tryParseUnits(value, 18);
  const exceedsDeposit =
    parsedAmount !== null && deposit !== null && parsedAmount > deposit;

  const canSubmit =
    isConnected &&
    value !== "" &&
    parsedAmount !== null &&
    parsedAmount > 0n &&
    !disabled &&
    !exceedsDeposit &&
    !spWithdraw.isPending;

  const handleMax = () => {
    if (disabled) return;
    setValue(formattedDeposit);
  };

  const handleSubmit = () => {
    if (!canSubmit || !address || parsedAmount === null) return;
    spWithdraw.mutate({
      symbol: debtToken.symbol,
      amount: parsedAmount,
      doClaim,
      wagmiConfig,
      account: address,
    });
  };

  const getButtonText = () => {
    if (spWithdraw.isPending) return "Withdrawing...";
    if (disabled) return "Switch network to withdraw";
    if (!value || parsedAmount === null || parsedAmount === 0n)
      return "Enter amount to withdraw";
    if (exceedsDeposit) return "Amount exceeds your deposit";
    return "Withdraw";
  };

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-2 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Amount</span>
          <div className="text-sm text-muted-foreground">
            Deposited:{" "}
            <span className="font-medium font-mono text-foreground/80">
              {formatCompactBalance(formattedDeposit)}
            </span>{" "}
            {debtToken.symbol}
          </div>
        </div>
        <div
          className={`gap-2 shadow-xs px-3 h-10 flex items-center rounded-md border bg-background focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/50 ${exceedsDeposit ? "border-destructive" : "border-input"}`}
        >
          <CoinInput
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setValue(e.target.value)
            }
            disabled={disabled}
            placeholder="0.00"
            className="p-0 text-sm font-mono placeholder:text-sm h-auto flex-1 border-0 shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <div className="gap-1.5 flex shrink-0 items-center">
            {tokenAddress && (
              <TokenIcon
                token={{
                  address: tokenAddress,
                  symbol: debtToken.symbol,
                }}
                size={20}
                className="rounded-full"
              />
            )}
            <span className="text-sm font-medium">{debtToken.symbol}</span>
          </div>
        </div>
        {exceedsDeposit && (
          <p className="text-xs text-destructive">
            Amount exceeds your deposit
          </p>
        )}
        <div className="gap-2 flex">
          {[25, 50, 75].map((pct) => (
            <button
              key={pct}
              type="button"
              disabled={disabled}
              className="py-1.5 text-xs font-medium flex-1 rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground/70"
              onClick={() => {
                if (!deposit) return;
                const scaled = (deposit * BigInt(pct)) / 100n;
                setValue(formatUnits(scaled, 18));
              }}
            >
              {pct}%
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            className="py-1.5 text-xs font-medium flex-1 rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground/70"
            onClick={handleMax}
          >
            MAX
          </button>
        </div>
      </div>

      {hasRewards && (
        <label className="gap-2 text-sm flex items-center">
          <input
            type="checkbox"
            checked={doClaim}
            disabled={disabled}
            onChange={(e) => {
              setHasCustomClaimPreference(true);
              setDoClaim(e.target.checked);
            }}
            className="accent-primary"
          />
          Claim rewards with withdrawal
        </label>
      )}

      <Button
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {getButtonText()}
      </Button>
    </div>
  );
}
