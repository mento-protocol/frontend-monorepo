import { ProposalState } from "@/graphql/subgraph/generated/subgraph";

export type VoteCardState =
  | "loading"
  | "confirming"
  | "signing"
  | "succeeded"
  | "voted"
  | "finished"
  | "executed"
  | "queued"
  | "defeated"
  | "canceled"
  | "expired"
  | "pending"
  | "insufficient-mento"
  | "ready";

export interface VoteCardStateInputs {
  isInitializing: boolean;
  isConfirmed: boolean;
  isConfirming: boolean;
  isExecuteConfirming: boolean;
  isQueueConfirming: boolean;
  isQueueConfirmed: boolean;
  isQueueTransactionPending: boolean;
  isAwaitingUserSignature: boolean;
  isAwaitingExecuteSignature: boolean;
  isAwaitingQueueSignature: boolean;
  hasVoted: boolean;
  hasEnoughLockedMentoToVote: boolean;
  isConnected: boolean;
  isVotingOpen: boolean;
  proposalState: ProposalState;
  isDeadlinePassed: boolean;
}

export function deriveVoteCardState({
  isInitializing,
  isConfirmed,
  isConfirming,
  isExecuteConfirming,
  isQueueConfirming,
  isQueueConfirmed,
  isQueueTransactionPending,
  isAwaitingUserSignature,
  isAwaitingExecuteSignature,
  isAwaitingQueueSignature,
  hasVoted,
  hasEnoughLockedMentoToVote,
  isConnected,
  isVotingOpen,
  proposalState,
  isDeadlinePassed,
}: VoteCardStateInputs): VoteCardState {
  if (isInitializing) return "loading";

  if (isConfirming || isExecuteConfirming || isQueueConfirming) {
    return "confirming";
  }

  if (
    isAwaitingUserSignature ||
    isAwaitingExecuteSignature ||
    isAwaitingQueueSignature
  ) {
    return "signing";
  }

  if (proposalState === ProposalState.Succeeded && isQueueConfirmed) {
    return "succeeded";
  }

  if ((proposalState === ProposalState.Active && hasVoted) || isConfirmed) {
    return "voted";
  }

  if (!isVotingOpen) {
    if (proposalState === ProposalState.Active && isDeadlinePassed) {
      return "finished";
    }

    switch (proposalState) {
      case ProposalState.Executed:
        return "executed";
      case ProposalState.Queued:
        return "queued";
      case ProposalState.Succeeded:
        if (isQueueTransactionPending) return "confirming";
        return "succeeded";
      case ProposalState.Defeated:
        return "defeated";
      case ProposalState.Canceled:
        return "canceled";
      case ProposalState.Expired:
        return "expired";
      case ProposalState.Pending:
        return "pending";
      default:
        return "finished";
    }
  }

  if (!hasEnoughLockedMentoToVote && isConnected) {
    return "insufficient-mento";
  }

  return "ready";
}
