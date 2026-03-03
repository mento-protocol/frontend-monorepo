import { atom } from "jotai";
import type { BorrowView } from "@repo/web3";

export const borrowViewAtom = atom<BorrowView>("dashboard");
