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
import { ProposalState } from "@/graphql/subgraph/generated/subgraph";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useMemo } from "react";
import { TransactionLink } from "./components/TransactionLink";
import { AddressLink } from "./components/AddressLink";

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
      transaction: {
        id: string;
      };
    }>;
  };
  votingDeadline?: Date;
}

export const ProposalHeader = ({
  proposal,
  votingDeadline,
}: ProposalHeaderProps) => {
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
      <div className="mb-12 gap-5 flex flex-col">
        <h1
          className="font-medium md:text-6xl text-3xl"
          data-testid="proposalTitleLabel"
          title={proposal.metadata?.title}
        >
          {proposal.metadata?.title}
        </h1>
        <div className="gap-2 md:gap-8 flex flex-wrap items-center">
          <ProposalStatus
            variant={getStatusVariant()}
            data-testid="proposalStateLabel"
          />
          <div className="gap-2 flex items-center">
            <span className="text-sm text-muted-foreground">Proposed by:</span>
            <div className="gap-1 flex items-center">
              <Identicon
                address={proposal.proposer.id}
                size={16}
                styles={{ alignSelf: "self-start" }}
              />
              <AddressLink
                address={proposal.proposer.id}
                className="text-sm underline-offset-4 hover:underline"
              >
                {`${proposal.proposer.id.slice(0, 6)}...${proposal.proposer.id.slice(-4)}`}
              </AddressLink>
            </div>
            <CopyToClipboard text={proposal.proposer.id} />
          </div>
          <div className="gap-2 flex items-center">
            <span className="text-sm text-muted-foreground">Proposed on:</span>
            {proposedOn && proposal.proposalCreated[0]?.transaction.id ? (
              <TransactionLink
                className="text-sm underline-offset-4 hover:underline"
                txHash={proposal.proposalCreated[0].transaction.id}
              >
                {format(proposedOn, "MMM do, yyyy")}
              </TransactionLink>
            ) : (
              <span className="text-sm">
                {proposedOn && format(proposedOn, "MMM do, yyyy")}
              </span>
            )}
          </div>
          <div className="gap-2 flex items-center">
            <span className="text-sm text-muted-foreground">
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
