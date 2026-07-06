import { describe, expect, it, vi } from "vitest";
import type { ContractInfo, DecodedArg } from "./types";

vi.mock("../../services/address-resolver-service", () => ({
  getAddressNameFromCache: (address: string) => address,
  getContractInfo: () => undefined,
  addressResolverService: {
    resolveFromCacheWithContext: (address: string) => ({ name: address }),
  },
}));

const { tokenPatterns } = await import("./token-patterns");

const CONTRACT: ContractInfo = {
  address: "0x2222222222222222222222222222222222222222",
};

function arg(
  name: string,
  type: string,
  value: DecodedArg["value"],
): DecodedArg {
  return { name, type, value };
}

function getPattern(signature: string) {
  const pattern = tokenPatterns[signature];
  if (!pattern) throw new Error(`pattern missing: ${signature}`);
  return pattern;
}

describe("tokenPatterns", () => {
  it("transfer: happy path pins a real description", () => {
    const pattern = getPattern("transfer(address,uint256)");
    const args = [
      arg("recipient", "address", "0x1111111111111111111111111111111111111111"),
      arg("amount", "uint256", "1000000000000000000"),
    ];

    expect(pattern(CONTRACT, args, "0")).toBe(
      "Send 1 tokens to 0x1111111111111111111111111111111111111111",
    );
  });

  it("transfer: returns null for empty args", () => {
    expect(getPattern("transfer(address,uint256)")(CONTRACT, [], "0")).toBe(
      null,
    );
  });

  it("transfer: returns null for too few args", () => {
    const args = [arg("recipient", "address", "0xabc")];
    expect(getPattern("transfer(address,uint256)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("transfer: returns null when an arg's value is null", () => {
    const args = [
      arg("recipient", "address", "0xabc"),
      arg("amount", "uint256", null as unknown as string),
    ];
    expect(getPattern("transfer(address,uint256)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("approve: returns null for empty args", () => {
    expect(getPattern("approve(address,uint256)")(CONTRACT, [], "0")).toBe(
      null,
    );
  });

  it("approve: returns null for too few args", () => {
    const args = [arg("spender", "address", "0xabc")];
    expect(getPattern("approve(address,uint256)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("approve: returns null when an arg's value is null", () => {
    const args = [
      arg("spender", "address", "0xabc"),
      arg("amount", "uint256", null as unknown as string),
    ];
    expect(getPattern("approve(address,uint256)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("mint: returns null for empty args", () => {
    expect(getPattern("mint(address,uint256)")(CONTRACT, [], "0")).toBe(null);
  });

  it("mint: returns null for too few args", () => {
    const args = [arg("recipient", "address", "0xabc")];
    expect(getPattern("mint(address,uint256)")(CONTRACT, args, "0")).toBe(null);
  });

  it("mint: returns null when an arg's value is null", () => {
    const args = [
      arg("recipient", "address", "0xabc"),
      arg("amount", "uint256", null as unknown as string),
    ];
    expect(getPattern("mint(address,uint256)")(CONTRACT, args, "0")).toBe(null);
  });

  it("burn: returns null for empty args", () => {
    expect(getPattern("burn(uint256)")(CONTRACT, [], "0")).toBe(null);
  });

  it("burn: returns null when the arg's value is null", () => {
    const args = [arg("amount", "uint256", null as unknown as string)];
    expect(getPattern("burn(uint256)")(CONTRACT, args, "0")).toBe(null);
  });

  it("lock: returns null for empty args", () => {
    expect(
      getPattern("lock(address,address,uint96,uint32,uint32)")(
        CONTRACT,
        [],
        "0",
      ),
    ).toBe(null);
  });

  it("lock: returns null for too few args", () => {
    const args = [
      arg("account", "address", "0xabc"),
      arg("delegate", "address", "0xdef"),
    ];
    expect(
      getPattern("lock(address,address,uint96,uint32,uint32)")(
        CONTRACT,
        args,
        "0",
      ),
    ).toBe(null);
  });

  it("lock: returns null when a required arg's value is null", () => {
    const args = [
      arg("account", "address", "0xabc"),
      arg("delegate", "address", "0xdef"),
      arg("amount", "uint96", null as unknown as string),
      arg("slopePeriod", "uint32", "4"),
      arg("cliff", "uint32", "0"),
    ];
    expect(
      getPattern("lock(address,address,uint96,uint32,uint32)")(
        CONTRACT,
        args,
        "0",
      ),
    ).toBe(null);
  });

  it("delegateTo: returns null for empty args", () => {
    expect(getPattern("delegateTo(uint256,address)")(CONTRACT, [], "0")).toBe(
      null,
    );
  });

  it("delegateTo: returns null for too few args", () => {
    const args = [arg("id", "uint256", "1")];
    expect(getPattern("delegateTo(uint256,address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("delegateTo: returns null when an arg's value is null", () => {
    const args = [
      arg("id", "uint256", "1"),
      arg("newDelegate", "address", null as unknown as string),
    ];
    expect(getPattern("delegateTo(uint256,address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("setName: returns null for empty args", () => {
    expect(getPattern("setName(string)")(CONTRACT, [], "0")).toBe(null);
  });

  it("setName: returns null when the arg's value is null", () => {
    const args = [arg("newName", "string", null as unknown as string)];
    expect(getPattern("setName(string)")(CONTRACT, args, "0")).toBe(null);
  });

  it("setSymbol: returns null for empty args", () => {
    expect(getPattern("setSymbol(string)")(CONTRACT, [], "0")).toBe(null);
  });

  it("setSymbol: returns null when the arg's value is null", () => {
    const args = [arg("newSymbol", "string", null as unknown as string)];
    expect(getPattern("setSymbol(string)")(CONTRACT, args, "0")).toBe(null);
  });
});
