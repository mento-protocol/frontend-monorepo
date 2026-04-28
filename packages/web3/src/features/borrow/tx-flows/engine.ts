import type { Config } from "wagmi";
import type { CallParams } from "../types";
import type { BorrowFlowState, FlowStep } from "../atoms/flow-atoms";
import { sendSdkTransaction, waitForTx } from "./send-tx";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowStepDefinition {
  id: string;
  label: string;
  /** Return CallParams to execute, or null to skip this step. */
  buildTx: () => Promise<CallParams | null>;
}

export interface ExecuteFlowOptions {
  successHref?: string;
}

type SetFlowAtom = (
  update:
    | BorrowFlowState
    | null
    | ((prev: BorrowFlowState | null) => BorrowFlowState | null),
) => void;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Orchestrates a multi-step transaction flow, updating the flow atom at each
 * state transition so the UI can react in real-time.
 */
export async function executeFlow(
  wagmiConfig: Config,
  setFlowAtom: SetFlowAtom,
  flowId: string,
  operation: string,
  account: string,
  stepDefs: FlowStepDefinition[],
  options?: ExecuteFlowOptions,
): Promise<{ success: boolean; txHashes: string[] }> {
  const txHashes: string[] = [];

  // Build initial flow state — all steps idle
  const initialSteps: FlowStep[] = stepDefs.map((def) => ({
    id: def.id,
    label: def.label,
    status: "idle" as const,
  }));

  const initialState: BorrowFlowState = {
    flowId,
    operation,
    steps: initialSteps,
    currentStepIndex: 0,
    account,
    successHref: options?.successHref,
  };

  setFlowAtom(initialState);

  for (let i = 0; i < stepDefs.length; i++) {
    const def = stepDefs[i]!;

    try {
      const callParams = await def.buildTx();

      // Skip step if buildTx returns null
      if (callParams === null) {
        setFlowAtom((prev) => {
          if (!prev) return prev;
          const steps = [...prev.steps];
          steps[i] = {
            ...steps[i]!,
            status: "confirmed",
            label: `${def.label} — Skipped`,
          };
          return { ...prev, steps, currentStepIndex: i + 1 };
        });
        continue;
      }

      // Mark step as pending
      setFlowAtom((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        steps[i] = { ...steps[i]!, status: "pending" };
        return { ...prev, steps, currentStepIndex: i };
      });

      // Send transaction
      const txHash = await sendSdkTransaction(
        wagmiConfig,
        callParams,
        undefined,
        account,
      );

      // Mark step as confirming with txHash
      setFlowAtom((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        steps[i] = { ...steps[i]!, status: "confirming", txHash };
        return { ...prev, steps };
      });

      // Wait for confirmation and surface on-chain reverts explicitly.
      const receipt = await waitForTx(wagmiConfig, txHash);
      if (receipt.status === "reverted") {
        throw new Error("Transaction reverted on-chain");
      }
      txHashes.push(txHash);

      // Mark step as confirmed
      setFlowAtom((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        steps[i] = { ...steps[i]!, status: "confirmed" };
        return { ...prev, steps, currentStepIndex: i + 1 };
      });
    } catch (error) {
      const errName = error instanceof Error ? error.constructor.name : null;
      const errMessage =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");

      // Mark step as error and stop
      setFlowAtom((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        steps[i] = {
          ...steps[i]!,
          status: "error",
          error: { name: errName, message: errMessage },
        };
        return { ...prev, steps };
      });

      return { success: false, txHashes };
    }
  }

  return { success: true, txHashes };
}
