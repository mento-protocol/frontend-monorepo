import { describe, expect, it, vi } from "vitest";

vi.mock("@mento-protocol/mento-sdk", () => ({
  getBorrowRegistry: vi.fn(),
  resolveAddressesFromRegistry: vi.fn(),
}));

const { buildOpenTroveSuccessHref } = await import("./use-open-trove");

const TROVE_ID = 123456789n;

describe("buildOpenTroveSuccessHref", () => {
  it("builds a manage URL with the trove id and token symbol", () => {
    expect(buildOpenTroveSuccessHref(TROVE_ID, "GBPm")).toBe(
      `/borrow/manage/${TROVE_ID.toString()}?token=GBPm`,
    );
  });

  it("URL-encodes special characters in the symbol", () => {
    const href = buildOpenTroveSuccessHref(TROVE_ID, "GB Pm");
    expect(href).toBe(`/borrow/manage/${TROVE_ID.toString()}?token=GB%20Pm`);
  });

  it("uses the bigint string representation for the trove id", () => {
    const large = BigInt(
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    );
    const href = buildOpenTroveSuccessHref(large, "GBPm");
    expect(href).toBe(`/borrow/manage/${large.toString()}?token=GBPm`);
  });

  it("produces different URLs for different symbols", () => {
    const hrefA = buildOpenTroveSuccessHref(TROVE_ID, "GBPm");
    const hrefB = buildOpenTroveSuccessHref(TROVE_ID, "EURm");
    expect(hrefA).not.toBe(hrefB);
    expect(hrefB).toContain("token=EURm");
  });

  it("produces different URLs for different trove ids", () => {
    const hrefA = buildOpenTroveSuccessHref(1n, "GBPm");
    const hrefB = buildOpenTroveSuccessHref(2n, "GBPm");
    expect(hrefA).not.toBe(hrefB);
  });
});
