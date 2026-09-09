// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const known = "0x1111111111111111111111111111111111111111";
const second = "0x2222222222222222222222222222222222222222";
const mocks = vi.hoisted(() => ({
  mappings: [] as Array<{
    name: string;
    address: string;
    friendlyName?: string;
    symbol?: string;
  }>,
}));

vi.mock("@repo/web3", () => ({
  isValidAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value),
}));
vi.mock("../hooks/useAddressResolver", () => ({
  useAllResolvedMappings: () => mocks.mappings,
}));
vi.mock("../services/address-resolver-service", () => ({
  getAddressNameFromCache: (address: string) =>
    address === "0x2222222222222222222222222222222222222222"
      ? "Cached contract"
      : address,
  getContractInfo: (address: string) =>
    address === "0x1111111111111111111111111111111111111111"
      ? { name: "Registry", friendlyName: "Friendly Registry", symbol: "REG" }
      : undefined,
}));

import { AddressParser } from "./AddressParser";

beforeEach(() => {
  mocks.mappings = [
    { name: "Reserve", friendlyName: "Mento Reserve", address: known },
    {
      name: "USDmToken",
      friendlyName: "USDm Token",
      symbol: "USDm",
      address: second,
    },
    {
      name: "CELO/ETH rate feed",
      friendlyName: "CELO/ETH rate feed",
      symbol: "CELO/ETH",
      address: second,
    },
    { name: "Misc", symbol: "ABC", address: second },
    { name: "Tiny", friendlyName: "short", symbol: "CELO", address: second },
  ];
});
afterEach(cleanup);

describe("AddressParser", () => {
  it("resolves full addresses through registry and cache names", async () => {
    const found = vi.fn();
    render(
      <AddressParser
        text={`${known} and ${second} and 0x1234`}
        onAddressFound={found}
      />,
    );
    await waitFor(() => expect(found).toHaveBeenCalled());
    expect(found.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ match: "Friendly Registry", address: known }),
      expect.objectContaining({ match: "Cached contract", address: second }),
    ]);
  });

  it("resolves truncated transaction and decoded argument addresses", async () => {
    const found = vi.fn();
    const transaction = { address: known } as never;
    const decodedTransaction = {
      args: [{ value: second }, { value: 12 }, { value: "0xshort" }],
    } as never;
    render(
      <AddressParser
        text="Call 0x1111...1111 then 0x2222...2222"
        transaction={transaction}
        decodedTransaction={decodedTransaction}
        onAddressFound={found}
      />,
    );
    await waitFor(() => expect(found).toHaveBeenCalled());
    expect(found.mock.lastCall?.[0]).toHaveLength(2);
  });

  it("builds safe friendly-name and token-symbol mappings", async () => {
    const found = vi.fn();
    render(
      <AddressParser
        text="Reserve, Mento Reserve, USDm, ABC, CELO and CELO/ETH rate feed"
        transaction={{ address: known } as never}
        onAddressFound={found}
      />,
    );
    await waitFor(() => expect(found).toHaveBeenCalled());
    const replacements = found.mock.lastCall?.[0] as Array<{ match: string }>;
    expect(replacements.map((item) => item.match)).toContain("Reserve");
    expect(replacements.map((item) => item.match)).toContain("USDm");
    expect(replacements.map((item) => item.match)).toContain("ABC");
    expect(replacements.map((item) => item.match)).not.toContain("CELO");
  });

  it("removes overlapping names and skips pool pairs", async () => {
    mocks.mappings = [
      { name: "Long Registry", address: known },
      { name: "Registry", address: second },
      { name: "USDmToken", symbol: "USDm", address: second },
    ];
    const found = vi.fn();
    render(
      <AddressParser
        text="Long Registry and USDm/CELO"
        onAddressFound={found}
      />,
    );
    await waitFor(() => expect(found).toHaveBeenCalled());
    expect(found.mock.lastCall?.[0]).toEqual([
      expect.objectContaining({ match: "Long Registry" }),
    ]);
  });

  it("uses full addresses in text to resolve truncated forms", async () => {
    const found = vi.fn();
    render(
      <AddressParser
        text={`0x2222...2222 means ${second}`}
        transaction={{ address: known } as never}
        onAddressFound={found}
      />,
    );
    await waitFor(() => expect(found).toHaveBeenCalled());
    expect(found.mock.lastCall?.[0].length).toBeGreaterThan(0);
  });
});
