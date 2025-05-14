import { atom } from "jotai";
import type { BlockStub } from "@/features/blocks/types";

/**
 * Atom to store the latest blockchain block information.
 * It can be a BlockStub object, null (if fetching failed), or undefined (initial state).
 */
export const latestBlockAtom = atom<BlockStub | null | undefined>(undefined);

/**
 * Write-only atom to reset the latestBlockAtom to its initial undefined state.
 */
export const resetLatestBlockAtom = atom(null, (_get, set) => {
  set(latestBlockAtom, undefined);
});
