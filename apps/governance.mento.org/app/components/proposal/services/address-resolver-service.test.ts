import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  capture: vi.fn(),
  context: vi.fn(),
  tag: vi.fn(),
}));
vi.mock("./contract-api-service", () => ({
  ContractAPIService: class {
    getContractInfo = mocks.api;
  },
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.capture,
  withScope: (
    callback: (scope: {
      setTag: typeof mocks.tag;
      setContext: typeof mocks.context;
    }) => void,
  ) => callback({ setTag: mocks.tag, setContext: mocks.context }),
}));
vi.mock("@repo/web3", () => ({
  shortenAddress: (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`,
}));

import {
  addressResolverService,
  getAddressNameFromCache,
  getContractInfo,
} from "./address-resolver-service";

const token = ["0x471ece3750da237f93b8", "e339c536989b8978a438"].join("");
const sorted = "0xefb84935239dacdecf7c5ba76d8de40b077b7b33";
const feed = "0x40dc8528167557353fdcd98548ab2139a670dd0b";
const unknown = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  addressResolverService.clearCache();
  mocks.api.mockResolvedValue(null);
});

describe("AddressResolverService", () => {
  it("handles empty, local, and formatted cache resolutions", () => {
    expect(addressResolverService.resolveFromCache(null).name).toBe("Unknown");
    const local = addressResolverService.resolveFromCache(token.toUpperCase());
    expect(local.source).toBe("local");
    expect(local.name).toBeTruthy();
    const fallback = addressResolverService.resolveFromCache(unknown);
    expect(fallback).toEqual(
      expect.objectContaining({ name: "0x1111...1111", source: "formatted" }),
    );
    expect(getAddressNameFromCache(token)).toBeTruthy();
    expect(getContractInfo(token)).toBeTruthy();
    expect(getContractInfo(undefined)).toBeNull();
  });

  it("uses rate-feed mappings in a SortedOracles context", () => {
    const resolvedFeed = addressResolverService.resolveFromCacheWithContext(
      feed,
      sorted,
    );
    expect(resolvedFeed.name).toBe("EUR/XOF rate feed");
    expect(
      addressResolverService.resolveFromCacheWithContext(token, unknown).source,
    ).toBe("local");
  });

  it("resolves local, API, and fallback addresses asynchronously", async () => {
    expect((await addressResolverService.resolve(token)).source).toBe("local");
    mocks.api.mockResolvedValue({
      name: "API Contract",
      friendlyName: "Friendly",
      symbol: "API",
      decimals: 18,
      isProxy: true,
      implementationAddress: token,
    });
    expect(await addressResolverService.resolve(unknown)).toEqual(
      expect.objectContaining({
        name: "API Contract",
        source: "api",
        isProxy: true,
      }),
    );
    addressResolverService.clearCache();
    mocks.api.mockResolvedValue(null);
    expect((await addressResolverService.resolve(unknown)).source).toBe(
      "formatted",
    );
    expect((await addressResolverService.resolve(undefined)).name).toBe(
      "Unknown",
    );
  });

  it("reuses cached and pending resolutions", async () => {
    let finish: ((value: { name: string }) => void) | undefined;
    mocks.api.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = addressResolverService.resolve(unknown);
    const second = addressResolverService.resolve(unknown);
    finish?.({ name: "Pending API" });
    expect(await first).toEqual(await second);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect((await addressResolverService.resolve(unknown)).name).toBe(
      "Pending API",
    );
  });

  it("captures a failed resolution and falls back", async () => {
    mocks.api.mockRejectedValue(new Error("api failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const resolved = await addressResolverService.resolve(unknown);
    expect(resolved.source).toBe("formatted");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolves rate feeds and multiple address lists", async () => {
    expect((await addressResolverService.resolveRateFeed(undefined)).name).toBe(
      "Unknown rate feed",
    );
    expect((await addressResolverService.resolveRateFeed(feed)).name).toBe(
      "EUR/XOF rate feed",
    );
    const sortedResult = await addressResolverService.resolveRateFeed(sorted);
    expect(sortedResult.source).toBe("local");
    const multiple = await addressResolverService.resolveMultiple([
      token,
      null,
      token,
      unknown,
    ]);
    expect(multiple).toHaveLength(4);
    expect(multiple[1]?.name).toBe("Unknown");
  });

  it("lists local mappings and clears populated caches", async () => {
    expect(addressResolverService.getAllLocalMappings().length).toBeGreaterThan(
      10,
    );
    await addressResolverService.resolve(token);
    addressResolverService.clearCache();
    expect(addressResolverService.resolveFromCache(token).source).toBe("local");
  });
});
