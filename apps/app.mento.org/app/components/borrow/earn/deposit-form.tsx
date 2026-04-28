"use client";

import { useEffect, useState } from "react";
import { Button, CoinInput, TokenIcon } from "@repo/ui";
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import { getStabilitySwapRoute } from "@/lib/stability-route";
import {
  useSpDeposit,
  formatCompactBalance,
  tryParseUnits,
  type ChainId,
  type DebtTokenConfig,
} from "@repo/web3";
import { useAccount, useReadContract, useConfig } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { erc20Abi, formatUnits, type Address } from "viem";

interface DepositFormProps {
  deposit: bigint | null;
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
  debtToken: DebtTokenConfig;
  targetChainId: ChainId;
  disabled?: boolean;
}

export function DepositForm({
  deposit,
  collateralGain,
  debtTokenGain,
  debtToken,
  targetChainId,
  disabled = false,
}: DepositFormProps) {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const spDeposit = useSpDeposit();

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

  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    chainId: targetChainId,
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const formattedBalance = balance ? formatUnits(balance, 18) : "0";
  const hasPosition = (deposit ?? 0n) > 0n || hasRewards;
  const showSwapCta = isConnected && !hasPosition && balance === 0n;

  const parsedAmount = tryParseUnits(value, 18);
  const insufficient =
    parsedAmount !== null && balance !== undefined && parsedAmount > balance;

  const canSubmit =
    isConnected &&
    value !== "" &&
    parsedAmount !== null &&
    parsedAmount > 0n &&
    !disabled &&
    !insufficient &&
    !spDeposit.isPending;

  const handleMax = () => {
    if (disabled) return;
    setValue(formattedBalance);
  };

  const handleSubmit = () => {
    if (!canSubmit || !address || parsedAmount === null) return;
    spDeposit.mutate({
      symbol: debtToken.symbol,
      amount: parsedAmount,
      doClaim,
      wagmiConfig,
      account: address,
    });
  };

  const getButtonText = () => {
    if (spDeposit.isPending) return "Depositing...";
    if (disabled) return "Switch network to deposit";
    if (!value || parsedAmount === null || parsedAmount === 0n)
      return "Enter amount to deposit";
    if (insufficient) return `Insufficient ${debtToken.symbol} balance`;
    return "Deposit";
  };

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-2 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Amount</span>
          <div className="text-sm text-muted-foreground">
            Balance:{" "}
            <span className="font-medium font-mono text-foreground/80">
              {formatCompactBalance(formattedBalance)}
            </span>{" "}
            {debtToken.symbol}
          </div>
        </div>
        <div
          className={`gap-2 shadow-xs px-3 h-10 flex items-center rounded-md border bg-background focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/50 ${insufficient ? "border-destructive" : "border-input"}`}
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
        {insufficient && (
          <p className="text-xs text-destructive">
            Insufficient {debtToken.symbol} balance
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
                if (!balance) return;
                const scaled = (balance * BigInt(pct)) / 100n;
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
          Claim rewards with deposit
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

      {showSwapCta && (
        <Button variant="outline" size="lg" className="w-full" asChild>
          <Link href={getStabilitySwapRoute(debtToken.symbol, targetChainId)}>
            <ArrowRightLeft className="h-4 w-4" />
            Swap USDm for {debtToken.symbol}
          </Link>
        </Button>
      )}
    </div>
  );
}
