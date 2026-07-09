// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { TokenSymbol } from "@mento-protocol/mento-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendTransactionAsyncMock = vi.fn();
let mockTxRequest: { to: string; data: string } | null = null;

vi.mock("wagmi", () => ({
  useEstimateGas: () => ({ data: undefined, error: null }),
  useSendTransaction: () => ({
    data: undefined,
    isPending: false,
    isSuccess: false,
    sendTransactionAsync: sendTransactionAsyncMock,
    reset: vi.fn(),
  }),
  useWaitForTransactionReceipt: () => ({ data: undefined, isSuccess: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ error: null, data: mockTxRequest }),
}));
vi.mock("@repo/ui", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/utils", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/config/chains", () => ({ chainIdToChain: {} })); // real module imports .svg — unloadable in vitest
vi.mock("@mento-protocol/mento-sdk", () => ({
  getTokenAddress: vi.fn(),
  getContractAddress: vi.fn(),
}));

const { useApproveTransaction } = await import("./use-approve-transaction");

const VALID_ADDRESS = "0x471ece3750da237f93b8e339c536989b8978a438"; // lowercase — passes real validateAddress

function renderApproveHook() {
  return renderHook(() =>
    useApproveTransaction({
      chainId: 42220,
      tokenInSymbol: "cUSD" as TokenSymbol,
      tokenOutSymbol: "CELO" as TokenSymbol,
      amountInWei: "1000000000000000000",
      accountAddress: VALID_ADDRESS as `0x${string}`,
    }),
  );
}

describe("sendApproveTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTxRequest = null;
  });

  it("dispatches on a later call after an early return while txRequest was not ready", async () => {
    const { result, rerender } = renderApproveHook();

    await act(async () => {
      expect(await result.current.sendApproveTx()).toBeNull(); // early return, no dispatch
    });
    expect(sendTransactionAsyncMock).not.toHaveBeenCalled();

    mockTxRequest = { to: VALID_ADDRESS, data: "0x095ea7b3" }; // txRequest now ready
    rerender();

    sendTransactionAsyncMock.mockResolvedValueOnce("0xhash");
    await act(async () => {
      expect(await result.current.sendApproveTx()).toBe("0xhash"); // fails on unfixed code
    });
    expect(sendTransactionAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks a second call while a send is in flight", async () => {
    mockTxRequest = { to: VALID_ADDRESS, data: "0x095ea7b3" };
    const { result } = renderApproveHook();

    let resolveSend!: (hash: string) => void;
    sendTransactionAsyncMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSend = resolve)),
    );

    await act(async () => {
      const first = result.current.sendApproveTx();
      const second = result.current.sendApproveTx();
      expect(await second).toBeNull(); // re-entrancy guard still active
      resolveSend("0xhash");
      await first;
    });
    expect(sendTransactionAsyncMock).toHaveBeenCalledTimes(1);
  });
});
