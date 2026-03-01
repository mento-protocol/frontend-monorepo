"use client";

import { useAtomValue } from "jotai";
import { selectedDebtTokenAtom } from "@repo/web3";
import { DebtTokenSelector } from "./shared/debt-token-selector";
import { FlowDialog } from "./shared/flow-dialog";
import { BorrowDashboard } from "./dashboard/borrow-dashboard";
import { borrowViewAtom } from "./atoms/borrow-navigation";

export function BorrowView() {
  const view = useAtomValue(borrowViewAtom);

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 mb-6 min-h-[550px] w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 bg-card flex items-start justify-between">
          <div>
            <h1 className="font-medium md:text-2xl">Borrow</h1>
            <p className="text-sm text-muted-foreground">
              Borrow stablecoins against your collateral.
            </p>
          </div>
          <DebtTokenSelector />
        </div>
      </div>

      {/* Content */}
      {view === "dashboard" && <BorrowDashboard />}
      {view === "open-trove" && (
        <div className="p-6 bg-card text-center text-muted-foreground">
          Open Trove — coming soon
        </div>
      )}
      {typeof view === "object" && view.view === "manage-trove" && (
        <div className="p-6 bg-card text-center text-muted-foreground">
          Manage Trove #{view.troveId} — coming soon
        </div>
      )}
      {view === "earn" && (
        <div className="p-6 bg-card text-center text-muted-foreground">
          Stability Pool — coming soon
        </div>
      )}
      {view === "redeem" && (
        <div className="p-6 bg-card text-center text-muted-foreground">
          Redeem — coming soon
        </div>
      )}
      <FlowDialog />
    </div>
  );
}
