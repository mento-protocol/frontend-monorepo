import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-all disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive cursor-pointer disabled:bg-incard disabled:text-muted-foreground",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border-[var(--border)] dark:hover:border-[var(--new-muted-color)] shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-[var(--border)] dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-primary shadow-xs hover:bg-secondary-foreground active:bg-[var(--secondary-active)]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        approve:
          "bg-[#1CB06B] text-white hover:bg-[#1CB06B]/90 active:bg-white/10",
        abstain:
          "bg-[#6F667A] text-white hover:bg-[#6F667A]/90 active:bg-white/10",
        reject:
          "bg-[#C92C2C] text-white hover:bg-[#C92C2C]/90 active:bg-white/10",
        switch:
          "text-muted border dark:bg-incard border-border-secondary dark:border-input relative gap-0 hover:border-[var(--new-muted-color)] dark:hover:border-[var(--new-muted-color)]",
      },
      size: {
        default: "h-8 px-4 py-2 has-[>svg]:px-3 text-base",
        switch: "p-[3px]",
        xs: "h-8 px-4 py-2",
        sm: "h-9 rounded-none gap-1.5 px-4 has-[>svg]:px-2.5 text-base",
        md: "h-10 rounded-none px-6 has-[>svg]:px-6 text-base",
        lg: "h-12 rounded-none px-4 has-[>svg]:px-4 text-base",
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

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  className,
  variant,
  size,
  clipped,
  asChild = false,
  ...props
}: ButtonProps) {
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
