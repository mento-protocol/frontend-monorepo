import type { Config } from "wagmi";
import { logger } from "@/utils/logger";
import {
  executeTxFlow,
  extractTxFlowErrorString,
  type TxFlowOptions,
  type TxFlowStepDefinition,
  type TxFlowTransaction,
} from "../tx-flow";
import type { LiquidityFlowState, LiquidityFlowStep } from "./flow-atoms";

export type TxParams = TxFlowTransaction;
export type LiquidityFlowStepDefinition = TxFlowStepDefinition;

type SetLiquidityFlowState = (
  update:
    | LiquidityFlowState
    | null
    | ((previous: LiquidityFlowState | null) => LiquidityFlowState | null),
) => void;

export async function executeLiquidityFlow(
  wagmiConfig: Config,
  setFlowState: SetLiquidityFlowState,
  operation: string,
  stepDefinitions: LiquidityFlowStepDefinition[],
  chainId?: number,
): Promise<{ success: boolean; txHashes: string[] }> {
  const steps: LiquidityFlowStep[] = stepDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    status: "idle",
  }));
  const initialState: LiquidityFlowState = {
    operation,
    steps,
    currentStepIndex: 0,
    chainId,
  };

  return executeTxFlow(
    wagmiConfig,
    setFlowState,
    initialState,
    stepDefinitions,
    createLiquidityFlowOptions(chainId),
  );
}

function createLiquidityFlowOptions(
  chainId?: number,
): TxFlowOptions<LiquidityFlowState> {
  return {
    chainId,
    gasHeadroom: 0.25,
    applyFeeOverrides: true,
    confirmations: 1,
    onUserRejection: "clear-flow",
    formatStepError: formatLiquidityFlowStepError,
    onStepError: (error, step) => {
      logger.error(`[LiquidityFlow] Step "${step.label}" failed:`, error);
    },
  };
}

function formatLiquidityFlowStepError(error: unknown): { message: string } {
  const rawMessage = extractTxFlowErrorString(error);

  // The InsufficientAmount* / InsufficientLiquidity selectors fire in both
  // balanced add-liquidity and single-token zap-in. Keep the copy applicable
  // to either mode. Route/preparation failures are genuinely zap-specific.
  const message =
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

  return { message };
}
