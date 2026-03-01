"use client";

import { useState } from "react";
import { useAtomValue } from "jotai";
import { Button, CoinInput } from "@repo/ui";
import {
  selectedDebtTokenAtom,
  useSpDeposit,
  formatDebtAmount,
  formatCollateralAmount,
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
  deposit,
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

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-2 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Amount</span>
          <div className="text-sm text-muted-foreground">
            Balance: {formatCompactBalance(formattedBalance)}{" "}
            <button
              type="button"
              className="font-medium cursor-pointer text-primary hover:underline"
              onClick={handleMax}
            >
              MAX
            </button>
          </div>
        </div>
        <CoinInput
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setValue(e.target.value)
          }
          placeholder="0"
          className={`shadow-xs h-10 px-3 text-sm placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${insufficient ? "border-destructive" : ""}`}
        />
        {insufficient && (
          <p className="text-xs text-destructive">
            Insufficient {debtToken.symbol} balance
          </p>
        )}
      </div>

      {hasRewards && (
        <div className="gap-2 flex flex-col">
          <label className="gap-2 text-sm flex items-center">
            <input
              type="checkbox"
              checked={doClaim}
              onChange={(e) => setDoClaim(e.target.checked)}
              className="accent-primary"
            />
            Claim rewards with deposit
          </label>
          {doClaim && (
            <div className="gap-2 rounded p-3 text-xs flex flex-col border border-border bg-muted/50">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Collateral Gain</span>
                <span>{formatCollateralAmount(collateralGain)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {debtToken.symbol} Yield
                </span>
                <span>{formatDebtAmount(debtTokenGain, debtToken)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <Button disabled={!canSubmit} onClick={handleSubmit}>
        {spDeposit.isPending ? "Depositing..." : "Deposit"}
      </Button>
    </div>
  );
}
