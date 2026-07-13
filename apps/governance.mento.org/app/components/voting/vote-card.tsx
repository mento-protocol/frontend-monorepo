import { ProgressBar } from "@/components/progress-bar";
import { TransactionLink } from "@/components/proposal/components/TransactionLink";
import { Timer } from "@/components/timer";
import { deriveVoteCardState } from "@/components/voting/derive-vote-card-state";
import { getActiveGovernanceTransactionError } from "@/components/voting/get-active-governance-transaction-error";
import { VoteCardActions } from "@/components/voting/vote-card-actions";
import { VoteCardSpecialContent } from "@/components/voting/vote-card-special-content";
import { useDelayedVoteCardRefire } from "@/components/voting/use-delayed-vote-card-refire";
import { getWatchdogMultisigAddress } from "@/config";
import { useLocksByAccount } from "@/contracts";
import {
  useCancelProposalAsProposer,
  useCancelProposalAsWatchdog,
  useCastVote,
  useExecuteProposal,
  useIsWatchdog,
  usePendingMultisigCancellation,
  useQueueProposal,
  useQuorum,
  useVoteReceipt,
} from "@/contracts/governor";
import { getTimelockOperationId } from "@/contracts/governor/utils/get-timelock-operation-id";
import { Proposal, ProposalState } from "@/graphql/subgraph/generated/subgraph";
import { useVeMentoDelegationSummary } from "@/hooks/use-ve-mento-delegation-summary";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mento-protocol/ui";
import { NumbersService } from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import * as Sentry from "@sentry/nextjs";
import { CheckCircle2, CircleCheck, XCircle, XCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import spacetime from "spacetime";
import { formatUnits, keccak256, toHex } from "viem";

interface VoteCardProps {
  proposal: Proposal;
  votingDeadline: Date | undefined;
  onVoteConfirmed?: () => void;
}

const cardClassName = "w-full pt-0 border-none gap-0 pb-0";

export const VoteCard = ({
  proposal,
  votingDeadline,
  onVoteConfirmed,
}: VoteCardProps) => {
  const { address, isConnecting, isConnected } = useAccount();

  // Get locks for delegation calculation
  const { locks } = useLocksByAccount({
    account: address,
  });

  // Calculate total voting power including received delegations
  const { ownVe, receivedVe } = useVeMentoDelegationSummary({ locks, address });
  const chainId = useChainId();
  const { isWatchdog, isWatchdogSafe } = useIsWatchdog();
  const watchdogAddress = getWatchdogMultisigAddress(chainId);
  const {
    data: voteReceipt,
    isLoading: isHasVotedStatusLoading,
    refetch: refetchVoteReceipt,
  } = useVoteReceipt({
    proposalId: proposal.proposalId,
    address,
  });

  const {
    hash,
    castVote,
    variables,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    error,
  } = useCastVote();
  const {
    hash: executeHash,
    executeProposal,
    isAwaitingUserSignature: isAwaitingExecuteSignature,
    isConfirming: isExecuteConfirming,
    error: executeError,
  } = useExecuteProposal();
  const {
    hash: queueHash,
    queueProposal,
    isAwaitingUserSignature: isAwaitingQueueSignature,
    isConfirming: isQueueConfirming,
    isConfirmed: isQueueConfirmed,
    error: queueError,
  } = useQueueProposal();
  const {
    hash: cancelHash,
    cancelProposal,
    isAwaitingUserSignature: isAwaitingCancelSignature,
    isConfirming: isCancelConfirming,
    error: cancelError,
  } = useCancelProposalAsWatchdog();
  const {
    cancelProposalAsProposer,
    isAwaitingUserSignature: isAwaitingProposerCancelSignature,
    isConfirming: isProposerCancelConfirming,
    isConfirmed: isProposerCancelConfirmed,
  } = useCancelProposalAsProposer();

  // Calculate operation ID for checking pending Safe cancellation
  const operationId = useMemo(() => {
    const targets = proposal.calls.map((call) => call.target.id);
    const values = proposal.calls.map((call) => BigInt(call.value));
    const calldatas = proposal.calls.map(
      (call) => call.calldata as `0x${string}`,
    );
    const descriptionHash = keccak256(
      toHex(proposal.description || ""),
    ) as `0x${string}`;

    return getTimelockOperationId(targets, values, calldatas, descriptionHash);
  }, [proposal.calls, proposal.description]);

  // Only check for pending Safe cancellation when:
  // 1. User is a watchdog (otherwise they can't see/interact with it anyway)
  // 2. Proposal is in a state where it could be canceled (queued/succeeded)
  const shouldCheckPendingCancellation =
    isWatchdog &&
    (proposal.state === ProposalState.Queued ||
      proposal.state === ProposalState.Succeeded);

  // Check for pending Safe cancellation transaction
  const {
    hasPendingCancellation,
    isStatusUnavailable: isPendingCancellationStatusUnavailable,
    signaturesCollected,
    signaturesRequired,
  } = usePendingMultisigCancellation(
    operationId,
    shouldCheckPendingCancellation,
  );

  const { quorumNeeded } = useQuorum(proposal.startBlock);

  // User can vote if they have any voting power (own or delegated)
  const hasEnoughLockedMentoToVote = ownVe + receivedVe > 0;
  const isInitializing = isConnecting || isHasVotedStatusLoading;

  // Track when queue transaction is pending (sent but not confirmed)
  const isQueueTransactionPending = queueHash && !isQueueConfirmed;

  // Always use the most recent transaction hash for explorer links
  const currentTxHash = cancelHash || queueHash || executeHash || hash;

  const queueEndTime = useMemo(() => {
    const eta = proposal.proposalQueued?.[0]?.eta;
    return eta ? new Date(Number(eta) * 1000) : null;
  }, [proposal.proposalQueued]);

  // Track whether the veto period has passed. Initialized as false so SSR
  // and client-hydration render structurally identical CTA branches — same
  // tradeoff isDeadlinePassed below makes. An already-executable proposal
  // briefly paints "In Veto Period" for one frame before the effect flips
  // the gate; accepted as the price of structural hydration safety.
  const [isVetoPeriodOver, setIsVetoPeriodOver] = useState(false);
  useEffect(() => {
    if (!queueEndTime) {
      setIsVetoPeriodOver(false);
      return;
    }
    const check = () => {
      const over = new Date() >= queueEndTime;
      setIsVetoPeriodOver(over);
      return over;
    };
    if (check()) return;
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [queueEndTime]);

  // Track if deadline has passed in real-time
  // Initialize as false to prevent hydration mismatch, will be updated in useEffect
  const [isDeadlinePassed, setIsDeadlinePassed] = useState(false);

  // Update deadline status every second, but only when voting is open
  useEffect(() => {
    if (!votingDeadline) return;

    const proposalState = proposal.state || ProposalState.Active;
    const isVotingCurrentlyOpen = proposalState === ProposalState.Active;

    // Helper function to check and update deadline status
    const checkDeadline = () => {
      const now = new Date();
      const deadlinePassed = now > votingDeadline;
      setIsDeadlinePassed(deadlinePassed);
      return deadlinePassed;
    };

    // Initialize deadline status immediately
    checkDeadline();

    if (!isVotingCurrentlyOpen) return;

    // Check immediately if deadline has passed
    const deadlinePassed = checkDeadline();

    // If deadline has already passed, no need to set up interval
    if (deadlinePassed) return;

    const interval = setInterval(checkDeadline, 1000);

    return () => clearInterval(interval);
  }, [votingDeadline, proposal.state]);

  useDelayedVoteCardRefire({
    isVoteConfirmed: isConfirmed,
    isQueueConfirmed,
    isProposerCancelConfirmed,
    refetchVoteReceipt,
    onVoteConfirmed,
  });

  // Calculate total voting power for quorum display
  const totalVotingPower = useMemo(() => {
    if (!proposal?.votes) return BigInt(0);

    const forPower = BigInt(proposal.votes.for?.total || 0);
    const againstPower = BigInt(proposal.votes.against?.total || 0);
    const abstainPower = BigInt(proposal.votes.abstain?.total || 0);

    return forPower + againstPower + abstainPower;
  }, [proposal.votes]);

  const formattedTotalVotingPower = useMemo(() => {
    return NumbersService.parseNumericValue(formatUnits(totalVotingPower, 18));
  }, [totalVotingPower]);

  const formattedVeMentoBalance = useMemo(() => {
    // Total voting power = own veMENTO + received delegated veMENTO
    const totalVotingPower = ownVe + receivedVe;
    return NumbersService.parseNumericValue(totalVotingPower.toFixed(18));
  }, [ownVe, receivedVe]);

  const quorumNeededFormatted = useMemo(() => {
    return NumbersService.parseNumericValue(
      formatUnits(quorumNeeded || BigInt(0), 18),
    );
  }, [quorumNeeded]);

  // Individual vote counts for easier access
  const forVotes = useMemo(
    () => proposal.votes?.for?.participants?.length || 0,
    [proposal.votes],
  );
  const againstVotes = useMemo(
    () => proposal.votes?.against?.participants?.length || 0,
    [proposal.votes],
  );
  const abstainVotes = useMemo(
    () => proposal.votes?.abstain?.participants?.length || 0,
    [proposal.votes],
  );

  // Calculate vote percentages and data for progress bar
  const voteData = useMemo(() => {
    // Get voting power values
    const forPower = BigInt(proposal.votes?.for?.total || 0);
    const againstPower = BigInt(proposal.votes?.against?.total || 0);
    const abstainPower = BigInt(proposal.votes?.abstain?.total || 0);
    const total = forPower + againstPower + abstainPower;

    // Calculate percentages, guarded against division by zero
    let forPercentage = "0.0";
    let againstPercentage = "0.0";
    let abstainPercentage = "0.0";

    // Only perform calculation if some votes have been cast
    if (total > BigInt(0)) {
      forPercentage = ((Number(forPower) / Number(total)) * 100).toFixed(1);
      againstPercentage = (
        (Number(againstPower) / Number(total)) *
        100
      ).toFixed(1);
      abstainPercentage = (
        (Number(abstainPower) / Number(total)) *
        100
      ).toFixed(1);
    }

    return {
      approve: {
        // Display voting power formatted
        value: NumbersService.parseNumericValue(formatUnits(forPower, 18)),
        percentage: parseFloat(forPercentage),
      },
      reject: {
        value: NumbersService.parseNumericValue(formatUnits(againstPower, 18)),
        percentage: parseFloat(againstPercentage),
      },
      abstain: {
        value: NumbersService.parseNumericValue(formatUnits(abstainPower, 18)),
        percentage: parseFloat(abstainPercentage),
      },
      totalQuorum: Number(formatUnits(total, 18)),
      mode: "vote" as const,
    };
  }, [proposal.votes]);

  const handleVote = (support: number) => {
    if (!isAwaitingUserSignature && !isConfirming && !voteReceipt?.hasVoted) {
      try {
        castVote(proposal.proposalId, support);
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  };

  const handleExecute = () => {
    if (!isAwaitingExecuteSignature && !isExecuteConfirming) {
      try {
        executeProposal(
          BigInt(proposal.proposalId),
          () => {
            // Success callback - proposal data will be refetched automatically
            if (onVoteConfirmed) {
              onVoteConfirmed();
            }
          },
          (error) => {
            Sentry.captureException(error);
          },
        );
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  };

  const handleQueue = () => {
    if (!isAwaitingQueueSignature && !isQueueConfirming) {
      try {
        queueProposal(
          BigInt(proposal.proposalId),
          () => {
            // Success callback - proposal data will be refetched automatically
            if (onVoteConfirmed) {
              onVoteConfirmed();
            }
          },
          (error) => {
            Sentry.captureException(error);
          },
        );
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  };

  const handleCancelByWatchdog = () => {
    if (!isAwaitingCancelSignature && !isCancelConfirming) {
      try {
        cancelProposal(
          operationId,
          () => {
            // Success callback - proposal data will be refetched automatically
            if (onVoteConfirmed) {
              onVoteConfirmed();
            }
          },
          (error) => {
            Sentry.captureException(error);
          },
        );
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  };

  const handleCancelByProposer = () => {
    if (!isAwaitingProposerCancelSignature && !isProposerCancelConfirming) {
      try {
        cancelProposalAsProposer(
          BigInt(proposal.proposalId),
          () => {
            // Success callback - proposal data will be refetched automatically
            if (onVoteConfirmed) {
              onVoteConfirmed();
            }
          },
          (error) => {
            Sentry.captureException(error);
          },
        );
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  };

  // Check if connected user is the proposer and can cancel
  const isProposer =
    address?.toLowerCase() === proposal.proposer.id.toLowerCase();
  const canProposerCancel =
    isProposer &&
    (proposal.state === ProposalState.Pending ||
      proposal.state === ProposalState.Active ||
      proposal.state === ProposalState.Succeeded);

  const proposalState = proposal.state || ProposalState.Active;

  const isVotingOpen =
    proposalState === ProposalState.Active && !isDeadlinePassed;
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
  const hasQuorum = totalVotingPower >= (quorumNeeded || BigInt(0));
  const activeTransactionError = getActiveGovernanceTransactionError([
    { kind: "execute", error: executeError },
    { kind: "queue", error: queueError },
    { kind: "cancel", error: cancelError },
    { kind: "vote", error },
  ]);

  const currentState = useMemo(() => {
    return deriveVoteCardState({
      isInitializing,
      isConfirmed,
      isConfirming,
      isExecuteConfirming,
      isQueueConfirming,
      isQueueConfirmed,
      isQueueTransactionPending: Boolean(isQueueTransactionPending),
      isAwaitingUserSignature,
      isAwaitingExecuteSignature,
      isAwaitingQueueSignature,
      hasVoted: Boolean(voteReceipt?.hasVoted),
      hasEnoughLockedMentoToVote,
      isConnected,
      isVotingOpen,
      proposalState,
      isDeadlinePassed,
    });
  }, [
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
    voteReceipt?.hasVoted,
    hasEnoughLockedMentoToVote,
    isConnected,
    isVotingOpen,
    proposalState,
    isDeadlinePassed,
  ]);

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
    onCancel: handleCancelByWatchdog,
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
    onCancel: handleCancelByProposer,
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
  const isVotedForApprove = voteReceipt?.support === 1;
  const isVotedForAbstain = voteReceipt?.support === 2;
  const isVotedForReject = voteReceipt?.support === 0;
  const hasVoted = voteReceipt?.hasVoted;
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
          voteSupport={variables?.args?.[1] as number | undefined}
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
                onExecute={handleExecute}
                onQueue={handleQueue}
                onVote={handleVote}
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
