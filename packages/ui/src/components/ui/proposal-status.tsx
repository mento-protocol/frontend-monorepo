import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils.js";

const proposalStatusVariants = cva(
  "w-[72px] h-8 flex flex-row items-center justify-center gap-0 text-xs lg:text-sm capitalize shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--expired)] text-[var(--expired-text)]", // EXPIRED
        active: "bg-[var(--active)]",
        pending: "bg-[var(--pending)]",
        executed: "bg-[var(--executed)] text-black",
        queued: "bg-[var(--queued)]",
        succeeded: "bg-[var(--succeeded)]",
        defeated: "bg-[var(--defeated)]",
        canceled: "bg-[var(--canceled)]",
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
