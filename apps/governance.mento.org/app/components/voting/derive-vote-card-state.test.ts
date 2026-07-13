import { ProposalState } from "@/graphql/subgraph/generated/subgraph";
import { describe, expect, it } from "vitest";
import {
  deriveVoteCardState,
  type VoteCardStateInputs,
} from "./derive-vote-card-state";

function makeInputs(
  overrides: Partial<VoteCardStateInputs> = {},
): VoteCardStateInputs {
  return {
    isInitializing: false,
    isConfirmed: false,
    isConfirming: false,
    isExecuteConfirming: false,
    isQueueConfirming: false,
    isQueueConfirmed: false,
    isQueueTransactionPending: false,
    isAwaitingUserSignature: false,
    isAwaitingExecuteSignature: false,
    isAwaitingQueueSignature: false,
    hasVoted: false,
    hasEnoughLockedMentoToVote: true,
    isConnected: true,
    isVotingOpen: true,
    proposalState: ProposalState.Active,
    isDeadlinePassed: false,
    ...overrides,
  };
}

describe("deriveVoteCardState", () => {
  it("returns loading when initialization is in progress", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          isInitializing: true,
          isConfirming: true,
          proposalState: ProposalState.Executed,
          isVotingOpen: false,
        }),
      ),
    ).toBe("loading");
  });

  it("returns confirming while a vote transaction is confirming", () => {
    expect(deriveVoteCardState(makeInputs({ isConfirming: true }))).toBe(
      "confirming",
    );
  });

  it("returns signing while awaiting a wallet signature", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          isAwaitingUserSignature: true,
          proposalState: ProposalState.Canceled,
          isVotingOpen: false,
        }),
      ),
    ).toBe("signing");
  });

  it("returns succeeded after a succeeded proposal queue confirmation", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Succeeded,
          isVotingOpen: false,
          isQueueConfirmed: true,
        }),
      ),
    ).toBe("succeeded");
  });

  it("returns voted for an active proposal after the voter has voted", () => {
    expect(deriveVoteCardState(makeInputs({ hasVoted: true }))).toBe("voted");
  });

  it("returns voted after a vote confirmation even before receipt refresh", () => {
    expect(deriveVoteCardState(makeInputs({ isConfirmed: true }))).toBe(
      "voted",
    );
  });

  it("returns finished when active voting has passed its deadline", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          isVotingOpen: false,
          isDeadlinePassed: true,
        }),
      ),
    ).toBe("finished");
  });

  it("returns executed for executed proposals", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Executed,
          isVotingOpen: false,
        }),
      ),
    ).toBe("executed");
  });

  it("returns queued for queued proposals", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Queued,
          isVotingOpen: false,
        }),
      ),
    ).toBe("queued");
  });

  it("returns defeated for defeated proposals", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Defeated,
          isVotingOpen: false,
        }),
      ),
    ).toBe("defeated");
  });

  it("returns canceled for canceled proposals", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Canceled,
          isVotingOpen: false,
        }),
      ),
    ).toBe("canceled");
  });

  it("returns expired for expired proposals", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Expired,
          isVotingOpen: false,
        }),
      ),
    ).toBe("expired");
  });

  it("returns pending for pending proposals", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Pending,
          isVotingOpen: false,
        }),
      ),
    ).toBe("pending");
  });

  it("returns insufficient-mento for connected voters without voting power", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          hasEnoughLockedMentoToVote: false,
        }),
      ),
    ).toBe("insufficient-mento");
  });

  it("returns ready for a disconnected voter while voting is open", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          hasEnoughLockedMentoToVote: false,
          isConnected: false,
        }),
      ),
    ).toBe("ready");
  });

  it("keeps confirming precedence over terminal states", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          isExecuteConfirming: true,
          proposalState: ProposalState.Executed,
          isVotingOpen: false,
        }),
      ),
    ).toBe("confirming");
  });

  it("keeps signing precedence over terminal states", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          isAwaitingQueueSignature: true,
          proposalState: ProposalState.Queued,
          isVotingOpen: false,
        }),
      ),
    ).toBe("signing");
  });

  it("returns confirming for a succeeded proposal while the queue transaction is pending", () => {
    expect(
      deriveVoteCardState(
        makeInputs({
          proposalState: ProposalState.Succeeded,
          isVotingOpen: false,
          isQueueTransactionPending: true,
        }),
      ),
    ).toBe("confirming");
  });
});
