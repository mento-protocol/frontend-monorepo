"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@repo/ui";
import {
  useUserTroves,
  useStabilityPool,
  selectedDebtTokenAtom,
} from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import { DebtTokenSelector } from "../shared/debt-token-selector";
import { PositionCard } from "./position-card";
import { StabilityCard } from "./stability-card";
import { borrowViewAtom } from "../atoms/borrow-navigation";

export function BorrowDashboard() {
  const { address, isConnected } = useAccount();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);

  const {
    data: troves,
    isLoading: trovesLoading,
    isError: trovesError,
  } = useUserTroves(debtToken.symbol);

  const {
    data: spPosition,
    isLoading: spLoading,
  } = useStabilityPool(debtToken.symbol);

  const isLoading = trovesLoading || spLoading;
  const hasTroves = troves && troves.length > 0;
  const hasSpDeposit = spPosition && spPosition.deposit > 0n;
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

  if (!hasPositions) {
    return (
      <EmptyState
        onOpenTrove={() => setBorrowView("open-trove")}
        onEarn={() => setBorrowView("earn")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex gap-3">
        <Button onClick={() => setBorrowView("open-trove")}>Open Trove</Button>
        <Button variant="outline" onClick={() => setBorrowView("earn")}>
          Earn
        </Button>
      </div>

      {/* Trove positions */}
      {hasTroves && (
        <div className="grid gap-4 md:grid-cols-2">
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
        <div className="grid gap-4 md:grid-cols-2">
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
    <div className="grid gap-4 md:grid-cols-2">
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
    <div className="p-8 bg-card text-center space-y-4">
      <p className="text-muted-foreground">
        You don&apos;t have any active positions yet.
      </p>
      <div className="flex justify-center gap-3">
        <Button onClick={onOpenTrove}>Open Your First Trove</Button>
        <Button variant="outline" onClick={onEarn}>
          Deposit into Stability Pool
        </Button>
      </div>
    </div>
  );
}
