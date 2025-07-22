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
  CopyToClipboard,
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
import { formatUnits } from "viem";
import { useAccount, useBlock, useBlockNumber } from "wagmi";

// Function to decode HTML entities
function decodeHtmlEntities(text: string): string {
  const textArea = document.createElement("textarea");
  textArea.innerHTML = text;
  return textArea.value;
}

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
                <div
                  className="h-auto !bg-transparent p-0"
                  onClick={() => handleCopyAddress(participant.address)}
                >
                  <span className="flex items-center gap-1">
                    {`${participant.address.slice(0, 6)}...${participant.address.slice(-4)}`}
                    <CopyToClipboard
                      text={participant.address}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </span>
                </div>
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
  const { proposal, refetch: refetchProposal } = useProposal(BigInt(id));
  const { chainId } = useAccount();

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
    if (Number(currentBlock) >= proposal.endBlock && endBlock.data) {
      return new Date(Number(endBlock.data.timestamp) * 1000);
    }
    return new Date(
      Date.now() + (proposal.endBlock - Number(currentBlock)) * CELO_BLOCK_TIME,
    );
  }, [currentBlock, endBlock.data, proposal]);

  if (!proposal) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <IconLoading />
      </div>
    );
  }

  const getStatusVariant = () => {
    if (!proposal.state) return "active";

    switch (proposal.state) {
      case ProposalState.Pending:
        return "pending";
      case ProposalState.Active:
        return "active";
      case ProposalState.Succeeded:
        return "queued";
      case ProposalState.Defeated:
        return "defeated";
      case ProposalState.Queued:
        return "queued";
      case ProposalState.Executed:
        return "executed";
      case ProposalState.Canceled:
        return "defeated";
      case ProposalState.Expired:
        return "default";
      default:
        return "active";
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
            <BreadcrumbPage className="max-w-xl truncate">
              {proposal.metadata?.title}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mb-16 flex flex-col gap-6">
        <ProposalStatus
          variant={getStatusVariant()}
          data-testid="proposalStateLabel"
        />
        <h1
          className="max-w-6xlxl truncate text-3xl font-medium leading-[80px] md:text-6xl"
          data-testid="proposalTitleLabel"
          title={proposal.metadata?.title}
        >
          {proposal.metadata?.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 md:gap-8">
          <div className="flex items-center gap-2">
            <Identicon address={proposal.proposer.id} size={16} />
            <span className="text-muted-foreground text-sm">
              by {formatAddress(proposal.proposer.id)}
            </span>
            <CopyToClipboard text={proposal.proposer.id} />
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

      <div className="flex flex-col gap-8 xl:w-full xl:flex-row xl:gap-10">
        <div className="xl:w-2/3">
          <VoteCard
            proposal={proposal}
            votingDeadline={votingDeadline}
            onVoteConfirmed={refetchProposal}
          />

          <div className="prose prose-invert mt-16">
            {proposal.metadata?.description ? (
              <div
                dangerouslySetInnerHTML={{
                  __html: decodeHtmlEntities(proposal.metadata.description),
                }}
                data-testid="proposalDescriptionLabel"
              />
            ) : (
              <p>No description available</p>
            )}
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
                  <TabsTrigger
                    value="for"
                    data-testid="participantsTabButton_approve"
                  >
                    Yes
                  </TabsTrigger>
                  <TabsTrigger
                    value="against"
                    data-testid="participantsTabButton_reject"
                  >
                    No
                  </TabsTrigger>
                  <TabsTrigger
                    value="abstain"
                    data-testid="participantsTabButton_abstain"
                  >
                    Abstain
                  </TabsTrigger>
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
