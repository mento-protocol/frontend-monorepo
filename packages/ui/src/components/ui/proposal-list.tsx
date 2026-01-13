"use client";
import type * as React from "react";

import { cn } from "@/lib/utils.js";

function ProposalList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="proposal-list"
      className={cn(
        "gap-0 flex w-full flex-col items-start justify-start",
        className,
      )}
      {...props}
    />
  );
}

function ProposalListItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="proposal-list-item"
      className={cn(
        "grid grid-cols-[34px_auto] border-b border-[var(--border-tertiary)] first:border-t",
        className,
      )}
      {...props}
    />
  );
}

interface ProposalListItemIndexProps extends React.ComponentProps<"div"> {
  index?: string | number;
}

function ProposalListItemIndex({
  index,
  className,
  ...props
}: ProposalListItemIndexProps) {
  return (
    <div
      data-slot="proposal-list-item-index"
      className={cn(
        "text-sm lg:w-12 flex h-full w-full shrink-0 flex-col items-center justify-center bg-[var(--dark-background)] text-[var(--index)]",
        className,
      )}
      {...props}
    >
      {index !== undefined && index}
    </div>
  );
}

function ProposalListItemBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="proposal-list-item-body"
      className={cn(
        "gap-2 p-3 xl:flex xl:w-full xl:!flex-row xl:items-center xl:!gap-8 xl:p-8 flex flex-col items-start justify-start",
        className,
      )}
    >
      {props.children}
    </div>
  );
}

export {
  ProposalList,
  ProposalListItem,
  ProposalListItemIndex,
  ProposalListItemBody,
};
