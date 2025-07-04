"use client";
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
  ProposalStatus,
} from "@repo/ui";
import { format } from "date-fns";
import { Copy } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import { useAccount, useBlock, useBlockNumber } from "wagmi";

export default function ProposalPage() {
  const params = useParams();
  const id = params.id as string;
  const { proposal } = useProposal(BigInt(id));
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

  // There should really ever be 1 ProposalCreated event per proposal so we just take the first one
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
        Loading...
      </div>
    );
  }

  // Get the variant for ProposalStatus based on the state
  const getStatusVariant = (state: ProposalState) => {
    switch (state) {
      case ProposalState.Active:
        return "active";
      case ProposalState.Succeeded:
        return "succeeded";
      case ProposalState.Executed:
        return "executed";
      case ProposalState.Defeated:
        return "defeated";
      case ProposalState.Pending:
        return "pending";
      case ProposalState.Queued:
        return "queued";
      case ProposalState.Expired:
        return "expired";
      case ProposalState.Canceled:
        return "canceled";
      default:
        return "active";
    }
  };

  // Format the proposer address for display
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(proposal.proposer.id);
  };

  return (
    <main className="md:px-22 relative w-full px-4 py-8 md:py-16">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>1</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mb-16 flex flex-col gap-6">
        <ProposalStatus variant={getStatusVariant(proposal.state)} />
        <h1 className="max-w-[26ch] text-3xl font-medium md:text-6xl">
          {proposal.metadata?.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 md:gap-8">
          <div className="flex items-center gap-2">
            <span className="bg-primary h-4 w-4 rounded-full" />
            <span className="text-muted-foreground text-sm">
              by {formatAddress(proposal.proposer.id)}
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="text-secondary-active h-4 w-4"
              onClick={handleCopyAddress}
            >
              <Copy />
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
      <VoteCard proposal={proposal} votingDeadline={votingDeadline} />
      <div className="prose prose-invert mt-16">
        <ReactMarkdown remarkPlugins={[gfm]}>
          {proposal.metadata?.description || ""}
        </ReactMarkdown>
      </div>
    </main>
  );
}
