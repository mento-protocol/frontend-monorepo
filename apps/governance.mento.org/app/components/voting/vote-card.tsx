import { ConnectButton } from "@/components/connect-button";
import { ProgressBar } from "@/components/progress-bar";
import { Timer } from "@/components/timer";
import useCastVote from "@/lib/contracts/governor/use-cast-vote";
import { useQuorum } from "@/lib/contracts/governor/useQuorum";
import useVoteReceipt from "@/lib/contracts/governor/useVoteReceipt";
import useTokens from "@/lib/contracts/useTokens";
import type { Proposal } from "@/lib/graphql";
import { ProposalState } from "@/lib/graphql";
import NumbersService from "@/lib/helpers/numbers";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconLoading,
} from "@repo/ui";
import * as Sentry from "@sentry/nextjs";
import { CheckCircle2, CircleCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { useAccount, useBlockNumber } from "wagmi";
import { ensureChainId } from "@/lib/helpers/ensure-chain-id";

interface VoteCardProps {
  proposal: Proposal;
  votingDeadline: Date | undefined;
}

// Vote type constants for clarity
export const VOTE_TYPES = {
  Against: 0,
  For: 1,
  Abstain: 2,
} as { [key: string]: number };

export const REVERSE_VOTE_TYPE_MAP = {
  [VOTE_TYPES.For]: "For",
  [VOTE_TYPES.Against]: "Against",
  [VOTE_TYPES.Abstain]: "Abstain",
} as const;

const cardClassName = "w-full pt-0 border-none gap-0 pb-0";

export const VoteCard = ({ proposal, votingDeadline }: VoteCardProps) => {
  const { address, isConnecting, isConnected, chainId } = useAccount();
  const { veMentoBalance } = useTokens();
  const { data: currentBlock } = useBlockNumber({
    chainId: ensureChainId(chainId),
  });
  const { data: voteReceipt, isLoading: isHasVotedStatusLoading } =
    useVoteReceipt({
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
  const { quorumNeeded } = useQuorum(proposal.startBlock);

  const hasEnoughLockedMentoToVote = veMentoBalance.value > 0;
  const isInitializing = isConnecting || isHasVotedStatusLoading;

  const formattedVeMentoBalance = useMemo(() => {
    return Number(formatUnits(veMentoBalance.value, 18)).toLocaleString();
  }, [veMentoBalance.value]);

  // Calculate total votes as BigInt
  const totalVotes = useMemo(() => {
    if (!proposal?.votes) return BigInt(0);

    // Parse vote totals as BigInts
    const forVotes = BigInt(proposal.votes.for?.total || "0");
    const againstVotes = BigInt(proposal.votes.against?.total || "0");
    const abstainVotes = BigInt(proposal.votes.abstain?.total || "0");

    // Sum using BigInt addition
    return forVotes + againstVotes + abstainVotes;
  }, [proposal.votes]);

  // Individual vote values for easier access
  const forVotes = useMemo(
    () => BigInt(proposal.votes?.for?.total || "0"),
    [proposal.votes],
  );
  const againstVotes = useMemo(
    () => BigInt(proposal.votes?.against?.total || "0"),
    [proposal.votes],
  );
  const abstainVotes = useMemo(
    () => BigInt(proposal.votes?.abstain?.total || "0"),
    [proposal.votes],
  );

  // Calculate vote percentages and data for progress bar
  const voteData = useMemo(() => {
    // Calculate percentages using Number conversion for display
    // We need to convert to numbers for percentage calculation
    let forPercentage = "0.0";
    let againstPercentage = "0.0";

    if (totalVotes > BigInt(0)) {
      // Convert to number with proper decimal handling for percentage calculation
      const totalAsNumber = Number(formatUnits(totalVotes, 18));
      const forAsNumber = Number(formatUnits(forVotes, 18));
      const againstAsNumber = Number(formatUnits(againstVotes, 18));

      forPercentage = ((forAsNumber / totalAsNumber) * 100).toFixed(1);
      againstPercentage = ((againstAsNumber / totalAsNumber) * 100).toFixed(1);
    }

    return {
      approve: {
        // Format vote counts using NumbersService for display
        value: NumbersService.parseNumericValue(formatUnits(forVotes, 18)),
        percentage: parseFloat(forPercentage),
      },
      reject: {
        value: NumbersService.parseNumericValue(formatUnits(againstVotes, 18)),
        percentage: parseFloat(againstPercentage),
      },
      mode: "vote" as const,
    };
  }, [forVotes, againstVotes, totalVotes]);

  const handleVote = (support: number) => {
    if (!isAwaitingUserSignature && !isConfirming && !voteReceipt?.hasVoted) {
      try {
        castVote(proposal.proposalId, support);
      } catch (error) {
        Sentry.captureException(error);
      }
    }
  };

  // Derive the actual proposal state from proposal fields instead of relying on proposal.state
  const getDerivedProposalState = () => {
    if (!proposal || !currentBlock) return ProposalState.Active;

    // Check explicit boolean states first
    if (proposal.canceled) return ProposalState.Defeated; // Canceled proposals are shown as defeated
    if (proposal.executed) return ProposalState.Executed;
    if (proposal.queued) return ProposalState.Queued;

    const currentBlockNum = Number(currentBlock);
    const endBlockNum = Number(proposal.endBlock);
    const startBlockNum = Number(proposal.startBlock);

    // Check if voting period hasn't started yet
    if (currentBlockNum < startBlockNum) {
      return ProposalState.Pending;
    }

    // Check if voting period is active
    if (currentBlockNum >= startBlockNum && currentBlockNum <= endBlockNum) {
      return ProposalState.Active;
    }

    // Voting period has ended, check if proposal succeeded or was defeated
    if (currentBlockNum > endBlockNum) {
      // If queued but not executed and past execution deadline, it's expired
      if (proposal.queued && proposal.eta) {
        const executionDeadline = Number(proposal.eta) + 7 * 24 * 60 * 60; // 7 days in seconds
        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (currentTimestamp > executionDeadline) {
          return ProposalState.Expired;
        }
      }

      // Check vote results to determine if succeeded or defeated
      const totalVotes = Number(proposal.votes.total);
      const forVotes = Number(proposal.votes.for.total);
      const againstVotes = Number(proposal.votes.against.total);

      // Simple majority check (this might need adjustment based on actual governance rules)
      if (totalVotes > 0 && forVotes > againstVotes) {
        return ProposalState.Succeeded;
      } else {
        return ProposalState.Defeated;
      }
    }

    return ProposalState.Active;
  };

  const derivedState = getDerivedProposalState();

  const isVotingOpen =
    derivedState === ProposalState.Active &&
    !(new Date() > (votingDeadline || new Date()));
  const isApproved =
    derivedState === ProposalState.Succeeded ||
    derivedState === ProposalState.Queued ||
    derivedState === ProposalState.Executed;
  const isRejected = derivedState === ProposalState.Defeated;
  const isAbstained =
    derivedState === ProposalState.Defeated &&
    abstainVotes > forVotes &&
    abstainVotes > againstVotes;
  const isQuorumNotMet =
    derivedState === ProposalState.Defeated && forVotes > againstVotes;

  // Determine the current UI state
  const currentState = useMemo(() => {
    if (isInitializing) return "loading";
    if (isConfirmed) return "confirmed";
    if (isConfirming) return "confirming";
    if (isAwaitingUserSignature) return "signing";
    if (voteReceipt?.hasVoted) return "voted";

    // Check if proposal is in a votable state before checking for insufficient MENTO
    if (!isVotingOpen) {
      // Return specific states based on the actual proposal state
      switch (derivedState) {
        case ProposalState.Executed:
          return "executed";
        case ProposalState.Queued:
          return "queued";
        case ProposalState.Succeeded:
          return "succeeded";
        case ProposalState.Defeated:
          return "defeated";
        case ProposalState.Expired:
          return "expired";
        case ProposalState.Pending:
          return "pending";
        default:
          return "finished"; // Generic finished state for other non-votable states
      }
    }

    // Only check for insufficient MENTO if proposal is actually votable
    if (!hasEnoughLockedMentoToVote && isConnected) return "insufficient-mento";
    return "ready";
  }, [
    isInitializing,
    isConfirmed,
    isConfirming,
    isAwaitingUserSignature,
    voteReceipt?.hasVoted,
    hasEnoughLockedMentoToVote,
    isConnected,
    isVotingOpen,
    derivedState,
  ]);

  // Get title based on state
  const title = useMemo(() => {
    switch (currentState) {
      case "loading":
        return null;
      case "confirmed":
        return "Vote Success";
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
        if (isQuorumNotMet) return "Quorum Not Met";
        return "Proposal Defeated";
      case "expired":
        return "Proposal Expired";
      case "pending":
        return "Voting Pending";
      case "finished":
        return "Voting Finished";
      default:
        if (isVotingOpen) return "Voting Open";
        return "Voting Open";
    }
  }, [currentState, isVotingOpen, isAbstained, isQuorumNotMet]);

  // Get description based on state
  const description = useMemo(() => {
    switch (currentState) {
      case "loading":
        return null;
      case "confirmed":
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
          <>
            This proposal has been approved and is queued for execution.
            <br />
            It will be executed after the timelock period expires.
          </>
        );
      case "succeeded":
        return (
          <>
            The community has voted in favor of this proposal.
            <br />
            It will now proceed to the next stage of implementation.
          </>
        );
      case "defeated":
        if (forVotes > againstVotes) {
          return (
            <>
              The proposal did not reach the required quorum.
              <br />
              As a result, it has not been approved and will not be implemented.
            </>
          );
        }
        if (abstainVotes > forVotes && abstainVotes > againstVotes) {
          return (
            <>
              While quorum was reached, most voters chose to abstain.
              <br />
              As a result, the proposal did not receive enough support to pass.
            </>
          );
        }
        return (
          <>
            The proposal did not receive sufficient support.
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
      default:
        if (isVotingOpen) {
          return (
            <>
              Your vote matters - participate in the decision.
              <br />
              Even if you abstain, it helps the community move forward.
            </>
          );
        }
        return (
          <>
            Your vote matters - participate in the decision.
            <br />
            Even if you abstain, it helps the community move forward.
          </>
        );
    }
  }, [currentState, isVotingOpen, forVotes, againstVotes, abstainVotes]);

  // Show header based on state
  const showHeader = !["loading", "confirming", "confirmed"].includes(
    currentState,
  );
  const showQuorumStatus = currentState === "voted" || currentState === "ready";

  // Render vote buttons based on state
  const renderActions = () => {
    switch (currentState) {
      case "loading":
      case "confirming":
      case "confirmed":
      case "signing":
        return null;

      case "insufficient-mento":
        return (
          <Button variant="default" size="lg" clipped="default" asChild>
            <Link href="/voting-power">Lock MENTO Tokens</Link>
          </Button>
        );

      case "voted":
        return (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Button variant="approve" size="lg" disabled>
              {voteReceipt?.support === 1
                ? "Your vote: Approve"
                : "Approve Proposal"}
            </Button>
            <Button variant="abstain" size="lg" disabled>
              {voteReceipt?.support === 2 ? "Your vote: Abstain" : "Abstain"}
            </Button>
            <Button variant="reject" size="lg" disabled>
              {voteReceipt?.support === 0
                ? "Your vote: Reject"
                : "Reject Proposal"}
            </Button>
          </div>
        );

      case "executed":
      case "queued":
      case "succeeded":
      case "defeated":
      case "expired":
      case "finished":
        // Show disabled buttons for finished proposals
        return <></>;

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
                fullwidth
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
                derivedState !== ProposalState.Active ||
                isAwaitingUserSignature ||
                isConfirming
              }
              data-testid="approveProposalButton"
            >
              Approve Proposal
            </Button>
            <Button
              variant="abstain"
              size="lg"
              onClick={() => handleVote(2)}
              disabled={
                derivedState !== ProposalState.Active ||
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
                derivedState !== ProposalState.Active ||
                isAwaitingUserSignature ||
                isConfirming
              }
              data-testid="rejectProposalButton"
            >
              Reject Proposal
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  // Special content for certain states
  const renderSpecialContent = () => {
    switch (currentState) {
      case "loading":
        return (
          <div className="flex flex-col items-center gap-4">
            <IconLoading />
            <p className="text-muted-foreground">
              Loading voting information...
            </p>
          </div>
        );

      case "signing":
        return (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="border-primary h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"></div>
            <p className="text-lg font-medium">Waiting for confirmation...</p>
            <p className="text-muted-foreground">
              You are voting to{" "}
              {variables?.args?.[1] === 1
                ? "Approve"
                : variables?.args?.[1] === 0
                  ? "Reject"
                  : "Abstain"}{" "}
              on this proposal
            </p>
          </div>
        );

      case "confirming":
      case "confirmed":
        return (
          <div className="mt-4 flex flex-col items-center gap-4 text-center">
            <CardTitle
              className="text-3xl font-medium text-white"
              data-testid="proposalStateLabel"
            >
              {title}
            </CardTitle>
            <div className="h-20 w-20 rounded-full bg-green-100 p-4 text-green-600">
              <CheckCircle2 className="h-full w-full" />
            </div>
            <p className="text-muted-foreground">
              {currentState === "confirming"
                ? "Your vote is being processed"
                : null}
            </p>
            {hash && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`https://explorer.celo.org/mainnet/tx/${hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on explorer
                </a>
              </Button>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  console.log("DEBUG", {
    proposalState: proposal,
    totalVotes: formatUnits(totalVotes, 18),
    forVotes: formatUnits(forVotes, 18),
    againstVotes: formatUnits(againstVotes, 18),
    abstainVotes: formatUnits(abstainVotes, 18),
    isVotingOpen,
    votingDeadline,
  });

  return (
    <Card className={cardClassName}>
      {showHeader && (
        <CardHeader className="bg-incard mb-0 flex flex-col items-start justify-between gap-2 p-4 md:flex-row md:items-center xl:px-8 xl:py-6">
          <div className="flex items-center gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}

            {showQuorumStatus && (
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-white" />
                <span>Quorum reached</span>
                <span className="text-muted-foreground">
                  {NumbersService.parseNumericValue(
                    formatUnits(totalVotes, 18),
                  )}{" "}
                  of{" "}
                  {NumbersService.parseNumericValue(
                    formatUnits(quorumNeeded || BigInt(0), 18),
                  )}
                </span>
              </div>
            )}
          </div>

          {isConnected && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Voting Power:</span>
              <span>{formattedVeMentoBalance} veMENTO</span>
            </div>
          )}
        </CardHeader>
      )}

      <CardContent
        className={
          currentState === "loading"
            ? "flex items-center justify-center py-16"
            : "space-y-8 p-4 xl:p-8"
        }
      >
        {renderSpecialContent()}

        {!["loading", "confirming", "confirmed", "signing"].includes(
          currentState,
        ) && (
          <>
            <div className="space-y-4">
              <CardTitle className="flex items-center gap-2 text-3xl font-medium text-white">
                {isApproved && <CircleCheck size={32} />}
                {isRejected && <XCircle size={32} />}
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

            {/* MANUAL TEST AS PER DESIGN */}
            {/* <div className="flex flex-col gap-16 py-16">
              <ProgressBar
                mode="vote"
                data={{
                  approve: {
                    value: "920K",
                    percentage: 76.7,
                  },
                  reject: {
                    value: "280K",
                    percentage: 23.3,
                  },
                  mode: "vote",
                }}
              />

              <ProgressBar
                mode="vote"
                data={{
                  approve: {
                    value: "770K",
                    percentage: 100,
                  },
                  reject: {
                    value: "0",
                    percentage: 0,
                  },
                  mode: "vote",
                }}
              />

              <ProgressBar
                mode="vote"
                data={{
                  approve: {
                    value: "70K",
                    percentage: 16.7,
                  },
                  reject: {
                    value: "80K",
                    percentage: 23.3,
                  },
                  abstain: {
                    value: "620K",
                    percentage: 76.7,
                  },
                  mode: "vote",
                }}
              />

              <ProgressBar
                mode="vote"
                data={{
                  approve: {
                    value: "220K",
                    percentage: 76.7,
                  },
                  reject: {
                    value: "5",
                    percentage: 0.0016,
                  },
                  abstain: {
                    value: "80K",
                    percentage: 23.3,
                  },
                  mode: "vote",
                }}
              />
            </div> */}

            <div
              className={
                currentState === "insufficient-mento"
                  ? "mt-8 flex flex-col gap-4"
                  : "mt-8"
              }
            >
              {renderActions()}
            </div>

            {error && currentState === "ready" && (
              <div className="flex w-full flex-col items-center justify-center gap-1 text-sm text-red-500">
                {error.message?.includes("User rejected") ? null : (
                  <>
                    <span>Error casting vote</span>
                    <span>{error.message}</span>
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
