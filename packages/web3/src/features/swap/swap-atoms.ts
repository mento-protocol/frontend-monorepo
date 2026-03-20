import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { SwapFormValues, ToCeloRates } from "./types";

const initialFormValues: SwapFormValues | null = {
  slippage: "0.3",
  isAutoSlippage: true,
  deadlineMinutes: "5",
  isAutoDeadline: true,
};
const SWAP_FORM_VALUES_STORAGE_KEY = "swap-form-values-v1";

const initialToCeloRates: ToCeloRates = {};
const initialShowSlippage = false;
const initialConfirmView = false;

export const formValuesAtom = atomWithStorage<SwapFormValues | null>(
  SWAP_FORM_VALUES_STORAGE_KEY,
  initialFormValues,
);
export const toCeloRatesAtom = atom<ToCeloRates>(initialToCeloRates);
export const showSlippageAtom = atom<boolean>(initialShowSlippage);
export const confirmViewAtom = atom<boolean>(initialConfirmView);

// A write-only atom to reset all swap-related UI atoms
export const resetSwapUiAtomsAtom = atom(
  null, // read-only part, value doesn't matter for a write-only atom
  (_get, set) => {
    set(formValuesAtom, initialFormValues);
    set(toCeloRatesAtom, initialToCeloRates);
    set(showSlippageAtom, initialShowSlippage);
    set(confirmViewAtom, initialConfirmView);
  },
);
