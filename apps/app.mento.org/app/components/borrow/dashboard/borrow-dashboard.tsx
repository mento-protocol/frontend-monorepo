"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@repo/ui";
import {
  useUserTroves,
  useSurplusCollateral,
  useClaimCollateral,
  selectedDebtTokenAtom,
  formatCollateralAmount,
} from "@repo/web3";
import { useAccount, useConfig } from "@repo/web3/wagmi";
import { TroveList } from "./trove-list";
import { borrowViewAtom } from "../atoms/borrow-navigation";
import { activeTabAtom } from "@/atoms/navigation";

export function BorrowDashboard() {
  const { address, isConnected } = useAccount();
  const wagmiConfig = useConfig();
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);
  const setActiveTab = useSetAtom(activeTabAtom);

  const {
    data: troves,
    isLoading: trovesLoading,
    isError: trovesError,
    error: trovesErrorDetail,
  } = useUserTroves(debtToken.symbol);

  const { data: surplusAmount } = useSurplusCollateral(debtToken.symbol);
  const claimCollateral = useClaimCollateral();

  const hasTroves = troves && troves.length > 0;
  const hasSurplus = surplusAmount != null && surplusAmount > 0n;

  if (!isConnected) {
    return <NotConnectedState />;
  }

  if (trovesError) {
    return (
      <div className="p-6 bg-card text-center">
        <p className="text-destructive">
          Failed to load positions. Please check your connection and try again.
        </p>
        {trovesErrorDetail instanceof Error && (
          <p className="mt-2 text-xs break-all text-muted-foreground">
            {trovesErrorDetail.message}
          </p>
        )}
      </div>
    );
  }

  if (!trovesLoading && !hasTroves && !hasSurplus) {
    return (
      <EmptyState
        onOpenTrove={() => setBorrowView("open-trove")}
        onEarn={() => setActiveTab("earn")}
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
      </div>

      {/* Trove list */}
      <TroveList
        troves={troves ?? []}
        debtToken={debtToken}
        isLoading={trovesLoading}
      />
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
