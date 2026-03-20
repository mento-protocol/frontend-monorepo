"use client";

import { useAtom } from "jotai";
import { borrowFlowAtom } from "@repo/web3";
import type { BorrowFlowState } from "@repo/web3";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui";
import { FlowStep } from "./flow-step";
import { borrowViewAtom } from "../atoms/borrow-navigation";
import { useSetAtom } from "jotai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAllConfirmed(flow: BorrowFlowState): boolean {
  return flow.steps.every((s) => s.status === "confirmed");
}

function hasError(flow: BorrowFlowState): boolean {
  return flow.steps.some((s) => s.status === "error");
}

// ---------------------------------------------------------------------------
// FlowDialog — self-managing transaction progress dialog
// ---------------------------------------------------------------------------

export function FlowDialog() {
  const [flow, setFlow] = useAtom(borrowFlowAtom);
  const setBorrowView = useSetAtom(borrowViewAtom);

  if (!flow) return null;

  const allDone = isAllConfirmed(flow);
  const errored = hasError(flow);

  function handleBackToDashboard() {
    setFlow(null);
    setBorrowView("dashboard");
  }

  function handleTryAgain() {
    setFlow(null);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setFlow(null);
          if (allDone) {
            setBorrowView("dashboard");
          }
        }
      }}
    >
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>{flow.operation}</DialogTitle>
          <DialogDescription>
            {allDone
              ? "All steps completed successfully."
              : errored
                ? "An error occurred during the transaction."
                : "Please confirm the transactions in your wallet."}
          </DialogDescription>
        </DialogHeader>

        <div className="gap-1 flex flex-col">
          {flow.steps.map((step, i) => (
            <FlowStep
              key={step.id}
              step={step}
              isActive={i === flow.currentStepIndex}
            />
          ))}
        </div>

        {(allDone || errored) && (
          <DialogFooter>
            {allDone && (
              <Button onClick={handleBackToDashboard}>Back to Dashboard</Button>
            )}
            {errored && (
              <Button variant="outline" onClick={handleTryAgain}>
                Try Again
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
