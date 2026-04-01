import { useMemo } from "react";
import { useAtom } from "jotai";
import { useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { AppFeature, getVisibleChains } from "./chain-policy";

export const TESTNET_MODE_STORAGE_KEY = "mento:testnet-mode";
export const TESTNET_MODE_COOKIE = "mento_testnet_mode";

function parseStoredBoolean(value?: string | null): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function readCookieValue(
  cookieSource: string | null | undefined,
  key: string,
): string | null {
  if (!cookieSource) return null;

  const prefix = `${key}=`;
  const match = cookieSource
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return match ? match.slice(prefix.length) : null;
}

export function readTestnetModeCookie(cookieSource?: string | null): boolean {
  return (
    parseStoredBoolean(readCookieValue(cookieSource, TESTNET_MODE_COOKIE)) ??
    false
  );
}

function writeTestnetModeCookie(enabled: boolean) {
  if (typeof document === "undefined") return;

  document.cookie = `${TESTNET_MODE_COOKIE}=${enabled ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

const testnetModeStorage = {
  getItem: (_key: string, initialValue: boolean) => {
    if (typeof window === "undefined") return initialValue;

    const storedValue = parseStoredBoolean(
      window.localStorage.getItem(TESTNET_MODE_STORAGE_KEY),
    );
    if (storedValue !== null) {
      return storedValue;
    }

    const cookieValue = parseStoredBoolean(
      readCookieValue(document.cookie, TESTNET_MODE_COOKIE),
    );
    return cookieValue ?? initialValue;
  },
  setItem: (_key: string, value: boolean) => {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(TESTNET_MODE_STORAGE_KEY, String(value));
    writeTestnetModeCookie(value);
  },
  removeItem: () => {
    if (typeof window === "undefined") return;

    window.localStorage.removeItem(TESTNET_MODE_STORAGE_KEY);
    document.cookie = `${TESTNET_MODE_COOKIE}=0; Path=/; Max-Age=0; SameSite=Lax`;
  },
};

export const testnetModeAtom = atomWithStorage<boolean>(
  TESTNET_MODE_STORAGE_KEY,
  false,
  testnetModeStorage,
  { getOnInit: true },
);

export function useTestnetMode() {
  return useAtom(testnetModeAtom);
}

export function useVisibleChains(feature?: AppFeature) {
  const testnetMode = useAtomValue(testnetModeAtom);

  return useMemo(
    () => getVisibleChains({ testnetMode, feature }),
    [feature, testnetMode],
  );
}
