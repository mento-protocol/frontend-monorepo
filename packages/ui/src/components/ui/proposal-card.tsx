"use client";
import type * as React from "react";

import { cn } from "@/lib/utils.js";
import { cva, type VariantProps } from "class-variance-authority";

const proposalCardHeaderVariants = cva(
  // The card surface (--another-card-color) is always dark in both themes, so the
  // header text must be light regardless of the app theme. primary-foreground is
  // theme-independent (oklch 0.98 in :root and .dark); without it, plain-text header
  // children inherit --foreground and render dark-on-dark in light mode. Consumers
  // can still override (e.g. text-white/70).
  "flex w-full flex-col items-start justify-start px-6 py-5 gap-6 lg:flex-row lg:!justify-between text-primary-foreground",
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
        "flex w-full flex-col items-start justify-start bg-[var(--another-card-color)]!",
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
        "p-6 flex w-full flex-row items-center justify-center",
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
