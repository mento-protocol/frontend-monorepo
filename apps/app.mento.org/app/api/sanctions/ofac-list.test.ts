import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache needs Next's incremental cache, which tests lack. By default
// the function passes through, so every call reaches it.
const nextCache = vi.hoisted(() => ({
  unstable_cache: vi.fn(<T>(callback: T) => callback),
}));

vi.mock("next/cache", () => nextCache);

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);

type OfacList = typeof import("./ofac-list");

const SDN_XML_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Copied verbatim from SDN.XML published 2026-09-29.
const SDN_ENTRY = `  <sdnEntry>
    <uid>57118</uid>
    <firstName>Rodrigo</firstName>
    <lastName>ALARCON PALOMARES</lastName>
    <sdnType>Individual</sdnType>
    <programList>
      <program>ILLICIT-DRUGS-EO14059</program>
    </programList>
    <idList>
      <id>
        <uid>51344</uid>
        <idType>C.U.R.P.</idType>
        <idNumber>AAPR960621HSLLLD02</idNumber>
        <idCountry>Mexico</idCountry>
      </id>
      <id>
        <uid>196726</uid>
        <idType>Gender</idType>
        <idNumber>Male</idNumber>
      </id>
      <id>
        <uid>196727</uid>
        <idType>Digital Currency Address - ETH</idType>
        <idNumber>0xaC4cC4B68ea24BbFAAC8fD127B67Ed445ACcCE22</idNumber>
      </id>
    </idList>
    <addressList>
      <address>
        <uid>87469</uid>
        <country>Mexico</country>
      </address>
    </addressList>
    <nationalityList>
      <nationality>
        <uid>96725</uid>
        <country>Mexico</country>
        <mainEntry>true</mainEntry>
      </nationality>
    </nationalityList>
    <dateOfBirthList>
      <dateOfBirthItem>
        <uid>96723</uid>
        <dateOfBirth>21 Jun 1996</dateOfBirth>
        <mainEntry>true</mainEntry>
      </dateOfBirthItem>
    </dateOfBirthList>
    <placeOfBirthList>
      <placeOfBirthItem>
        <uid>96724</uid>
        <placeOfBirth>Sinaloa, Mexico</placeOfBirth>
        <mainEntry>true</mainEntry>
      </placeOfBirthItem>
    </placeOfBirthList>
  </sdnEntry>`;

const SDN_ENTRY_ADDRESS = "0xaC4cC4B68ea24BbFAAC8fD127B67Ed445ACcCE22";

// The published file uses CRLF line endings.
function sdnXml(entries: string[]): string {
  return [
    '<?xml version="1.0" standalone="yes"?>',
    '<sdnList xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML">',
    ...entries,
    "</sdnList>",
  ]
    .join("\n")
    .replace(/\n/g, "\r\n");
}

// The verbatim entry with its address replaced, or with its address id
// replaced by `idType` and `idNumber`.
function sdnEntry(idNumber: string, idType = "Digital Currency Address - ETH") {
  return SDN_ENTRY.replace(SDN_ENTRY_ADDRESS, idNumber).replace(
    "Digital Currency Address - ETH",
    idType,
  );
}

function evmAddress(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

// A well-formed list with `count` EVM addresses, one per entry.
function sdnList(count: number): string {
  return sdnXml(
    Array.from({ length: count }, (_, index) =>
      sdnEntry(evmAddress(index + 1)),
    ),
  );
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function staleMessages() {
  return sentry.captureMessage.mock.calls.filter(
    ([message]) => message === "OFAC SDN list is stale",
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseSdnEvmAddresses", () => {
  let parseSdnEvmAddresses: OfacList["parseSdnEvmAddresses"];

  beforeEach(async () => {
    ({ parseSdnEvmAddresses } = await import("./ofac-list"));
  });

  it("reads the address from a verbatim entry", () => {
    expect(parseSdnEvmAddresses(sdnXml([SDN_ENTRY]))).toEqual([
      SDN_ENTRY_ADDRESS.toLowerCase(),
    ]);
  });

  it("lowercases, dedupes and sorts EVM addresses across types", () => {
    const xml = sdnXml([
      sdnEntry(
        "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
        "Digital Currency Address - USDT",
      ),
      sdnEntry(
        "0x098b716b8aaf21512996dc57eb0615e2383e2f96",
        "Digital Currency Address - USDC",
      ),
      sdnEntry(evmAddress(1), "Digital Currency Address - ETC"),
    ]);

    expect(parseSdnEvmAddresses(xml)).toEqual([
      evmAddress(1),
      "0x098b716b8aaf21512996dc57eb0615e2383e2f96",
    ]);
  });

  it("ignores non-EVM types, longer 0x hashes and other id types", () => {
    const xml = sdnXml([
      sdnEntry(
        "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
        "Digital Currency Address - XBT",
      ),
      sdnEntry(
        "TNVTdTSPGwvHkXwEjkUWQ7cEUuJmdhxhbq",
        "Digital Currency Address - TRX",
      ),
      sdnEntry(`0x${"ab".repeat(32)}`),
      sdnEntry(`0x${"cd".repeat(21)}`),
      sdnEntry(evmAddress(2), "Registration Number"),
    ]);

    expect(parseSdnEvmAddresses(xml)).toEqual([]);
  });
});

describe("fetchSdnList", () => {
  let list: OfacList;

  beforeEach(async () => {
    vi.resetModules();
    list = await import("./ofac-list");
  });

  it("downloads the XML uncached and returns its EVM addresses", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    const fetchMock = vi.fn().mockResolvedValue(textResponse(sdnList(120)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await list.fetchSdnList();

    expect(result.fetchedAt).toBe(1_000_000);
    expect(result.addresses).toHaveLength(120);
    expect(result.addresses[0]).toBe(evmAddress(1));
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SDN_XML_URL);
    expect(options).toMatchObject({ redirect: "follow", cache: "no-store" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts exactly the minimum number of addresses", async () => {
    expect(list.MIN_EXPECTED_EVM_ADDRESSES).toBe(100);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(textResponse(sdnList(100))),
    );

    await expect(list.fetchSdnList()).resolves.toMatchObject({
      addresses: expect.any(Array),
    });
  });

  it("throws when fewer than the minimum addresses come back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(textResponse(sdnList(99))),
    );

    await expect(list.fetchSdnList()).rejects.toThrow(
      "yielded 99 EVM addresses, expected at least 100",
    );
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("", 503)));

    await expect(list.fetchSdnList()).rejects.toThrow(
      "OFAC SDN download failed: 503",
    );
  });

  it("throws on an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("")));

    await expect(list.fetchSdnList()).rejects.toThrow("empty body");
  });

  it("aborts the download after 30 seconds", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        signal = options.signal!;
        return new Promise((_, reject) => {
          signal!.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );

    const result = list.fetchSdnList();
    const assertion = expect(result).rejects.toThrow("Aborted");

    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await assertion;
  });
});

describe("getSanctionedEvmAddresses", () => {
  let list: OfacList;

  beforeEach(async () => {
    vi.resetModules();
    sentry.captureMessage.mockClear();
    nextCache.unstable_cache.mockClear();
    list = await import("./ofac-list");
  });

  it("caches the parsed list under a versioned key for six hours", () => {
    expect(nextCache.unstable_cache).toHaveBeenCalledOnce();
    expect(nextCache.unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      ["ofac-sdn-evm-v2"],
      { revalidate: 21_600 },
    );
  });

  it("returns the list as a set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(textResponse(sdnList(120))),
    );

    const addresses = await list.getSanctionedEvmAddresses();

    expect(addresses.size).toBe(120);
    expect(addresses.has(evmAddress(120))).toBe(true);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("throws when no list has ever loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("", 500)));

    await expect(list.getSanctionedEvmAddresses()).rejects.toThrow(
      "OFAC SDN download failed: 500",
    );
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("serves the last good list after a failed refresh", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse(sdnList(120)))
      .mockResolvedValueOnce(textResponse(sdnList(3)));
    vi.stubGlobal("fetch", fetchMock);

    const first = await list.getSanctionedEvmAddresses();
    const second = await list.getSanctionedEvmAddresses();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(second.size).toBe(120);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "OFAC SDN refresh failed; serving last good list",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("shares one download between concurrent calls", async () => {
    let respond: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise((resolve) => (respond = resolve)))
      .mockResolvedValueOnce(textResponse(sdnList(120)));
    vi.stubGlobal("fetch", fetchMock);

    const first = list.getSanctionedEvmAddresses();
    const second = list.getSanctionedEvmAddresses();
    respond(textResponse(sdnList(120)));

    expect(await first).toBe(await second);
    expect(fetchMock).toHaveBeenCalledOnce();

    // The finished download is not reused by the next miss.
    await list.getSanctionedEvmAddresses();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("stale list", () => {
    const fetchedAt = Date.UTC(2026, 8, 1);

    // Serve one cached entry, as Next does while its refresh keeps failing.
    async function importWithCachedEntry(): Promise<OfacList> {
      vi.resetModules();
      nextCache.unstable_cache.mockImplementationOnce(() => async () => ({
        fetchedAt,
        addresses: [evmAddress(1)],
      }));
      return import("./ofac-list");
    }

    it("stays quiet for three days", async () => {
      vi.useFakeTimers({ now: fetchedAt + 3 * DAY_MS, toFake: ["Date"] });
      list = await importWithCachedEntry();

      await list.getSanctionedEvmAddresses();

      expect(staleMessages()).toHaveLength(0);
    });

    it("warns once an hour when the list is older than three days", async () => {
      vi.useFakeTimers({
        now: fetchedAt + 3 * DAY_MS + HOUR_MS,
        toFake: ["Date"],
      });
      list = await importWithCachedEntry();

      const addresses = await list.getSanctionedEvmAddresses();
      expect(addresses.has(evmAddress(1))).toBe(true);
      expect(staleMessages()).toEqual([
        [
          "OFAC SDN list is stale",
          { level: "warning", extra: { ageHours: 73 } },
        ],
      ]);

      vi.setSystemTime(Date.now() + HOUR_MS - 1);
      await list.getSanctionedEvmAddresses();
      expect(staleMessages()).toHaveLength(1);

      vi.setSystemTime(Date.now() + 1);
      await list.getSanctionedEvmAddresses();
      expect(staleMessages()).toHaveLength(2);
      expect(staleMessages()[1]![1]).toEqual({
        level: "warning",
        extra: { ageHours: 74 },
      });
    });

    it("warns when the last good list it falls back on is stale", async () => {
      vi.useFakeTimers({ now: fetchedAt, toFake: ["Date"] });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(textResponse(sdnList(120)))
          .mockRejectedValue(new Error("unreachable")),
      );

      await list.getSanctionedEvmAddresses();
      vi.setSystemTime(fetchedAt + 4 * DAY_MS);
      const addresses = await list.getSanctionedEvmAddresses();

      expect(addresses.size).toBe(120);
      expect(staleMessages()).toHaveLength(1);
    });
  });
});
