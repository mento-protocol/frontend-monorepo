import { atomWithStorage } from "jotai/utils";

export type AppTab = "pool" | "borrow" | "earn" | "bridge";

export const activeTabAtom = atomWithStorage<AppTab>("active-tab", "pool");
