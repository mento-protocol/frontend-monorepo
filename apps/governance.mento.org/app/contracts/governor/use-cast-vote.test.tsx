import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WriteContractErrorType } from "@repo/web3/wagmi";

const MENTO_GOVERNOR_ADDRESS = "0x1111111111111111111111111111111111111111";

const writeContractMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@repo/web3", () => ({
  GovernorABI: [],
  useContracts: () => ({
    MentoGovernor: { address: MENTO_GOVERNOR_ADDRESS },
  }),
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ chainId: 42220 }),
  useWriteContract: () => ({
    writeContract: writeContractMock,
    isPending: false,
    data: undefined,
    error: undefined,
  }),
  useWaitForTransactionReceipt: () => ({
    isLoading: false,
    isSuccess: false,
  }),
}));

vi.mock("@repo/ui", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock("@/hooks/use-current-chain", () => ({
  useCurrentChain: () => undefined,
}));

vi.mock("@/contracts/governor/use-proposal", () => ({
  ProposalQueryKey: "proposal",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

const { useCastVote } = await import("./use-cast-vote");

describe("useCastVote", () => {
  it("calls castVote on the governor, invalidates the proposal query, and runs the caller's onSuccess", () => {
    writeContractMock.mockImplementation((_config, options) => {
      options.onSuccess();
    });

    const { result } = renderHook(() => useCastVote());
    const onSuccess = vi.fn();

    act(() => {
      result.current.castVote(1n, 1, onSuccess);
    });

    expect(writeContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MENTO_GOVERNOR_ADDRESS,
        functionName: "castVote",
        args: [1n, 1],
      }),
      expect.anything(),
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["proposal"],
    });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("passes the write error through to the caller's onError", () => {
    const writeError = new Error("boom") as unknown as WriteContractErrorType;
    writeContractMock.mockImplementation((_config, options) => {
      options.onError(writeError);
    });

    const { result } = renderHook(() => useCastVote());
    const onError = vi.fn();

    act(() => {
      result.current.castVote(1n, 1, undefined, onError);
    });

    expect(onError).toHaveBeenCalledWith(writeError);
  });
});
