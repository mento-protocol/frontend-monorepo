import { IS_DEBUG, IS_PROD } from "../utils/environment";

export type StorageLike = Pick<Storage, "getItem">;

/** localStorage RPC/fork overrides are honoured only outside production
 *  builds, or when the debug flag was baked in at build time. */
export function canUseStorageOverrides(
  isProduction: boolean,
  isDebugEnabled: boolean,
): boolean {
  return isDebugEnabled || !isProduction;
}

export function readStorageOverride(
  key: string,
  storage: StorageLike | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
  isProduction: boolean = IS_PROD,
  isDebugEnabled: boolean = IS_DEBUG,
): string | null {
  if (!storage) return null;
  if (!canUseStorageOverrides(isProduction, isDebugEnabled)) return null;
  return storage.getItem(key);
}
