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

    if (
      value === "" ||
      (Number.parseFloat(value) <= 5 && Number.parseFloat(value) >= 0)
    ) {
      setLocalSlippage(value);
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

  return (
    <div className="mx-auto max-w-4xl space-y-8 pt-10">
      <div className="flex flex-1 flex-row flex-wrap items-center gap-4">
        {slippageOptions.map((option) => (
          <Button
            key={option.value}
            variant="outline"
            className={cn(
              localSlippage === option.value &&
                isPresetSelected &&
                "!border-[var(--primary)]",
              "min-w-28",
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
            className="h-8 min-w-28"
            value={isPresetSelected ? "" : localSlippage || ""}
            onChange={handleCustomSlippageChange}
            type="number"
            min={0}
            max={5}
          />
        </div>
      </div>
      <Button clipped="lg" size="lg" className="w-full" onClick={handleConfirm}>
        Confirm
      </Button>
    </div>
  );
}
