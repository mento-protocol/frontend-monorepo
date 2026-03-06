"use client";

import { useState } from "react";
import { useAtomValue } from "jotai";
import { Button, CoinInput, TokenIcon } from "@repo/ui";
import {
  selectedDebtTokenAtom,
  useSpDeposit,
  formatCompactBalance,
  tryParseUnits,
} from "@repo/web3";
import { useAccount, useReadContract, useChainId } from "@repo/web3/wagmi";
import { useConfig } from "wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { erc20Abi, formatUnits, type Address } from "viem";

interface DepositFormProps {
  deposit: bigint | null;
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
}

export function DepositForm({
  collateralGain,
  debtTokenGain,
}: DepositFormProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wagmiConfig = useConfig();
  const spDeposit = useSpDeposit();

  const [value, setValue] = useState("");

  const hasRewards =
    (collateralGain != null && collateralGain > 0n) ||
    (debtTokenGain != null && debtTokenGain > 0n);
  const [doClaim, setDoClaim] = useState(hasRewards);

  const tokenAddress = getTokenAddress(
    chainId,
    debtToken.symbol as TokenSymbol,
  ) as Address | undefined;

  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const formattedBalance = balance ? formatUnits(balance, 18) : "0";

  const parsedAmount = tryParseUnits(value, 18);
  const insufficient =
    parsedAmount !== null && balance !== undefined && parsedAmount > balance;

  const canSubmit =
    isConnected &&
    value !== "" &&
    parsedAmount !== null &&
    parsedAmount > 0n &&
    !insufficient &&
    !spDeposit.isPending;

  const handleMax = () => {
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
            {debtToken.symbol}{" "}
            <button
              type="button"
              className="font-medium cursor-pointer text-primary hover:underline"
              onClick={handleMax}
            >
              MAX
            </button>
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
      </div>

      {hasRewards && (
        <label className="gap-2 text-sm flex items-center">
          <input
            type="checkbox"
            checked={doClaim}
            onChange={(e) => setDoClaim(e.target.checked)}
            className="accent-primary"
          />
          Claim rewards with deposit
        </label>
      )}

      <Button disabled={!canSubmit} onClick={handleSubmit}>
        {getButtonText()}
      </Button>
    </div>
  );
}
