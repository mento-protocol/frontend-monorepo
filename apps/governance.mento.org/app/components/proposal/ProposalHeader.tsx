"use client";
import { Identicon } from "@/components/identicon";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  CopyToClipboard,
  ProposalStatus,
} from "@repo/ui";
import { useCurrentChain } from "@/hooks/use-current-chain";
import { ProposalState } from "@/graphql/subgraph/generated/subgraph";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { useMemo } from "react";

interface ProposalHeaderProps {
  proposal: {
    metadata?: {
      title?: string;
    };
    proposer: {
      id: string;
    };
    state?: ProposalState;
    proposalCreated: Array<{
      timestamp: number;
    }>;
  };
  votingDeadline?: Date;
}

export const ProposalHeader = ({
  proposal,
  votingDeadline,
}: ProposalHeaderProps) => {
  const currentChain = useCurrentChain();
  const explorerUrl = currentChain.blockExplorers?.default?.url;

  const proposedOn = useMemo(() => {
    return proposal && new Date(proposal.proposalCreated[0]!.timestamp * 1000);
  }, [proposal]);

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
    </>
  );
};
