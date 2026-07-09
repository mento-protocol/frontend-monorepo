import type { Config } from "wagmi";
import {
  estimateGas,
  sendTransaction,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { Address, Hex } from "viem";
import { isUserRejection } from "@/utils/is-user-rejection";
import { getTransactionFeeOverrides } from "@/utils/transaction-fees";
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

function stringifyErrorPart(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function extractFlowErrorString(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return String(error);

  const err = error as Error & {
    shortMessage?: string;
    reason?: string;
    details?: string;
    data?: unknown;
    cause?: unknown;
  };

  const cause =
    typeof err.cause === "object" && err.cause !== null
      ? (err.cause as {
          message?: string;
          data?: unknown;
          signature?: string;
          reason?: string;
        })
      : undefined;

  return [
    err.message,
    err.shortMessage,
    err.reason,
    err.details,
    stringifyErrorPart(err.data),
    cause?.message,
    cause?.reason,
    stringifyErrorPart(cause?.data),
    cause?.signature,
    err.name,
  ]
    .filter(Boolean)
    .join(" ");
}

function isLikelyDeterministicRevert(error: unknown): boolean {
  const message = extractFlowErrorString(error).toLowerCase();

  return /execution reverted|call execution error|insufficient liquidity|insufficientliquidity|insufficient reserves|insufficient output amount|bb55fd27|always failing transaction|simulation failed|slippage|minimum amount|minimum output|no viable zap-(in|out) route|no route for this amount|route unavailable|unable to prepare single-token|unable to quote single-token|no single-token route/i.test(
    message,
  );
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export async function executeLiquidityFlow(
  wagmiConfig: Config,
  setFlowAtom: SetFlowAtom,
  operation: string,
  stepDefs: LiquidityFlowStepDefinition[],
  chainId?: number,
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
    chainId,
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
        ...(chainId != null && { chainId }),
      };

      // Only estimateGas is fallible here. Letting sendTransaction run inside
      // the catch block silently retries the wallet popup whenever the first
      // broadcast fails for a non-revert reason (e.g. Polygon's gas-tip-cap
      // rejection), which surfaces as "first tx fails, second succeeds".
      let gasLimit: bigint | undefined;
      try {
        const gasEstimate = await estimateGas(wagmiConfig, txRequest);
        gasLimit =
          gasEstimate + BigInt(Math.ceil(Number(gasEstimate) * GAS_HEADROOM));
      } catch (estimateError) {
        if (isLikelyDeterministicRevert(estimateError)) {
          throw estimateError;
        }
        // Estimation flaked for a non-deterministic reason; defer to wallet.
        gasLimit = undefined;
      }

      const feeOverrides = await getTransactionFeeOverrides(
        wagmiConfig,
        chainId,
      );
      const txHash = await sendTransaction(
        wagmiConfig,
        gasLimit !== undefined
          ? { ...txRequest, ...feeOverrides, gas: gasLimit }
          : { ...txRequest, ...feeOverrides },
      );

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
      const rawMessage = extractFlowErrorString(error);

      // If user rejected, clear the flow entirely
      if (isUserRejection(rawMessage)) {
        setFlowAtom(null);
        return { success: false, txHashes };
      }

      // Log full error for debugging, show friendly message to user
      console.error(`[LiquidityFlow] Step "${def.label}" failed:`, error);

      // The InsufficientAmount* / InsufficientLiquidity selectors fire in
      // both balanced add-liquidity and single-token zap-in. Phrase the copy
      // so it makes sense regardless of which mode the caller is in — telling
      // a balanced-mode user to "use balanced mode" is nonsense. The route /
      // single-token-prepare branch is genuinely zap-only and stays specific.
      const friendlyMessage =
        /pool liquidity is insufficient|insufficient liquidity|insufficientliquidity|insufficient reserves|insufficient output amount|bb55fd27/i.test(
          rawMessage,
        )
          ? "Pool liquidity is insufficient for this amount. Try a smaller amount."
          : /current pool ratio|cannot be added|insufficient amount[ab]?|insufficient amount[ab] desired|0x8f66ec14|0x34c90624|0xdc6b2ef2|0xacee0513|0x5945ea56/i.test(
                rawMessage,
              )
            ? "Pool ratio shifted during the transaction. Try a smaller amount or higher slippage."
            : /no viable zap-(in|out) route|no route for this amount|route unavailable|unable to prepare single-token|unable to quote single-token|no single-token route/i.test(
                  rawMessage,
                )
              ? "No single-token route is available for this amount. Try a smaller amount or use balanced mode."
              : /reverted/i.test(rawMessage)
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
