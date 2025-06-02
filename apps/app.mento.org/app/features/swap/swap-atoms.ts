import { atom } from "jotai";
import type { SwapFormValues, ToCeloRates, TokenId } from "./types";

const initialFormValues: SwapFormValues | null = {
  amount: "1",
  direction: "in",
  fromTokenId: "CELO" as TokenId,
  quote: "0.367552450768393127",
  toTokenId: "cUSD" as TokenId,
  slippage: "0.5",
};

const initialToCeloRates: ToCeloRates = {};
const initialShowSlippage = false;
const initialConfirmView = false;

export const formValuesAtom = atom<SwapFormValues | null>(initialFormValues);
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
