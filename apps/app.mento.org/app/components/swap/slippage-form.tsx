"use client";
import { formValuesAtom } from "@/features/swap/swap-atoms";
import { Button, cn, Input } from "@repo/ui";
import { useAtom } from "jotai";
import { useState, useEffect } from "react";

const slippageOptions = [
  { value: "0.5", label: "0.5%" },
  { value: "1", label: "1%" },
  { value: "1.5", label: "1.5%" },
];

export default function SlippageForm({ onSubmit }: { onSubmit: () => void }) {
  const [formValues, setFormValues] = useAtom(formValuesAtom);
  const [localSlippage, setLocalSlippage] = useState<string>("0.5");

  useEffect(() => {
    setLocalSlippage(formValues?.slippage || "0.5");
  }, [formValues?.slippage]);

  const handleSlippageSelect = (value: string) => {
    setLocalSlippage(value);
  };

  const handleCustomSlippageChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;

    // Allow only digits and decimal point pattern
    if (!/^[0-9]*\.?[0-9]*$/.test(value)) {
      return;
    }

    // Prevent just a decimal point at the start
    if (value === ".") {
      return;
    }

    // Allow empty input for clearing
    if (value === "") {
      setLocalSlippage("");
      return;
    }

    // Validate numeric range
    const numValue = Number.parseFloat(value);
    if (numValue <= 49 && numValue >= 0) {
      setLocalSlippage(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent invalid characters from being typed
    const invalidChars = ["e", "E", "-", "+", ","];
    if (invalidChars.includes(e.key)) {
      e.preventDefault();
      return;
    }

    // Allow only one decimal point
    if (e.key === "." && localSlippage.includes(".")) {
      e.preventDefault();
      return;
    }

    // Prevent decimal point at the start
    if (e.key === "." && localSlippage === "") {
      e.preventDefault();
      return;
    }
  };

  const handleConfirm = () => {
    setFormValues({
      ...(formValues ?? {}),
      slippage: localSlippage,
    });
    onSubmit();
  };

  const isPresetSelected = slippageOptions.some(
    (option) => option.value === localSlippage,
  );

  const isValidSlippage = () => {
    if (!localSlippage || localSlippage === "") {
      return false;
    }
    const numValue = Number.parseFloat(localSlippage);
    return !Number.isNaN(numValue) && numValue >= 0 && numValue <= 49;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pt-6">
      <div className="flex flex-1 flex-row flex-wrap items-center gap-4">
        {slippageOptions.map((option) => (
          <Button
            key={option.value}
            variant="outline"
            className={cn(
              "border-input h-10 min-w-28",
              localSlippage === option.value && isPresetSelected
                ? "border-primary"
                : "!bg-transparent",
            )}
            onClick={() => handleSlippageSelect(option.value)}
            type="button"
          >
            {option.label}
          </Button>
        ))}
        <div className="flex-shrink-0">
          <Input
            placeholder="Custom"
            className="hover:!border-primary h-10 min-w-28 transition-colors"
            value={isPresetSelected ? "" : localSlippage || ""}
            onChange={handleCustomSlippageChange}
            onKeyDown={handleKeyDown}
            type="number"
            min={0}
            max={49}
          />
        </div>
      </div>
      <Button
        clipped="lg"
        size="lg"
        className="w-full"
        onClick={handleConfirm}
        disabled={!isValidSlippage()}
      >
        Confirm
      </Button>
    </div>
  );
}
