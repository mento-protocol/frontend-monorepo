"use client";

import type { ChangeEvent, FocusEvent } from "react";

interface Props {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}

export function RadioInput({
  name,
  value,
  label,
  checked,
  onChange,
  onBlur,
}: Props) {
  return (
    <label className="checkmarkContainer">
      <div className="text-sm tracking-tight">{label}</div>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        onBlur={onBlur}
      />
      <span className="checkmark" />
    </label>
  );
}
