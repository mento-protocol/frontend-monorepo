"use client";

import { RadioInput } from "@/components/input/radio-input";
import type {
  ControllerRenderProps,
  FieldPath,
  FieldValues,
} from "react-hook-form";

// Define props based on what Controller's render prop provides for 'field'
interface SlippageRowProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> extends ControllerRenderProps<TFieldValues, TName> {
  // Add any other specific props SlippageRow might need, if any
}

export function SlippageRow<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: SlippageRowProps<TFieldValues, TName>) {
  const { name, value: currentValue, onChange, onBlur, ref } = props;

  return (
    <fieldset
      className="relative my-6 flex items-center justify-between space-x-7 px-[5px] text-sm font-medium dark:text-white"
      // onBlur={onBlur} // RHF's onBlur can be tricky with radio groups, handle if necessary
      // ref={ref} // Usually not needed for a wrapper around radios unless for focus management
    >
      <legend className="sr-only">Max Slippage</legend>
      <div>Max Slippage:</div>
      <RadioInput
        name={name}
        value="0.5"
        label="0.5%"
        checked={currentValue === "0.5"}
        onChange={onChange}
        onBlur={onBlur} // Pass onBlur to individual radios if needed by RHF
        // ref could be passed if RadioInput supports it and RHF requires it for radios
      />
      <RadioInput
        name={name}
        value="1.0"
        label="1.0%"
        checked={currentValue === "1.0"}
        onChange={onChange}
        onBlur={onBlur}
      />
      <RadioInput
        name={name}
        value="1.5"
        label="1.5%"
        checked={currentValue === "1.5"}
        onChange={onChange}
        onBlur={onBlur}
      />
    </fieldset>
  );
}
