import type { PublicClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/mento-sdk", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@mento-protocol/mento-sdk")>();

  return {
    ...actual,
    getBorrowRegistry: vi.fn(),
    resolveAddressesFromRegistry: vi.fn(),
  };
});

const { getBorrowRegistry, resolveAddressesFromRegistry } =
  await import("@mento-protocol/mento-sdk");
const { fetchTroveOwner, isTroveOwner } = await import("./use-trove-owner");
const { TROVE_NFT_ABI } = await import("./trove-parsing");

const REGISTRY = "0x1111111111111111111111111111111111111111";
const TROVE_NFT = "0x2222222222222222222222222222222222222222";
const OWNER = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

describe("fetchTroveOwner", () => {
  beforeEach(() => {
    vi.mocked(getBorrowRegistry).mockReset().mockReturnValue(REGISTRY);
    vi.mocked(resolveAddressesFromRegistry)
      .mockReset()
      .mockResolvedValue({ troveNFT: TROVE_NFT } as Awaited<
        ReturnType<typeof resolveAddressesFromRegistry>
      >);
  });

  it("reads ownerOf from the TroveNFT resolved through the borrow registry", async () => {
    const readContract = vi.fn().mockResolvedValue(OWNER);
    const publicClient = { readContract } as unknown as PublicClient;

    const owner = await fetchTroveOwner(publicClient, 42220, "GBPm", 42n);

    expect(owner).toBe(OWNER);
    expect(getBorrowRegistry).toHaveBeenCalledWith(42220, "GBPm");
    expect(resolveAddressesFromRegistry).toHaveBeenCalledWith(
      publicClient,
      REGISTRY,
    );
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith({
      address: TROVE_NFT,
      abi: TROVE_NFT_ABI,
      functionName: "ownerOf",
      args: [42n],
    });
  });

  it("rejects when ownerOf reverts for an id with no NFT", async () => {
    const readContract = vi.fn().mockRejectedValue(new Error("reverted"));
    const publicClient = { readContract } as unknown as PublicClient;

    await expect(
      fetchTroveOwner(publicClient, 42220, "GBPm", 7n),
    ).rejects.toThrow("reverted");
  });
});

describe("isTroveOwner", () => {
  it("matches addresses regardless of case", () => {
    expect(isTroveOwner(OWNER, OWNER.toLowerCase())).toBe(true);
    expect(isTroveOwner(OWNER.toUpperCase().replace("0X", "0x"), OWNER)).toBe(
      true,
    );
  });

  it("returns false for different addresses", () => {
    expect(isTroveOwner(OWNER, TROVE_NFT)).toBe(false);
  });

  it("returns false when either side is missing", () => {
    expect(isTroveOwner(undefined, OWNER)).toBe(false);
    expect(isTroveOwner(OWNER, undefined)).toBe(false);
    expect(isTroveOwner("", "")).toBe(false);
    expect(isTroveOwner(undefined, undefined)).toBe(false);
  });
});
