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

function args(
  config: Record<string, string | undefined> | string,
  exchangeId = EXCHANGE_ID,
  token = AUDM_ADDRESS,
): DecodedArg[] {
  return [
    { name: "exchangeId", type: "bytes32", value: exchangeId },
    { name: "token", type: "address", value: token },
    {
      name: "config",
      type: "tuple",
      value: typeof config === "string" ? config : JSON.stringify(config),
    },
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

  it("uses the generic summary for other trading-limit flags", () => {
    expect(
      getPattern()(CONTRACT, args({ limitGlobal: "10", flags: "3" }), "0"),
    ).toBe("Configure trading limits for AUDm on USDm/AUDm pool");
  });

  it("uses safe fallbacks for an unknown pool, token, and malformed config", () => {
    expect(
      getPattern()(
        CONTRACT,
        args(
          "not-json",
          "0x1234567890abcdef",
          "0x0000000000000000000000000000000000000001",
        ),
        "0",
      ),
    ).toBe(
      "Configure trading limits for 0x0000000000000000000000000000000000000001 on pool 0x12345678... pool",
    );
  });

  it.each([{ limitGlobal: "10" }, { flags: "4" }])(
    "uses the generic summary for an incomplete config",
    (config) => {
      expect(getPattern()(CONTRACT, args(config), "0")).toBe(
        "Configure trading limits for AUDm on USDm/AUDm pool",
      );
    },
  );
});
