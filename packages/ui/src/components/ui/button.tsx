import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer disabled:bg-[#6F667A] disabled:text-[#8E8B92]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-[#7D1CFC]",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-[#CCA6FF]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        approve: "bg-[#1CB06B] text-white hover:bg-[#1CB06B]/90",
        abstain: "bg-[#6F667A] text-white hover:bg-[#6F667A]/90",
        reject: "bg-[#C92C2C] text-white hover:bg-[#C92C2C]/90",
        switch:
          "bg-card text-[#6F667A] dark:text-[#8E8B92] border-solid border border-[#ADAAB2] dark:border-[#272130] relative gap-0",
      },
      size: {
        default: "h-8 px-8 py-2 has-[>svg]:px-3",
        switch: "p-[1px]",
        xs: "h-8 px-4 py-2",
        sm: "h-10 rounded-md gap-1.5 px-8 has-[>svg]:px-2.5",
        lg: "h-12 rounded-md px-8 has-[>svg]:px-4",
        icon: "size-9",
      },
      clipped: {
        default: "clip-btn-default",
        sm: "clip-btn-default",
        lg: "clip-btn-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  clipped,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, clipped, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
