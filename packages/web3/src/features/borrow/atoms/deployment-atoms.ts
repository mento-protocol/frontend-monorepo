import { atom } from "jotai";
import { DEBT_TOKEN_CONFIGS, type DebtTokenConfig } from "../types";

// GBPm is always present in the config registry
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
export const selectedDebtTokenAtom = atom<DebtTokenConfig>(
  DEBT_TOKEN_CONFIGS.GBPm!,
);
