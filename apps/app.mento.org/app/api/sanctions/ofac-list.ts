import * as Sentry from "@sentry/nextjs";
import { unstable_cache } from "next/cache";

// OFAC's Sanctions List Service. It redirects to a pre-signed S3 URL for the
// latest publication of the Specially Designated Nationals (SDN) list.
// See docs/adr/0014-sanctions-screening-uses-the-ofac-sdn-list.md.
const SDN_CSV_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV";
const FETCH_TIMEOUT_MS = 30_000;
const REVALIDATE_SECONDS = 21_600;

// The list carried 91 unique EVM addresses in September 2026. A download that
// yields far fewer is truncated or reformatted, and must not clear every wallet.
export const MIN_EXPECTED_EVM_ADDRESSES = 50;

// Addresses sit in the remarks column as
// `Digital Currency Address - <TYPE> <address>;`. Only 0x-prefixed EVM
// addresses are collected; the word boundary rejects longer 0x hashes.
const EVM_ADDRESS_PATTERN =
  /Digital Currency Address - [A-Z0-9]+ (0x[0-9a-fA-F]{40})\b/g;

export function parseSdnEvmAddresses(csv: string): string[] {
  const addresses = new Set<string>();
  for (const match of csv.matchAll(EVM_ADDRESS_PATTERN)) {
    addresses.add(match[1]!.toLowerCase());
  }
  return [...addresses].sort();
}

export async function fetchSdnEvmAddresses(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // The CSV is about 5.7 MB, above the 2 MB data cache limit, so it is never
    // cached; only the parsed address array is.
    const response = await fetch(SDN_CSV_URL, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OFAC SDN download failed: ${response.status}`);
    }

    const csv = await response.text();
    if (!csv) {
      throw new Error("OFAC SDN download returned an empty body");
    }

    const addresses = parseSdnEvmAddresses(csv);
    if (addresses.length < MIN_EXPECTED_EVM_ADDRESSES) {
      throw new Error(
        `OFAC SDN list yielded ${addresses.length} EVM addresses, expected at least ${MIN_EXPECTED_EVM_ADDRESSES}`,
      );
    }
    return addresses;
  } finally {
    clearTimeout(timeout);
  }
}

// When an entry is stale, Next serves it and refreshes in the background; a
// failed background refresh keeps the stale entry. A missing entry is fetched
// in the foreground, and that failure reaches the caller.
const getCachedSdnEvmAddresses = unstable_cache(
  fetchSdnEvmAddresses,
  ["ofac-sdn-evm-v1"],
  { revalidate: REVALIDATE_SECONDS },
);

// Covers a foreground failure, such as an evicted cache entry while OFAC is
// unreachable, for as long as this instance has loaded the list once.
let lastGoodAddresses: ReadonlySet<string> | null = null;

export async function getSanctionedEvmAddresses(): Promise<
  ReadonlySet<string>
> {
  try {
    const addresses = new Set(await getCachedSdnEvmAddresses());
    lastGoodAddresses = addresses;
    return addresses;
  } catch (error) {
    if (!lastGoodAddresses) throw error;
    Sentry.captureMessage("OFAC SDN refresh failed; serving last good list", {
      level: "warning",
      extra: { error: error instanceof Error ? error.message : String(error) },
    });
    return lastGoodAddresses;
  }
}
