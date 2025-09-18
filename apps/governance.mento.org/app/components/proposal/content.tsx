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
import { ExecutionCode } from "./execution-code/ExecutionCode";
import { isEmptyTransaction } from "./execution-code/patterns/utils";
import { ParticipantList } from "./participants/ParticipantList";
import { ProposalDescription } from "./description/ProposalDescription";

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
      <div className="mb-12 flex flex-col gap-5">
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

          <ProposalDescription description={proposal.metadata?.description} />

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
