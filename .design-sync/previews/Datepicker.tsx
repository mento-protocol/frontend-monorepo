import { Datepicker } from "@mento-protocol/ui";

// Stable reference — inlining `new Date(...)` would make a fresh object every
// render and re-trigger Datepicker's value-sync effect.
const DATEPICKER_DEFAULT_DATE = new Date(2026, 0, 15);

export const DatepickerDefault = () => (
  <Datepicker
    value={DATEPICKER_DEFAULT_DATE}
    onChange={() => {}}
    formatter={(d) => d.toLocaleDateString("en-US")}
  />
);

export const DatepickerLongFormat = () => (
  <Datepicker
    value={DATEPICKER_DEFAULT_DATE}
    onChange={() => {}}
    formatter={(d) =>
      d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    }
  />
);
