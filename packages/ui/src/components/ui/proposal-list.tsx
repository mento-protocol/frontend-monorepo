"use client";
import type * as React from "react";

import { cn } from "@/lib/utils.js";
import { cva, type VariantProps } from "class-variance-authority";

function ProposalList({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="proposal-list"
      className={cn("flex flex-col items-start justify-start gap-0", className)}
      {...props}
    />
  );
}

function ProposalListItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="proposal-list-item flex flex-col items-start justify-start p-3 lg:p-8 lg:flex-row lg:items-center lg:justify-between"
      className={cn("flex", className)}
      {...props}
    />
  );
}

export { ProposalList, ProposalListItem };
