"use client";

import { useMemo } from "react";
import { Button } from "@repo/ui";
import {
  useCloseTrove,
  selectedDebtTokenAtom,
  formatCollateralAmount,
  formatDebtTokenAmount,
  type BorrowPosition,
} from "@repo/web3";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
} from "@repo/web3/wagmi";
import { useAtomValue } from "jotai";
import { erc20Abi, type Address } from "viem";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";

interface CloseFormProps {
  troveId: string;
  troveData: BorrowPosition;
}

export function CloseForm({ troveId, troveData }: CloseFormProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const wagmiConfig = useConfig();
  const closeTrove = useCloseTrove();
  const isZombieTrove = troveData.status === "zombie";
  const canCloseZombieWithoutDebt = isZombieTrove && troveData.debt === 0n;

  // Total debt to repay (debt includes accrued interest from SDK)
  const totalDebt = troveData.debt;
  const collateralToReceive = troveData.collateral;

  // Debt token wallet balance
  const debtTokenAddress = getTokenAddress(
    chainId,
    debtToken.symbol as TokenSymbol,
  ) as Address | undefined;

  const { data: debtTokenBalance } = useReadContract({
    address: debtTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!debtTokenAddress },
  });

  const insufficientBalance =
    debtTokenBalance !== undefined &&
    totalDebt > 0n &&
    debtTokenBalance < totalDebt;

  const buttonDisabledReason = useMemo(() => {
    if (!isConnected) return "Connect wallet";
    if (totalDebt === 0n) {
      return canCloseZombieWithoutDebt ? null : "No debt to repay";
    }
    if (insufficientBalance) return "Insufficient balance to repay";
    if (closeTrove.isPending) return "Closing position...";
    return null;
  }, [
    isConnected,
    totalDebt,
    canCloseZombieWithoutDebt,
    insufficientBalance,
    closeTrove.isPending,
  ]);

  const handleSubmit = () => {
    if (buttonDisabledReason || !address) return;

    closeTrove.mutate({
      symbol: debtToken.symbol,
      troveId,
      debt: totalDebt,
      wagmiConfig,
      account: address,
    });
  };

  return (
    <div className="space-y-6 pt-4">
      {/* Close summary */}
      <div className="p-4 space-y-3 rounded-md border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Debt to repay</span>
          <span className="text-sm font-medium">
            {formatDebtTokenAmount(totalDebt, debtToken)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Collateral to receive
          </span>
          <span className="text-sm font-medium">
            {formatCollateralAmount(collateralToReceive)}
          </span>
        </div>
      </div>

      {/* Confirmation message */}
      {canCloseZombieWithoutDebt ? (
        <p className="text-sm text-muted-foreground">
          This trove has no remaining {debtToken.symbol} debt. Closing it will
          return{" "}
          <span className="font-medium text-foreground">
            {formatCollateralAmount(collateralToReceive)}
          </span>
          .
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          You will repay{" "}
          <span className="font-medium text-foreground">
            {formatDebtTokenAmount(totalDebt, debtToken)}
          </span>{" "}
          and receive{" "}
          <span className="font-medium text-foreground">
            {formatCollateralAmount(collateralToReceive)}
          </span>
          .
        </p>
      )}

      {/* Insufficient balance warning */}
      {insufficientBalance && (
        <p className="text-sm text-destructive">
          Your {debtToken.symbol} balance is insufficient to repay the full
          debt. You need {formatDebtTokenAmount(totalDebt, debtToken)} but only
          have {formatDebtTokenAmount(debtTokenBalance ?? 0n, debtToken)}.
        </p>
      )}

      {/* Submit */}
      <Button
        variant="destructive"
        size="lg"
        className="w-full"
        disabled={buttonDisabledReason !== null}
        onClick={handleSubmit}
      >
        {buttonDisabledReason ?? "Close Trove"}
      </Button>
    </div>
  );
}
