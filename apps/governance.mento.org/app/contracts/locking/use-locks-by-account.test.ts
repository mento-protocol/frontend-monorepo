import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GetLocksDocument } from "@/graphql/subgraph/generated/subgraph";

const useQueryMock = vi.fn();
const reportSubgraphErrorMock = vi.fn();

vi.mock("@/config", () => ({
  getSubgraphApiName: () => "governance",
}));

vi.mock("@apollo/client/react", () => ({
  useQuery: useQueryMock,
}));

vi.mock("@/utils/report-subgraph-error", () => ({
  reportSubgraphError: reportSubgraphErrorMock,
}));

vi.mock("@repo/web3", () => ({
  useEnsureChainId: () => 42220,
}));

vi.mock("./use-locking-week", () => ({
  useLockingWeek: () => ({ currentWeek: 1 }),
}));

const { useLocksByAccount } = await import("./use-locks-by-account");

describe("useLocksByAccount", () => {
  it("ignores stale cached locks and errors while the account query is skipped", () => {
    const staleError = new Error("stale error");
    useQueryMock.mockReturnValue({
      data: {
        locks: [
          {
            amount: "100",
            cliff: 0,
            delegate: { id: "0xabc" },
            lockCreate: [],
            lockId: "1",
            owner: { id: "0xabc" },
            relocked: false,
            replacedBy: null,
            replaces: null,
            slope: 1,
            time: "1",
          },
        ],
      },
      error: staleError,
      loading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() =>
      useLocksByAccount({ account: undefined }),
    );

    expect(useQueryMock).toHaveBeenCalledWith(
      GetLocksDocument,
      expect.objectContaining({
        skip: true,
        variables: { address: "" },
      }),
    );
    expect(result.current.locks).toEqual([]);
    expect(result.current.error).toBeUndefined();
    expect(reportSubgraphErrorMock).not.toHaveBeenCalled();
  });
});
