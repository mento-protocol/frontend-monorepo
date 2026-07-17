import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
} from "@mento-protocol/ui";

export const NextControl = () => (
  <Pagination>
    <PaginationContent>
      <PaginationItem>
        <PaginationLink href="#" isActive>
          3
        </PaginationLink>
      </PaginationItem>
      <PaginationItem>
        <PaginationNext href="#" />
      </PaginationItem>
    </PaginationContent>
  </Pagination>
);
