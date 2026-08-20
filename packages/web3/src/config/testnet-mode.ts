import { useMemo } from "react";
import { useAtom } from "jotai";
import { useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { AppFeature, getVisibleChains } from "./chain-policy";

export const TESTNET_MODE_STORAGE_KEY = "mento:testnet-mode";
export const TESTNET_MODE_COOKIE = "mento_testnet_mode";

const versionedValuePattern = /^v1:(\d+):(1|true|0|false)$/;
const versionBase = 1n << 64n;

type StoredTestnetMode = {
  value: boolean;
  version: bigint;
};

let latestTestnetModeVersion = 0n;

function parseStoredBoolean(value?: string | null): boolean | null {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function parseStoredTestnetMode(
  value?: string | null,
): StoredTestnetMode | null {
  const legacyValue = parseStoredBoolean(value);
  if (legacyValue !== null) return { value: legacyValue, version: 0n };

  const match = value?.match(versionedValuePattern);
  if (!match) return null;

  const versionText = match[1];
  const valueText = match[2];
  if (!versionText || !valueText) return null;

  const parsedValue = parseStoredBoolean(valueText);
  if (parsedValue === null) return null;

  let version: bigint;
  try {
    version = BigInt(versionText);
  } catch {
    return null;
  }

  return { value: parsedValue, version };
}

function serializeStoredTestnetMode(value: boolean, version: bigint): string {
  return `v1:${version}:${value ? "1" : "0"}`;
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
    parseStoredTestnetMode(readCookieValue(cookieSource, TESTNET_MODE_COOKIE))
      ?.value ?? false
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

function writeTestnetModeCookie(
  enabled: boolean,
  version: bigint,
  verify = false,
): boolean {
  if (typeof document === "undefined") return false;

  try {
    document.cookie = `${TESTNET_MODE_COOKIE}=${serializeStoredTestnetMode(enabled, version)}; Path=/; Max-Age=31536000; SameSite=Lax`;

    if (verify) {
      const storedValue = parseStoredTestnetMode(
        readCookieValue(readTestnetModeDocumentCookie(), TESTNET_MODE_COOKIE),
      );
      return storedValue?.value === enabled && storedValue.version === version;
    }

    return true;
  } catch {
    // Sandboxed browsers can reject cookie access independently of storage.
    return false;
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

function readStoredTestnetModeValues(cookieSource: string | null): {
  cookie: StoredTestnetMode | null;
  localStorage: StoredTestnetMode | null;
} {
  return {
    cookie: parseStoredTestnetMode(
      readCookieValue(cookieSource, TESTNET_MODE_COOKIE),
    ),
    localStorage: parseStoredTestnetMode(readTestnetModeStorageValue()),
  };
}

function getNewestStoredTestnetMode(
  values: ReturnType<typeof readStoredTestnetModeValues>,
): StoredTestnetMode | null {
  if (!values.cookie) return values.localStorage;
  if (!values.localStorage) return values.cookie;

  return values.localStorage.version > values.cookie.version
    ? values.localStorage
    : values.cookie;
}

function getRandomVersionOffset(): bigint {
  try {
    const randomValues = new Uint32Array(2);
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.getRandomValues) {
      cryptoObject.getRandomValues(randomValues);
      return (
        (BigInt(randomValues[0] ?? 0) << 32n) | BigInt(randomValues[1] ?? 0)
      );
    }
  } catch {
    // Fall back to bounded non-cryptographic randomness.
  }

  try {
    const randomUint32 = () => Math.floor(Math.random() * 0x1_0000_0000);
    return (BigInt(randomUint32()) << 32n) | BigInt(randomUint32());
  } catch {
    return 0n;
  }
}

function getCandidateTestnetModeVersion(): bigint {
  return BigInt(Date.now()) * versionBase + getRandomVersionOffset();
}

function nextTestnetModeVersion(cookieSource: string | null): bigint {
  const values = readStoredTestnetModeValues(cookieSource);
  const cookieVersion = values.cookie?.version ?? 0n;
  const localStorageVersion = values.localStorage?.version ?? 0n;
  const readableVersion =
    cookieVersion > localStorageVersion ? cookieVersion : localStorageVersion;
  const candidateVersion = getCandidateTestnetModeVersion();
  const minimumVersion =
    latestTestnetModeVersion > readableVersion
      ? latestTestnetModeVersion
      : readableVersion;
  const version =
    candidateVersion > minimumVersion ? candidateVersion : minimumVersion + 1n;
  latestTestnetModeVersion = version;
  return version;
}

function writeTestnetModeStorage(value: boolean, version: bigint): boolean {
  if (typeof window === "undefined") return false;

  try {
    const storage = window.localStorage;
    if (!storage) return false;

    storage.setItem(
      TESTNET_MODE_STORAGE_KEY,
      serializeStoredTestnetMode(value, version),
    );
    return true;
  } catch {
    // Some embedded browsers expose localStorage but reject access to it.
    return false;
  }
}

function persistTestnetMode(value: boolean) {
  const version = nextTestnetModeVersion(readTestnetModeDocumentCookie());
  const localStorageWritten = writeTestnetModeStorage(value, version);

  // A cookie setter can fail silently. Verify it only when localStorage did
  // not provide a durable read path for this mutation.
  writeTestnetModeCookie(value, version, !localStorageWritten);
}

export function readTestnetModeStorage(
  initialValue = false,
  cookieSource: string | null = readTestnetModeDocumentCookie(),
): boolean {
  return (
    getNewestStoredTestnetMode(readStoredTestnetModeValues(cookieSource))
      ?.value ?? initialValue
  );
}

const testnetModeStorage = {
  getItem: (_key: string, initialValue: boolean) => {
    if (typeof window === "undefined") return initialValue;

    return readTestnetModeStorage(initialValue);
  },
  setItem: (_key: string, value: boolean) => {
    if (typeof window === "undefined") return;

    persistTestnetMode(value);
  },
  removeItem: () => {
    if (typeof window === "undefined") return;

    // Keep a versioned tombstone so RESET can outrank a stale cookie.
    persistTestnetMode(false);
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
