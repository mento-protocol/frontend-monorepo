"use client";
import { formValuesAtom } from "@/features/swap/swap-atoms";
import { Button, cn, Input } from "@repo/ui";
import { useAtom } from "jotai";

const slippageOptions = [
  { value: "0.5", label: "0.5%" },
  { value: "1", label: "1%" },
  { value: "1.5", label: "1.5%" },
];

export default function SlippageForm({ onSubmit }: { onSubmit: () => void }) {
  const [formValues, setFormValues] = useAtom(formValuesAtom);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  const handleSlippageSelect = (value: string) => {
    setFormValues({
      ...(formValues ?? {}),
      slippage: value,
    });
  };

  const handleCustomSlippageChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    if (!formValues) return;

    if (
      value === "" ||
      (Number.parseFloat(value) <= 5 && Number.parseFloat(value) >= 0)
    ) {
      setFormValues({
        ...formValues,
        slippage: value,
      });
    }
  };

  const currentSlippage = formValues?.slippage;
  const isPresetSelected = slippageOptions.some(
    (option) => option.value === currentSlippage,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-10">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-9 flex flex-row items-center justify-between gap-4">
          {slippageOptions.map((option) => (
            <Button
              key={option.value}
              variant="outline"
              className={cn(
                currentSlippage === option.value &&
                  isPresetSelected &&
                  "!border-[var(--primary)]",
              )}
              onClick={() => handleSlippageSelect(option.value)}
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
            value={isPresetSelected ? "" : currentSlippage || ""}
            onChange={handleCustomSlippageChange}
            type="number"
            min={0}
            max={5}
          />
        </div>
      </div>
      <Button clipped="lg" size="lg" className="w-full" onClick={onSubmit}>
        Confirm
      </Button>
    </div>
  );
}
