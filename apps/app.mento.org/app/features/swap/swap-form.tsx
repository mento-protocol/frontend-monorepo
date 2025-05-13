"use client";
import { TokenId } from "@/lib/config/tokens";
import { FloatingBox } from "@/components/layout/floating-box";
import { debounce } from "@/lib/utils/debounce";
import { useAccount, useChainId } from "wagmi";
import {
  useAccountBalances,
  type AccountBalances,
} from "@/features/accounts/use-account-balances";

import { SettingsMenu } from "./components/settings-menu";
import { SlippageRow } from "./components/slippage-row";
import { SubmitButton } from "./components/submit-button";
import { SwapFormInputs } from "./components/swap-form-inputs";
import { useFormValidator } from "./hooks/use-form-validator";
import { useAtomValue, useSetAtom } from "jotai/react";
import {
  formValuesAtom,
  showSlippageAtom,
  confirmViewAtom,
} from "./swap-atoms";
import type { SwapFormValues } from "./types";
import {
  Controller,
  useForm,
  type SubmitHandler,
  type FieldErrors as RHFFieldErrors,
} from "react-hook-form";

const initialValues: SwapFormValues = {
  fromTokenId: TokenId.CELO,
  toTokenId: TokenId.cUSD,
  amount: "",
  quote: "",
  direction: "in",
  slippage: "1.0",
};

// Define a default empty balances structure
const defaultEmptyBalances: AccountBalances = Object.values(TokenId).reduce(
  (acc, tid) => {
    acc[tid as TokenId] = "0";
    return acc;
  },
  {} as AccountBalances,
);

// Define a type for React Hook Form compatible errors
type SwapFormFieldErrors = RHFFieldErrors<SwapFormValues>;

export function SwapFormCard() {
  return (
    <FloatingBox
      width="max-w-md w-full"
      padding="p-0"
      classes="overflow-visible border border-primary-dark dark:border-[#333336] dark:bg-[#1D1D20]"
    >
      <div className="border-primary-dark flex justify-between border-b p-6 dark:border-[#333336]">
        <h2 className="font-fg text-primary-dark text-[32px] font-medium leading-10 dark:text-white">
          Swap
        </h2>
        <SettingsMenu />
      </div>
      <div className="p-6">
        <SwapForm />
      </div>
    </FloatingBox>
  );
}

function SwapForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const {
    data: balancesFromHook,
    isLoading: isBalancesLoading,
    isError: isBalancesError,
  } = useAccountBalances({ address, chainId });

  const balances = balancesFromHook || defaultEmptyBalances;

  const showSlippage = useAtomValue(showSlippageAtom);

  const isWalletConnected = address && isConnected;
  const isBalanceLoaded =
    !isBalancesLoading && !isBalancesError && !!balancesFromHook;

  const setFormValues = useSetAtom(formValuesAtom);
  const setConfirmView = useSetAtom(confirmViewAtom);
  const storedFormValues = useAtomValue(formValuesAtom);
  const initialFormValues = storedFormValues || initialValues;

  // Validator hook from your existing logic
  const validateFormWithDependencies = useFormValidator({
    balances: balances,
    isBalanceLoaded,
    isWalletConnected,
  });

  // Debounce the validation function
  const debouncedValidateForm = debounce(
    async (values: SwapFormValues) => validateFormWithDependencies(values),
    100,
  );

  // Resolver for React Hook Form - now simplified
  const resolver = async (
    data: SwapFormValues,
  ): Promise<{ values: SwapFormValues; errors: SwapFormFieldErrors }> => {
    // validateFormWithDependencies (useFormValidator) already returns the RHF-compatible structure
    return debouncedValidateForm(data);
  };

  const {
    control,
    handleSubmit,
    formState,
    watch,
    setValue,
    // Add other methods from useForm if needed by child components: watch, setValue, getValues, etc.
  } = useForm<SwapFormValues>({
    defaultValues: initialFormValues,
    resolver,
    mode: "onChange", // Corresponds to Formik's validateOnChange=true, validateOnBlur=false
  });

  const watchedValues = watch();

  const onSubmit: SubmitHandler<SwapFormValues> = (values) => {
    setFormValues(values);
    setConfirmView(true);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <SwapFormInputs
        balances={balances}
        control={control} // Pass control for Controller component
        errors={formState.errors} // Pass errors for display
        setValue={setValue} // Pass setValue
      />
      {showSlippage ? (
        <Controller
          name="slippage" // Assuming 'slippage' is part of SwapFormValues and SlippageRow is a controlled input
          control={control}
          render={({ field }) => (
            <SlippageRow {...field} /> // This needs SlippageRow to be adapted
          )}
        />
      ) : null}
      <div className="my-6 mb-0 flex w-full justify-center">
        <SubmitButton
          isWalletConnected={isWalletConnected}
          isBalanceLoaded={isBalanceLoaded}
          isSubmitting={formState.isSubmitting} // Pass form state
          isValid={formState.isValid}
          errors={formState.errors} // Pass errors
          values={watchedValues} // Pass watched values
        />
      </div>
    </form>
  );
}
