import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const MENTO_GOVERNOR_ADDRESS = "0x1111111111111111111111111111111111111111";
const ENSURED_CHAIN_ID = 42220;

const useReadContractMock = vi.fn();

vi.mock("@repo/web3", () => ({
  GovernorABI: [],
  useContracts: () => ({
    MentoGovernor: { address: MENTO_GOVERNOR_ADDRESS },
  }),
  useEnsureChainId: () => ENSURED_CHAIN_ID,
}));

vi.mock("@repo/web3/wagmi", () => ({
  useReadContract: (...args: unknown[]) => useReadContractMock(...args),
}));

const { useQuorum } = await import("./use-quorum");

describe("useQuorum", () => {
  it("reads the governor's quorum for the given block number", () => {
    useReadContractMock.mockReturnValue({ data: 720_000n });

    const blockNumber = 123n;
    renderHook(() => useQuorum(blockNumber));

    expect(useReadContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: MENTO_GOVERNOR_ADDRESS,
        functionName: "quorum",
        args: [blockNumber],
        chainId: ENSURED_CHAIN_ID,
      }),
    );
  });

  it("returns the mocked quorum value", () => {
    useReadContractMock.mockReturnValue({ data: 720_000n });

    const { result } = renderHook(() => useQuorum(123n));

    expect(result.current.quorumNeeded).toBe(720_000n);
  });

  it("returns 0n as-is for the zero-supply edge case, not undefined", () => {
    useReadContractMock.mockReturnValue({ data: 0n });

    const { result } = renderHook(() => useQuorum(123n));

    expect(result.current.quorumNeeded).toBe(0n);
  });
});
