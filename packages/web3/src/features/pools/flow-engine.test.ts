import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiquidityFlowState } from "./flow-atoms";

vi.mock("wagmi/actions", () => ({
  estimateGas: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("@/utils/transaction-fees", () => ({
  getTransactionFeeOverrides: vi.fn(),
}));

const { executeLiquidityFlow } = await import("./flow");
const wagmiActions = await import("wagmi/actions");
const transactionFees = await import("@/utils/transaction-fees");

const estimateGasMock = vi.mocked(wagmiActions.estimateGas);
const sendTransactionMock = vi.mocked(wagmiActions.sendTransaction);
const waitForTransactionReceiptMock = vi.mocked(
  wagmiActions.waitForTransactionReceipt,
);
const getTransactionFeeOverridesMock = vi.mocked(
  transactionFees.getTransactionFeeOverrides,
);

function createFlowRecorder() {
  let state: LiquidityFlowState | null = null;
  const snapshots: Array<LiquidityFlowState | null> = [];

  const setFlowAtom = (
    update:
      | LiquidityFlowState
      | null
      | ((prev: LiquidityFlowState | null) => LiquidityFlowState | null),
  ) => {
    state = typeof update === "function" ? update(state) : update;
    snapshots.push(state === null ? null : structuredClone(state));
  };

  return {
    setFlowAtom,
    snapshots,
    getState: () => state,
  };
}

describe("executeLiquidityFlow", () => {
  const wagmiConfig = {} as never;
  const firstHash =
    "0x1111111111111111111111111111111111111111111111111111111111111111";
  const secondHash =
    "0x2222222222222222222222222222222222222222222222222222222222222222";
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getTransactionFeeOverridesMock.mockResolvedValue({});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs a two-step happy path and records every state transition", async () => {
    const recorder = createFlowRecorder();
    const stepOneBuildTx = vi.fn().mockResolvedValue({
      to: "0x0000000000000000000000000000000000000001",
      data: "0x01",
      value: 1n,
    });
    const stepTwoBuildTx = vi.fn().mockResolvedValue({
      to: "0x0000000000000000000000000000000000000002",
      data: "0x02",
      value: 2n,
    });

    estimateGasMock.mockResolvedValueOnce(100n).mockResolvedValueOnce(200n);
    sendTransactionMock
      .mockResolvedValueOnce(firstHash as never)
      .mockResolvedValueOnce(secondHash as never);
    waitForTransactionReceiptMock
      .mockResolvedValueOnce({ status: "success" } as never)
      .mockResolvedValueOnce({ status: "success" } as never);

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Add liquidity",
      [
        { id: "approve", label: "Approve", buildTx: stepOneBuildTx },
        { id: "deposit", label: "Deposit", buildTx: stepTwoBuildTx },
      ],
      42220,
    );

    expect(result).toEqual({
      success: true,
      txHashes: [firstHash, secondHash],
    });
    expect(stepOneBuildTx).toHaveBeenCalledTimes(1);
    expect(stepTwoBuildTx).toHaveBeenCalledTimes(1);
    expect(sendTransactionMock).toHaveBeenNthCalledWith(1, wagmiConfig, {
      to: "0x0000000000000000000000000000000000000001",
      data: "0x01",
      value: 1n,
      chainId: 42220,
      gas: 125n,
    });
    expect(sendTransactionMock).toHaveBeenNthCalledWith(2, wagmiConfig, {
      to: "0x0000000000000000000000000000000000000002",
      data: "0x02",
      value: 2n,
      chainId: 42220,
      gas: 250n,
    });
    expect(recorder.snapshots).toEqual([
      {
        operation: "Add liquidity",
        currentStepIndex: 0,
        chainId: 42220,
        steps: [
          { id: "approve", label: "Approve", status: "idle" },
          { id: "deposit", label: "Deposit", status: "idle" },
        ],
      },
      {
        operation: "Add liquidity",
        currentStepIndex: 0,
        chainId: 42220,
        steps: [
          { id: "approve", label: "Approve", status: "pending" },
          { id: "deposit", label: "Deposit", status: "idle" },
        ],
      },
      {
        operation: "Add liquidity",
        currentStepIndex: 0,
        chainId: 42220,
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirming",
            txHash: firstHash,
          },
          { id: "deposit", label: "Deposit", status: "idle" },
        ],
      },
      {
        operation: "Add liquidity",
        currentStepIndex: 1,
        chainId: 42220,
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          { id: "deposit", label: "Deposit", status: "idle" },
        ],
      },
      {
        operation: "Add liquidity",
        currentStepIndex: 1,
        chainId: 42220,
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          { id: "deposit", label: "Deposit", status: "pending" },
        ],
      },
      {
        operation: "Add liquidity",
        currentStepIndex: 1,
        chainId: 42220,
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          {
            id: "deposit",
            label: "Deposit",
            status: "confirming",
            txHash: secondHash,
          },
        ],
      },
      {
        operation: "Add liquidity",
        currentStepIndex: 2,
        chainId: 42220,
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          {
            id: "deposit",
            label: "Deposit",
            status: "confirmed",
            txHash: secondHash,
          },
        ],
      },
    ]);
    expect(recorder.getState()).toEqual({
      operation: "Add liquidity",
      currentStepIndex: 2,
      chainId: 42220,
      steps: [
        {
          id: "approve",
          label: "Approve",
          status: "confirmed",
          txHash: firstHash,
        },
        {
          id: "deposit",
          label: "Deposit",
          status: "confirmed",
          txHash: secondHash,
        },
      ],
    });
  });

  it("marks skipped steps as confirmed with an exact skipped label", async () => {
    const recorder = createFlowRecorder();

    estimateGasMock.mockResolvedValueOnce(80n);
    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Rebalance",
      [
        {
          id: "approve",
          label: "Approve",
          buildTx: vi.fn().mockResolvedValue(null),
        },
        {
          id: "rebalance",
          label: "Rebalance",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000003",
            data: "0x03",
            value: 0n,
          }),
        },
      ],
      42220,
    );

    expect(result).toEqual({ success: true, txHashes: [firstHash] });
    expect(sendTransactionMock).toHaveBeenCalledTimes(1);
    expect(recorder.snapshots[1]).toEqual({
      operation: "Rebalance",
      currentStepIndex: 1,
      chainId: 42220,
      steps: [
        {
          id: "approve",
          label: "Approve — Skipped",
          status: "confirmed",
        },
        { id: "rebalance", label: "Rebalance", status: "idle" },
      ],
    });
  });

  it("marks the failing step as error, aborts, and does not build later steps", async () => {
    const recorder = createFlowRecorder();
    const stepThreeBuildTx = vi.fn();

    estimateGasMock.mockResolvedValueOnce(100n);
    sendTransactionMock
      .mockResolvedValueOnce(firstHash as never)
      .mockRejectedValueOnce(new Error("rpc exploded"));
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Add liquidity",
      [
        {
          id: "approve",
          label: "Approve",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000001",
            data: "0x01",
            value: 1n,
          }),
        },
        {
          id: "deposit",
          label: "Deposit",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000002",
            data: "0x02",
            value: 2n,
          }),
        },
        {
          id: "stake",
          label: "Stake",
          buildTx: stepThreeBuildTx,
        },
      ],
    );

    expect(result).toEqual({ success: false, txHashes: [firstHash] });
    expect(stepThreeBuildTx).not.toHaveBeenCalled();
    expect(recorder.getState()).toEqual({
      operation: "Add liquidity",
      currentStepIndex: 1,
      steps: [
        {
          id: "approve",
          label: "Approve",
          status: "confirmed",
          txHash: firstHash,
        },
        {
          id: "deposit",
          label: "Deposit",
          status: "error",
          error: { message: "Something went wrong. Please try again." },
        },
        { id: "stake", label: "Stake", status: "idle" },
      ],
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[LiquidityFlow] Step "Deposit" failed:',
      expect.any(Error),
    );
  });

  it("preserves actionable copy when the pool ratio changes after approval", async () => {
    const recorder = createFlowRecorder();
    const ratioChangedMessage =
      "Pool ratio changed. Review the updated amounts before submitting.";

    estimateGasMock.mockResolvedValueOnce(100n);
    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Add liquidity",
      [
        {
          id: "approve",
          label: "Approve",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000001",
            data: "0x01",
            value: 0n,
          }),
        },
        {
          id: "deposit",
          label: "Deposit",
          buildTx: vi.fn().mockRejectedValue(new Error(ratioChangedMessage)),
        },
      ],
    );

    expect(result).toEqual({ success: false, txHashes: [firstHash] });
    expect(recorder.getState()).toEqual({
      operation: "Add liquidity",
      currentStepIndex: 1,
      steps: [
        {
          id: "approve",
          label: "Approve",
          status: "confirmed",
          txHash: firstHash,
        },
        {
          id: "deposit",
          label: "Deposit",
          status: "error",
          error: { message: ratioChangedMessage },
        },
      ],
    });
  });

  it("surfaces reverted receipts while preserving the pools-friendly error copy", async () => {
    const recorder = createFlowRecorder();

    estimateGasMock.mockResolvedValueOnce(100n);
    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "reverted",
    } as never);

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Remove liquidity",
      [
        {
          id: "remove",
          label: "Remove",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000004",
            data: "0x04",
            value: 0n,
          }),
        },
      ],
    );

    expect(result).toEqual({ success: false, txHashes: [] });
    expect(recorder.getState()).toEqual({
      operation: "Remove liquidity",
      currentStepIndex: 0,
      steps: [
        {
          id: "remove",
          label: "Remove",
          status: "error",
          error: {
            message:
              "Transaction was reverted. Please check your inputs and try again.",
          },
          txHash: firstHash,
        },
      ],
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[LiquidityFlow] Step "Remove" failed:',
      expect.objectContaining({ message: "Transaction reverted on-chain" }),
    );
  });

  it("clears the flow entirely on user rejection", async () => {
    const recorder = createFlowRecorder();

    estimateGasMock.mockResolvedValueOnce(100n);
    sendTransactionMock.mockRejectedValueOnce(new Error("User rejected"));

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Add liquidity",
      [
        {
          id: "approve",
          label: "Approve",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000005",
            data: "0x05",
            value: 0n,
          }),
        },
      ],
    );

    expect(result).toEqual({ success: false, txHashes: [] });
    expect(recorder.snapshots.at(-1)).toBeNull();
    expect(recorder.getState()).toBeNull();
  });

  it("falls back to wallet gas estimation and still spreads fee overrides", async () => {
    const recorder = createFlowRecorder();

    estimateGasMock.mockRejectedValueOnce(new Error("rpc timeout"));
    getTransactionFeeOverridesMock.mockResolvedValueOnce({
      maxFeePerGas: 50n,
      maxPriorityFeePerGas: 5n,
    });
    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Rebalance",
      [
        {
          id: "rebalance",
          label: "Rebalance",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000006",
            data: "0x06",
            value: 3n,
          }),
        },
      ],
      80002,
    );

    expect(result).toEqual({ success: true, txHashes: [firstHash] });
    expect(sendTransactionMock).toHaveBeenCalledWith(wagmiConfig, {
      to: "0x0000000000000000000000000000000000000006",
      data: "0x06",
      value: 3n,
      chainId: 80002,
      maxFeePerGas: 50n,
      maxPriorityFeePerGas: 5n,
    });
    expect(sendTransactionMock.mock.calls[0]?.[1]).not.toHaveProperty("gas");
  });

  it("aborts on deterministic estimate reverts without sending the transaction", async () => {
    const recorder = createFlowRecorder();

    estimateGasMock.mockRejectedValueOnce(new Error("execution reverted"));

    const result = await executeLiquidityFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "Rebalance",
      [
        {
          id: "rebalance",
          label: "Rebalance",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000007",
            data: "0x07",
            value: 0n,
          }),
        },
      ],
    );

    expect(result).toEqual({ success: false, txHashes: [] });
    expect(sendTransactionMock).not.toHaveBeenCalled();
    expect(recorder.getState()).toEqual({
      operation: "Rebalance",
      currentStepIndex: 0,
      steps: [
        {
          id: "rebalance",
          label: "Rebalance",
          status: "error",
          error: {
            message:
              "Transaction was reverted. Please check your inputs and try again.",
          },
        },
      ],
    });
  });
});
