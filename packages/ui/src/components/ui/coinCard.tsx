import * as React from "react";

import { cn } from "@/lib/utils.js";

function CoinCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 py-4",
        className,
      )}
      {...props}
    />
  );
}

function CoinCardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-header"
      className={cn(
        "flex flex-row items-start justify-between gap-6 px-4",
        className,
      )}
      {...props}
    />
  );
}

function CoinCardHeaderGroup({
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

function CoinCardSymbol({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-symbol"
      className={cn("text-2xl font-medium", className)}
      {...props}
    />
  );
}

function CoinCardName({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-name"
      className={cn("text-muted-foreground text-sm leading-5", className)}
      {...props}
    />
  );
}

function CoinCardLogo({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-logo"
      className={cn("h-14 w-14", className)}
      {...props}
    />
  );
}

function CoinCardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex flex-row items-center justify-between gap-6 px-4",
        className,
      )}
      {...props}
    />
  );
}

function CoinCardOrigin({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-origin"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function CoinCardOriginFlag({
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

function CoinCardOriginText({
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

function CoinCardSupply({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="coin-card-supply"
      className={cn("flex flex-col gap-2", className)}
    >
      <span className="text-muted-foreground text-sm">Supply:</span>
      <span className="leading-none">{props.children}</span>
    </div>
  );
}

export {
  CoinCard,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardSymbol,
  CoinCardName,
  CoinCardLogo,
  CoinCardFooter,
  CoinCardOrigin,
  CoinCardOriginFlag,
  CoinCardOriginText,
  CoinCardSupply,
};
