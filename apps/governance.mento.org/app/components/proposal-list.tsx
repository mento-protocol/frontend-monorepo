"use client";
import { Button, IconChevron } from "@repo/ui";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ProposalCard,
  ProposalCardBody,
  ProposalCardFooter,
  ProposalCardHeader,
  ProposalList as ProposalListComponent,
  ProposalListItem,
  ProposalListItemBody,
  ProposalListItemIndex,
  ProposalStatus,
} from "@repo/ui";
import useProposals from "@/lib/contracts/governor/use-proposals";
import { formatUnits } from "viem";
import NumbersService from "@/lib/helpers/numbers";

export const ProposalList = () => {
  const { proposals } = useProposals();

  return (
    <ProposalCard>
      <ProposalCardHeader variant="highlighted">
        <h2 className="text-2xl font-semibold">Proposals</h2>
        <Button clipped="lg" size="md">
          Create New Proposal <IconChevron />
        </Button>
      </ProposalCardHeader>
      <ProposalCardBody className="flex flex-col">
        {proposals.map(({ proposalId, metadata, state, votes }, index) => (
          <ProposalListItem key={index}>
            <ProposalListItemIndex index={index + 1} />
            <ProposalListItemBody>
              <ProposalStatus variant="active" />
              <h3 className="text-xl text-white xl:text-lg">
                {metadata.title}
              </h3>
              <div className="w-full xl:max-w-[192px]">
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                    <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                    {NumbersService.parseNumericValue(
                      Number(formatUnits(votes.for.total, 18)),
                    )}
                  </div>
                  <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                    <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                    {NumbersService.parseNumericValue(
                      Number(formatUnits(votes.against.total, 18)),
                    )}
                  </div>
                  <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-base leading-5 xl:text-sm">
                    <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                    {NumbersService.parseNumericValue(
                      Number(formatUnits(votes.abstain.total, 18)),
                    )}
                  </div>
                </div>
              </div>
            </ProposalListItemBody>
          </ProposalListItem>
        ))}
      </ProposalCardBody>
    </ProposalCard>
  );
};
