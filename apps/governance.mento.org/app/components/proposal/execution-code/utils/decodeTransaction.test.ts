import { describe, expect, it } from "vitest";
import { decodeTransaction } from "./decodeTransaction";

const BROKER = "0x777a8255ca72412f0d706dc03c9d1987306b4cad";
const EMPTY_ABI_MAP = new Map();

const RESET_AUDM_LIMIT =
  "0xa9b5aab3d580d237231109e6a96d67d82450611c610a805a26660c90281bdc0cd04a95c70000000000000000000000007175504c455076f15c04a2f90a8e352281f492f9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const SET_AUDM_LIMIT =
  "0xa9b5aab3d580d237231109e6a96d67d82450611c610a805a26660c90281bdc0cd04a95c70000000000000000000000007175504c455076f15c04a2f90a8e352281f492f90000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000063d0000000000000000000000000000000000000000000000000000000000000004";

describe("decodeTransaction", () => {
  it("decodes an MGP-18 trading-limit reset from the local Broker ABI", async () => {
    const decoded = await decodeTransaction(
      { address: BROKER, value: "0", data: RESET_AUDM_LIMIT },
      EMPTY_ABI_MAP,
    );

    expect(decoded).toEqual({
      functionName: "configureTradingLimit",
      functionSignature: "configureTradingLimit(bytes32,address,tuple)",
      args: [
        {
          name: "exchangeId",
          type: "bytes32",
          value:
            "0xd580d237231109e6a96d67d82450611c610a805a26660c90281bdc0cd04a95c7",
        },
        {
          name: "token",
          type: "address",
          value: "0x7175504c455076f15c04a2f90a8e352281f492f9",
        },
        {
          name: "config",
          type: "tuple",
          value:
            '{"timestep0":"0","timestep1":"0","limit0":"0","limit1":"0","limitGlobal":"0","flags":"0"}',
        },
      ],
    });
  });

  it("decodes the MGP-18 global-only limit values", async () => {
    const decoded = await decodeTransaction(
      { address: BROKER, value: "0", data: SET_AUDM_LIMIT },
      EMPTY_ABI_MAP,
    );

    expect(decoded?.args?.[2]).toEqual({
      name: "config",
      type: "tuple",
      value:
        '{"timestep0":"0","timestep1":"0","limit0":"0","limit1":"0","limitGlobal":"1597","flags":"4"}',
    });
  });

  it("does not apply the Broker ABI to another contract", async () => {
    const decoded = await decodeTransaction(
      {
        address: "0x0000000000000000000000000000000000000001",
        value: "0",
        data: SET_AUDM_LIMIT,
      },
      EMPTY_ABI_MAP,
    );

    expect(decoded).toBeNull();
  });
});
