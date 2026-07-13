import type { Config } from "wagmi";
import {
  estimateGas,
  sendTransaction,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { Address, Hex } from "viem";
import { isUserRejection } from "@/utils/is-user-rejection";
import { getTransactionFeeOverrides } from "@/utils/transaction-fees";

export type TxFlowStepStatus =
  | "idle"
  | "pending"
  | "confirming"
  | "confirmed"
  | "error";

export interface TxFlowStepBase {
  id: string;
  label: string;
  status: TxFlowStepStatus;
  txHash?: string;
  error?: unknown;
}

export interface TxFlowStateBase {
  steps: TxFlowStepBase[];
  currentStepIndex: number;
}

export interface TxFlowTransaction {
  to: string;
  data: string;
  value?: string | number | bigint;
}

export interface TxFlowStepDefinition {
  id: string;
  label: string;
  /** Return a transaction to execute, or null to skip this step. */
  buildTx: () => Promise<TxFlowTransaction | null>;
}

export type SetTxFlowState<TState extends TxFlowStateBase> = (
  update: TState | null | ((previous: TState | null) => TState | null),
) => void;

export interface TxFlowOptions<TState extends TxFlowStateBase> {
  chainId?: number;
  account?: string;
  gasHeadroom?: number;
  applyFeeOverrides?: boolean;
  confirmations?: number;
  onUserRejection: "clear-flow" | "mark-step-error";
  formatStepError: (
    error: unknown,
  ) => NonNullable<TState["steps"][number]["error"]>;
  normalizeTransactionError?: (
    error: unknown,
    transactionData?: Hex,
  ) => unknown;
  onStepError?: (error: unknown, step: TxFlowStepDefinition) => void;
}

const DEFAULT_GAS_HEADROOM = 0.25;
const DEFAULT_CONFIRMATIONS = 1;

export async function executeTxFlow<TState extends TxFlowStateBase>(
  wagmiConfig: Config,
  setFlowState: SetTxFlowState<TState>,
  initialState: TState,
  stepDefinitions: TxFlowStepDefinition[],
  options: TxFlowOptions<TState>,
): Promise<{ success: boolean; txHashes: string[] }> {
  const txHashes: string[] = [];

  setFlowState(initialState);

  for (let index = 0; index < stepDefinitions.length; index++) {
    const definition = stepDefinitions[index]!;

    try {
      const transaction = await definition.buildTx();

      if (transaction === null) {
        setFlowState((previous) =>
          updateFlowStep(previous, index, {
            status: "confirmed",
            label: `${definition.label} — Skipped`,
            currentStepIndex: index + 1,
          }),
        );
        continue;
      }

      setFlowState((previous) =>
        updateFlowStep(previous, index, {
          status: "pending",
          currentStepIndex: index,
        }),
      );

      const txHash = await sendFlowTransaction(
        wagmiConfig,
        transaction,
        options,
      );

      setFlowState((previous) =>
        updateFlowStep(previous, index, {
          status: "confirming",
          txHash,
        }),
      );

      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash: txHash,
        confirmations: options.confirmations ?? DEFAULT_CONFIRMATIONS,
      });

      if (receipt.status === "reverted") {
        throw new Error("Transaction reverted on-chain");
      }

      txHashes.push(txHash);

      setFlowState((previous) =>
        updateFlowStep(previous, index, {
          status: "confirmed",
          currentStepIndex: index + 1,
        }),
      );
    } catch (error) {
      if (
        options.onUserRejection === "clear-flow" &&
        (isUserRejection(error) ||
          isUserRejection(extractTxFlowErrorString(error)))
      ) {
        setFlowState(null);
        return { success: false, txHashes };
      }

      options.onStepError?.(error, definition);

      setFlowState((previous) =>
        updateFlowStep(previous, index, {
          status: "error",
          error: options.formatStepError(error),
        }),
      );

      return { success: false, txHashes };
    }
  }

  return { success: true, txHashes };
}

interface StepUpdate {
  status: TxFlowStepStatus;
  label?: string;
  txHash?: Hex;
  error?: unknown;
  currentStepIndex?: number;
}

function updateFlowStep<TState extends TxFlowStateBase>(
  state: TState | null,
  index: number,
  update: StepUpdate,
): TState | null {
  if (!state) return state;

  const steps = [...state.steps];
  const currentStep = steps[index]!;
  steps[index] = {
    ...currentStep,
    ...(update.label !== undefined && { label: update.label }),
    status: update.status,
    ...(update.txHash !== undefined && { txHash: update.txHash }),
    ...(update.error !== undefined && { error: update.error }),
  };

  return {
    ...state,
    steps,
    ...(update.currentStepIndex !== undefined && {
      currentStepIndex: update.currentStepIndex,
    }),
  };
}

async function sendFlowTransaction<TState extends TxFlowStateBase>(
  wagmiConfig: Config,
  transaction: TxFlowTransaction,
  options: TxFlowOptions<TState>,
): Promise<Hex> {
  const txRequest = {
    ...(options.account ? { account: options.account as Address } : {}),
    to: transaction.to as Address,
    data: transaction.data as Hex,
    value: BigInt(transaction.value || 0),
    ...(options.chainId != null && { chainId: options.chainId }),
  };

  let gasLimit: bigint | undefined;
  try {
    const gasEstimate = await estimateGas(wagmiConfig, txRequest);
    const gasHeadroom = options.gasHeadroom ?? DEFAULT_GAS_HEADROOM;
    gasLimit =
      gasEstimate + BigInt(Math.ceil(Number(gasEstimate) * gasHeadroom));
  } catch (estimateError) {
    if (isLikelyDeterministicRevert(estimateError)) {
      throw normalizeTransactionError(estimateError, txRequest.data, options);
    }

    // A flaky estimate should not abort a valid flow. Omitting gas delegates
    // the estimate to the wallet at send time.
    gasLimit = undefined;
  }

  const feeOverrides =
    (options.applyFeeOverrides ?? true)
      ? await getTransactionFeeOverrides(wagmiConfig, options.chainId)
      : {};

  try {
    return await sendTransaction(
      wagmiConfig,
      gasLimit === undefined
        ? { ...txRequest, ...feeOverrides }
        : { ...txRequest, ...feeOverrides, gas: gasLimit },
    );
  } catch (error) {
    throw normalizeTransactionError(error, txRequest.data, options);
  }
}

function normalizeTransactionError<TState extends TxFlowStateBase>(
  error: unknown,
  transactionData: Hex,
  options: TxFlowOptions<TState>,
): unknown {
  return options.normalizeTransactionError?.(error, transactionData) ?? error;
}

export function extractTxFlowErrorString(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return String(error);

  const structuredError = error as Error & {
    shortMessage?: string;
    reason?: string;
    details?: string;
    data?: unknown;
    cause?: unknown;
  };
  const cause =
    typeof structuredError.cause === "object" && structuredError.cause !== null
      ? (structuredError.cause as {
          message?: string;
          data?: unknown;
          signature?: string;
          reason?: string;
        })
      : undefined;

  return [
    structuredError.message,
    structuredError.shortMessage,
    structuredError.reason,
    structuredError.details,
    stringifyErrorPart(structuredError.data),
    cause?.message,
    cause?.reason,
    stringifyErrorPart(cause?.data),
    cause?.signature,
    structuredError.name,
  ]
    .filter(Boolean)
    .join(" ");
}

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

function isLikelyDeterministicRevert(error: unknown): boolean {
  const message = extractTxFlowErrorString(error).toLowerCase();

  return /execution reverted|call execution error|insufficient liquidity|insufficientliquidity|insufficient reserves|insufficient output amount|bb55fd27|always failing transaction|simulation failed|slippage|minimum amount|minimum output|no viable zap-(in|out) route|no route for this amount|route unavailable|unable to prepare single-token|unable to quote single-token|no single-token route/i.test(
    message,
  );
}
