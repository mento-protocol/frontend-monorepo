import { ProgressBar } from "@/components/progress-bar";
import { TransactionLink } from "@/components/proposal/components/TransactionLink";
import { Timer } from "@/components/timer";
import { VoteCardActions } from "@/components/voting/vote-card-actions";
import { VoteCardState } from "@/components/voting/derive-vote-card-state";
import { VoteCardSpecialContent } from "@/components/voting/vote-card-special-content";
import { Proposal, ProposalState } from "@/graphql/subgraph/generated/subgraph";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mento-protocol/ui";
import { CheckCircle2, CircleCheck, XCircle, XCircleIcon } from "lucide-react";
import { ComponentProps, useMemo } from "react";
import spacetime from "spacetime";

interface ActiveTransactionError {
  label: string;
  message: string;
}

interface VoteCardContentProps {
  currentState: VoteCardState;
  proposal: Proposal;
  proposalState: ProposalState;
  votingDeadline: Date | undefined;
  address: string | undefined;
  isConnected: boolean;
  isVotingOpen: boolean;
  hasQuorum: boolean;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumNeededFormatted: string;
  formattedVeMentoBalance: string;
  formattedTotalVotingPower: string;
  voteData: ComponentProps<typeof ProgressBar>["data"];
  hasVoted: boolean | undefined;
  pendingVoteSupport: number | undefined;
  recordedVoteSupport: number | undefined;
  queueEndTime: Date | null;
  isVetoPeriodOver: boolean;
  isDeadlinePassed: boolean;
  isAwaitingUserSignature: boolean;
  isConfirming: boolean;
  isAwaitingExecuteSignature: boolean;
  isExecuteConfirming: boolean;
  isAwaitingQueueSignature: boolean;
  isQueueConfirming: boolean;
  currentTxHash: string | undefined;
  hash: string | undefined;
  executeHash: string | undefined;
  queueHash: string | undefined;
  onExecute: () => void;
  onQueue: () => void;
  onVote: (support: number) => void;
  isWatchdogSafe: boolean;
  isWatchdog: boolean;
  hasPendingCancellation: boolean;
  isPendingCancellationStatusUnavailable: boolean;
  onWatchdogCancel: () => void;
  isAwaitingCancelSignature: boolean;
  isCancelConfirming: boolean;
  signaturesCollected: number;
  signaturesRequired: number;
  chainId: number;
  watchdogAddress: string;
  canProposerCancel: boolean;
  onProposerCancel: () => void;
  isAwaitingProposerCancelSignature: boolean;
  isProposerCancelConfirming: boolean;
  isProposerCancelConfirmed: boolean;
  activeTransactionError: ActiveTransactionError | null;
}

const cardClassName = "w-full pt-0 border-none gap-0 pb-0";

export const VoteCardContent = ({
  currentState,
  proposal,
  proposalState,
  votingDeadline,
  address,
  isConnected,
  isVotingOpen,
  hasQuorum,
  forVotes,
  againstVotes,
  abstainVotes,
  quorumNeededFormatted,
  formattedVeMentoBalance,
  formattedTotalVotingPower,
  voteData,
  hasVoted,
  pendingVoteSupport,
  recordedVoteSupport,
  queueEndTime,
  isVetoPeriodOver,
  isDeadlinePassed,
  isAwaitingUserSignature,
  isConfirming,
  isAwaitingExecuteSignature,
  isExecuteConfirming,
  isAwaitingQueueSignature,
  isQueueConfirming,
  currentTxHash,
  hash,
  executeHash,
  queueHash,
  onExecute,
  onQueue,
  onVote,
  isWatchdogSafe,
  isWatchdog,
  hasPendingCancellation,
  isPendingCancellationStatusUnavailable,
  onWatchdogCancel,
  isAwaitingCancelSignature,
  isCancelConfirming,
  signaturesCollected,
  signaturesRequired,
  chainId,
  watchdogAddress,
  canProposerCancel,
  onProposerCancel,
  isAwaitingProposerCancelSignature,
  isProposerCancelConfirming,
  isProposerCancelConfirmed,
  activeTransactionError,
}: VoteCardContentProps) => {
  const isApproved =
    proposalState === ProposalState.Succeeded ||
    proposalState === ProposalState.Queued ||
    proposalState === ProposalState.Executed;
  const isRejected = proposalState === ProposalState.Defeated;
  const isCanceled = proposalState === ProposalState.Canceled;
  const isAbstained =
    proposalState === ProposalState.Defeated &&
    abstainVotes > forVotes &&
    abstainVotes > againstVotes;

  const title = useMemo(() => {
    switch (currentState) {
      case "loading":
        return null;
      case "confirming":
        return "Vote Submitted";
      case "signing":
        return "Confirm Your Vote";
      case "insufficient-mento":
        return "Lock MENTO to Vote";
      case "executed":
        return "Proposal Executed";
      case "queued":
        return "Proposal Queued";
      case "succeeded":
        return "Proposal Succeeded";
      case "defeated":
        if (isAbstained) return "Majority Abstained";
        if (!hasQuorum) return "Quorum Not Met";
        return "Proposal Defeated";
      case "canceled":
        return "Proposal Canceled";
      case "expired":
        return "Proposal Expired";
      case "pending":
        return "Voting Pending";
      case "finished":
        return "Voting Finished";
      default:
        if (isVotingOpen) return "Voting is Open";
        return "Voting Finished";
    }
  }, [currentState, isVotingOpen, isAbstained, hasQuorum]);

  const cancelButtonText = useMemo(() => {
    if (isWatchdogSafe) {
      // Connected AS the Safe (via WalletConnect) - direct execution
      if (isAwaitingCancelSignature) return "Confirm in Safe UI";
      if (isCancelConfirming) return "Cancelling...";
      return "Cancel Proposal";
    } else {
      // Connected as individual watchdog signer - propose in Safe UI
      return "Propose Cancellation in Safe";
    }
  }, [isWatchdogSafe, isAwaitingCancelSignature, isCancelConfirming]);
  const watchdogCancelAction = {
    isWatchdog,
    hasPendingCancellation,
    isPendingCancellationStatusUnavailable,
    onCancel: onWatchdogCancel,
    isAwaitingCancelSignature,
    isCancelConfirming,
    cancelButtonText,
    signaturesCollected,
    signaturesRequired,
    chainId,
    watchdogAddress,
  };
  const proposerCancelAction = {
    canProposerCancel,
    onCancel: onProposerCancel,
    isAwaitingProposerCancelSignature,
    isProposerCancelConfirming,
    isProposerCancelConfirmed,
  };

  const description = useMemo(() => {
    switch (currentState) {
      case "loading":
        return null;
      case "confirming":
        return null;
      case "signing":
        return "Please confirm the transaction in your wallet to cast your vote.";
      case "insufficient-mento":
        return "You need to lock your MENTO tokens to participate in governance voting.";
      case "executed":
        return (
          <>
            This proposal has been successfully executed.
            <br />
            The changes outlined in the proposal are now in effect.
          </>
        );
      case "queued":
        return (
          <>This proposal has been approved and is queued for execution.</>
        );
      case "succeeded":
        return (
          <>
            The community has voted in favor of this proposal.
            <br />
            It can now be queued for execution by anyone.
          </>
        );
      case "defeated":
        if (forVotes > againstVotes) {
          return (
            <>
              The proposal did not reach the required quorum of{" "}
              {quorumNeededFormatted} votes.
              <br />
              It will not move forward.
            </>
          );
        }
        if (abstainVotes > forVotes && abstainVotes > againstVotes) {
          return (
            <>
              While quorum was met, most voters chose to abstain.
              <br />
              As a result, the proposal did not receive enough support to pass.
            </>
          );
        }
        return (
          <>
            The proposal did not receive enough YES votes.
            <br />
            It will not move forward.
          </>
        );
      case "expired":
        return (
          <>
            This proposal has expired and can no longer be executed.
            <br />
            The execution deadline has passed.
          </>
        );
      case "pending":
        return (
          <>
            Voting for this proposal has not yet started.
            <br />
            Please check back when the voting period begins.
          </>
        );
      case "finished":
        return (
          <>
            Voting for this proposal has concluded.
            <br />
            The final results are displayed above.
          </>
        );
      case "canceled": {
        const cancelTxHash = proposal.proposalCanceled?.[0]?.transaction?.id;
        return (
          <>
            This proposal has been canceled. It will not move forward.
            <br />
            {cancelTxHash && (
              <>
                {" "}
                <TransactionLink
                  txHash={cancelTxHash}
                  className="underline underline-offset-4"
                >
                  View cancel transaction &rarr;
                </TransactionLink>
              </>
            )}
          </>
        );
      }

      default:
        if (isVotingOpen) {
          return <>Your vote matters - participate in the decision.</>;
        }
        return <>Your vote matters - participate in the decision.</>;
    }
  }, [
    currentState,
    isVotingOpen,
    forVotes,
    againstVotes,
    abstainVotes,
    quorumNeededFormatted,
    proposal.proposalCanceled,
  ]);

  // Show header based on state
  const showHeader = !["loading", "confirming", "signing"].includes(
    currentState,
  );
  const isVotedForApprove = recordedVoteSupport === 1;
  const isVotedForAbstain = recordedVoteSupport === 2;
  const isVotedForReject = recordedVoteSupport === 0;
  const quorumLabel = useMemo(() => {
    let label = "";

    if (isVotingOpen) label = hasQuorum ? "Quorum met" : "Quorum not yet met";
    else label = hasQuorum ? "Quorum met" : "Quorum not met";

    return label;
  }, [isVotingOpen, hasQuorum]);

  return (
    <Card className={cardClassName}>
      {showHeader && (
        <CardHeader className="mb-0 gap-2 p-4 md:flex-row md:items-center xl:px-8 xl:py-6 flex flex-col items-start justify-between bg-incard">
          <div className="gap-2 text-sm md:flex-row md:items-center md:gap-8 flex flex-col">
            {isCanceled && proposal.proposalCanceled?.[0] ? (
              <div className="gap-2 flex items-center">
                <div className="gap-1 flex items-center">
                  <XCircleIcon size={16} />
                  <span>Cancelled:</span>
                </div>
                {proposal.proposalCanceled[0].transaction?.id &&
                proposal.proposalCanceled[0].timestamp ? (
                  <TransactionLink
                    txHash={proposal.proposalCanceled[0].transaction.id}
                    className="text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {spacetime(
                      new Date(
                        Number(proposal.proposalCanceled[0].timestamp) * 1000,
                      ),
                    ).format("{date-ordinal} {month}, {year}")}
                  </TransactionLink>
                ) : proposal.proposalCanceled[0].timestamp ? (
                  <span className="text-muted-foreground">
                    {spacetime(
                      new Date(
                        Number(proposal.proposalCanceled[0].timestamp) * 1000,
                      ),
                    ).format("{date-ordinal} {month}, {year}")}
                  </span>
                ) : null}
              </div>
            ) : !isCanceled &&
              !isProposerCancelConfirmed &&
              currentState === "queued" &&
              queueEndTime ? (
              <Timer
                until={queueEndTime}
                label="Executable in:"
                expiredLabel="Executable since"
              />
            ) : !isCanceled && !isProposerCancelConfirmed && votingDeadline ? (
              <Timer until={votingDeadline} />
            ) : null}

            <div className="gap-2 flex items-center">
              {!hasQuorum ? (
                <XCircleIcon size={16} className="text-white" />
              ) : (
                <CheckCircle2 size={16} className="text-white" />
              )}
              <span>{quorumLabel}</span>
              <span
                className="text-sm text-muted-foreground"
                data-testid="quorumReachedLabel"
              >
                Min. {quorumNeededFormatted} veMENTO
              </span>
            </div>
          </div>

          {!hasVoted && currentState === "ready" && isConnected && (
            <div className="gap-2 text-sm flex items-center">
              <span>Your Voting Power:</span>
              <span className="text-muted-foreground">
                {formattedVeMentoBalance} veMENTO
              </span>
            </div>
          )}

          {hasVoted && currentState !== "ready" && isConnected && (
            <div className="gap-2 text-sm flex items-center">
              <span>Total Votes:</span>
              <span
                className="text-muted-foreground"
                data-testid="totalVotesLabel"
              >
                {formattedTotalVotingPower} veMENTO
              </span>
            </div>
          )}
        </CardHeader>
      )}

      <CardContent
        className={
          ["loading", "signing", "confirming"].includes(currentState)
            ? "py-16 flex items-center justify-center"
            : "space-y-8 p-4 xl:p-8"
        }
      >
        <VoteCardSpecialContent
          currentState={currentState}
          isAwaitingExecuteSignature={isAwaitingExecuteSignature}
          isAwaitingQueueSignature={isAwaitingQueueSignature}
          isExecuteConfirming={isExecuteConfirming}
          isQueueConfirming={isQueueConfirming}
          voteSupport={pendingVoteSupport}
          currentTxHash={currentTxHash}
          hash={hash}
          executeHash={executeHash}
          queueHash={queueHash}
        />

        {!["loading", "confirming", "signing"].includes(currentState) && (
          <>
            <div className="space-y-4">
              <CardTitle
                className="gap-2 font-medium text-white flex items-center text-3xl"
                data-testid="voteStatus"
              >
                {isApproved && <CircleCheck size={32} />}
                {isRejected && <XCircle size={32} />}
                {isCanceled && <XCircle size={32} />}
                {title}
              </CardTitle>

              {description && (
                <CardDescription className="space-y-1 text-lg text-muted-foreground">
                  {description}
                </CardDescription>
              )}
            </div>

            <div className="py-0">
              <ProgressBar mode="vote" data={voteData} />
            </div>

            <div
              className={
                currentState === "insufficient-mento"
                  ? "mt-8 gap-4 flex flex-col"
                  : "mt-8"
              }
            >
              <VoteCardActions
                currentState={currentState}
                address={address}
                proposal={proposal}
                proposalState={proposalState}
                hasVoted={hasVoted}
                isVotedForApprove={isVotedForApprove}
                isVotedForAbstain={isVotedForAbstain}
                isVotedForReject={isVotedForReject}
                queueEndTime={queueEndTime}
                isVetoPeriodOver={isVetoPeriodOver}
                isDeadlinePassed={isDeadlinePassed}
                isAwaitingUserSignature={isAwaitingUserSignature}
                isConfirming={isConfirming}
                isAwaitingExecuteSignature={isAwaitingExecuteSignature}
                isExecuteConfirming={isExecuteConfirming}
                isAwaitingQueueSignature={isAwaitingQueueSignature}
                isQueueConfirming={isQueueConfirming}
                onExecute={onExecute}
                onQueue={onQueue}
                onVote={onVote}
                watchdogCancelAction={watchdogCancelAction}
                proposerCancelAction={proposerCancelAction}
              />
            </div>

            {activeTransactionError &&
              (currentState === "ready" ||
                currentState === "succeeded" ||
                currentState === "queued") && (
                <div className="gap-1 text-sm text-red-500 flex w-full flex-col items-center justify-center">
                  <span>{activeTransactionError.label}</span>
                  <span>{activeTransactionError.message}</span>
                </div>
              )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
