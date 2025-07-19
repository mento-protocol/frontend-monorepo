"use client";
import useProposals from "@/lib/contracts/governor/use-proposals";
import NumbersService from "@/lib/helpers/numbers";
import { ProposalState } from "@/lib/graphql";
import {
  Button,
  IconChevron,
  IconLoading,
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  ProposalCard,
  ProposalCardBody,
  ProposalCardHeader,
  ProposalListItem,
  ProposalListItemBody,
  ProposalListItemIndex,
  ProposalStatus,
} from "@repo/ui";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import useTokens from "@/lib/contracts/useTokens";
import { useProposalThreshold } from "@/lib/contracts/governor/useProposalThreshold";

const ITEMS_PER_PAGE = 10;
const DOTS = "...";

const range = (start: number, end: number) => {
  const length = end - start + 1;
  return Array.from({ length }, (_, idx) => idx + start);
};

const usePagination = ({
  totalPages,
  siblingCount = 1,
  currentPage,
}: {
  totalPages: number;
  siblingCount?: number;
  currentPage: number;
}) => {
  const paginationRange = useMemo(() => {
    const totalPageNumbers = siblingCount + 5;

    if (totalPageNumbers >= totalPages) {
      return range(1, totalPages);
    }

    const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
    const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

    const shouldShowLeftDots = leftSiblingIndex > 2;
    const shouldShowRightDots = rightSiblingIndex < totalPages - 2;

    const firstPageIndex = 1;
    const lastPageIndex = totalPages;

    if (!shouldShowLeftDots && shouldShowRightDots) {
      const leftItemCount = 3 + 2 * siblingCount;
      const leftRange = range(1, leftItemCount);
      return [...leftRange, DOTS, totalPages];
    }

    if (shouldShowLeftDots && !shouldShowRightDots) {
      const rightItemCount = 3 + 2 * siblingCount;
      const rightRange = range(totalPages - rightItemCount + 1, totalPages);
      return [firstPageIndex, DOTS, ...rightRange];
    }

    if (shouldShowLeftDots && shouldShowRightDots) {
      const middleRange = range(leftSiblingIndex, rightSiblingIndex);
      return [firstPageIndex, DOTS, ...middleRange, DOTS, lastPageIndex];
    }
    return range(1, totalPages);
  }, [totalPages, siblingCount, currentPage]);

  return paginationRange;
};

export const ProposalList = () => {
  const { proposals, isLoading } = useProposals();
  const { veMentoBalance, mentoBalance, isBalanceLoading } = useTokens();
  const { proposalThreshold, isLoadingProposalThreshold } =
    useProposalThreshold();

  const [currentPage, setCurrentPage] = useState(1);

  const canCreateProposal = useMemo(() => {
    if (isBalanceLoading || isLoadingProposalThreshold) return false;

    return veMentoBalance.value >= proposalThreshold;
  }, [
    isBalanceLoading,
    isLoadingProposalThreshold,
    veMentoBalance.value,
    proposalThreshold,
  ]);
  const totalPages = Math.ceil(proposals.length / ITEMS_PER_PAGE);
  const paginatedProposals = proposals.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const paginationRange = usePagination({
    currentPage,
    totalPages,
  });

  return (
    <ProposalCard>
      <ProposalCardHeader>
        <h2 className="text-2xl font-semibold">Proposals</h2>
        {canCreateProposal && (
          <Link href="/create-proposal">
            <Button clipped="lg" size="md">
              Create New Proposal <IconChevron />
            </Button>
          </Link>
        )}
      </ProposalCardHeader>
      <ProposalCardBody className="relative flex min-h-40 flex-col">
        {paginatedProposals.length === 0 && isLoading ? (
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4">
            <IconLoading />
          </div>
        ) : (
          paginatedProposals.map((proposal, index) => {
            const { proposalId, metadata, votes, state } = proposal;

            const getStatusVariant = () => {
              if (!state) return "active";

              switch (state) {
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

            return (
              <ProposalListItem key={index}>
                <ProposalListItemIndex
                  index={(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                />
                <ProposalListItemBody>
                  <ProposalStatus variant={getStatusVariant() as any} />
                  <Link href={`/proposals/${proposalId}`}>
                    <h3
                      className="text-lg leading-5 text-white"
                      data-testid={`proposal_${metadata.title}`}
                    >
                      {metadata.title}
                    </h3>
                  </Link>
                  <div className="w-full xl:ml-auto xl:max-w-[192px]">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-sm leading-5 xl:h-8 xl:text-sm">
                        <span className="block h-1 w-1 bg-[var(--approved)]"></span>
                        {NumbersService.parseNumericValue(
                          Number(formatUnits(votes.for.total, 18)),
                        )}
                      </div>
                      <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-sm leading-5 xl:h-8 xl:text-sm">
                        <span className="block h-1 w-1 bg-[var(--rejected)]"></span>
                        {NumbersService.parseNumericValue(
                          Number(formatUnits(votes.against.total, 18)),
                        )}
                      </div>
                      <div className="flex flex-row items-center justify-center gap-2 bg-[var(--dark-background)] py-1 text-sm leading-5 xl:h-8 xl:text-sm">
                        <span className="block h-1 w-1 bg-[var(--abstained)]"></span>
                        {NumbersService.parseNumericValue(
                          Number(formatUnits(votes.abstain.total, 18)),
                        )}
                      </div>
                    </div>
                  </div>
                </ProposalListItemBody>
              </ProposalListItem>
            );
          })
        )}
        {totalPages > 1 && (
          <Pagination className="mt-4">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handlePageChange(currentPage - 1);
                  }}
                  className={
                    currentPage === 1 ? "pointer-events-none opacity-50" : ""
                  }
                />
              </PaginationItem>
              {paginationRange.map((pageNumber, index) => {
                if (pageNumber === DOTS) {
                  return (
                    <PaginationItem key={`${pageNumber}-${index}`}>
                      <span className="flex h-10 w-10 items-center justify-center">
                        ...
                      </span>
                    </PaginationItem>
                  );
                }

                return (
                  <PaginationItem key={pageNumber}>
                    <PaginationLink
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        handlePageChange(pageNumber as number);
                      }}
                      isActive={currentPage === pageNumber}
                    >
                      {pageNumber}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    handlePageChange(currentPage + 1);
                  }}
                  className={
                    currentPage === totalPages
                      ? "pointer-events-none opacity-50"
                      : ""
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </ProposalCardBody>
    </ProposalCard>
  );
};
