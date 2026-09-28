import type { Config } from "wagmi";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  estimateGasMock,
  reportErrorMock,
  sendTransactionMock,
  waitForTransactionReceiptMock,
} = vi.hoisted(() => ({
  estimateGasMock: vi.fn(),
  reportErrorMock: vi.fn(),
  sendTransactionMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
}));

vi.mock("wagmi/actions", () => ({
  estimateGas: estimateGasMock,
  sendTransaction: sendTransactionMock,
  waitForTransactionReceipt: waitForTransactionReceiptMock,
}));

vi.mock("@/utils/transaction-fees", () => ({
  getTransactionFeeOverrides: vi.fn(async () => ({})),
}));

vi.mock("@/utils/error-reporter", () => ({
  reportError: reportErrorMock,
}));

import {
  executeTxFlow,
  type TxFlowOptions,
  type TxFlowStateBase,
  type TxFlowStepDefinition,
} from "./engine";

const wagmiConfig = {} as Config;

const initialState: TxFlowStateBase = {
  steps: [{ id: "approve", label: "Approve", status: "idle" }],
  currentStepIndex: 0,
};

const transactionStep: TxFlowStepDefinition = {
  id: "approve",
  label: "Approve",
  buildTx: async () => ({ to: `0x${"1".repeat(40)}`, data: "0x" }),
};

function flowOptions(
  onUserRejection: TxFlowOptions<TxFlowStateBase>["onUserRejection"],
): TxFlowOptions<TxFlowStateBase> {
  return {
    onUserRejection,
    formatStepError: () => "failed",
    applyFeeOverrides: false,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("executeTxFlow error reporting", () => {
  it("reports a failing step with its step id", async () => {
    const error = new Error("Transaction reverted on-chain");
    estimateGasMock.mockResolvedValue(21_000n);
    sendTransactionMock.mockResolvedValue(`0x${"a".repeat(64)}`);
    waitForTransactionReceiptMock.mockResolvedValue({ status: "reverted" });
    const onStepError = vi.fn();

    const result = await executeTxFlow(
      wagmiConfig,
      vi.fn(),
      initialState,
      [transactionStep],
      { ...flowOptions("mark-step-error"), onStepError },
    );

    expect(result.success).toBe(false);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: error.message }),
      { step: "approve" },
    );
    expect(onStepError).toHaveBeenCalledTimes(1);
  });

  it("reports a step whose transaction cannot be built", async () => {
    const error = new Error("quote unavailable");

    await executeTxFlow(
      wagmiConfig,
      vi.fn(),
      initialState,
      [
        {
          ...transactionStep,
          buildTx: async () => {
            throw error;
          },
        },
      ],
      flowOptions("mark-step-error"),
    );

    expect(reportErrorMock).toHaveBeenCalledWith(error, { step: "approve" });
  });

  it("does not report a user rejection in clear-flow mode", async () => {
    estimateGasMock.mockResolvedValue(21_000n);
    sendTransactionMock.mockRejectedValue(
      Object.assign(new Error("User rejected the request."), { code: 4001 }),
    );
    const setFlowState = vi.fn();

    const result = await executeTxFlow(
      wagmiConfig,
      setFlowState,
      initialState,
      [transactionStep],
      flowOptions("clear-flow"),
    );

    expect(result.success).toBe(false);
    expect(setFlowState).toHaveBeenLastCalledWith(null);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});
