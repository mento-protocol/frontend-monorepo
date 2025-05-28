"use client";
import { useState } from "react";
import { Button, cn } from "@repo/ui";
import { Input } from "@repo/ui";
import { useAtom } from "jotai";
import { slippageAtom } from "@/features/swap/swap-atoms";

const slippageOptions = [
  { value: "0.25", label: "0.25%" },
  { value: "0.5", label: "0.5%" },
  { value: "1", label: "1%" },
];

export default function SlippageForm({ onSubmit }: { onSubmit: () => void }) {
  const [slippage, setSlippage] = useAtom(slippageAtom);
  const [customSlippage, setCustomSlippage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalSlippage = customSlippage || slippage;
    setSlippage(finalSlippage);
    onSubmit();
  };

  const handleCustomSlippageChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    if (
      value === "" ||
      Number.parseFloat(value) <= 2 ||
      Number.parseFloat(value) >= 0
    ) {
      setCustomSlippage(value);
    }
  };

  const handlePresetSlippage = (value: string) => {
    setSlippage(value);
    setCustomSlippage("");
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-8 py-10">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-9 flex flex-row items-center justify-between gap-4">
          {slippageOptions.map((option) => (
            <Button
              key={option.value}
              variant="outline"
              className={cn(
                slippage === option.value &&
                  customSlippage === "" &&
                  "!border-[var(--primary)]",
              )}
              onClick={() => handlePresetSlippage(option.value)}
              type="button"
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="col-span-3">
          <Input
            placeholder="Custom"
            className="h-8"
            value={customSlippage}
            onChange={handleCustomSlippageChange}
            type="number"
            min={0}
            max={2}
          />
        </div>
      </div>
      <Button clipped="lg" size="lg" className="w-full" type="submit">
        Confirm
      </Button>
    </form>
  );
}
