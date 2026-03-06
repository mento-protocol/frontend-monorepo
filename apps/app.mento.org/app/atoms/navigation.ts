import { atomWithStorage } from "jotai/utils";

export type AppTab = "swap" | "pool" | "borrow" | "earn";

export const activeTabAtom = atomWithStorage<AppTab>("active-tab", "swap");
