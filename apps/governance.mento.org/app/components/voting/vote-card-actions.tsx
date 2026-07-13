import { TransactionLink } from "@/components/proposal/components/TransactionLink";
import {
  ProposerCancelActionProps,
  VoteCardCancelActions,
  WatchdogCancelActionProps,
} from "@/components/voting/vote-card-cancel-actions";
import { VoteCardState } from "@/components/voting/derive-vote-card-state";
import { Proposal, ProposalState } from "@/graphql/subgraph/generated/subgraph";
import { Button } from "@mento-protocol/ui";
import { ConnectButton } from "@repo/web3";
import Link from "next/link";

interface VoteCardActionsProps {
  currentState: VoteCardState;
  address: string | undefined;
  proposal: Proposal;
  proposalState: ProposalState;
  hasVoted: boolean | undefined;
  isVotedForApprove: boolean;
  isVotedForAbstain: boolean;
  isVotedForReject: boolean;
  queueEndTime: Date | null;
  isVetoPeriodOver: boolean;
  isDeadlinePassed: boolean;
  isAwaitingUserSignature: boolean;
  isConfirming: boolean;
  isAwaitingExecuteSignature: boolean;
  isExecuteConfirming: boolean;
  isAwaitingQueueSignature: boolean;
  isQueueConfirming: boolean;
  onExecute: () => void;
  onQueue: () => void;
  onVote: (support: number) => void;
  watchdogCancelAction: WatchdogCancelActionProps;
  proposerCancelAction: ProposerCancelActionProps;
}

const usedVoteOptionButtonLocator = "usedVoteOptionButton";

export const VoteCardActions = ({
  currentState,
  address,
  proposal,
  proposalState,
  hasVoted,
  isVotedForApprove,
  isVotedForAbstain,
  isVotedForReject,
  queueEndTime,
  isVetoPeriodOver,
  isDeadlinePassed,
  isAwaitingUserSignature,
  isConfirming,
  isAwaitingExecuteSignature,
  isExecuteConfirming,
  isAwaitingQueueSignature,
  isQueueConfirming,
  onExecute,
  onQueue,
  onVote,
  watchdogCancelAction,
  proposerCancelAction,
}: VoteCardActionsProps) => {
  switch (currentState) {
    case "loading":
    case "confirming":
    case "signing":
      return null;

    case "insufficient-mento":
      return (
        <Button variant="default" size="lg" clipped="default" asChild>
          <Link href="/voting-power">Lock MENTO Tokens</Link>
        </Button>
      );

    case "voted":
    case "defeated":
    case "expired":
    case "finished":
      if (hasVoted) {
        return (
          <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
            {isVotedForApprove && (
              <Button
                variant="approve"
                size="lg"
                data-testid={usedVoteOptionButtonLocator}
                disabled
              >
                Your vote: YES
              </Button>
            )}
            {isVotedForAbstain && (
              <Button
                variant="abstain"
                size="lg"
                data-testid={usedVoteOptionButtonLocator}
                disabled
              >
                Your vote: Abstain
              </Button>
            )}
            {isVotedForReject && (
              <Button
                variant="reject"
                size="lg"
                data-testid={usedVoteOptionButtonLocator}
                disabled
              >
                Your vote: NO
              </Button>
            )}
          </div>
        );
      }

      return null;

    case "queued": {
      const canExecute = queueEndTime && isVetoPeriodOver;

      if (!address) {
        return (
          <div className="col-span-full flex justify-center">
            <ConnectButton
              size="lg"
              text={
                canExecute ? "Connect Wallet to Execute" : "Proposal Queued"
              }
              fullWidth
              disabled={!canExecute}
            />
          </div>
        );
      }

      if (canExecute) {
        return (
          <div className="gap-4 flex flex-col">
            <Button
              variant="default"
              size="lg"
              clipped="default"
              onClick={onExecute}
              disabled={isAwaitingExecuteSignature || isExecuteConfirming}
              data-testid="executeProposalButton"
              className="w-full"
            >
              {isAwaitingExecuteSignature
                ? "Confirm in Wallet"
                : isExecuteConfirming
                  ? "Executing..."
                  : "Execute Proposal"}
            </Button>
            <VoteCardCancelActions
              watchdogCancelAction={watchdogCancelAction}
            />
          </div>
        );
      }

      return (
        <div className="gap-4 flex flex-col">
          <Button
            variant="default"
            size="lg"
            clipped="default"
            disabled
            className="w-full"
          >
            In Veto Period
          </Button>
          <VoteCardCancelActions watchdogCancelAction={watchdogCancelAction} />
        </div>
      );
    }

    case "executed": {
      const executionTxHash = proposal.proposalExecuted?.[0]?.transaction?.id;

      return (
        <div className="flex justify-center">
          {executionTxHash ? (
            <Button variant="outline" size="lg" asChild>
              <TransactionLink txHash={executionTxHash} className="w-full">
                View Execution Transaction
              </TransactionLink>
            </Button>
          ) : (
            <Button variant="default" size="lg" disabled>
              Proposal Executed
            </Button>
          )}
        </div>
      );
    }

    case "succeeded":
      if (!address) {
        return (
          <div className="col-span-full flex justify-center">
            <ConnectButton size="lg" text="Connect Wallet to Queue" fullWidth />
          </div>
        );
      }

      return (
        <div className="gap-4 flex flex-col">
          <Button
            variant="default"
            size="lg"
            clipped="default"
            onClick={onQueue}
            disabled={isAwaitingQueueSignature || isQueueConfirming}
            data-testid="queueProposalButton"
            className="w-full"
          >
            {isAwaitingQueueSignature
              ? "Confirm in Wallet"
              : isQueueConfirming
                ? "Queueing..."
                : "Queue for Execution"}
          </Button>
          <VoteCardCancelActions
            watchdogCancelAction={watchdogCancelAction}
            proposerCancelAction={proposerCancelAction}
          />
        </div>
      );

    case "pending":
      return (
        <>
          <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
            <Button variant="approve" size="lg" disabled>
              Voting Not Started
            </Button>
            <Button variant="abstain" size="lg" disabled>
              Voting Not Started
            </Button>
            <Button variant="reject" size="lg" disabled>
              Voting Not Started
            </Button>
          </div>
          <VoteCardCancelActions proposerCancelAction={proposerCancelAction} />
        </>
      );

    case "ready":
      if (!address) {
        return (
          <div className="col-span-full flex justify-center">
            <ConnectButton size="lg" text="Connect Wallet to Vote" fullWidth />
          </div>
        );
      }

      return (
        <>
          <div className="gap-4 md:grid-cols-3 grid grid-cols-1">
            <Button
              variant="approve"
              size="lg"
              onClick={() => onVote(1)}
              disabled={
                proposalState !== ProposalState.Active ||
                isDeadlinePassed ||
                isAwaitingUserSignature ||
                isConfirming
              }
              data-testid="yesProposalButton"
            >
              Vote YES
            </Button>
            <Button
              variant="abstain"
              size="lg"
              onClick={() => onVote(2)}
              disabled={
                proposalState !== ProposalState.Active ||
                isDeadlinePassed ||
                isAwaitingUserSignature ||
                isConfirming
              }
              data-testid="abstainProposalButton"
            >
              Abstain
            </Button>
            <Button
              variant="reject"
              size="lg"
              onClick={() => onVote(0)}
              disabled={
                proposalState !== ProposalState.Active ||
                isDeadlinePassed ||
                isAwaitingUserSignature ||
                isConfirming
              }
              data-testid="noProposalButton"
            >
              Vote NO
            </Button>
          </div>
          <VoteCardCancelActions proposerCancelAction={proposerCancelAction} />
        </>
      );

    default:
      return null;
  }
};
