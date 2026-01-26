"use client";

import { formValuesAtom } from "@repo/web3";
import {
  cn,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui";
import { useAtom } from "jotai";
import { Info, Settings } from "lucide-react";

const DEFAULT_SLIPPAGE = "0.5";
const DEFAULT_DEADLINE = "20";

export function SwapSettingsPopover() {
  const [formValues, setFormValues] = useAtom(formValuesAtom);

  const slippage = formValues?.slippage || DEFAULT_SLIPPAGE;
  const isAutoSlippage = formValues?.isAutoSlippage ?? true;
  const deadlineMinutes = formValues?.deadlineMinutes || DEFAULT_DEADLINE;

  const updateFormValues = (updates: Partial<typeof formValues>) => {
    setFormValues({
      ...formValues,
      slippage: formValues?.slippage || DEFAULT_SLIPPAGE,
      ...updates,
    });
  };

  const handleAutoToggle = () => {
    if (isAutoSlippage) return;
    updateFormValues({
      isAutoSlippage: true,
      slippage: DEFAULT_SLIPPAGE,
    });
  };

  const handleSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (!/^[0-9]*\.?[0-9]*$/.test(value) || value === ".") {
      return;
    }

    if (value === "") {
      updateFormValues({
        slippage: "",
        isAutoSlippage: false,
      });
      return;
    }

    const numValue = Number.parseFloat(value);
    if (numValue >= 0 && numValue <= 49) {
      updateFormValues({
        slippage: value,
        isAutoSlippage: false,
      });
    }
  };

  const handleDeadlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (!/^[0-9]*$/.test(value)) {
      return;
    }

    if (value === "") {
      updateFormValues({
        deadlineMinutes: "",
      });
      return;
    }

    const numValue = Number.parseInt(value, 10);
    if (numValue >= 1 && numValue <= 180) {
      updateFormValues({
        deadlineMinutes: value,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const invalidChars = ["e", "E", "-", "+", ","];
    if (invalidChars.includes(e.key)) {
      e.preventDefault();
    }
  };

  const handleSlippageKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyDown(e);
    const currentValue = (e.target as HTMLInputElement).value;
    if (e.key === "." && currentValue.includes(".")) {
      e.preventDefault();
    }
    if (e.key === "." && currentValue === "") {
      e.preventDefault();
    }
  };

  const displaySlippage = isAutoSlippage ? DEFAULT_SLIPPAGE : slippage;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          data-testid="swapSettingsButton"
          className="p-2 rounded-full transition-colors hover:bg-muted"
          aria-label="Swap settings"
        >
          <Settings className="h-5 w-5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 space-y-4 pb-3 [&>span]:hidden"
      >
        {/* Max Slippage Row */}
        <div className="flex items-center justify-between">
          <div className="gap-1.5 flex items-center">
            <span className="text-sm text-foreground">Max slippage</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                The maximum price difference you&apos;re willing to accept when
                a swap is executed.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="gap-2 flex items-center">
            <button
              data-testid="autoSlippageToggle"
              onClick={handleAutoToggle}
              className={cn(
                "px-3 py-1 text-xs font-medium transition-colors",
                isAutoSlippage
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              Auto
            </button>
            <div className="relative">
              <Input
                data-testid="slippageInput"
                type="text"
                inputMode="decimal"
                value={displaySlippage}
                onChange={handleSlippageChange}
                onKeyDown={handleSlippageKeyDown}
                className="h-8 w-20 pr-6 text-sm text-right"
                placeholder="0.5"
              />
              <span className="right-2 text-sm pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground">
                %
              </span>
            </div>
          </div>
        </div>

        {/* Swap Deadline Row */}
        <div className="flex items-center justify-between">
          <div className="gap-1.5 flex items-center">
            <span className="text-sm text-foreground">Swap deadline</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                Your transaction will revert if it is pending for more than this
                period of time.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="relative">
            <Input
              data-testid="deadlineInput"
              type="text"
              inputMode="numeric"
              value={deadlineMinutes}
              onChange={handleDeadlineChange}
              onKeyDown={handleKeyDown}
              className="h-8 w-28 pr-16 text-sm text-right"
              placeholder="20"
            />
            <span className="right-2 text-sm pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground">
              minutes
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
