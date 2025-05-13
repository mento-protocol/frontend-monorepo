"use client";

import { escapeRegExp, inputRegex } from "@/lib/utils/string";
import type React from "react"; // For types like ChangeEvent

interface Props {
  value: string | number;
  onChange: (value: string) => void;
  onFocus?: () => void;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  showSpinner?: boolean;
}

export function AmountField({
  value,
  onChange,
  onFocus,
  name,
  placeholder = "0.00",
  disabled,
  error,
  showSpinner,
}: Props) {
  const internalOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const processedValue = `${rawValue}`.replace(/,/g, ".");

    if (
      processedValue === "" ||
      inputRegex.test(escapeRegExp(processedValue))
    ) {
      onChange(processedValue);
    }
  };

  if (showSpinner) {
    return (
      <div className="flex h-8 min-w-[theme(space.36)] items-center justify-center pt-1">
        <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-gray-900 dark:border-gray-100" />
      </div>
    );
  }

  return (
    <>
      <input
        autoComplete="off"
        name={name}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={placeholder}
        className={`font-fg w-36 truncate bg-transparent pt-1 text-right text-[20px] font-medium focus:outline-none dark:text-white ${disabled ? "opacity-70" : ""} ${error ? "border-red-500" : ""}`}
        onChange={internalOnChange}
        onFocus={onFocus}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        aria-invalid={error ? "true" : "false"} // Use string "true" or "false"
        aria-describedby={error && name ? `${name}-error-message` : undefined}
      />
      {error && name && (
        <p
          id={`${name}-error-message`}
          className="w-36 text-right text-xs text-red-500"
        >
          {error}
        </p>
      )}
    </>
  );
}
