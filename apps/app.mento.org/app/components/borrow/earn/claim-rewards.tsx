"use client";

import { useAtomValue } from "jotai";
import { Button } from "@repo/ui";
import { selectedDebtTokenAtom, useSpWithdraw } from "@repo/web3";
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
    <Button
      variant="outline"
      size="lg"
      className="w-full"
      disabled={!canClaim}
      onClick={handleClaim}
    >
      {spWithdraw.isPending ? "Claiming..." : "Claim rewards"}
    </Button>
  );
}
