import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BorrowFlowState } from "../atoms/flow-atoms";

vi.mock("wagmi/actions", () => ({
  estimateGas: vi.fn(),
  getChainId: vi.fn(),
  sendTransaction: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock("@/utils/transaction-fees", () => ({
  getTransactionFeeOverrides: vi.fn(),
}));

const { executeFlow } = await import("./flow");
const wagmiActions = await import("wagmi/actions");
const transactionFees = await import("@/utils/transaction-fees");

const estimateGasMock = vi.mocked(wagmiActions.estimateGas);
const getChainIdMock = vi.mocked(wagmiActions.getChainId);
const sendTransactionMock = vi.mocked(wagmiActions.sendTransaction);
const waitForTransactionReceiptMock = vi.mocked(
  wagmiActions.waitForTransactionReceipt,
);
const getTransactionFeeOverridesMock = vi.mocked(
  transactionFees.getTransactionFeeOverrides,
);

function createFlowRecorder() {
  let state: BorrowFlowState | null = null;
  const snapshots: Array<BorrowFlowState | null> = [];

  const setFlowAtom = (
    update:
      | BorrowFlowState
      | null
      | ((prev: BorrowFlowState | null) => BorrowFlowState | null),
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

describe("executeFlow", () => {
  const wagmiConfig = {} as never;
  const account = "0x00000000000000000000000000000000000000aa";
  const firstHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const secondHash =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  beforeEach(() => {
    vi.clearAllMocks();
    getChainIdMock.mockReturnValue(42220);
    estimateGasMock.mockResolvedValue(100n);
    getTransactionFeeOverridesMock.mockResolvedValue({});
  });

  it("runs a two-step happy path and preserves the borrow flow shape", async () => {
    const recorder = createFlowRecorder();
    const approveBuildTx = vi.fn().mockResolvedValue({
      to: "0x0000000000000000000000000000000000000011",
      data: "0x11",
      value: 1n,
    });
    const openBuildTx = vi.fn().mockResolvedValue({
      to: "0x0000000000000000000000000000000000000012",
      data: "0x12",
      value: 2n,
    });

    sendTransactionMock
      .mockResolvedValueOnce(firstHash as never)
      .mockResolvedValueOnce(secondHash as never);
    waitForTransactionReceiptMock
      .mockResolvedValueOnce({ status: "success" } as never)
      .mockResolvedValueOnce({ status: "success" } as never);

    const result = await executeFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "open-trove",
      "Open Trove",
      account,
      [
        { id: "approve", label: "Approve", buildTx: approveBuildTx },
        { id: "open", label: "Open", buildTx: openBuildTx },
      ],
      { successHref: "/borrow/manage/1?token=GBPm" },
    );

    expect(result).toEqual({
      success: true,
      txHashes: [firstHash, secondHash],
    });
    expect(sendTransactionMock).toHaveBeenNthCalledWith(1, wagmiConfig, {
      account,
      to: "0x0000000000000000000000000000000000000011",
      data: "0x11",
      value: 1n,
      chainId: 42220,
      gas: 125n,
    });
    expect(sendTransactionMock).toHaveBeenNthCalledWith(2, wagmiConfig, {
      account,
      to: "0x0000000000000000000000000000000000000012",
      data: "0x12",
      value: 2n,
      chainId: 42220,
      gas: 125n,
    });
    expect(waitForTransactionReceiptMock).toHaveBeenNthCalledWith(
      1,
      wagmiConfig,
      { hash: firstHash, confirmations: 3 },
    );
    expect(waitForTransactionReceiptMock).toHaveBeenNthCalledWith(
      2,
      wagmiConfig,
      { hash: secondHash, confirmations: 3 },
    );
    expect(recorder.snapshots).toEqual([
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 0,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          { id: "approve", label: "Approve", status: "idle" },
          { id: "open", label: "Open", status: "idle" },
        ],
      },
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 0,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          { id: "approve", label: "Approve", status: "pending" },
          { id: "open", label: "Open", status: "idle" },
        ],
      },
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 0,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirming",
            txHash: firstHash,
          },
          { id: "open", label: "Open", status: "idle" },
        ],
      },
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 1,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          { id: "open", label: "Open", status: "idle" },
        ],
      },
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 1,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          { id: "open", label: "Open", status: "pending" },
        ],
      },
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 1,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          {
            id: "open",
            label: "Open",
            status: "confirming",
            txHash: secondHash,
          },
        ],
      },
      {
        flowId: "open-trove",
        operation: "Open Trove",
        currentStepIndex: 2,
        account,
        successHref: "/borrow/manage/1?token=GBPm",
        steps: [
          {
            id: "approve",
            label: "Approve",
            status: "confirmed",
            txHash: firstHash,
          },
          {
            id: "open",
            label: "Open",
            status: "confirmed",
            txHash: secondHash,
          },
        ],
      },
    ]);
    expect(recorder.getState()).toEqual({
      flowId: "open-trove",
      operation: "Open Trove",
      currentStepIndex: 2,
      account,
      successHref: "/borrow/manage/1?token=GBPm",
      steps: [
        {
          id: "approve",
          label: "Approve",
          status: "confirmed",
          txHash: firstHash,
        },
        {
          id: "open",
          label: "Open",
          status: "confirmed",
          txHash: secondHash,
        },
      ],
    });
  });

  it("marks skipped steps as confirmed with an exact skipped label", async () => {
    const recorder = createFlowRecorder();

    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "close-trove",
      "Close Trove",
      account,
      [
        {
          id: "approve",
          label: "Approve",
          buildTx: vi.fn().mockResolvedValue(null),
        },
        {
          id: "close",
          label: "Close",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000013",
            data: "0x13",
            value: 0n,
          }),
        },
      ],
    );

    expect(result).toEqual({ success: true, txHashes: [firstHash] });
    expect(sendTransactionMock).toHaveBeenCalledTimes(1);
    expect(recorder.snapshots[1]).toEqual({
      flowId: "close-trove",
      operation: "Close Trove",
      currentStepIndex: 1,
      account,
      successHref: undefined,
      steps: [
        {
          id: "approve",
          label: "Approve — Skipped",
          status: "confirmed",
        },
        { id: "close", label: "Close", status: "idle" },
      ],
    });
  });

  it("marks the failing step as error, aborts, and does not build later steps", async () => {
    const recorder = createFlowRecorder();
    const stepThreeBuildTx = vi.fn();

    sendTransactionMock
      .mockResolvedValueOnce(firstHash as never)
      .mockRejectedValueOnce(new Error("rpc exploded"));
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "adjust-trove",
      "Adjust Trove",
      account,
      [
        {
          id: "approve",
          label: "Approve",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000014",
            data: "0x14",
            value: 1n,
          }),
        },
        {
          id: "adjust",
          label: "Adjust",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000015",
            data: "0x15",
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
      flowId: "adjust-trove",
      operation: "Adjust Trove",
      currentStepIndex: 1,
      account,
      successHref: undefined,
      steps: [
        {
          id: "approve",
          label: "Approve",
          status: "confirmed",
          txHash: firstHash,
        },
        {
          id: "adjust",
          label: "Adjust",
          status: "error",
          error: { name: "Error", message: "rpc exploded" },
        },
        { id: "stake", label: "Stake", status: "idle" },
      ],
    });
  });

  it("stores the raw reverted receipt message on the failing borrow step", async () => {
    const recorder = createFlowRecorder();

    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "reverted",
    } as never);

    const result = await executeFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "withdraw-sp",
      "Withdraw SP",
      account,
      [
        {
          id: "withdraw",
          label: "Withdraw",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000016",
            data: "0x16",
            value: 0n,
          }),
        },
      ],
    );

    expect(result).toEqual({ success: false, txHashes: [] });
    expect(recorder.getState()).toEqual({
      flowId: "withdraw-sp",
      operation: "Withdraw SP",
      currentStepIndex: 0,
      account,
      successHref: undefined,
      steps: [
        {
          id: "withdraw",
          label: "Withdraw",
          status: "error",
          txHash: firstHash,
          error: { name: "Error", message: "Transaction reverted on-chain" },
        },
      ],
    });
  });

  it("falls back to wallet estimation, applies fee overrides, and keeps three confirmations", async () => {
    const recorder = createFlowRecorder();

    getChainIdMock.mockReturnValueOnce(80002);
    estimateGasMock.mockRejectedValueOnce(new Error("rpc timeout"));
    getTransactionFeeOverridesMock.mockResolvedValueOnce({
      maxFeePerGas: 50n,
      maxPriorityFeePerGas: 5n,
    });
    sendTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTransactionReceiptMock.mockResolvedValueOnce({
      status: "success",
    } as never);

    const result = await executeFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "deposit-sp",
      "Deposit SP",
      account,
      [
        {
          id: "deposit",
          label: "Deposit",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000018",
            data: "0x18",
            value: 0n,
          }),
        },
      ],
    );

    expect(result).toEqual({ success: true, txHashes: [firstHash] });
    expect(sendTransactionMock).toHaveBeenCalledWith(wagmiConfig, {
      account,
      to: "0x0000000000000000000000000000000000000018",
      data: "0x18",
      value: 0n,
      chainId: 80002,
      maxFeePerGas: 50n,
      maxPriorityFeePerGas: 5n,
    });
    expect(sendTransactionMock.mock.calls[0]?.[1]).not.toHaveProperty("gas");
    expect(waitForTransactionReceiptMock).toHaveBeenCalledWith(wagmiConfig, {
      hash: firstHash,
      confirmations: 3,
    });
  });

  it("keeps the flow state and marks the step as error on user rejection", async () => {
    const recorder = createFlowRecorder();

    sendTransactionMock.mockRejectedValueOnce(
      new Error("Transaction rejected by user"),
    );

    const result = await executeFlow(
      wagmiConfig,
      recorder.setFlowAtom,
      "claim-rewards",
      "Claim Rewards",
      account,
      [
        {
          id: "claim",
          label: "Claim",
          buildTx: vi.fn().mockResolvedValue({
            to: "0x0000000000000000000000000000000000000017",
            data: "0x17",
            value: 0n,
          }),
        },
      ],
      { successHref: "/borrow/manage/claim" },
    );

    expect(result).toEqual({ success: false, txHashes: [] });
    expect(recorder.getState()).toEqual({
      flowId: "claim-rewards",
      operation: "Claim Rewards",
      currentStepIndex: 0,
      account,
      successHref: "/borrow/manage/claim",
      steps: [
        {
          id: "claim",
          label: "Claim",
          status: "error",
          error: {
            name: "Error",
            message: "Transaction rejected by user",
          },
        },
      ],
    });
    expect(recorder.snapshots.at(-1)).not.toBeNull();
  });
});
