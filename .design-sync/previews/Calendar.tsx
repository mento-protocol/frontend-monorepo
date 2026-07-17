import { Calendar } from "@mento-protocol/ui";

// Module-level stable dates — an inline `new Date(...)` would create a fresh
// object every render.
const CALENDAR_SELECTED_DATE = new Date(2026, 0, 15);
const CALENDAR_RANGE_FROM = new Date(2026, 0, 10);
const CALENDAR_RANGE_TO = new Date(2026, 0, 20);

export const CalendarSingle = () => (
  <Calendar
    mode="single"
    selected={CALENDAR_SELECTED_DATE}
    defaultMonth={CALENDAR_SELECTED_DATE}
    onSelect={() => {}}
    className="rounded-md border"
  />
);

export const CalendarRange = () => (
  <Calendar
    mode="range"
    selected={{ from: CALENDAR_RANGE_FROM, to: CALENDAR_RANGE_TO }}
    defaultMonth={CALENDAR_RANGE_FROM}
    onSelect={() => {}}
    className="rounded-md border"
  />
);
