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
}

export function Datepicker({
  value,
  onChange,
  label,
  formatter,
  disabled,
  startMonth,
  endMonth,
}: DatepickerProps) {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState<Date | undefined>(value);

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
          >
            {date ? formatter(date) : "Select date"}
            <ChevronDownIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
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
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
