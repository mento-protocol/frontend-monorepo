// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  block: 50n as bigint | undefined,
  chainId: 42220 as number | undefined,
  endTimestamp: 1_800_000_000n as bigint | undefined,
  loading: false,
  proposal: undefined as Record<string, unknown> | undefined,
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "1" }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@repo/web3", () => ({
  CELO_BLOCK_TIME: 5000,
  ensureChainId: (id?: number) => id ?? 42220,
}));
vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({ chainId: mocks.chainId }),
  useBlockNumber: () => ({ data: mocks.block }),
  useBlock: () => ({
    data:
      mocks.endTimestamp === undefined
        ? undefined
        : { timestamp: mocks.endTimestamp },
  }),
}));
vi.mock("@/contracts/governor", () => ({
  useProposal: () => ({
    proposal: mocks.proposal,
    isLoading: mocks.loading,
    refetch: mocks.refetch,
  }),
}));
vi.mock("@mento-protocol/ui", () => ({
  IconLoading: () => <span>loading</span>,
}));
vi.mock("./ProposalHeader", () => ({
  ProposalHeader: ({ votingDeadline }: { votingDeadline?: Date }) => (
    <span>header:{votingDeadline?.toISOString() ?? "none"}</span>
  ),
}));
vi.mock("@/components/voting/vote-card", () => ({
  VoteCard: () => <span>vote card</span>,
}));
vi.mock("./execution-code/ExecutionCode", () => ({
  ExecutionCode: ({ transactions }: { transactions: unknown[] }) => (
    <span>execution:{transactions.length}</span>
  ),
}));
vi.mock("./participants/Participants", () => ({
  Participants: () => <span>participants</span>,
}));
vi.mock("./description/ProposalDescription", () => ({
  ProposalDescription: ({ description }: { description?: string }) => (
    <span>description:{description}</span>
  ),
}));
vi.mock("./execution-code/patterns/utils", () => ({
  isEmptyTransaction: (tx: { data: string }) => tx.data === "0x",
}));

import { ProposalContent } from "./content";

function proposal(
  calls: Array<{
    target: { id: string };
    value: string;
    calldata: string;
  }> = [],
) {
  return { endBlock: 100, calls, metadata: { description: "Details" } };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  Object.assign(mocks, {
    block: 50n,
    chainId: 42220,
    endTimestamp: 1_800_000_000n,
    loading: false,
    proposal: undefined,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ProposalContent", () => {
  it("renders loading and missing states", () => {
    mocks.loading = true;
    const { rerender } = render(<ProposalContent />);
    expect(screen.getByText("loading")).toBeTruthy();
    mocks.loading = false;
    rerender(<ProposalContent />);
    expect(screen.getByText("Proposal not found")).toBeTruthy();
  });

  it("uses no deadline without current block data", () => {
    mocks.proposal = proposal();
    mocks.block = undefined;
    render(<ProposalContent />);
    expect(screen.getByText("header:none")).toBeTruthy();
    expect(screen.getByText("execution:0")).toBeTruthy();
  });

  it("estimates a future deadline and detects meaningful calls", () => {
    mocks.proposal = proposal([
      { target: { id: "0xa" }, value: "0", calldata: "0x1234" },
    ]);
    render(<ProposalContent />);
    expect(screen.getByText(/header:2026/)).toBeTruthy();
    expect(screen.getByText("execution:1")).toBeTruthy();
  });

  it("uses the end block timestamp after voting and handles empty or multiple calls", () => {
    mocks.block = 100n;
    mocks.proposal = proposal([
      { target: { id: "0xa" }, value: "0", calldata: "0x" },
    ]);
    const { rerender } = render(<ProposalContent />);
    expect(screen.getByText("header:2027-01-15T08:00:00.000Z")).toBeTruthy();
    mocks.proposal = proposal([
      { target: { id: "0xa" }, value: "0", calldata: "0x" },
      { target: { id: "0xb" }, value: "0", calldata: "0x" },
    ]);
    rerender(<ProposalContent />);
    expect(screen.getByText("execution:2")).toBeTruthy();
  });
});
