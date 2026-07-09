import { describe, expect, it, vi } from "vitest";
import type { ContractInfo, DecodedArg } from "./types";

vi.mock("../../services/address-resolver-service", () => ({
  getAddressNameFromCache: (address: string) => address,
  getContractInfo: () => undefined,
  addressResolverService: {
    resolveFromCacheWithContext: (address: string) => ({ name: address }),
  },
}));

const { oraclePatterns } = await import("./oracle-patterns");

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
  const pattern = oraclePatterns[signature];
  if (!pattern) throw new Error(`pattern missing: ${signature}`);
  return pattern;
}

describe("oraclePatterns", () => {
  it("addOracle: happy path pins a real description", () => {
    const pattern = getPattern("addOracle(address,address)");
    const args = [
      arg("token", "address", "0x1111111111111111111111111111111111111111"),
      arg("oracle", "address", "0x3333333333333333333333333333333333333333"),
    ];

    expect(pattern(CONTRACT, args, "0")).toBe(
      "Add 0x3333333333333333333333333333333333333333 as price oracle for the 0x1111111111111111111111111111111111111111",
    );
  });

  it("addOracle: returns null for empty args", () => {
    expect(getPattern("addOracle(address,address)")(CONTRACT, [], "0")).toBe(
      null,
    );
  });

  it("addOracle: returns null for too few args", () => {
    const args = [arg("token", "address", "0xabc")];
    expect(getPattern("addOracle(address,address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("addOracle: returns null when an arg's value is null", () => {
    const args = [
      arg("token", "address", "0xabc"),
      arg("oracle", "address", null as unknown as string),
    ];
    expect(getPattern("addOracle(address,address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("removeOracle: returns null for empty args", () => {
    expect(
      getPattern("removeOracle(address,address,uint256)")(CONTRACT, [], "0"),
    ).toBe(null);
  });

  it("removeOracle: returns null for too few args", () => {
    const args = [arg("token", "address", "0xabc")];
    expect(
      getPattern("removeOracle(address,address,uint256)")(CONTRACT, args, "0"),
    ).toBe(null);
  });

  it("removeOracle: returns null when a required arg's value is null", () => {
    const args = [
      arg("token", "address", "0xabc"),
      arg("oracle", "address", null as unknown as string),
      arg("index", "uint256", "0"),
    ];
    expect(
      getPattern("removeOracle(address,address,uint256)")(CONTRACT, args, "0"),
    ).toBe(null);
  });
});
