import { describe, expect, it, vi } from "vitest";
import type { ContractInfo, DecodedArg } from "./types";

vi.mock("../../services/address-resolver-service", () => ({
  getAddressNameFromCache: (address: string) => address,
  getContractInfo: () => undefined,
  addressResolverService: {
    resolveFromCacheWithContext: (address: string) => ({ name: address }),
  },
}));

const { proxyPatterns } = await import("./proxy-patterns");

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
  const pattern = proxyPatterns[signature];
  if (!pattern) throw new Error(`pattern missing: ${signature}`);
  return pattern;
}

describe("proxyPatterns", () => {
  it("upgrade: happy path pins a real description", () => {
    const pattern = getPattern("upgrade(address,address)");
    const args = [
      arg("proxy", "address", "0x1111111111111111111111111111111111111111"),
      arg(
        "implementation",
        "address",
        "0x3333333333333333333333333333333333333333",
      ),
    ];

    expect(pattern(CONTRACT, args, "0")).toBe(
      "Upgrade 0x1111111111111111111111111111111111111111 to implementation 0x3333333333333333333333333333333333333333",
    );
  });

  it("changeProxyAdmin: returns null for empty args", () => {
    expect(
      getPattern("changeProxyAdmin(address,address)")(CONTRACT, [], "0"),
    ).toBe(null);
  });

  it("changeProxyAdmin: returns null for too few args", () => {
    const args = [arg("proxy", "address", "0xabc")];
    expect(
      getPattern("changeProxyAdmin(address,address)")(CONTRACT, args, "0"),
    ).toBe(null);
  });

  it("changeProxyAdmin: returns null when an arg's value is null", () => {
    const args = [
      arg("proxy", "address", "0xabc"),
      arg("newAdmin", "address", null as unknown as string),
    ];
    expect(
      getPattern("changeProxyAdmin(address,address)")(CONTRACT, args, "0"),
    ).toBe(null);
  });

  it("upgrade: returns null for empty args", () => {
    expect(getPattern("upgrade(address,address)")(CONTRACT, [], "0")).toBe(
      null,
    );
  });

  it("upgrade: returns null for too few args", () => {
    const args = [arg("proxy", "address", "0xabc")];
    expect(getPattern("upgrade(address,address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("upgrade: returns null when an arg's value is null", () => {
    const args = [
      arg("proxy", "address", "0xabc"),
      arg("implementation", "address", null as unknown as string),
    ];
    expect(getPattern("upgrade(address,address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });

  it("upgradeAndCall: returns null for empty args", () => {
    expect(
      getPattern("upgradeAndCall(address,address,bytes)")(CONTRACT, [], "0"),
    ).toBe(null);
  });

  it("upgradeAndCall: returns null for too few args", () => {
    const args = [arg("proxy", "address", "0xabc")];
    expect(
      getPattern("upgradeAndCall(address,address,bytes)")(CONTRACT, args, "0"),
    ).toBe(null);
  });

  it("upgradeAndCall: returns null when a required arg's value is null", () => {
    const args = [
      arg("proxy", "address", "0xabc"),
      arg("implementation", "address", null as unknown as string),
      arg("data", "bytes", "0x"),
    ];
    expect(
      getPattern("upgradeAndCall(address,address,bytes)")(CONTRACT, args, "0"),
    ).toBe(null);
  });

  it("_setImplementation: returns null for empty args", () => {
    expect(getPattern("_setImplementation(address)")(CONTRACT, [], "0")).toBe(
      null,
    );
  });

  it("_setImplementation: returns null when the arg's value is null", () => {
    const args = [arg("implementation", "address", null as unknown as string)];
    expect(getPattern("_setImplementation(address)")(CONTRACT, args, "0")).toBe(
      null,
    );
  });
});
