import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// unstable_cache needs Next's incremental cache, which tests lack. Pass the
// function through, so every call reaches it.
vi.mock("next/cache", () => ({
  unstable_cache: <T>(callback: T) => callback,
}));

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentry);

type OfacList = typeof import("./ofac-list");

function sdnRow(id: number, remarks: string): string {
  return `${id},"SANCTIONED ENTITY ${id}",-0- ,"CYBER2",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"${remarks}"`;
}

function evmAddress(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

// A well-formed list with `count` EVM entries, one per row.
function sdnCsv(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    sdnRow(
      index,
      `Digital Currency Address - ETH ${evmAddress(index + 1)}; alt. Digital Currency Address - XBT 1BoatSLRHtKNngkdXEeobR76b53LETtpyT;`,
    ),
  ).join("\n");
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("parseSdnEvmAddresses", () => {
  let parseSdnEvmAddresses: OfacList["parseSdnEvmAddresses"];

  beforeEach(async () => {
    ({ parseSdnEvmAddresses } = await import("./ofac-list"));
  });

  it("lowercases, dedupes and sorts EVM addresses across types", () => {
    const csv = [
      sdnRow(
        1,
        "Digital Currency Address - ETH 0x098B716B8Aaf21512996dC57EB0615e2383E2f96; Digital Currency Address - USDT 0xa7e5d5a720f06526557c513402f2e6b5fa20b008;",
      ),
      sdnRow(
        2,
        "Digital Currency Address - USDC 0x098b716b8aaf21512996dc57eb0615e2383e2f96; Digital Currency Address - ETC 0x0000000000000000000000000000000000000001;",
      ),
    ].join("\n");

    expect(parseSdnEvmAddresses(csv)).toEqual([
      "0x0000000000000000000000000000000000000001",
      "0x098b716b8aaf21512996dc57eb0615e2383e2f96",
      "0xa7e5d5a720f06526557c513402f2e6b5fa20b008",
    ]);
  });

  it("ignores non-EVM types and 0x hashes longer than 40 hex characters", () => {
    const csv = [
      sdnRow(
        1,
        "Digital Currency Address - XBT 1BoatSLRHtKNngkdXEeobR76b53LETtpyT; Digital Currency Address - TRX TNVTdTSPGwvHkXwEjkUWQ7cEUuJmdhxhbq;",
      ),
      sdnRow(
        2,
        `Digital Currency Address - ETH 0x${"ab".repeat(32)}; Digital Currency Address - ETH 0x${"cd".repeat(21)};`,
      ),
      sdnRow(3, "Website 0x0000000000000000000000000000000000000002;"),
    ].join("\n");

    expect(parseSdnEvmAddresses(csv)).toEqual([]);
  });
});

describe("fetchSdnEvmAddresses", () => {
  let list: OfacList;

  beforeEach(async () => {
    vi.resetModules();
    list = await import("./ofac-list");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads the list uncached and returns its EVM addresses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(sdnCsv(60)));
    vi.stubGlobal("fetch", fetchMock);

    const addresses = await list.fetchSdnEvmAddresses();

    expect(addresses).toHaveLength(60);
    expect(addresses[0]).toBe(evmAddress(1));
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
    );
    expect(options).toMatchObject({ redirect: "follow", cache: "no-store" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("", 503)));

    await expect(list.fetchSdnEvmAddresses()).rejects.toThrow(
      "OFAC SDN download failed: 503",
    );
  });

  it("throws on an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse("")));

    await expect(list.fetchSdnEvmAddresses()).rejects.toThrow("empty body");
  });

  it("throws on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );

    await expect(list.fetchSdnEvmAddresses()).rejects.toThrow("Aborted");
  });

  it("throws when fewer than the minimum addresses come back", async () => {
    const count = list.MIN_EXPECTED_EVM_ADDRESSES - 1;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(textResponse(sdnCsv(count))),
    );

    await expect(list.fetchSdnEvmAddresses()).rejects.toThrow(
      `yielded ${count} EVM addresses`,
    );
  });
});

describe("getSanctionedEvmAddresses", () => {
  let list: OfacList;

  beforeEach(async () => {
    vi.resetModules();
    sentry.captureMessage.mockClear();
    list = await import("./ofac-list");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the list as a set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textResponse(sdnCsv(60))));

    const addresses = await list.getSanctionedEvmAddresses();

    expect(addresses.size).toBe(60);
    expect(addresses.has(evmAddress(60))).toBe(true);
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
      .mockResolvedValueOnce(textResponse(sdnCsv(60)))
      .mockResolvedValueOnce(textResponse(sdnCsv(3)));
    vi.stubGlobal("fetch", fetchMock);

    const first = await list.getSanctionedEvmAddresses();
    const second = await list.getSanctionedEvmAddresses();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
    expect(second.size).toBe(60);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "OFAC SDN refresh failed; serving last good list",
      expect.objectContaining({ level: "warning" }),
    );
  });
});
