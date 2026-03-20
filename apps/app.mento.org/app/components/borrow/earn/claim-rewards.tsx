"use client";

import { useAtomValue } from "jotai";
import { Button } from "@repo/ui";
import { selectedDebtTokenAtom, useSpClaimRewards } from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";

interface ClaimRewardsProps {
  hasActiveDeposit: boolean;
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
}

export function ClaimRewards({
  hasActiveDeposit,
  collateralGain,
  debtTokenGain,
}: ClaimRewardsProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const spClaimRewards = useSpClaimRewards();

  const hasRewards =
    (collateralGain != null && collateralGain > 0n) ||
    (debtTokenGain != null && debtTokenGain > 0n);

  if (!hasRewards) return null;

  const canClaim = isConnected && !spClaimRewards.isPending;

  const handleClaim = () => {
    if (!canClaim || !address) return;
    spClaimRewards.mutate({
      symbol: debtToken.symbol,
      hasDeposit: hasActiveDeposit,
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
      {spClaimRewards.isPending ? "Claiming..." : "Claim rewards"}
    </Button>
  );
}
