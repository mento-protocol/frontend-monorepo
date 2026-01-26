import { atom } from "jotai";

export type AppTab = "swap" | "pool" | "borrow";

export const activeTabAtom = atom<AppTab>("swap");
