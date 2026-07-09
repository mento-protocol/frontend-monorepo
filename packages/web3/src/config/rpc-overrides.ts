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
  storage?: StorageLike,
  isProduction: boolean = IS_PROD,
  isDebugEnabled: boolean = IS_DEBUG,
): string | null {
  if (!canUseStorageOverrides(isProduction, isDebugEnabled)) return null;

  const storageSource = storage ?? readWindowStorage();
  if (!storageSource) return null;

  try {
    return storageSource.getItem(key);
  } catch {
    return null;
  }
}

function readWindowStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
