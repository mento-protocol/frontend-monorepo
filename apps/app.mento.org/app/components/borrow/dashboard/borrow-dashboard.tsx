"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@repo/ui";
import {
  useUserTroves,
  useStabilityPool,
  useSurplusCollateral,
  useClaimCollateral,
  selectedDebtTokenAtom,
  formatCollateralAmount,
} from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";
import { PositionCard } from "./position-card";
import { StabilityCard } from "./stability-card";
import { borrowViewAtom } from "../atoms/borrow-navigation";

export function BorrowDashboard() {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);

  const {
    data: troves,
    isLoading: trovesLoading,
    isError: trovesError,
  } = useUserTroves(debtToken.symbol);

  const { data: spPosition, isLoading: spLoading } = useStabilityPool(
    debtToken.symbol,
  );

  const { data: surplusAmount } = useSurplusCollateral(debtToken.symbol);
  const claimCollateral = useClaimCollateral();

  const isLoading = trovesLoading || spLoading;
  const hasTroves = troves && troves.length > 0;
  const hasSpDeposit = spPosition && spPosition.deposit > 0n;
  const hasSurplus = surplusAmount != null && surplusAmount > 0n;
  const hasPositions = hasTroves || hasSpDeposit;

  if (!isConnected) {
    return <NotConnectedState />;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (trovesError) {
    return (
      <div className="p-6 bg-card text-center">
        <p className="text-destructive">
          Failed to load positions. Please check your connection and try again.
        </p>
      </div>
    );
  }

  if (!hasPositions && !hasSurplus) {
    return (
      <EmptyState
        onOpenTrove={() => setBorrowView("open-trove")}
        onEarn={() => setBorrowView("earn")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Claim collateral banner */}
      {hasSurplus && (
        <div className="p-4 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5">
          <div>
            <p className="font-medium">Surplus Collateral Available</p>
            <p className="text-sm text-muted-foreground">
              You have {formatCollateralAmount(surplusAmount)} available to
              claim from a liquidated position.
            </p>
          </div>
          <Button
            onClick={() =>
              claimCollateral.mutate({
                symbol: debtToken.symbol,
                wagmiConfig,
                account: address!,
              })
            }
            disabled={claimCollateral.isPending}
          >
            {claimCollateral.isPending ? "Claiming…" : "Claim Collateral"}
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="gap-3 flex">
        <Button onClick={() => setBorrowView("open-trove")}>Open Trove</Button>
        <Button variant="outline" onClick={() => setBorrowView("earn")}>
          Earn
        </Button>
      </div>

      {/* Trove positions */}
      {hasTroves && (
        <div className="gap-4 md:grid-cols-2 grid">
          {troves.map((position) => (
            <PositionCard
              key={position.troveId}
              position={position}
              debtToken={debtToken}
            />
          ))}
        </div>
      )}

      {/* Stability Pool position */}
      {hasSpDeposit && (
        <div className="gap-4 md:grid-cols-2 grid">
          <StabilityCard position={spPosition} debtToken={debtToken} />
        </div>
      )}
    </div>
  );
}

function NotConnectedState() {
  return (
    <div className="p-8 bg-card text-center">
      <p className="text-muted-foreground">
        Connect your wallet to view your borrow positions.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="gap-4 md:grid-cols-2 grid">
      {[1, 2].map((i) => (
        <div key={i} className="h-48 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

function EmptyState({
  onOpenTrove,
  onEarn,
}: {
  onOpenTrove: () => void;
  onEarn: () => void;
}) {
  return (
    <div className="p-8 space-y-4 bg-card text-center">
      <p className="text-muted-foreground">
        You don&apos;t have any active positions yet.
      </p>
      <div className="gap-3 flex justify-center">
        <Button onClick={onOpenTrove}>Open Your First Trove</Button>
        <Button variant="outline" onClick={onEarn}>
          Deposit into Stability Pool
        </Button>
      </div>
    </div>
  );
}
