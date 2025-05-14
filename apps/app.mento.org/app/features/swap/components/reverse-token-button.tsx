"use client";

import type { SVGProps } from "react";
import type { UseFormSetValue } from "react-hook-form";
import type { SwapFormValues, TokenId } from "../types";

interface Props {
  setValue: UseFormSetValue<SwapFormValues>;
  currentValues: SwapFormValues;
}

export function ReverseTokenButton({ setValue, currentValues }: Props) {
  const onReverseTokens = () => {
    const { fromTokenId, toTokenId, amount, quote, direction } = currentValues;

    setValue("fromTokenId", toTokenId, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue("toTokenId", fromTokenId, {
      shouldValidate: true,
      shouldDirty: true,
    });

    if (direction === "in") {
      setValue("amount", amount, { shouldValidate: true, shouldDirty: true });
      // The 'quote' field will be updated by the useEffect in SwapFormInputs based on new tokens and 'amount'
    } else {
      // direction === 'out'
      setValue("amount", amount, { shouldValidate: true, shouldDirty: true });
      // 'quote' will re-calculate
    }
  };

  return (
    <button
      title="Reverse tokens"
      type="button"
      onClick={onReverseTokens}
      className="border-primary-dark text-primary-dark flex h-[36px] w-[36px] items-center justify-center rounded-full border dark:border-none dark:bg-[#545457] dark:text-white"
    >
      <DownArrow />
    </button>
  );
}

const DownArrow = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={14}
    height={15}
    fill="none"
    {...props}
  >
    <title>Down arrow indicating token reversal</title>
    <path
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth={1.33}
      d="M7 .75v12.5m0 0 5.625-5.625M7 13.25 1.375 7.625"
    />
  </svg>
);
