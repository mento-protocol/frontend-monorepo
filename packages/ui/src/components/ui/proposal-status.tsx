"use client";
import type * as React from "react";

import { cn } from "@/lib/utils.js";
import { cva, type VariantProps } from "class-variance-authority";

const proposalStatusVariants = cva(
  "flex flex-col items-start justify-start gap-0",
  {
    variants: {
      variant: {
        default: "bg-transparent", // EXPIRED
        defeated: "bg-[var(--dark-background)]",
        queued: "",
        executed: "",
        pending: "",
        active: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function ProposalStatus({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="proposal-status"
      className={cn("flex flex-col items-start justify-start gap-0", className)}
      {...props}
    />
  );
}

export { ProposalStatus };
