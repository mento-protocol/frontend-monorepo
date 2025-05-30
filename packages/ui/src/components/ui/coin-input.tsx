import type * as React from "react";

import { cn } from "@/lib/utils.js";

function CoinInput({
  className,
  type = "text",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-none bg-transparent text-base outline-none transition-[color,box-shadow]",
        "placeholder:text-muted-foreground text-2xl placeholder:text-2xl",
        "selection:bg-primary/20 selection:text-primary-foreground",
        "file:text-foreground file:inline-flex file:h-7 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "px-0 py-1",
        className,
      )}
      {...props}
    />
  );
}

export { CoinInput };
