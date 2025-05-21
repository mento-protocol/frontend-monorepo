import * as React from "react";

import { cn } from "@/lib/utils.js";

function CoinInput({
  className,
  type,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:text-primary-foreground shadow-xs flex h-9 w-full min-w-0 rounded-md bg-transparent px-0 px-3 py-1 text-base outline-none transition-[color,box-shadow] file:inline-flex file:h-7 file:bg-transparent file:text-sm file:font-medium placeholder:text-2xl disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-2xl",
        "px-0",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { CoinInput };
