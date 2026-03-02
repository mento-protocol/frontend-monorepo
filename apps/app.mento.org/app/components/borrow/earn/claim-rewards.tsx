"use client";

import { useAtomValue } from "jotai";
import { Button } from "@repo/ui";
import {
  selectedDebtTokenAtom,
  useSpWithdraw,
  formatDebtAmount,
  formatCollateralAmount,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { useConfig } from "wagmi";

interface ClaimRewardsProps {
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
}

export function ClaimRewards({
  collateralGain,
  debtTokenGain,
}: ClaimRewardsProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const spWithdraw = useSpWithdraw();

  const hasRewards =
    (collateralGain != null && collateralGain > 0n) ||
    (debtTokenGain != null && debtTokenGain > 0n);

  if (!hasRewards) return null;

  const canClaim = isConnected && !spWithdraw.isPending;

  const handleClaim = () => {
    if (!canClaim || !address) return;
    spWithdraw.mutate({
      symbol: debtToken.symbol,
      amount: 0n,
      doClaim: true,
      wagmiConfig,
      account: address,
    });
  };

  return (
    <div className="gap-3 mt-4 pt-4 flex flex-col border-t border-border">
      <span className="text-sm font-medium">Pending Rewards</span>
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
      <Button disabled={!canClaim} onClick={handleClaim}>
        {spWithdraw.isPending ? "Claiming..." : "Claim Rewards"}
      </Button>
    </div>
  );
}
