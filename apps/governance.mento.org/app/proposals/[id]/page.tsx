"use client";
import { Identicon } from "@/components/identicon";
import { VoteCard } from "@/components/voting/vote-card";
import { CELO_BLOCK_TIME } from "@/lib/config/config.constants";
import useProposal from "@/lib/contracts/governor/useProposal";
import { ProposalState } from "@/lib/graphql";
import { ensureChainId } from "@/lib/helpers/ensure-chain-id";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  IconLoading,
  ProposalStatus,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@repo/ui";
import { format } from "date-fns";
import { Check, Copy } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import { formatUnits } from "viem";
import { useAccount, useBlock, useBlockNumber } from "wagmi";

type ParticipantListProps = {
  participants: Array<{ address: string; weight: bigint }>;
};

function ParticipantList({ participants }: ParticipantListProps) {
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const handleCopyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);

    setTimeout(() => {
      setCopiedAddress(null);
    }, 2000);
  };

  const totalWeight = useMemo(() => {
    if (participants.length === 0) return BigInt(0);
    return participants.reduce(
      (sum, participant) => sum + BigInt(participant.weight),
      BigInt(0),
    );
  }, [participants]);

  const formattedWeight = useMemo(() => {
    if (totalWeight === BigInt(0)) return "0";
    const weight = Number(formatUnits(totalWeight, 18));

    let formatted;
    if (weight >= 1_000_000) {
      formatted = `${(weight / 1_000_000).toFixed(2)}M`;
    } else if (weight >= 1_000) {
      formatted = `${(weight / 1_000).toFixed(2)}K`;
    } else {
      formatted = weight.toFixed(2);
    }

    return formatted;
  }, [totalWeight]);

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{formattedWeight} Votes</span>
        </div>
        <span className="text-muted-foreground text-sm">
          {participants.length} addresses
        </span>
      </div>
      {participants.length > 0 ? (
        [...participants]
          .sort((a, b) => Number(BigInt(b.weight) - BigInt(a.weight)))
          .map((participant) => (
            <div
              key={participant.address}
              className="group flex items-center justify-between border-b border-[var(--border)] py-4 last:border-0"
            >
              <div className="flex items-center gap-2">
                <Identicon address={participant.address} size={16} />
                <Button
                  className="h-auto !bg-transparent p-0"
                  onClick={() => handleCopyAddress(participant.address)}
                >
                  <span className="flex items-center gap-1">
                    {`${participant.address.slice(0, 6)}...${participant.address.slice(-4)}`}
                    {copiedAddress === participant.address ? (
                      <div className="h-3 w-3 text-green-500">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                    ) : (
                      <Copy className="text-muted-foreground h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </span>
                </Button>
              </div>
              <span>
                {(() => {
                  const weight = Number(
                    formatUnits(BigInt(participant.weight), 18),
                  );
                  if (weight >= 1_000_000) {
                    return `${(weight / 1_000_000).toFixed(2)}M`;
                  } else if (weight >= 1_000) {
                    return `${(weight / 1_000).toFixed(2)}K`;
                  } else {
                    return weight.toFixed(2);
                  }
                })()}
              </span>
            </div>
          ))
      ) : (
        <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">
          No votes yet
        </p>
      )}
    </div>
  );
}

export default function ProposalPage() {
  const params = useParams();
  const id = params.id as string;
  const { proposal } = useProposal(BigInt(id));
  const { chainId } = useAccount();
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  const { data: currentBlock } = useBlockNumber({
    chainId: ensureChainId(chainId),
    query: {
      enabled: proposal !== undefined,
      refetchInterval: CELO_BLOCK_TIME,
    },
  });

  const endBlock = useBlock({
    blockNumber: proposal?.endBlock ? BigInt(proposal.endBlock) : 0n,
    query: {
      enabled: proposal !== undefined,
    },
  });

  const proposedOn = useMemo(() => {
    return proposal && new Date(proposal.proposalCreated[0].timestamp * 1000);
  }, [proposal]);

  const votingDeadline = useMemo(() => {
    if (!(proposal && currentBlock)) return;
    // If the end block is already mined, we can fetch the timestamp
    if (Number(currentBlock) >= proposal.endBlock && endBlock.data) {
      return new Date(Number(endBlock.data.timestamp) * 1000);
    }
    // If the end block is not mined yet, we estimate the time
    return new Date(
      Date.now() +
        // Estimation of ~1 seconds per block
        (proposal.endBlock - Number(currentBlock)) * CELO_BLOCK_TIME,
    );
  }, [currentBlock, endBlock.data, proposal]);

  if (!proposal) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <IconLoading />
      </div>
    );
  }

  // Derive the actual proposal state from proposal fields instead of relying on proposal.state
  const getDerivedProposalState = ():
    | "pending"
    | "executed"
    | "active"
    | "queued"
    | "defeated"
    | "default" => {
    if (!proposal || !currentBlock) return "active";

    // Check explicit boolean states first
    if (proposal.canceled) return "defeated"; // Canceled proposals are shown as defeated
    if (proposal.executed) return "executed";
    if (proposal.queued) return "queued";

    const currentBlockNum = Number(currentBlock);
    const endBlockNum = Number(proposal.endBlock);
    const startBlockNum = Number(proposal.startBlock);

    // Check if voting period hasn't started yet
    if (currentBlockNum < startBlockNum) {
      return "pending";
    }

    // Check if voting period is active
    if (currentBlockNum >= startBlockNum && currentBlockNum <= endBlockNum) {
      return "active";
    }

    // Voting period has ended, check if proposal succeeded or was defeated
    if (currentBlockNum > endBlockNum) {
      // If queued but not executed and past execution deadline, it's expired (show as default)
      if (proposal.queued && proposal.eta) {
        const executionDeadline = Number(proposal.eta) + 7 * 24 * 60 * 60; // 7 days in seconds
        const currentTimestamp = Math.floor(Date.now() / 1000);
        if (currentTimestamp > executionDeadline) {
          return "default"; // "default" variant shows as "Expired"
        }
      }

      // Check vote results to determine if succeeded or defeated
      const totalVotes = Number(proposal.votes.total);
      const forVotes = Number(proposal.votes.for.total);
      const againstVotes = Number(proposal.votes.against.total);

      // Simple majority check (this might need adjustment based on actual governance rules)
      if (totalVotes > 0 && forVotes > againstVotes) {
        return "queued"; // Succeeded proposals that aren't queued yet show as queued
      } else {
        return "defeated";
      }
    }

    return "active";
  };

  // Format the proposer address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleCopyAddress = () => {
    try {
      navigator.clipboard.writeText(proposal.proposer.id);
      toast.success("Address copied to clipboard", { duration: 2000 });
      setCopiedAddress(proposal.proposer.id);
      setTimeout(() => {
        setCopiedAddress(null);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy address", error);
    }
  };

  return (
    <main className="md:px-22 relative w-full px-4 py-8 md:py-16">
      <Breadcrumb className="mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{proposal.metadata?.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mb-16 flex flex-col gap-6">
        <ProposalStatus
          variant={getDerivedProposalState()}
          data-testid="proposalStateLabel"
        />
        <h1
          className="max-w-[26ch] text-3xl font-medium md:text-6xl"
          data-testid="proposalTitleLabel"
        >
          {proposal.metadata?.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 md:gap-8">
          <div className="flex items-center gap-2">
            <Identicon address={proposal.proposer.id} size={16} />
            <span className="text-muted-foreground text-sm">
              by {formatAddress(proposal.proposer.id)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-secondary-active hover:text-secondary-active/75 h-4 w-4"
              onClick={handleCopyAddress}
            >
              {copiedAddress === proposal.proposer.id ? <Check /> : <Copy />}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Proposed on:</span>
            <span className="text-sm">
              {proposedOn && format(proposedOn, "MMM do, yyyy")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">
              Voting deadline:
            </span>
            <span className="text-sm">
              {votingDeadline && format(votingDeadline, "MMM do, yyyy")}
            </span>
          </div>
        </div>
      </div>

      <div className="xl:gap-22 flex flex-col gap-8 xl:w-full xl:flex-row">
        <div className="xl:w-2/3">
          <VoteCard proposal={proposal} votingDeadline={votingDeadline} />

          <div className="prose prose-invert mt-16">
            <ReactMarkdown remarkPlugins={[gfm]}>
              {proposal.metadata?.description || ""}
            </ReactMarkdown>
          </div>
        </div>
        <div className="xl:w-1/3">
          <Card className="bord max-h-[420px] w-full gap-3 overflow-hidden border-none">
            <CardHeader>
              <CardTitle className="text-2xl">Participants</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="for" className="max-h-[330px] overflow-auto">
                <TabsList>
                  <TabsTrigger value="for">Approve</TabsTrigger>
                  <TabsTrigger value="against">Reject</TabsTrigger>
                  <TabsTrigger value="abstain">Abstain</TabsTrigger>
                </TabsList>

                <TabsContent
                  value="for"
                  className="max-h-[330px] overflow-auto"
                >
                  <ParticipantList
                    participants={proposal.votes.for.participants}
                    totalVotes={proposal.votes.total}
                    voteType="Approve"
                  />
                </TabsContent>

                <TabsContent
                  value="against"
                  className="max-h-[330px] overflow-auto"
                >
                  <ParticipantList
                    participants={proposal.votes.against.participants}
                    totalVotes={proposal.votes.total}
                    voteType="Reject"
                  />
                </TabsContent>

                <TabsContent
                  value="abstain"
                  className="max-h-[330px] overflow-auto"
                >
                  <ParticipantList
                    participants={proposal.votes.abstain.participants}
                    totalVotes={proposal.votes.total}
                    voteType="Abstain"
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
