import type * as React from "react";

import { cn } from "@/lib/utils.js";

function CoinInput({
  className,
  type = "text",
  onChange,
  ...props
}: React.ComponentProps<"input">) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let currentValue = e.target.value;

    // Allow empty string
    if (currentValue === "") {
      onChange?.(e);
      return;
    }

    let eventForCallback = e; // By default, pass the original event

    // If input starts with '.', prepend '0'
    if (currentValue.startsWith(".")) {
      currentValue = "0" + currentValue;
      // Prepare a new event object for the callback with the modified value
      eventForCallback = {
        ...e,
        target: { ...e.target, value: currentValue },
        currentTarget: { ...e.currentTarget, value: currentValue },
      };
    }

    // Only allow numbers and one decimal point using the (potentially modified) currentValue
    const numericRegex = /^[0-9]*\.?[0-9]*$/;

    // Check if the currentValue matches the pattern and doesn't have multiple dots
    if (
      numericRegex.test(currentValue) &&
      (currentValue.match(/\./g) || []).length <= 1
    ) {
      // Note: Multiple leading zeros are now allowed, matching Uniswap's behavior
      onChange?.(eventForCallback); // Pass the appropriate event object
    }
    // If invalid input (regex fails or too many dots), don't call onChange.
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
