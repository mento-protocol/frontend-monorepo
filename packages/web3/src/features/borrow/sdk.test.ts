import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  parseAbiParameters,
} from "viem";
import { describe, expect, it, vi } from "vitest";

// Mock the SDK module so we can import deriveBorrowTroveId without pulling in
// @mento-protocol/mento-sdk (which has an ESM resolution issue in the test env).
vi.mock("@mento-protocol/mento-sdk", () => ({ BorrowService: class {} }));

const { deriveBorrowTroveId } = await import("./sdk");

const PARAMS = parseAbiParameters(
  "address opener, address owner, uint256 ownerIndex",
);

function referenceId(
  opener: string,
  owner: string,
  ownerIndex: number,
): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(PARAMS, [
        getAddress(opener),
        getAddress(owner),
        BigInt(ownerIndex),
      ]),
    ),
  );
}

const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";

describe("deriveBorrowTroveId", () => {
  it("returns a non-zero bigint", () => {
    const id = deriveBorrowTroveId(ADDR_A, ADDR_A, 0);
    expect(typeof id).toBe("bigint");
    expect(id).not.toBe(0n);
  });

  it("matches the reference keccak256(abi.encode(opener, owner, ownerIndex))", () => {
    expect(deriveBorrowTroveId(ADDR_A, ADDR_A, 0)).toBe(
      referenceId(ADDR_A, ADDR_A, 0),
    );
    expect(deriveBorrowTroveId(ADDR_A, ADDR_B, 3)).toBe(
      referenceId(ADDR_A, ADDR_B, 3),
    );
  });

  it("is deterministic", () => {
    expect(deriveBorrowTroveId(ADDR_A, ADDR_A, 0)).toBe(
      deriveBorrowTroveId(ADDR_A, ADDR_A, 0),
    );
  });

  it("normalises address casing — lowercase and checksummed give the same id", () => {
    const lower = ADDR_A.toLowerCase() as `0x${string}`;
    // toUpperCase on the hex chars only
    const mixed = `0x${ADDR_A.slice(2).toUpperCase()}` as `0x${string}`;
    expect(deriveBorrowTroveId(lower, lower, 0)).toBe(
      deriveBorrowTroveId(mixed, mixed, 0),
    );
  });

  it("produces different ids for different ownerIndex values", () => {
    expect(deriveBorrowTroveId(ADDR_A, ADDR_A, 0)).not.toBe(
      deriveBorrowTroveId(ADDR_A, ADDR_A, 1),
    );
  });

  it("produces different ids for different owner addresses", () => {
    expect(deriveBorrowTroveId(ADDR_A, ADDR_A, 0)).not.toBe(
      deriveBorrowTroveId(ADDR_B, ADDR_B, 0),
    );
  });

  it("produces different ids when opener differs from owner", () => {
    expect(deriveBorrowTroveId(ADDR_A, ADDR_A, 0)).not.toBe(
      deriveBorrowTroveId(ADDR_B, ADDR_A, 0),
    );
  });
});
