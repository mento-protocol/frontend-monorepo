import type * as React from "react";

import { cn } from "@/lib/utils.js";

function CoinInput({
  className,
  type = "text",
  onChange,
  ...props
}: React.ComponentProps<"input">) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Allow empty string
    if (value === "") {
      onChange?.(e);
      return;
    }

    // Only allow numbers and one decimal point
    const numericRegex = /^[0-9]*\.?[0-9]*$/;

    // Check if the value matches the pattern and doesn't have multiple dots
    if (numericRegex.test(value) && (value.match(/\./g) || []).length <= 1) {
      // Prevent multiple leading zeros (except for 0.xxx)
      if (value.length > 1 && value[0] === "0" && value[1] !== ".") {
        return;
      }

      onChange?.(e);
    }
    // If invalid input, don't call onChange - this prevents the crash
  };

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-none bg-transparent text-base outline-none transition-[color,box-shadow]",
        "placeholder:text-muted-foreground text-[32px] placeholder:text-[32px]",
        "selection:bg-primary/20 selection:text-primary-foreground",
        "file:text-foreground file:inline-flex file:h-7 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "px-0 py-1",
        className,
      )}
      onChange={handleChange}
      {...props}
    />
  );
}

export { CoinInput };
