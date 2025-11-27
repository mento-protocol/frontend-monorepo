import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils.js";

const proposalStatusVariants = cva(
  "min-w-[72px] max-w-24 w-full h-8 flex flex-row items-center justify-center gap-0 text-xs lg:text-sm capitalize shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--expired)] text-[var(--expired-text)]", // EXPIRED
        active: "bg-active",
        pending: "bg-pending",
        executed: "bg-executed text-black",
        queued: "bg-queued",
        succeeded: "bg-succeeded",
        defeated: "bg-defeated",
        canceled: "bg-canceled",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function ProposalStatus({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof proposalStatusVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="div"
      className={cn(proposalStatusVariants({ variant, className }))}
      {...props}
    >
      {variant === "default" || variant === null || variant === undefined
        ? "Expired"
        : variant}
    </Comp>
  );
}

export { ProposalStatus, proposalStatusVariants };
