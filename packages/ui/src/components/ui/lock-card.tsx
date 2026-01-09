"use client";
import type * as React from "react";

import { cn } from "@/lib/utils.js";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "./button";

const cardVariants = cva(
  "bg-card text-card-foreground flex flex-col w-full gap-6 py-4 rounded-lg border border-border",
  {
    variants: {
      variant: {
        default: "md:max-w-[330px]",
        horizontal:
          "md:flex-row justify-between hover:bg-muted transition-colors",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const badgeVariants = cva(
  "inline-flex items-center px-3 py-1 text-sm font-medium",
  {
    variants: {
      type: {
        personal: "bg-executed text-muted",
        delegated: "bg-defeated text-foreground",
        received: "bg-primary text-foreground",
        expired: "bg-muted text-foreground",
        unlocked: "bg-success text-foreground",
      },
    },
    defaultVariants: {
      type: "personal",
    },
  },
);

type BadgeType = "personal" | "delegated" | "received" | "expired" | "unlocked";

function LockCard({
  className,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="coin-card"
      className={cn(cardVariants(props), className)}
      {...props}
    />
  );
}

function LockCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-header"
      className={cn(
        "px-4 flex flex-row items-start justify-between",
        className,
      )}
      {...props}
    />
  );
}

function LockCardHeaderGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-header-group"
      className={cn("", className)}
      {...props}
    />
  );
}

function LockCardSymbol({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-symbol"
      className={cn("text-2xl font-medium text-foreground", className)}
      {...props}
    />
  );
}

function LockCardName({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-name"
      className={cn("text-base leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

function LockCardLogo({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-logo" className={cn("p-0", className)} {...props} />
  );
}

function LockCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "gap-2 px-4 md:gap-6 flex flex-row items-center",
        className,
      )}
      {...props}
    />
  );
}

function LockCardOrigin({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-origin"
      className={cn("gap-2 flex flex-col", className)}
      {...props}
    />
  );
}

function LockCardOriginFlag({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-origin-flag"
      className={cn("h-4 w-4", className)}
      {...props}
    />
  );
}

function LockCardOriginText({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-origin-text"
      className={cn("leading-none", className)}
      {...props}
    />
  );
}

function LockCardSupply({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-supply"
      className={cn("gap-2 flex flex-col", className)}
    >
      <span className="text-sm text-muted-foreground">Supply:</span>
      <span className="text-sm md:text-base leading-none">
        {props.children}
      </span>
    </div>
  );
}

function LockCardBadge({
  className,
  type = "personal",
  ...props
}: React.ComponentProps<"div"> & { type?: BadgeType }) {
  return (
    <div
      data-slot="lock-card-badge"
      className={cn(badgeVariants({ type }), className)}
      {...props}
    />
  );
}

function LockCardAmount({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-amount"
      className={cn("text-2xl font-medium text-foreground", className)}
      {...props}
    />
  );
}

function LockCardToken({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-token"
      className={cn("text-base text-muted-foreground", className)}
      {...props}
    />
  );
}

function LockCardDelegationLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-delegation-label"
      className={cn("mb-1 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function LockCardDelegationAddress({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-delegation-address"
      className={cn("font-mono text-sm text-foreground", className)}
      {...props}
    />
  );
}

function LockCardBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-body"
      className={cn("space-y-4 px-4", className)}
      {...props}
    />
  );
}

function LockCardRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-row"
      className={cn("gap-5 grid grid-cols-2", className)}
      {...props}
    />
  );
}

function LockCardField({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-field"
      className={cn("gap-1 flex flex-col", className)}
      {...props}
    />
  );
}

function LockCardFieldLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-field-label"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function LockCardFieldValue({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-field-value"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
}

function LockCardActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-actions"
      className={cn("px-4 pb-2 mt-auto", className)}
      {...props}
    />
  );
}

function LockCardButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <Button
      data-slot="lock-card-button"
      className={cn(className, "text-sm w-full")}
      variant="abstain"
      clipped="default"
      {...props}
    />
  );
}

function LockCardNotice({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lock-card-notice"
      className={cn("px-4 pb-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  LockCard,
  LockCardHeader,
  LockCardHeaderGroup,
  LockCardSymbol,
  LockCardName,
  LockCardLogo,
  LockCardFooter,
  LockCardOrigin,
  LockCardOriginFlag,
  LockCardOriginText,
  LockCardSupply,
  LockCardBadge,
  LockCardAmount,
  LockCardToken,
  LockCardDelegationLabel,
  LockCardDelegationAddress,
  LockCardBody,
  LockCardRow,
  LockCardField,
  LockCardFieldLabel,
  LockCardFieldValue,
  LockCardActions,
  LockCardButton,
  LockCardNotice,
  type BadgeType,
};
