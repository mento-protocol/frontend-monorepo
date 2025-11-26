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

    // Convert comma to dot for decimal separator
    if (currentValue.includes(",")) {
      currentValue = currentValue.replace(/,/g, ".");
      eventForCallback = {
        ...e,
        target: { ...e.target, value: currentValue },
        currentTarget: { ...e.currentTarget, value: currentValue },
      };
    }

    // If input starts with '.' or ',', prepend '0'
    if (currentValue.startsWith(".")) {
      currentValue = "0" + currentValue;
      eventForCallback = {
        ...e,
        target: { ...e.target, value: currentValue },
        currentTarget: { ...e.currentTarget, value: currentValue },
      };
    }

    // Only allow numbers and one decimal point using the (potentially modified) currentValue
    // Optimized regex to prevent ReDoS: use possessive quantifiers and limit input length
    // Limit input length to prevent excessive processing
    if (currentValue.length > 100) {
      e.preventDefault();
      if (e.target instanceof HTMLInputElement) {
        setTimeout(() => {
          e.target.value = props.value?.toString() || "";
        }, 0);
      }
      return;
    }

    // Use a more efficient regex pattern that avoids catastrophic backtracking
    // Pattern: optional digits, optional dot, optional digits after dot
    const numericRegex = /^\d*\.?\d*$/;

    // Check if the currentValue matches the pattern and doesn't have multiple dots
    if (
      numericRegex.test(currentValue) &&
      (currentValue.match(/\./g) || []).length <= 1
    ) {
      // Note: Multiple leading zeros are now allowed, matching Uniswap's behavior
      onChange?.(eventForCallback); // Pass the appropriate event object
    } else {
      // For invalid input, prevent the default behavior
      e.preventDefault();

      // Keep the previous valid value by setting the input's value back
      if (e.target instanceof HTMLInputElement) {
        // Use setTimeout to ensure this happens after React's synthetic event handling
        setTimeout(() => {
          e.target.value = props.value?.toString() || "";
        }, 0);
      }
    }
  };

  // Add keydown handler to prevent entering invalid characters
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow navigation keys, deletion keys, and number keys
    const allowedKeys = [
      "Backspace",
      "Delete",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
      "Home",
      "End",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      ".",
      ",",
    ];

    // Allow copy/paste and selection operations
    if (
      (e.ctrlKey || e.metaKey) &&
      ["a", "c", "v", "x"].includes(e.key.toLowerCase())
    ) {
      return;
    }

    if (!allowedKeys.includes(e.key)) {
      e.preventDefault();
    }

    // Prevent multiple decimal points (both dot and comma)
    if (
      (e.key === "." || e.key === ",") &&
      (e.currentTarget.value.includes(".") ||
        e.currentTarget.value.includes(","))
    ) {
      e.preventDefault();
    }
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
      onKeyDown={handleKeyDown}
      inputMode="decimal"
      {...props}
    />
  );
}

export { CoinInput };
