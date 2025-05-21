"use client";

import { ChevronIcon } from "@/components/chevron";
import { Select } from "@/components/input/select";
import { type TokenId, getTokenById } from "@/lib/config/tokens";
import { TokenIcon } from "@/lib/images/tokens/token-icon";

import { CoinSelect } from "@repo/ui";

// RHF field props that will be passed by the Controller
interface RHFFieldProps {
  name: string; // RHF's name for the field
  value: string; // RHF's value for the field
  onChange: (value: string) => void; // RHF's onChange handler
  onBlur?: () => void; // RHF's onBlur handler, if needed
  // ref?: React.Ref<any>; // RHF's ref, if needed by underlying Select or for focus
}

type Props = RHFFieldProps & {
  label: string;
  onSelectionChange?: (optionValue: string) => void; // Renamed to avoid conflict with RHF's onChange
  tokenOptions: TokenId[];
};

const DEFAULT_VALUE = {
  label: "Select Token",
  value: "",
};

export function TokenSelectField({
  name, // from RHF
  value, // from RHF
  onChange: rhfOnChange, // from RHF, aliased
  // onBlur, // from RHF, if used
  label,
  onSelectionChange, // custom prop
  tokenOptions,
}: Props) {
  const handleChange = (optionValue: string) => {
    rhfOnChange(optionValue || ""); // Call RHF's onChange to update form state
    if (onSelectionChange) onSelectionChange(optionValue); // Call custom onChange if provided
  };

  return (
    <>
      <Select
        value={value} // Use RHF's value
        optionValues={tokenOptions}
        onChange={handleChange} // Use our wrapper that calls RHF's onChange
        button={TokenButton}
        option={Option}
        buttonLabel={label}
        // name={name} // The 'Select' component itself might not need 'name' if RHF Controller handles it
      />
      <CoinSelect />
    </>
  );
}

function TokenButton(tokenId: string, buttonLabel?: string) {
  const token = getTokenById(tokenId);
  return (
    <div className="flex min-w-[180px] items-center rounded-lg border border-solid border-black p-1 py-3 pl-3 pr-4 transition-all dark:border-[#636366] dark:bg-[#404043]">
      <TokenIcon size="l" token={token} />
      <div className="ml-3">
        <label className="cursor-pointer text-xs text-gray-400 dark:text-white">
          {buttonLabel || DEFAULT_VALUE.label}
        </label>
        <div className="flex items-center font-semibold">
          <div className="dark:text-white">
            {token?.symbol || DEFAULT_VALUE.value}
          </div>
          <div className="ml-1">
            <ChevronIcon direction="s" width={12} height={6} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Option(tokenId: string, selected?: boolean) {
  const token = getTokenById(tokenId);
  return (
    <div
      className={`flex cursor-pointer items-center px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-[#4E4E55] ${
        selected ? "bg-gray-50 dark:bg-[#36363B]" : ""
      }`}
    >
      <TokenIcon size="xs" token={token} />
      <div className="ml-2.5">{token?.symbol || "Unknown"}</div>
    </div>
  );
}
