import * as Sentry from "@sentry/nextjs";
import { unstable_cache } from "next/cache";

// OFAC's Sanctions List Service. It redirects to a pre-signed S3 URL for the
// latest publication of the Specially Designated Nationals (SDN) list. The XML
// is used, not SDN.CSV, because the CSV cuts the remarks column at 1000
// characters and loses addresses from long entries.
// See docs/adr/0014-sanctions-screening-uses-the-ofac-sdn-list.md.
const SDN_XML_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const FETCH_TIMEOUT_MS = 30_000;
const REVALIDATE_SECONDS = 21_600;
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_WARNING_INTERVAL_MS = 60 * 60 * 1000;

// The list carried 124 unique EVM addresses in September 2026, and the
// truncated CSV 91. A download that yields fewer than this is truncated or
// reformatted, and must not clear every wallet.
export const MIN_EXPECTED_EVM_ADDRESSES = 100;

// Each address is an `<id>` whose type is `Digital Currency Address - <TYPE>`.
// Only 0x-prefixed EVM addresses of exactly 40 hex characters are collected.
const EVM_ADDRESS_PATTERN =
  /<idType>Digital Currency Address - [A-Z0-9]+<\/idType>\s*<idNumber>(0x[0-9a-fA-F]{40})<\/idNumber>/g;

interface SdnList {
  fetchedAt: number;
  addresses: string[];
}

export function parseSdnEvmAddresses(xml: string): string[] {
  const addresses = new Set<string>();
  for (const match of xml.matchAll(EVM_ADDRESS_PATTERN)) {
    addresses.add(match[1]!.toLowerCase());
  }
  return [...addresses].sort();
}

export async function fetchSdnList(): Promise<SdnList> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // The XML is about 29 MB, above the 2 MB data cache limit, so it is never
    // cached; only the parsed address array is.
    const response = await fetch(SDN_XML_URL, {
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OFAC SDN download failed: ${response.status}`);
    }

    const xml = await response.text();
    if (!xml) {
      throw new Error("OFAC SDN download returned an empty body");
    }

    const addresses = parseSdnEvmAddresses(xml);
    if (addresses.length < MIN_EXPECTED_EVM_ADDRESSES) {
      throw new Error(
        `OFAC SDN list yielded ${addresses.length} EVM addresses, expected at least ${MIN_EXPECTED_EVM_ADDRESSES}`,
      );
    }
    return { fetchedAt: Date.now(), addresses };
  } finally {
    clearTimeout(timeout);
  }
}

// Concurrent cache misses on one instance share a single download.
let inflightDownload: Promise<SdnList> | null = null;

function downloadSdnList(): Promise<SdnList> {
  inflightDownload ??= fetchSdnList().finally(() => {
    inflightDownload = null;
  });
  return inflightDownload;
}

// When an entry is stale, Next serves it and refreshes it in the background
// through the platform's waitUntil. A failed background refresh is only logged
// and the stale entry stays, so the age check below is the only signal. A
// missing entry is fetched in the foreground, and that failure reaches the
// caller.
const getCachedSdnList = unstable_cache(downloadSdnList, ["ofac-sdn-evm-v2"], {
  revalidate: REVALIDATE_SECONDS,
});

interface LoadedList {
  fetchedAt: number;
  addresses: ReadonlySet<string>;
}

// Covers a foreground failure, such as an evicted cache entry while OFAC is
// unreachable, for as long as this instance has loaded the list once.
let lastGoodList: LoadedList | null = null;
let lastStaleWarningAt = Number.NEGATIVE_INFINITY;

function warnIfStale(fetchedAt: number) {
  const now = Date.now();
  const ageMs = now - fetchedAt;
  if (ageMs <= STALE_AFTER_MS) return;
  if (now - lastStaleWarningAt < STALE_WARNING_INTERVAL_MS) return;

  lastStaleWarningAt = now;
  Sentry.captureMessage("OFAC SDN list is stale", {
    level: "warning",
    extra: { ageHours: Math.floor(ageMs / (60 * 60 * 1000)) },
  });
}

export async function getSanctionedEvmAddresses(): Promise<
  ReadonlySet<string>
> {
  let list: LoadedList;
  try {
    const cached = await getCachedSdnList();
    list =
      lastGoodList?.fetchedAt === cached.fetchedAt
        ? lastGoodList
        : {
            fetchedAt: cached.fetchedAt,
            addresses: new Set(cached.addresses),
          };
    lastGoodList = list;
  } catch (error) {
    if (!lastGoodList) throw error;
    Sentry.captureMessage("OFAC SDN refresh failed; serving last good list", {
      level: "warning",
      extra: { error: error instanceof Error ? error.message : String(error) },
    });
    list = lastGoodList;
  }

  warnIfStale(list.fetchedAt);
  return list.addresses;
}
