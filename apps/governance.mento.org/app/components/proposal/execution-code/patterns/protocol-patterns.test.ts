import { describe, expect, it, vi } from "vitest";
import type { ContractInfo, DecodedArg } from "./types";

vi.mock("../../services/address-resolver-service", () => ({
  getAddressNameFromCache: (address: string) => address,
  getContractInfo: (address: string) =>
    address.toLowerCase() === "0x7175504c455076f15c04a2f90a8e352281f492f9"
      ? { symbol: "AUDm" }
      : undefined,
}));

const { protocolPatterns } = await import("./protocol-patterns");

const CONTRACT: ContractInfo = {
  address: "0x777a8255ca72412f0d706dc03c9d1987306b4cad",
};

const EXCHANGE_ID =
  "0xd580d237231109e6a96d67d82450611c610a805a26660c90281bdc0cd04a95c7";
const AUDM_ADDRESS = "0x7175504c455076f15c04a2f90a8e352281f492f9";

function getPattern() {
  const pattern =
    protocolPatterns["configureTradingLimit(bytes32,address,tuple)"];
  if (!pattern) throw new Error("configureTradingLimit pattern missing");
  return pattern;
}

function args(config: Record<string, string>): DecodedArg[] {
  return [
    { name: "exchangeId", type: "bytes32", value: EXCHANGE_ID },
    { name: "token", type: "address", value: AUDM_ADDRESS },
    { name: "config", type: "tuple", value: JSON.stringify(config) },
  ];
}

describe("protocolPatterns configureTradingLimit", () => {
  it("describes an MGP-18 reset", () => {
    expect(
      getPattern()(CONTRACT, args({ limitGlobal: "0", flags: "0" }), "0"),
    ).toBe("Reset trading limits for AUDm on USDm/AUDm pool");
  });

  it("describes an MGP-18 global-only limit", () => {
    expect(
      getPattern()(CONTRACT, args({ limitGlobal: "1597", flags: "4" }), "0"),
    ).toBe(
      "Set global trading limit for AUDm on USDm/AUDm pool to 1,597 whole tokens",
    );
  });
});
