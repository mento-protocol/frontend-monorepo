"use client";
import useProposals from "@/lib/contracts/governor/use-proposals";
import NumbersService from "@/lib/helpers/numbers";
import {
  Button,
  IconChevron,
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
  const { proposals } = useProposals();
  const [currentPage, setCurrentPage] = useState(1);

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
        <Link href="/create-proposal">
          <Button clipped="lg" size="md">
            Create New Proposal <IconChevron />
          </Button>
        </Link>
      </ProposalCardHeader>
      <ProposalCardBody className="flex flex-col">
        {paginatedProposals.map(({ proposalId, metadata, votes }, index) => (
          <ProposalListItem key={index}>
            <ProposalListItemIndex
              index={(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
            />
            <ProposalListItemBody>
              <ProposalStatus variant="active" />
              <Link href={`/proposals/${proposalId}`}>
                <h3 className="text-xl text-white xl:text-lg">
                  {metadata.title}
                </h3>
              </Link>
              <div className="w-full xl:ml-auto xl:max-w-[192px]">
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
