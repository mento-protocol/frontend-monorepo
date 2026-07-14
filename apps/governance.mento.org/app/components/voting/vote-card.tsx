import { deriveVoteCardState } from "@/components/voting/derive-vote-card-state";
import { getActiveGovernanceTransactionError } from "@/components/voting/get-active-governance-transaction-error";
import { getGovernanceTransactionErrorMessage } from "@/components/voting/get-governance-transaction-error-message";
import { VoteCardContent } from "@/components/voting/vote-card-content";
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
import { NumbersService } from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import * as Sentry from "@sentry/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, keccak256, toHex } from "viem";

interface VoteCardProps {
  proposal: Proposal;
  votingDeadline: Date | undefined;
  onVoteConfirmed?: () => void;
}

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
  const hasQuorum = totalVotingPower >= (quorumNeeded || BigInt(0));
  const activeTransactionError = getActiveGovernanceTransactionError([
    { kind: "execute", error: executeError },
    { kind: "queue", error: queueError },
    { kind: "cancel", error: cancelError },
    { kind: "vote", error },
  ]);
  const capturedVoteErrorsRef = useRef<Set<unknown>>(new Set());

  // Execute, queue, and cancel errors are captured by their callbacks or hooks.
  // Cast-vote does not receive an onError callback, so capture its hook state here.
  useEffect(() => {
    if (
      !error ||
      getGovernanceTransactionErrorMessage(error) === null ||
      capturedVoteErrorsRef.current.has(error)
    ) {
      return;
    }

    Sentry.captureException(error);
    capturedVoteErrorsRef.current.add(error);
  }, [error]);

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

  return (
    <VoteCardContent
      currentState={currentState}
      proposal={proposal}
      proposalState={proposalState}
      votingDeadline={votingDeadline}
      address={address}
      isConnected={isConnected}
      isVotingOpen={isVotingOpen}
      hasQuorum={hasQuorum}
      forVotes={forVotes}
      againstVotes={againstVotes}
      abstainVotes={abstainVotes}
      quorumNeededFormatted={quorumNeededFormatted}
      formattedVeMentoBalance={formattedVeMentoBalance}
      formattedTotalVotingPower={formattedTotalVotingPower}
      voteData={voteData}
      hasVoted={voteReceipt?.hasVoted}
      pendingVoteSupport={variables?.args?.[1] as number | undefined}
      recordedVoteSupport={voteReceipt?.support}
      queueEndTime={queueEndTime}
      isVetoPeriodOver={isVetoPeriodOver}
      isDeadlinePassed={isDeadlinePassed}
      isAwaitingUserSignature={isAwaitingUserSignature}
      isConfirming={isConfirming}
      isAwaitingExecuteSignature={isAwaitingExecuteSignature}
      isExecuteConfirming={isExecuteConfirming}
      isAwaitingQueueSignature={isAwaitingQueueSignature}
      isQueueConfirming={isQueueConfirming}
      currentTxHash={currentTxHash}
      hash={hash}
      executeHash={executeHash}
      queueHash={queueHash}
      onExecute={handleExecute}
      onQueue={handleQueue}
      onVote={handleVote}
      isWatchdogSafe={isWatchdogSafe}
      isWatchdog={isWatchdog}
      hasPendingCancellation={hasPendingCancellation}
      isPendingCancellationStatusUnavailable={
        isPendingCancellationStatusUnavailable
      }
      onWatchdogCancel={handleCancelByWatchdog}
      isAwaitingCancelSignature={isAwaitingCancelSignature}
      isCancelConfirming={isCancelConfirming}
      signaturesCollected={signaturesCollected}
      signaturesRequired={signaturesRequired}
      chainId={chainId}
      watchdogAddress={watchdogAddress}
      canProposerCancel={canProposerCancel}
      onProposerCancel={handleCancelByProposer}
      isAwaitingProposerCancelSignature={isAwaitingProposerCancelSignature}
      isProposerCancelConfirming={isProposerCancelConfirming}
      isProposerCancelConfirmed={isProposerCancelConfirmed}
      activeTransactionError={activeTransactionError}
    />
  );
};
