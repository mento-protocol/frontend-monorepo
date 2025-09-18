"use client";
import { Identicon } from "@/components/identicon";
import { VoteCard } from "@/components/voting/vote-card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
} from "@repo/ui";
import {
  CELO_BLOCK_TIME,
  ensureChainId,
  ProposalState,
  useCurrentChain,
  useProposal,
} from "@repo/web3";
import { useAccount, useBlock, useBlockNumber } from "@repo/web3/wagmi";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatUnits } from "viem";
import { ExecutionCode } from "./execution-code/ExecutionCode";
import { isEmptyTransaction } from "./execution-code/patterns/utils";

const CELO_COMMUNITY_ADDRESS = "0x41822d8a191fcfb1cfca5f7048818acd8ee933d3";

const ADDRESS_ALIASES: Record<string, string> = {
  [CELO_COMMUNITY_ADDRESS.toLowerCase()]: "Celo Community",
};

function getAddressLabel(address: string): string {
  const lowerAddress = address.toLowerCase();
  return (
    ADDRESS_ALIASES[lowerAddress] ||
    `${address.slice(0, 6)}...${address.slice(-4)}`
  );
}

function decodeHtmlEntities(text: string): string {
  const textArea = document.createElement("textarea");
  textArea.innerHTML = text;
  return textArea.value;
}

type ParticipantListProps = {
  participants: Array<{ address: string; weight: bigint }>;
};

function ParticipantList({ participants }: ParticipantListProps) {
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

  const currentChain = useCurrentChain();
  const explorerUrl = currentChain.blockExplorers?.default?.url;

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
                <div className="h-auto !bg-transparent p-0">
                  <a
                    href={`${explorerUrl}/address/${participant.address}`}
                    className="flex items-center gap-1"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="hover:underline">
                      {getAddressLabel(participant.address)}
                    </span>
                    <CopyToClipboard
                      text={participant.address}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </a>
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

export const ProposalContent = () => {
  const params = useParams();
  const id = params.id as string;
  const { proposal, refetch: refetchProposal } = useProposal(BigInt(id));
  const { chainId } = useAccount();

  const currentChain = useCurrentChain();

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
    return proposal && new Date(proposal.proposalCreated[0]!.timestamp * 1000);
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

  const transactions = useMemo(() => {
    if (!proposal?.calls || proposal.calls.length === 0) return [];
    return proposal.calls.map((call) => ({
      address: call.target.id,
      value: call.value,
      data: call.calldata,
    }));
  }, [proposal?.calls]);

  // Check if there's meaningful execution code (same logic as ExecutionCode component)
  const hasExecutionCode = useMemo(() => {
    if (transactions.length === 0) return false;

    // If there's more than one transaction, it's meaningful
    if (transactions.length > 1) return true;

    // If there's exactly one transaction, check if it's empty
    return !(
      transactions.length === 1 &&
      transactions[0] &&
      isEmptyTransaction(transactions[0])
    );
  }, [transactions]);

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
        return "succeeded";
      case ProposalState.Defeated:
        return "defeated";
      case ProposalState.Queued:
        return "queued";
      case ProposalState.Executed:
        return "executed";
      case ProposalState.Canceled:
        return "canceled";
      case ProposalState.Expired:
        return "default";
      default:
        return "active";
    }
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const explorerUrl = currentChain.blockExplorers?.default?.url;

  const descriptionType = proposal.metadata?.description
    ? proposal.metadata.description.match(/^<\w+>|<\/\w+>$/)
      ? "html"
      : "text"
    : "text";

  return (
    <>
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
      <div className="mb-12 flex flex-col gap-4">
        <h1
          className="text-3xl font-medium md:text-6xl"
          data-testid="proposalTitleLabel"
          title={proposal.metadata?.title}
        >
          {proposal.metadata?.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 md:gap-8">
          <ProposalStatus
            variant={getStatusVariant()}
            data-testid="proposalStateLabel"
          />
          <div className="flex items-center gap-2">
            <Identicon address={proposal.proposer.id} size={16} />
            <Link
              className="text-muted-foreground text-sm"
              href={`${explorerUrl}/address/${proposal.proposer.id}`}
            >
              by {formatAddress(proposal.proposer.id)}
            </Link>
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
              {votingDeadline &&
                formatInTimeZone(
                  votingDeadline,
                  "UTC",
                  "MMM do, yyyy, HH:mm 'UTC'",
                )}
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

          {/* Show execution code above description only when there are meaningful transactions */}
          {hasExecutionCode && (
            <ExecutionCode transactions={transactions} className="mt-4" />
          )}

          <Card className="border-border mt-4">
            <CardHeader>
              <CardTitle className="text-2xl">Proposal Description</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-invert">
                {proposal.metadata?.description ? (
                  descriptionType === "html" ? (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: decodeHtmlEntities(
                          proposal.metadata.description,
                        ),
                      }}
                      data-testid="proposalDescriptionLabel"
                    />
                  ) : (
                    <div data-testid="proposalDescriptionLabel">
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: (props) => (
                            <a
                              {...props}
                              href={
                                props.href?.includes("https")
                                  ? props.href
                                  : `https://${props.href?.replace("http://", "")}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                        }}
                      >
                        {proposal.metadata.description}
                      </Markdown>
                    </div>
                  )
                ) : (
                  <p>No description available</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Show execution code below description when there are no transactions */}
          {!hasExecutionCode && (
            <ExecutionCode transactions={transactions} className="mt-4" />
          )}
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
                    data-testid="participantsTabButton_yes"
                  >
                    Yes
                  </TabsTrigger>
                  <TabsTrigger
                    value="against"
                    data-testid="participantsTabButton_no"
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
                  />
                </TabsContent>

                <TabsContent
                  value="against"
                  className="max-h-[330px] overflow-auto"
                >
                  <ParticipantList
                    participants={proposal.votes.against.participants}
                  />
                </TabsContent>

                <TabsContent
                  value="abstain"
                  className="max-h-[330px] overflow-auto"
                >
                  <ParticipantList
                    participants={proposal.votes.abstain.participants}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};
