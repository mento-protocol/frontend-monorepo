"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PropsBase } from "react-day-picker";

interface DatepickerProps extends PropsBase {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  label: string;
  formatter: (date: Date) => string;
  dataTestId?: string;
}

export function Datepicker({
  value,
  onChange,
  label,
  formatter,
  disabled,
  startMonth,
  endMonth,
  dataTestId,
}: DatepickerProps) {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState<Date | undefined>(value);
  const [displayMonth, setDisplayMonth] = React.useState<Date | undefined>(
    value,
  );

  React.useEffect(() => {
    setDate(value);
  }, [value]);

  React.useEffect(() => {
    if (open && date) {
      setDisplayMonth(date);
    }
  }, [open, date]);

  return (
    <div className="flex flex-row items-center gap-3 md:flex-col md:items-end">
      <Label htmlFor="date" className="text-muted-foreground shrink-0 px-1">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            id="date"
            className="w-fit justify-between font-normal md:w-48"
            data-testid={dataTestId}
          >
            {date ? formatter(date) : "Select date"}
            <ChevronDownIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto overflow-hidden p-0"
          align="start"
          side="bottom"
          avoidCollisions={false}
          sticky="always"
        >
          <Calendar
            mode="single"
            selected={date}
            captionLayout="dropdown"
            onSelect={(date) => {
              setDate(date);
              onChange(date);
              setOpen(false);
            }}
            disabled={disabled}
            startMonth={startMonth}
            endMonth={endMonth}
            month={displayMonth}
            onMonthChange={setDisplayMonth}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
