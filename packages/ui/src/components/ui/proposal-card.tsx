"use client";
import type * as React from "react";

import { cn } from "@/lib/utils.js";
import { cva, type VariantProps } from "class-variance-authority";

const proposalCardHeaderVariants = cva(
  "flex w-full flex-col items-start justify-start px-6 py-5 gap-6 lg:flex-row lg:justify-between",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        highlighted: "bg-[var(--dark-background)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function ProposalCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="proposal-card"
      className={cn(
        "bg-[var(--another-card-color)]! flex w-full flex-col items-start justify-start",
        className,
      )}
      {...props}
    />
  );
}

function ProposalCardHeader({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof proposalCardHeaderVariants> & {
    asChild?: boolean;
  }) {
  return (
    <div
      data-slot="proposal-card-header"
      className={cn(proposalCardHeaderVariants({ variant, className }))}
      {...props}
    />
  );
}

function ProposalCardBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="proposal-card-body"
      className={cn("flex w-full", className)}
      {...props}
    />
  );
}
function ProposalCardFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="proposal-card-footer"
      className={cn(
        "flex w-full flex-row items-center justify-center p-6",
        className,
      )}
      {...props}
    />
  );
}

export {
  ProposalCard,
  ProposalCardHeader,
  ProposalCardBody,
  ProposalCardFooter,
};
