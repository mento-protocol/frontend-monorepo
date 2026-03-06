"use client";

import { useAtomValue } from "jotai";
import { DebtTokenSelector } from "./shared/debt-token-selector";
import { FlowDialog } from "./shared/flow-dialog";
import { BorrowDashboard } from "./dashboard/borrow-dashboard";
import { OpenTroveForm } from "./open-trove/open-trove-form";
import { ManageTroveView } from "./manage-trove/manage-trove-view";
import { borrowViewAtom } from "./atoms/borrow-navigation";

export function BorrowView() {
  const view = useAtomValue(borrowViewAtom);

  const isManageTrove =
    typeof view === "object" && view.view === "manage-trove";

  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 min-h-[550px] w-full">
      {/* Header — hidden on manage-trove page */}
      {!isManageTrove && (
        <div className="relative">
          <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
          <div className="p-6 flex items-start justify-between bg-card">
            <div>
              <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
                Collateralized Debt
              </span>
              <h1 className="mt-2 font-bold text-3xl">Borrow</h1>
              <p className="mt-1 text-sm max-w-md leading-relaxed text-muted-foreground">
                Borrow stablecoins against your collateral. Manage your open
                troves below.
              </p>
            </div>
            <DebtTokenSelector />
          </div>
        </div>
      )}

      {/* Content */}
      {view === "dashboard" && <BorrowDashboard />}
      {view === "open-trove" && <OpenTroveForm />}
      {typeof view === "object" && view.view === "manage-trove" && (
        <ManageTroveView troveId={view.troveId} />
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
