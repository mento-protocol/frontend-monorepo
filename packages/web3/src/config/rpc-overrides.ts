import { IS_DEBUG, IS_PROD } from "../utils/environment";

type StorageLike = Pick<Storage, "getItem">;

/** localStorage RPC/fork overrides are honoured only outside production-public
 *  builds, or when the debug flag was baked in at build time. */
export function canUseStorageOverrides(
  isProduction: boolean,
  isDebugEnabled: boolean,
  hostname?: string,
): boolean {
  if (isDebugEnabled) return true;
  if (isProduction) return false;
  return !isPublicMentoHostname(hostname ?? readWindowHostname());
}

export function readStorageOverride(
  key: string,
  storage?: StorageLike,
  isProduction: boolean = IS_PROD,
  isDebugEnabled: boolean = IS_DEBUG,
  hostname?: string,
): string | null {
  if (!canUseStorageOverrides(isProduction, isDebugEnabled, hostname)) {
    return null;
  }

  const storageSource = storage ?? readWindowStorage();
  if (!storageSource) return null;

  try {
    return storageSource.getItem(key);
  } catch {
    return null;
  }
}

function isPublicMentoHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase();
  return normalized === "mento.org" || normalized.endsWith(".mento.org");
}

function readWindowHostname(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location?.hostname;
}

function readWindowStorage(): StorageLike | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
