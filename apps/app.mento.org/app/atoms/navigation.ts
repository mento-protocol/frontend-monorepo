import { atomWithStorage } from "jotai/utils";

export type AppTab = "swap" | "pool" | "borrow";

export const activeTabAtom = atomWithStorage<AppTab>("active-tab", "swap");
