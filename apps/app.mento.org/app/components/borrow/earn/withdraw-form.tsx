"use client";

import { useState } from "react";
import { useAtomValue } from "jotai";
import { Button, CoinInput } from "@repo/ui";
import {
  selectedDebtTokenAtom,
  useSpWithdraw,
  formatDebtAmount,
  formatCollateralAmount,
  formatCompactBalance,
  tryParseUnits,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { useConfig } from "wagmi";
import { formatUnits } from "viem";

interface WithdrawFormProps {
  deposit: bigint | null;
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
}

export function WithdrawForm({
  deposit,
  collateralGain,
  debtTokenGain,
}: WithdrawFormProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const spWithdraw = useSpWithdraw();

  const [value, setValue] = useState("");

  const hasRewards =
    (collateralGain != null && collateralGain > 0n) ||
    (debtTokenGain != null && debtTokenGain > 0n);
  const [doClaim, setDoClaim] = useState(hasRewards);

  const formattedDeposit = deposit ? formatUnits(deposit, 18) : "0";

  const parsedAmount = tryParseUnits(value, 18);
  const exceedsDeposit =
    parsedAmount !== null && deposit !== null && parsedAmount > deposit;

  const canSubmit =
    isConnected &&
    value !== "" &&
    parsedAmount !== null &&
    parsedAmount > 0n &&
    !exceedsDeposit &&
    !spWithdraw.isPending;

  const handleMax = () => {
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

  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-2 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Amount</span>
          <div className="text-sm text-muted-foreground">
            Deposited: {formatCompactBalance(formattedDeposit)}{" "}
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
          className={`shadow-xs h-10 px-3 text-sm placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${exceedsDeposit ? "border-destructive" : ""}`}
        />
        {exceedsDeposit && (
          <p className="text-xs text-destructive">
            Amount exceeds your deposit
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
            Claim rewards with withdrawal
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
        {spWithdraw.isPending ? "Withdrawing..." : "Withdraw"}
      </Button>
    </div>
  );
}
