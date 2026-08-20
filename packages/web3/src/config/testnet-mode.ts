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

function readTestnetModeDocumentCookie(): string | null {
  if (typeof document === "undefined") return null;

  try {
    return document.cookie;
  } catch {
    return null;
  }
}

function writeTestnetModeCookie(enabled: boolean) {
  if (typeof document === "undefined") return;

  try {
    document.cookie = `${TESTNET_MODE_COOKIE}=${enabled ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // Sandboxed browsers can reject cookie access independently of storage.
  }
}

function readTestnetModeStorageValue(): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage?.getItem(TESTNET_MODE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function readTestnetModeStorage(
  initialValue = false,
  cookieSource: string | null = readTestnetModeDocumentCookie(),
): boolean {
  const cookieValue = parseStoredBoolean(
    readCookieValue(cookieSource, TESTNET_MODE_COOKIE),
  );
  if (cookieValue !== null) return cookieValue;

  return parseStoredBoolean(readTestnetModeStorageValue()) ?? initialValue;
}

const testnetModeStorage = {
  getItem: (_key: string, initialValue: boolean) => {
    if (typeof window === "undefined") return initialValue;

    return readTestnetModeStorage(initialValue);
  },
  setItem: (_key: string, value: boolean) => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage?.setItem(TESTNET_MODE_STORAGE_KEY, String(value));
    } catch {
      // Some embedded browsers expose localStorage but reject access to it.
    }
    writeTestnetModeCookie(value);
  },
  removeItem: () => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage?.removeItem(TESTNET_MODE_STORAGE_KEY);
    } catch {
      // Some embedded browsers expose localStorage but reject access to it.
    }
    writeTestnetModeCookie(false);
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
