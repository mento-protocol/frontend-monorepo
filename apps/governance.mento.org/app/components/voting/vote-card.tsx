import { ProgressBar } from "@/components/progress-bar";
import { TransactionLink } from "@/components/proposal/components/TransactionLink";
import { Timer } from "@/components/timer";
import { useLocksByAccount } from "@/contracts";
import {
  useCastVote,
  useExecuteProposal,
  useQueueProposal,
  useQuorum,
  useVoteReceipt,
} from "@/contracts/governor";
import { Proposal, ProposalState } from "@/graphql/subgraph/generated/subgraph";
import { useVeMentoDelegationSummary } from "@/hooks/use-ve-mento-delegation-summary";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconLoading,
} from "@repo/ui";
import { ConnectButton, NumbersService } from "@repo/web3";
import { useAccount } from "@repo/web3/wagmi";
import * as Sentry from "@sentry/nextjs";
import { CheckCircle2, CircleCheck, XCircle, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";

interface VoteCardProps {
  proposal: Proposal;
  votingDeadline: Date | undefined;
  onVoteConfirmed?: () => void;
}

// Vote type constants for clarity
export const VOTE_TYPES = {
  Against: 0,
  For: 1,
  Abstain: 2,
} as const;

export const REVERSE_VOTE_TYPE_MAP = {
  [VOTE_TYPES.For]: "For",
  [VOTE_TYPES.Against]: "Against",
  [VOTE_TYPES.Abstain]: "Abstain",
} as const;

const cardClassName = "w-full pt-0 border-none gap-0 pb-0";

export const VoteCard = ({
  proposal,
  votingDeadline,
  onVoteConfirmed,
}: VoteCardProps) => {
  const { address, isConnecting, isConnected } = useAccount();

  // Get locks for delegation calculation
  const { locks } = useLocksByAccount({
    account: address as string,
  });

  // Calculate total voting power including received delegations
  const { ownVe, receivedVe } = useVeMentoDelegationSummary({ locks, address });
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

  const { quorumNeeded } = useQuorum(proposal.startBlock);

  // User can vote if they have any voting power (own or delegated)
  const hasEnoughLockedMentoToVote = ownVe + receivedVe > 0;
  const isInitializing = isConnecting || isHasVotedStatusLoading;

  // Track when queue transaction is pending (sent but not confirmed)
  const isQueueTransactionPending = queueHash && !isQueueConfirmed;

  // Always use the most recent transaction hash for explorer links
  const currentTxHash = queueHash || executeHash || hash;

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

  useEffect(() => {
    if (isConfirmed) {
      refetchVoteReceipt();

      const voteReceiptTimeout1 = setTimeout(() => {
        refetchVoteReceipt();
      }, 2000);

      const voteReceiptTimeout2 = setTimeout(() => {
        refetchVoteReceipt();
      }, 5000);

      if (onVoteConfirmed) {
        onVoteConfirmed();

        const timeout1 = setTimeout(() => {
          onVoteConfirmed();
        }, 2000);

        const timeout2 = setTimeout(() => {
          onVoteConfirmed();
        }, 5000);

        return () => {
          clearTimeout(timeout1);
          clearTimeout(timeout2);
          clearTimeout(voteReceiptTimeout1);
          clearTimeout(voteReceiptTimeout2);
        };
      }

      return () => {
        clearTimeout(voteReceiptTimeout1);
        clearTimeout(voteReceiptTimeout2);
      };
    }
  }, [isConfirmed, refetchVoteReceipt, onVoteConfirmed]);

  // Trigger onVoteConfirmed when queue transaction is confirmed
  useEffect(() => {
    if (isQueueConfirmed && onVoteConfirmed) {
      onVoteConfirmed();

      const timeout1 = setTimeout(() => {
        onVoteConfirmed();
      }, 2000);

      const timeout2 = setTimeout(() => {
        onVoteConfirmed();
      }, 5000);

      return () => {
        clearTimeout(timeout1);
        clearTimeout(timeout2);
      };
    }
  }, [isQueueConfirmed, onVoteConfirmed]);

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

  const currentState = useMemo(() => {
    if (isInitializing) return "loading";

    // Show normal loading states during queue transaction
    if (isConfirming || isExecuteConfirming || isQueueConfirming)
      return "confirming";
    if (
      isAwaitingUserSignature ||
      isAwaitingExecuteSignature ||
      isAwaitingQueueSignature
    )
      return "signing";

    // Only show queued state after queue transaction is confirmed
    if (proposalState === ProposalState.Succeeded && isQueueConfirmed) {
      return "succeeded";
    }
    if (
      (proposalState === ProposalState.Active && voteReceipt?.hasVoted) ||
      isConfirmed
    )
      return "voted";

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
          // Keep showing the queueing state if the queue transaction is pending
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

    if (!hasEnoughLockedMentoToVote && isConnected) return "insufficient-mento";
    return "ready";
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
      case "queued": {
        const queueTxHash = proposal.proposalQueued?.[0]?.transaction?.id;
        const queueEndTime = proposal.eta
          ? new Date(Number(proposal.eta) * 1000)
          : null;
        return (
          <>
            This proposal has been approved and is queued for execution.
            <br />
            {queueEndTime && (
              <>It can be executed after {queueEndTime.toLocaleString()}.</>
            )}
            {queueTxHash && (
              <>
                <br />
                <Button variant="outline" size="lg" asChild>
                  <TransactionLink txHash={queueTxHash}>
                    View queue transaction
                  </TransactionLink>
                </Button>
              </>
            )}
          </>
        );
      }
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
      case "canceled":
        return (
          <>
            The{" "}
            <a
              href="https://docs.mento.org/mento/overview/governance-and-the-mento-token/watchdogs-and-safety"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              governance watchdogs
            </a>{" "}
            have canceled this proposal. It will not move forward.
          </>
        );

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
    proposal.eta,
    proposal.proposalQueued,
  ]);

  // Show header based on state
  const showHeader = !["loading", "confirming", "signing"].includes(
    currentState,
  );
  const isVotedForApprove = voteReceipt?.support === 1;
  const isVotedForAbstain = voteReceipt?.support === 2;
  const isVotedForReject = voteReceipt?.support === 0;
  const hasVoted = voteReceipt?.hasVoted;
  const usedVoteOptionButtonLocator = "usedVoteOptionButton";

  // Render vote buttons based on state
  const renderActions = () => {
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
        // Show disabled buttons for finished proposals
        if (hasVoted) {
          return (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
        const proposalQueued =
          proposal.proposalQueued && proposal.proposalQueued[0];
        // Check if veto period has passed
        const canExecute =
          proposalQueued?.eta &&
          Date.now() / 1000 > Number(proposalQueued?.eta);

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
            <div className="col-span-full flex justify-center">
              <Button
                variant="default"
                size="lg"
                clipped="default"
                onClick={handleExecute}
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
            </div>
          );
        }
        // Show disabled button during veto period
        return (
          <div className="flex justify-center">
            <Button
              variant="default"
              size="lg"
              clipped="default"
              disabled
              className="w-full"
            >
              In Veto Period
            </Button>
          </div>
        );
      }

      case "executed": {
        // Show link to execution transaction if available
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
        // Show queue button for succeeded proposals
        if (!address) {
          return (
            <div className="col-span-full flex justify-center">
              <ConnectButton
                size="lg"
                text="Connect Wallet to Queue"
                fullWidth
              />
            </div>
          );
        }
        return (
          <div className="flex justify-center">
            <Button
              variant="default"
              size="lg"
              clipped="default"
              onClick={handleQueue}
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
          </div>
        );

      case "pending":
        // Show disabled buttons for pending proposals
        return (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
        );

      case "ready":
        if (!address) {
          return (
            <div className="col-span-full flex justify-center">
              <ConnectButton
                size="lg"
                text="Connect Wallet to Vote"
                fullWidth
              />
            </div>
          );
        }
        return (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Button
              variant="approve"
              size="lg"
              onClick={() => handleVote(1)}
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
              onClick={() => handleVote(2)}
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
              onClick={() => handleVote(0)}
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
        );

      default:
        return null;
    }
  };

  // Get loading text based on state
  const getLoadingText = () => {
    switch (currentState) {
      case "loading":
        return "Loading voting information...";
      case "signing":
        if (isAwaitingExecuteSignature) {
          return "Waiting for execution confirmation...";
        }
        if (isAwaitingQueueSignature) {
          return "Waiting for queue confirmation...";
        }
        return "Waiting for confirmation...";
      case "confirming":
        if (isExecuteConfirming) {
          return "Proposal is being executed";
        }
        if (isQueueConfirming) {
          return "Proposal is being queued";
        }
        return "Your vote is being processed";
      default:
        return "";
    }
  };

  // Special content for certain states
  const renderSpecialContent = () => {
    const loadingStates = ["loading", "signing", "confirming"];

    if (loadingStates.includes(currentState)) {
      return (
        <div className="flex flex-col items-center gap-4">
          <IconLoading />
          <p
            className="text-muted-foreground"
            data-testid={
              currentState === "signing" && "waitingForConfirmationLabel"
            }
          >
            {getLoadingText()}
          </p>
          {currentState === "signing" &&
            !isAwaitingExecuteSignature &&
            !isAwaitingQueueSignature && (
              <p
                className="text-muted-foreground text-sm"
                data-testid="waitingForConfirmationDescriptionLabel"
              >
                You are voting{" "}
                {variables?.args?.[1] === 1
                  ? "YES"
                  : variables?.args?.[1] === 0
                    ? "NO"
                    : "ABSTAIN"}{" "}
                on this proposal
              </p>
            )}
          {currentState === "signing" && isAwaitingExecuteSignature && (
            <p
              className="text-muted-foreground text-sm"
              data-testid="waitingForExecutionDescriptionLabel"
            >
              You are executing this proposal
            </p>
          )}
          {currentState === "signing" && isAwaitingQueueSignature && (
            <p
              className="text-muted-foreground text-sm"
              data-testid="waitingForQueueDescriptionLabel"
            >
              You are queueing this proposal for execution
            </p>
          )}
          {currentState === "confirming" &&
            currentTxHash &&
            (hash || executeHash || queueHash) && (
              <Button variant="outline" size="sm" asChild className="mt-2">
                <TransactionLink txHash={currentTxHash}>
                  View on explorer
                </TransactionLink>
              </Button>
            )}
        </div>
      );
    }

    return null;
  };

  const quorumLabel = useMemo(() => {
    let label = "";

    if (isVotingOpen) label = hasQuorum ? "Quorum met" : "Quorum not yet met";
    else label = hasQuorum ? "Quorum met" : "Quorum not met";

    return label;
  }, [isVotingOpen, hasQuorum]);

  return (
    <Card className={cardClassName}>
      {showHeader && (
        <CardHeader className="bg-incard mb-0 flex flex-col items-start justify-between gap-2 p-4 md:flex-row md:items-center xl:px-8 xl:py-6">
          <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center md:gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}

            <div className="flex items-center gap-2">
              {!hasQuorum ? (
                <XCircleIcon size={16} className="text-white" />
              ) : (
                <CheckCircle2 size={16} className="text-white" />
              )}
              <span>{quorumLabel}</span>
              <span
                className="text-muted-foreground text-sm"
                data-testid="quorumReachedLabel"
              >
                Min. {quorumNeededFormatted} veMENTO
              </span>
            </div>
          </div>

          {!hasVoted && currentState === "ready" && isConnected && (
            <div className="flex items-center gap-2 text-sm">
              <span>Your Voting Power:</span>
              <span className="text-muted-foreground">
                {formattedVeMentoBalance} veMENTO
              </span>
            </div>
          )}

          {hasVoted && currentState !== "ready" && isConnected && (
            <div className="flex items-center gap-2 text-sm">
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
            ? "flex items-center justify-center py-16"
            : "space-y-8 p-4 xl:p-8"
        }
      >
        {renderSpecialContent()}

        {!["loading", "confirming", "signing"].includes(currentState) && (
          <>
            <div className="space-y-4">
              <CardTitle
                className="flex items-center gap-2 text-3xl font-medium text-white"
                data-testid="voteStatus"
              >
                {isApproved && <CircleCheck size={32} />}
                {isRejected && <XCircle size={32} />}
                {isCanceled && <XCircle size={32} />}
                {title}
              </CardTitle>

              {description && (
                <CardDescription className="text-muted-foreground space-y-1 text-lg">
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
                  ? "mt-8 flex flex-col gap-4"
                  : "mt-8"
              }
            >
              {renderActions()}
            </div>

            {(error || executeError || queueError) &&
              (currentState === "ready" ||
                currentState === "succeeded" ||
                currentState === "queued") && (
                <div className="flex w-full flex-col items-center justify-center gap-1 text-sm text-red-500">
                  {(
                    error?.message ||
                    executeError?.message ||
                    queueError?.message
                  )?.includes("rejected") ? null : (
                    <>
                      <span>
                        {executeError
                          ? "Error executing proposal"
                          : queueError
                            ? "Error queueing proposal"
                            : "Error casting vote"}
                      </span>
                      <span>
                        {(error || executeError || queueError)?.message}
                      </span>
                    </>
                  )}
                </div>
              )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
