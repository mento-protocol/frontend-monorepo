import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BorrowFlowState } from "../atoms/flow-atoms";

vi.mock("./send-tx", () => ({
  sendSdkTransaction: vi.fn(),
  waitForTx: vi.fn(),
}));

const { executeFlow } = await import("./engine");
const sendTxModule = await import("./send-tx");

const sendSdkTransactionMock = vi.mocked(sendTxModule.sendSdkTransaction);
const waitForTxMock = vi.mocked(sendTxModule.waitForTx);

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

    sendSdkTransactionMock
      .mockResolvedValueOnce(firstHash as never)
      .mockResolvedValueOnce(secondHash as never);
    waitForTxMock
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
    expect(sendSdkTransactionMock).toHaveBeenNthCalledWith(
      1,
      wagmiConfig,
      {
        to: "0x0000000000000000000000000000000000000011",
        data: "0x11",
        value: 1n,
      },
      undefined,
      account,
    );
    expect(sendSdkTransactionMock).toHaveBeenNthCalledWith(
      2,
      wagmiConfig,
      {
        to: "0x0000000000000000000000000000000000000012",
        data: "0x12",
        value: 2n,
      },
      undefined,
      account,
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

    sendSdkTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTxMock.mockResolvedValueOnce({ status: "success" } as never);

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
    expect(sendSdkTransactionMock).toHaveBeenCalledTimes(1);
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

    sendSdkTransactionMock
      .mockResolvedValueOnce(firstHash as never)
      .mockRejectedValueOnce(new Error("rpc exploded"));
    waitForTxMock.mockResolvedValueOnce({ status: "success" } as never);

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

    sendSdkTransactionMock.mockResolvedValueOnce(firstHash as never);
    waitForTxMock.mockResolvedValueOnce({ status: "reverted" } as never);

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

  it("keeps the flow state and marks the step as error on user rejection", async () => {
    const recorder = createFlowRecorder();

    sendSdkTransactionMock.mockRejectedValueOnce(
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
