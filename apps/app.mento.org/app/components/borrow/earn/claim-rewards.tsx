"use client";

import { Button } from "@repo/ui";
import { useSpClaimRewards, type DebtTokenConfig } from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";

interface ClaimRewardsProps {
  debtToken: DebtTokenConfig;
  hasActiveDeposit: boolean;
  collateralGain: bigint | null;
  debtTokenGain: bigint | null;
  disabled?: boolean;
}

export function ClaimRewards({
  debtToken,
  hasActiveDeposit,
  collateralGain,
  debtTokenGain,
  disabled = false,
}: ClaimRewardsProps) {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const spClaimRewards = useSpClaimRewards();

  const hasRewards =
    (collateralGain != null && collateralGain > 0n) ||
    (debtTokenGain != null && debtTokenGain > 0n);

  if (!hasRewards) return null;

  const canClaim = isConnected && !disabled && !spClaimRewards.isPending;

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
      {spClaimRewards.isPending
        ? "Claiming..."
        : disabled
          ? "Switch network to claim rewards"
          : "Claim rewards"}
    </Button>
  );
}
