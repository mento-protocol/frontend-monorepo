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
} from "@repo/ui";
import * as Sentry from "@sentry/nextjs";
import { isAfter } from "date-fns";
import { CheckCircle2, CircleCheck, XCircle } from "lucide-react";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

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

export const VoteCard = ({ proposal, votingDeadline }: VoteCardProps) => {
  const { address, isConnecting } = useAccount();
  const { veMentoBalance } = useTokens();
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

  const isVotingOpen =
    proposal.state === ProposalState.Active &&
    !isAfter(new Date(), votingDeadline || new Date());
  const isApproved =
    proposal.state === ProposalState.Succeeded ||
    proposal.state === ProposalState.Queued ||
    proposal.state === ProposalState.Executed;
  const isRejected = proposal.state === ProposalState.Defeated;
  const isAbstained =
    proposal.state === ProposalState.Defeated &&
    abstainVotes > forVotes &&
    abstainVotes > againstVotes;
  const isQuorumNotMet =
    proposal.state === ProposalState.Defeated && forVotes > againstVotes;

  const title = useMemo(() => {
    if (isVotingOpen) return "Voting Open";
    if (isApproved) return "Proposal Approved";
    if (isRejected) return "Proposal Rejected";
    if (isAbstained) return "Majority Abstained";
    if (isQuorumNotMet) return "Quorum Not Met";

    return "Voting Open";
  }, [isVotingOpen, isApproved, isRejected, isAbstained, isQuorumNotMet]);

  console.log("DEBUG", {
    proposalState: proposal,
    totalVotes: formatUnits(totalVotes, 18),
    forVotes: formatUnits(forVotes, 18),
    againstVotes: formatUnits(againstVotes, 18),
    abstainVotes: formatUnits(abstainVotes, 18),
    isVotingOpen,
    votingDeadline,
  });

  // Handle loading state
  if (isInitializing) {
    return (
      <Card className="w-full space-y-8 pt-0">
        <CardContent className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-4">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"></div>
            <p className="text-muted-foreground">
              Loading voting information...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle already voted state
  if (voteReceipt && voteReceipt.hasVoted) {
    return (
      <Card className="w-full space-y-8 pt-0">
        <CardHeader className="bg-incard mb-0 flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}

            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-white" />
              <span>Quorum reached</span>
              <span className="text-muted-foreground">
                {NumbersService.parseNumericValue(formatUnits(totalVotes, 18))}{" "}
                of{" "}
                {NumbersService.parseNumericValue(
                  formatUnits(quorumNeeded || BigInt(0), 18),
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Voting Power:</span>
            <span>{formattedVeMentoBalance} veMENTO</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <div className="space-y-4">
            <CardTitle className="flex items-center gap-2 text-3xl font-medium text-white">
              {isApproved && <CircleCheck size={32} />}
              {isRejected && <XCircle size={32} />}
              {title}
            </CardTitle>

            <CardDescription className="text-muted-foreground space-y-1 text-lg">
              {isVotingOpen ? (
                <>
                  Your vote matters - participate in the decision.
                  <br />
                  Even if you abstain, it helps the community move forward.
                </>
              ) : proposal.state === ProposalState.Defeated &&
                forVotes > againstVotes ? (
                <>
                  The proposal did not reach the required quorum.
                  <br />
                  As a result, it has not been approved and will not be
                  implemented.
                </>
              ) : proposal.state === ProposalState.Defeated &&
                abstainVotes > forVotes &&
                abstainVotes > againstVotes ? (
                <>
                  While quorum was reached, most voters chose to abstain.
                  <br />
                  As a result, the proposal did not receive enough support to
                  pass.
                </>
              ) : proposal.state === ProposalState.Defeated ? (
                <>
                  The proposal did not receive sufficient support.
                  <br />
                  It will not move forward.
                </>
              ) : proposal.state === ProposalState.Succeeded ||
                proposal.state === ProposalState.Queued ||
                proposal.state === ProposalState.Executed ? (
                <>
                  The community has voted in favor of this proposal.
                  <br />
                  It will now proceed to implementation as outlined.
                </>
              ) : (
                <>
                  Your vote matters - participate in the decision.
                  <br />
                  Even if you abstain, it helps the community move forward.
                </>
              )}
            </CardDescription>
          </div>

          <div className="py-4">
            <ProgressBar mode="vote" data={voteData} />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Button variant="approve" size="lg" disabled>
              {voteReceipt.support === 1
                ? "Your vote: Approve"
                : "Approve Proposal"}
            </Button>

            <Button variant="abstain" size="lg" disabled>
              {voteReceipt.support === 2 ? "Your vote: Abstain" : "Abstain"}
            </Button>

            <Button variant="reject" size="lg" disabled>
              {voteReceipt.support === 0
                ? "Your vote: Reject"
                : "Reject Proposal"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle insufficient locked MENTO
  if (!hasEnoughLockedMentoToVote) {
    return (
      <Card className="w-full space-y-8 pt-0">
        <CardHeader className="bg-incard mb-0 flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}

            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-white" />
              <span>Quorum reached</span>
              <span className="text-muted-foreground">
                {NumbersService.parseNumericValue(formatUnits(totalVotes, 18))}{" "}
                of{" "}
                {NumbersService.parseNumericValue(
                  formatUnits(quorumNeeded || BigInt(0), 18),
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Voting Power:</span>
            <span>{formattedVeMentoBalance} veMENTO</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <div className="space-y-4">
            <CardTitle className="flex items-center gap-2 text-3xl font-medium text-white">
              Lock MENTO to Vote
            </CardTitle>

            <CardDescription className="text-muted-foreground space-y-1 text-lg">
              You need to lock your MENTO tokens to participate in governance
              voting.
            </CardDescription>
          </div>

          <div className="py-4">
            <ProgressBar mode="vote" data={voteData} />
          </div>

          <div className="mt-8 flex flex-col gap-4">
            <div className="text-center">
              <p className="text-lg font-medium">
                You need to lock your MENTO to vote
              </p>
              <p className="text-muted-foreground">
                Current voting power: {formattedVeMentoBalance} veMENTO
              </p>
            </div>
            <Button variant="default" size="lg" asChild>
              <a href="/voting-power">Lock MENTO Tokens</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle awaiting user signature
  if (isAwaitingUserSignature) {
    return (
      <Card className="w-full space-y-8 pt-0">
        <CardHeader className="bg-incard mb-0 flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Voting Power:</span>
            <span>{formattedVeMentoBalance} veMENTO</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <div className="space-y-4">
            <CardTitle className="flex items-center gap-2 text-3xl font-medium text-white">
              Confirm Your Vote
            </CardTitle>

            <CardDescription className="text-muted-foreground space-y-1 text-lg">
              Please confirm the transaction in your wallet to cast your vote.
            </CardDescription>
          </div>

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
        </CardContent>
      </Card>
    );
  }

  // Handle confirming transaction
  if (isConfirming) {
    return (
      <Card className="w-full space-y-8 pt-0">
        <CardHeader className="bg-incard mb-0 flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <div className="mt-4 flex flex-col items-center gap-4 text-center">
            <CardTitle className="text-3xl font-medium text-white">
              Vote Submitted
            </CardTitle>
            <div className="h-20 w-20 rounded-full bg-green-100 p-4 text-green-600">
              <CheckCircle2 className="h-full w-full" />
            </div>
            <p className="text-muted-foreground">
              Your vote is being processed
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
        </CardContent>
      </Card>
    );
  }

  // Handle confirmed transaction
  if (isConfirmed) {
    return (
      <Card className="w-full space-y-8 pt-0">
        <CardHeader className="bg-incard mb-0 flex h-14 items-center justify-between">
          <div className="flex items-center gap-8">
            {votingDeadline && <Timer until={votingDeadline} />}
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <div className="mt-4 flex flex-col items-center gap-4 text-center">
            <CardTitle className="text-3xl font-medium text-white">
              Vote Success
            </CardTitle>
            <div className="h-20 w-20 rounded-full bg-green-100 p-4 text-green-600">
              <CheckCircle2 className="h-full w-full" />
            </div>
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
        </CardContent>
      </Card>
    );
  }

  // Default state - ready to vote
  return (
    <Card className="w-full space-y-8 pt-0">
      <CardHeader className="bg-incard mb-0 flex h-14 items-center justify-between">
        <div className="flex items-center gap-8">
          {votingDeadline && <Timer until={votingDeadline} />}

          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-white" />
            <span>Quorum reached</span>
            <span className="text-muted-foreground">
              {NumbersService.parseNumericValue(formatUnits(totalVotes, 18))} of{" "}
              {NumbersService.parseNumericValue(
                formatUnits(quorumNeeded || BigInt(0), 18),
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Voting Power:</span>
          <span>{formattedVeMentoBalance} veMENTO</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        <div className="space-y-4">
          <CardTitle className="flex items-center gap-2 text-3xl font-medium text-white">
            {isApproved && <CircleCheck size={32} />}
            {isRejected && <XCircle size={32} />}
            {title}
          </CardTitle>

          <CardDescription className="text-muted-foreground space-y-1 text-lg">
            {isVotingOpen ? (
              <>
                Your vote matters - participate in the decision.
                <br />
                Even if you abstain, it helps the community move forward.
              </>
            ) : proposal.state === ProposalState.Defeated &&
              forVotes > againstVotes ? (
              <>
                The proposal did not reach the required quorum.
                <br />
                As a result, it has not been approved and will not be
                implemented.
              </>
            ) : proposal.state === ProposalState.Defeated &&
              abstainVotes > forVotes &&
              abstainVotes > againstVotes ? (
              <>
                While quorum was reached, most voters chose to abstain.
                <br />
                As a result, the proposal did not receive enough support to
                pass.
              </>
            ) : proposal.state === ProposalState.Defeated ? (
              <>
                The proposal did not receive sufficient support.
                <br />
                It will not move forward.
              </>
            ) : proposal.state === ProposalState.Succeeded ||
              proposal.state === ProposalState.Queued ||
              proposal.state === ProposalState.Executed ? (
              <>
                The community has voted in favor of this proposal.
                <br />
                It will now proceed to implementation as outlined.
              </>
            ) : (
              <>
                Your vote matters - participate in the decision.
                <br />
                Even if you abstain, it helps the community move forward.
              </>
            )}
          </CardDescription>
        </div>

        <div className="py-4">
          <ProgressBar mode="vote" data={voteData} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          {!address ? (
            <div className="col-span-full flex justify-center">
              <ConnectButton size="lg" text="Connect Wallet to Vote" />
            </div>
          ) : (
            <>
              <Button
                variant="approve"
                size="lg"
                onClick={() => handleVote(1)}
                disabled={
                  proposal.state !== ProposalState.Active ||
                  isAwaitingUserSignature ||
                  isConfirming
                }
              >
                Approve Proposal
              </Button>

              <Button
                variant="abstain"
                size="lg"
                onClick={() => handleVote(2)}
                disabled={
                  proposal.state !== ProposalState.Active ||
                  isAwaitingUserSignature ||
                  isConfirming
                }
              >
                Abstain
              </Button>

              <Button
                variant="reject"
                size="lg"
                onClick={() => handleVote(0)}
                disabled={
                  proposal.state !== ProposalState.Active ||
                  isAwaitingUserSignature ||
                  isConfirming
                }
              >
                Reject Proposal
              </Button>
            </>
          )}
        </div>

        {error && (
          <div className="flex w-full flex-col items-center justify-center gap-1 text-sm text-red-500">
            {error.message?.includes("User rejected") ? null : (
              <>
                <span>Error casting vote</span>
                <span>{error.message}</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
