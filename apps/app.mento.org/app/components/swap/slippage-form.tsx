"use client";
import { formValuesAtom } from "@repo/web3";
import { Button, cn, Input } from "@repo/ui";
import { useAtom } from "jotai";
import { useState } from "react";

const defaultSlippage = "0.5";
const slippageOptions = [
  { value: "0.5", label: "0.5%" },
  { value: "1", label: "1%" },
  { value: "1.5", label: "1.5%" },
];

export default function SlippageForm({ onSubmit }: { onSubmit: () => void }) {
  const [formValues, setFormValues] = useAtom(formValuesAtom);

  const initialSlippage = formValues?.slippage || defaultSlippage;
  const isCustomInitial = !slippageOptions.some(
    (option) => option.value === initialSlippage,
  );

  const [slippage, setSlippage] = useState<string>(initialSlippage);
  const [customSlippage, setCustomSlippage] = useState<string>(
    isCustomInitial ? initialSlippage : "",
  );

  const handleSlippageSelect = (value: string) => {
    setSlippage(value);
    setCustomSlippage("");
  };

  const handleCustomSlippageChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;

    if (!/^[0-9]*\.?[0-9]*$/.test(value) || value === ".") {
      return;
    }

    setCustomSlippage(value);

    if (value === "") {
      setSlippage("");
      return;
    }

    const numValue = Number.parseFloat(value);
    if (numValue >= 0 && numValue <= 49) {
      setSlippage(value);
    } else {
      setSlippage("");
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
    if (e.key === "." && customSlippage.includes(".")) {
      e.preventDefault();
      return;
    }

    // Prevent decimal point at the start
    if (e.key === "." && customSlippage === "") {
      e.preventDefault();
      return;
    }
  };

  const handleConfirm = () => {
    setFormValues({
      ...(formValues ?? {}),
      slippage: slippage,
    });
    onSubmit();
  };

  const isPresetSelected = customSlippage === "";

  const isValidSlippage = () => {
    if (!slippage) {
      return false;
    }
    const numValue = Number.parseFloat(slippage);
    return !Number.isNaN(numValue) && numValue >= 0;
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pt-6">
      <div className="flex flex-1 flex-row flex-wrap items-center gap-4">
        {slippageOptions.map((option) => (
          <Button
            data-testid={`slippageOption_${option.value}`}
            key={option.value}
            variant="outline"
            className={cn(
              slippage === option.value &&
                isPresetSelected &&
                "!border-1 !border-[var(--primary)]",
              "hover:border-1 min-w-28 hover:!border-[var(--primary-hover)]",
            )}
            onClick={() => handleSlippageSelect(option.value)}
            type="button"
          >
            {option.label}
          </Button>
        ))}
        <div className="flex-shrink-0">
          <Input
            data-testid="customSlippageInput"
            placeholder="Custom"
            className="hover:!border-primary h-10 min-w-28 transition-colors"
            value={customSlippage}
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
