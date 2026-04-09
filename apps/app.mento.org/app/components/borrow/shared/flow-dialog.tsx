"use client";

import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [flow, setFlow] = useAtom(borrowFlowAtom);

  if (!flow) return null;

  const allDone = isAllConfirmed(flow);
  const errored = hasError(flow);
  const successHref = flow.successHref;

  function handleBackToDashboard() {
    setFlow(null);
    if (successHref) {
      router.push(successHref);
    }
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
          if (allDone && successHref) {
            router.push(successHref);
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
