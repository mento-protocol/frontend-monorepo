import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Proposal, ProposalState } from "@/graphql/subgraph/generated/subgraph";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  castVote: vi.fn(),
  castVoteError: undefined as unknown,
  castVoteVariables: { args: [1n, 2] },
  executeProposal: vi.fn(),
  queueProposal: vi.fn(),
  cancelProposal: vi.fn(),
  cancelProposalAsProposer: vi.fn(),
  refetchVoteReceipt: vi.fn(),
  voteCardContent: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  voteReceiptData: { hasVoted: true, support: 1 },
}));

vi.mock("@/components/voting/vote-card-content", () => ({
  VoteCardContent: mocks.voteCardContent,
}));

vi.mock("@/components/voting/use-delayed-vote-card-refire", () => ({
  useDelayedVoteCardRefire: vi.fn(),
}));

vi.mock("@/config", () => ({
  getWatchdogMultisigAddress: () =>
    "0x1111111111111111111111111111111111111111",
}));

vi.mock("@/contracts", () => ({
  useLocksByAccount: () => ({ locks: [] }),
}));

vi.mock("@/contracts/governor", () => ({
  useCancelProposalAsProposer: () => ({
    cancelProposalAsProposer: mocks.cancelProposalAsProposer,
    isAwaitingUserSignature: false,
    isConfirming: false,
    isConfirmed: false,
  }),
  useCancelProposalAsWatchdog: () => ({
    hash: undefined,
    cancelProposal: mocks.cancelProposal,
    isAwaitingUserSignature: false,
    isConfirming: false,
    error: undefined,
  }),
  useCastVote: () => ({
    hash: undefined,
    castVote: mocks.castVote,
    variables: mocks.castVoteVariables,
    isAwaitingUserSignature: false,
    isConfirming: false,
    isConfirmed: false,
    error: mocks.castVoteError,
  }),
  useExecuteProposal: () => ({
    hash: undefined,
    executeProposal: mocks.executeProposal,
    isAwaitingUserSignature: false,
    isConfirming: false,
    error: undefined,
  }),
  useIsWatchdog: () => ({
    isWatchdog: false,
    isWatchdogSafe: false,
  }),
  usePendingMultisigCancellation: () => ({
    hasPendingCancellation: false,
    isStatusUnavailable: false,
    signaturesCollected: 0,
    signaturesRequired: 0,
  }),
  useQueueProposal: () => ({
    hash: undefined,
    queueProposal: mocks.queueProposal,
    isAwaitingUserSignature: false,
    isConfirming: false,
    isConfirmed: false,
    error: undefined,
  }),
  useQuorum: () => ({ quorumNeeded: 0n }),
  useVoteReceipt: () => ({
    data: mocks.voteReceiptData,
    isLoading: false,
    refetch: mocks.refetchVoteReceipt,
  }),
}));

vi.mock("@/contracts/governor/utils/get-timelock-operation-id", () => ({
  getTimelockOperationId: () =>
    "0x2222222222222222222222222222222222222222222222222222222222222222",
}));

vi.mock("@/hooks/use-ve-mento-delegation-summary", () => ({
  useVeMentoDelegationSummary: () => ({ ownVe: 0, receivedVe: 0 }),
}));

vi.mock("@repo/web3", () => ({
  NumbersService: {
    parseNumericValue: (value: string) => value,
  },
}));

vi.mock("@repo/web3/wagmi", () => ({
  useAccount: () => ({
    address: undefined,
    isConnecting: false,
    isConnected: false,
  }),
  useChainId: () => 42220,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

const { VoteCard } = await import("./vote-card");

const proposal = {
  calls: [],
  description: "",
  proposalCanceled: [],
  proposalExecuted: [],
  proposalId: 1n,
  proposalQueued: [],
  proposer: { id: "0x3333333333333333333333333333333333333333" },
  startBlock: 1n,
  state: ProposalState.Executed,
  votes: undefined,
} as unknown as Proposal;

beforeEach(() => {
  mocks.castVoteError = undefined;
  mocks.castVoteVariables = { args: [1n, 2] };
  mocks.voteReceiptData = { hasVoted: true, support: 1 };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VoteCard", () => {
  it("passes pending and recorded vote support to the extracted content separately", () => {
    render(<VoteCard proposal={proposal} votingDeadline={undefined} />);

    const contentProps = mocks.voteCardContent.mock.calls.at(-1)?.[0] as
      | {
          pendingVoteSupport: number | undefined;
          recordedVoteSupport: number | undefined;
        }
      | undefined;

    expect(contentProps).toMatchObject({
      pendingVoteSupport: 2,
      recordedVoteSupport: 1,
    });
  });

  it("captures a cast-vote hook error only once per error object", () => {
    const voteError = new Error("execution reverted");
    mocks.castVoteError = voteError;

    const { rerender } = render(
      <VoteCard proposal={proposal} votingDeadline={undefined} />,
    );

    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(mocks.captureException).toHaveBeenCalledWith(voteError);

    mocks.castVoteError = undefined;
    rerender(<VoteCard proposal={proposal} votingDeadline={undefined} />);
    mocks.castVoteError = voteError;
    rerender(<VoteCard proposal={proposal} votingDeadline={undefined} />);

    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("does not capture a rejected cast-vote request", () => {
    mocks.castVoteError = new Error("User rejected request");

    render(<VoteCard proposal={proposal} votingDeadline={undefined} />);

    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
