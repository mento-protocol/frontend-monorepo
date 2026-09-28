import { describe, expect, it } from "vitest";
import { redactWalletData } from "./sentry-redaction";

const ADDRESS = "0x1234567890AbcdEF1234567890aBcdef12345678";
const HASH = `0x${"ab".repeat(32)}`;
const CALLDATA = `0xa9059cbb000000000000000000000000${ADDRESS.slice(2)}${"0".repeat(63)}1`;

describe("redactWalletData", () => {
  it("redacts a wallet address inside a string", () => {
    expect(
      redactWalletData(`/api/sanctions?address=${ADDRESS}&chain=42220`),
    ).toBe("/api/sanctions?address=0x[redacted]&chain=42220");
  });

  it("redacts calldata as a whole", () => {
    const redacted = redactWalletData(`data: ${CALLDATA}`);
    expect(redacted).toBe("data: 0x[redacted]");
    expect(redacted.toLowerCase()).not.toContain(
      ADDRESS.slice(2).toLowerCase(),
    );
  });

  it("redacts a 64-hex transaction hash", () => {
    expect(redactWalletData(`hash ${HASH}`)).toBe("hash 0x[redacted]");
  });

  it("redacts several matches in one string", () => {
    expect(redactWalletData(`from: ${ADDRESS} to: ${ADDRESS}`)).toBe(
      "from: 0x[redacted] to: 0x[redacted]",
    );
  });

  it("leaves short hex values alone", () => {
    expect(redactWalletData("chain 0xa4ec selector 0xa9059cbb")).toBe(
      "chain 0xa4ec selector 0xa9059cbb",
    );
  });

  it("redacts strings in nested objects without mutating the input", () => {
    const input = {
      message: `Transaction failed from: ${ADDRESS}`,
      extra: { flow: "swap", request: { url: `/x?address=${ADDRESS}` } },
    };

    const redacted = redactWalletData(input);

    expect(redacted).toEqual({
      message: "Transaction failed from: 0x[redacted]",
      extra: { flow: "swap", request: { url: "/x?address=0x[redacted]" } },
    });
    expect(input.message).toContain(ADDRESS);
  });

  it("redacts strings in arrays", () => {
    expect(
      redactWalletData([ADDRESS, { value: HASH }, ["nested", ADDRESS]]),
    ).toEqual([
      "0x[redacted]",
      { value: "0x[redacted]" },
      ["nested", "0x[redacted]"],
    ]);
  });

  it("returns non-string values untouched", () => {
    const date = new Date(0);
    const error = new Error(ADDRESS);
    const input = {
      count: 3,
      ok: true,
      none: null,
      missing: undefined,
      date,
      error,
    };

    const redacted = redactWalletData(input);

    expect(redacted.count).toBe(3);
    expect(redacted.ok).toBe(true);
    expect(redacted.none).toBeNull();
    expect(redacted.missing).toBeUndefined();
    expect(redacted.date).toBe(date);
    expect(redacted.error).toBe(error);
    expect(redactWalletData(42)).toBe(42);
    expect(redactWalletData(null)).toBeNull();
  });

  it("drops objects and arrays past the depth limit instead of sending them", () => {
    let deep: Record<string, unknown> = { value: ADDRESS, list: [ADDRESS] };
    for (let level = 0; level < 8; level++) {
      deep = { child: deep };
    }

    const redacted = redactWalletData(deep);

    let node: unknown = redacted;
    for (let level = 0; level < 8; level++) {
      node = (node as Record<string, unknown>).child;
    }
    expect(node).toBe("[Object]");
    expect(JSON.stringify(redacted)).not.toContain(ADDRESS);
  });

  it("still redacts strings at the deepest walked level", () => {
    let deep: Record<string, unknown> = { value: ADDRESS, list: [ADDRESS] };
    for (let level = 0; level < 7; level++) {
      deep = { child: deep };
    }

    const redacted = redactWalletData(deep);

    let node = redacted as Record<string, unknown>;
    for (let level = 0; level < 7; level++) {
      node = node.child as Record<string, unknown>;
    }
    expect(node.value).toBe("0x[redacted]");
    expect(node.list).toBe("[Array]");
  });
});
