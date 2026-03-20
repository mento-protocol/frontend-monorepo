import { atom } from "jotai";

// ---------------------------------------------------------------------------
// Open-trove form state — string values for controlled inputs,
// converted to bigint on submit
// ---------------------------------------------------------------------------

export interface OpenTroveFormState {
  collAmount: string;
  debtAmount: string;
  interestRate: string;
}

export const openTroveFormAtom = atom<OpenTroveFormState>({
  collAmount: "",
  debtAmount: "",
  interestRate: "",
});
