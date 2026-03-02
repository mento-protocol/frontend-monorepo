import type { Config } from "wagmi";
import {
  estimateGas,
  sendTransaction,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { Address, Hex } from "viem";
import type { LiquidityFlowState, LiquidityFlowStep } from "./flow-atoms";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxParams {
  to: string;
  data: string;
  value?: string | number | bigint;
}

export interface LiquidityFlowStepDefinition {
  id: string;
  label: string;
  /** Return TxParams to execute, or null to skip this step. */
  buildTx: () => Promise<TxParams | null>;
}

type SetFlowAtom = (
  update:
    | LiquidityFlowState
    | null
    | ((prev: LiquidityFlowState | null) => LiquidityFlowState | null),
) => void;

const GAS_HEADROOM = 0.25;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export async function executeLiquidityFlow(
  wagmiConfig: Config,
  setFlowAtom: SetFlowAtom,
  operation: string,
  stepDefs: LiquidityFlowStepDefinition[],
): Promise<{ success: boolean; txHashes: string[] }> {
  const txHashes: string[] = [];

  const initialSteps: LiquidityFlowStep[] = stepDefs.map((def) => ({
    id: def.id,
    label: def.label,
    status: "idle" as const,
  }));

  const initialState: LiquidityFlowState = {
    operation,
    steps: initialSteps,
    currentStepIndex: 0,
  };

  setFlowAtom(initialState);

  for (let i = 0; i < stepDefs.length; i++) {
    const def = stepDefs[i]!;

    try {
      const txParams = await def.buildTx();

      // Skip step if buildTx returns null
      if (txParams === null) {
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

      // Send transaction with gas headroom
      const txRequest = {
        to: txParams.to as Address,
        data: txParams.data as Hex,
        value: BigInt(txParams.value || 0),
      };

      let txHash: Hex;
      try {
        const gasEstimate = await estimateGas(wagmiConfig, txRequest);
        const gasLimit =
          gasEstimate + BigInt(Math.ceil(Number(gasEstimate) * GAS_HEADROOM));
        txHash = await sendTransaction(wagmiConfig, {
          ...txRequest,
          gas: gasLimit,
        });
      } catch {
        // Fall back to sending without explicit gas limit
        txHash = await sendTransaction(wagmiConfig, txRequest);
      }

      // Mark step as confirming with txHash
      setFlowAtom((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        steps[i] = { ...steps[i]!, status: "confirming", txHash };
        return { ...prev, steps };
      });

      // Wait for confirmation
      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash: txHash,
      });

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
      const rawMessage =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");

      // If user rejected, clear the flow entirely
      if (
        /user\s+rejected|denied\s+transaction|request\s+rejected/i.test(
          rawMessage,
        )
      ) {
        setFlowAtom(null);
        return { success: false, txHashes };
      }

      // Log full error for debugging, show friendly message to user
      console.error(`[LiquidityFlow] Step "${def.label}" failed:`, error);

      const friendlyMessage = /reverted/i.test(rawMessage)
        ? "Transaction was reverted. Please check your inputs and try again."
        : /insufficient\s+funds/i.test(rawMessage)
          ? "Insufficient funds to complete this transaction."
          : /nonce/i.test(rawMessage)
            ? "Transaction conflict. Please try again."
            : "Something went wrong. Please try again.";

      // Mark step as error and stop
      setFlowAtom((prev) => {
        if (!prev) return prev;
        const steps = [...prev.steps];
        steps[i] = {
          ...steps[i]!,
          status: "error",
          error: { message: friendlyMessage },
        };
        return { ...prev, steps };
      });

      return { success: false, txHashes };
    }
  }

  return { success: true, txHashes };
}
