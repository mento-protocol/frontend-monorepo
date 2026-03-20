"use client";

import { useAtom } from "jotai";
import {
  liquidityFlowAtom,
  type LiquidityFlowStep as FlowStepType,
} from "@repo/web3";
import { useExplorerUrl } from "@repo/web3";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui";

// ---------------------------------------------------------------------------
// Status icons
// ---------------------------------------------------------------------------

function CircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ""}`}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M10 2a8 8 0 0 1 8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path
        d="M6.5 10.5L9 13l4.5-5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7.5 7.5l5 5M12.5 7.5l-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusIcon({ status }: { status: FlowStepType["status"] }) {
  switch (status) {
    case "idle":
      return <CircleIcon className="text-muted-foreground" />;
    case "pending":
    case "confirming":
      return <SpinnerIcon className="text-primary" />;
    case "confirmed":
      return <CheckIcon className="text-green-600" />;
    case "error":
      return <ErrorIcon className="text-red-500" />;
  }
}

function shortenHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// FlowStep component
// ---------------------------------------------------------------------------

function FlowStep({
  step,
  isActive,
  explorerUrl,
}: {
  step: FlowStepType;
  isActive: boolean;
  explorerUrl: string;
}) {
  return (
    <div
      className={`gap-3 px-3 py-2 flex items-start rounded-md ${
        isActive ? "bg-muted/50" : ""
      }`}
    >
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={step.status} />
      </div>

      <div className="min-w-0 gap-0.5 flex flex-col">
        <span
          className={`text-sm font-medium ${
            step.status === "idle" ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {step.label}
        </span>

        {step.txHash && (
          <a
            href={`${explorerUrl}/tx/${step.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            {shortenHash(step.txHash)}
          </a>
        )}

        {step.status === "error" && step.error && (
          <span className="text-xs text-red-500">{step.error.message}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiquidityFlowDialog
// ---------------------------------------------------------------------------

export function LiquidityFlowDialog() {
  const [flow, setFlow] = useAtom(liquidityFlowAtom);
  const explorerUrl = useExplorerUrl(flow?.chainId);

  if (!flow) return null;

  const allDone = flow.steps.every((s) => s.status === "confirmed");
  const errored = flow.steps.some((s) => s.status === "error");

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && (allDone || errored) && setFlow(null)}
    >
      <DialogContent
        className="border-0 bg-card"
        showCloseButton={allDone || errored}
        onPointerDownOutside={(e) => {
          // Allow clicks on toasts (sonner) to pass through
          const target = e.target as HTMLElement;
          if (target?.closest("[data-sonner-toast]")) return;
          if (!allDone && !errored) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!allDone && !errored) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-medium md:text-2xl">
            {flow.operation}
          </DialogTitle>
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
              explorerUrl={explorerUrl}
            />
          ))}
        </div>

        {allDone && (
          <Button
            className="mt-2 w-full"
            size="lg"
            clipped="lg"
            onClick={() => setFlow(null)}
          >
            Done
          </Button>
        )}
        {errored && (
          <Button
            variant="outline"
            className="mt-2 w-full"
            size="lg"
            onClick={() => setFlow(null)}
          >
            Close
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
