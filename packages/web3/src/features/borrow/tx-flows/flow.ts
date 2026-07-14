import type { Config } from "wagmi";
import { getChainId } from "wagmi/actions";
import {
  executeTxFlow,
  type TxFlowOptions,
  type TxFlowStepDefinition,
} from "../../tx-flow";
import type { BorrowFlowState, FlowStep } from "../atoms/flow-atoms";
import { normalizeTxError } from "./send-tx";

export type FlowStepDefinition = TxFlowStepDefinition;

interface ExecuteFlowOptions {
  successHref?: string;
}

type SetBorrowFlowState = (
  update:
    | BorrowFlowState
    | null
    | ((previous: BorrowFlowState | null) => BorrowFlowState | null),
) => void;

/**
 * Adapts the shared transaction-flow engine to the persisted borrow atom.
 */
export async function executeFlow(
  wagmiConfig: Config,
  setFlowState: SetBorrowFlowState,
  flowId: string,
  operation: string,
  account: string,
  stepDefinitions: FlowStepDefinition[],
  options?: ExecuteFlowOptions,
): Promise<{ success: boolean; txHashes: string[] }> {
  const steps: FlowStep[] = stepDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    status: "idle",
  }));
  const initialState: BorrowFlowState = {
    flowId,
    operation,
    steps,
    currentStepIndex: 0,
    account,
    successHref: options?.successHref,
  };

  return executeTxFlow(
    wagmiConfig,
    setFlowState,
    initialState,
    stepDefinitions,
    createBorrowFlowOptions(wagmiConfig, account),
  );
}

function createBorrowFlowOptions(
  wagmiConfig: Config,
  account: string,
): TxFlowOptions<BorrowFlowState> {
  return {
    chainId: getChainId(wagmiConfig),
    account,
    gasHeadroom: 0.25,
    applyFeeOverrides: true,
    confirmations: 3,
    onUserRejection: "mark-step-error",
    normalizeTransactionError: normalizeTxError,
    formatStepError: formatBorrowFlowStepError,
  };
}

function formatBorrowFlowStepError(error: unknown): {
  name: string | null;
  message: string;
} {
  return {
    name: error instanceof Error ? error.constructor.name : null,
    message:
      error instanceof Error ? error.message : String(error ?? "Unknown error"),
  };
}
