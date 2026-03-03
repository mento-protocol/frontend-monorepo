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

const DEFAULT_SLIPPAGE = "0.3";
const DEFAULT_DEADLINE = "5";

const MIN_SLIPPAGE = 0.1;
const MAX_SLIPPAGE = 20.0;
const MIN_DEADLINE = 1;
const MAX_DEADLINE = 180;

export function SwapSettingsPopover() {
  const [formValues, setFormValues] = useAtom(formValuesAtom);

  const slippage = formValues?.slippage ?? DEFAULT_SLIPPAGE;
  const isAutoSlippage = formValues?.isAutoSlippage ?? true;
  const deadline = formValues?.deadlineMinutes ?? DEFAULT_DEADLINE;
  const isAutoDeadline = formValues?.isAutoDeadline ?? true;

  const update = (updates: Partial<NonNullable<typeof formValues>>) => {
    setFormValues((prev) => ({
      ...prev,
      slippage: prev?.slippage ?? DEFAULT_SLIPPAGE,
      ...updates,
    }));
  };

  // -- Slippage handlers --

  const handleAutoSlippageToggle = () => {
    if (isAutoSlippage) return;
    update({ isAutoSlippage: true, slippage: DEFAULT_SLIPPAGE });
  };

  const handleSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (!/^[0-9]*\.?[0-9]*$/.test(value) || value === ".") {
      return;
    }

    if (value === "") {
      update({ slippage: "", isAutoSlippage: false });
      return;
    }

    const numValue = Number.parseFloat(value);
    if (numValue >= 0 && numValue <= MAX_SLIPPAGE) {
      update({ slippage: value, isAutoSlippage: value === DEFAULT_SLIPPAGE });
    }
  };

  const handleSlippageBlur = () => {
    if (isAutoSlippage) return;

    let value = slippage;
    if (value.endsWith(".")) {
      value = value.slice(0, -1);
    }
    if (value === "" || Number.parseFloat(value) < MIN_SLIPPAGE) {
      update({ isAutoSlippage: true, slippage: DEFAULT_SLIPPAGE });
      return;
    }
    if (value !== slippage) {
      update({ slippage: value });
    }
  };

  const handleSlippageKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const invalidChars = ["e", "E", "-", "+", ","];
    if (invalidChars.includes(e.key)) {
      e.preventDefault();
    }
    const currentValue = (e.target as HTMLInputElement).value;
    if (e.key === "." && (currentValue.includes(".") || currentValue === "")) {
      e.preventDefault();
    }
  };

  // -- Deadline handlers --

  const handleAutoDeadlineToggle = () => {
    if (isAutoDeadline) return;
    update({ isAutoDeadline: true, deadlineMinutes: DEFAULT_DEADLINE });
  };

  const handleDeadlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (!/^[0-9]*$/.test(value)) {
      return;
    }

    if (value === "") {
      update({ deadlineMinutes: "", isAutoDeadline: false });
      return;
    }

    const numValue = Number.parseInt(value, 10);
    if (numValue >= MIN_DEADLINE && numValue <= MAX_DEADLINE) {
      update({
        deadlineMinutes: value,
        isAutoDeadline: value === DEFAULT_DEADLINE,
      });
    }
  };

  const handleDeadlineBlur = () => {
    if (isAutoDeadline) return;

    if (deadline === "" || Number.parseInt(deadline, 10) < MIN_DEADLINE) {
      update({ isAutoDeadline: true, deadlineMinutes: DEFAULT_DEADLINE });
    }
  };

  const handleDeadlineKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const invalidChars = ["e", "E", "-", "+", ",", "."];
    if (invalidChars.includes(e.key)) {
      e.preventDefault();
    }
  };

  const displaySlippage = isAutoSlippage ? DEFAULT_SLIPPAGE : slippage;
  const displayDeadline = isAutoDeadline ? DEFAULT_DEADLINE : deadline;

  const autoButtonClass = (active: boolean) =>
    cn(
      "px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/80",
    );

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
        className="gap-3 p-3! flex w-auto flex-col [&>span]:hidden"
      >
        <div className="gap-5 flex items-center">
          <div className="gap-1.5 flex items-center">
            <span className="text-sm text-foreground">Slippage</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                Max price change you accept for a swap. {MIN_SLIPPAGE}% –{" "}
                {MAX_SLIPPAGE}%.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="gap-1.5 ml-auto flex items-center">
            <button
              data-testid="autoSlippageToggle"
              onClick={handleAutoSlippageToggle}
              className={autoButtonClass(isAutoSlippage)}
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
                onBlur={handleSlippageBlur}
                maxLength={5}
                className="h-7 w-16 pr-5 text-xs text-right text-foreground"
                placeholder="0.3"
              />
              <span className="right-1.5 text-xs pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground">
                %
              </span>
            </div>
          </div>
        </div>

        <div className="gap-5 flex items-center">
          <div className="gap-1.5 flex items-center">
            <span className="text-sm text-foreground">Deadline</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                Time before a pending swap reverts. {MIN_DEADLINE} –{" "}
                {MAX_DEADLINE} minutes.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="gap-1.5 ml-auto flex items-center">
            <button
              data-testid="autoDeadlineToggle"
              onClick={handleAutoDeadlineToggle}
              className={autoButtonClass(isAutoDeadline)}
            >
              Auto
            </button>
            <div className="relative">
              <Input
                data-testid="deadlineInput"
                type="text"
                inputMode="numeric"
                value={displayDeadline}
                onChange={handleDeadlineChange}
                onKeyDown={handleDeadlineKeyDown}
                onBlur={handleDeadlineBlur}
                className="h-7 w-16 pr-5 text-xs text-right text-foreground"
                placeholder="5"
              />
              <span className="right-1.5 text-xs pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground">
                m
              </span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
