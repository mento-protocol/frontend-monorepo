import { describe, expect, it, vi } from "vitest";
import type { AdjustTroveParams } from "../types";
import { buildAdjustTroveCall } from "./adjust-trove-transaction";

const params: AdjustTroveParams = {
  troveId: "0x1234",
  collChange: 1n,
  isCollIncrease: true,
  debtChange: 2n,
  isDebtIncrease: true,
  maxUpfrontFee: 3n,
};

describe("buildAdjustTroveCall", () => {
  it("uses the normal adjust builder for active troves", async () => {
    const normalCall = { to: "0x1", data: "0x", value: 0n } as const;
    const buildAdjustTroveTransaction = vi.fn().mockResolvedValue(normalCall);
    const buildAdjustZombieTroveTransaction = vi.fn();

    const result = await buildAdjustTroveCall(
      {
        buildAdjustTroveTransaction,
        buildAdjustZombieTroveTransaction,
      } as never,
      "GBPm",
      params,
      "active",
    );

    expect(buildAdjustTroveTransaction).toHaveBeenCalledWith("GBPm", params);
    expect(buildAdjustZombieTroveTransaction).not.toHaveBeenCalled();
    expect(result).toBe(normalCall);
  });

  it("uses the zombie-specific adjust builder for zombie troves", async () => {
    const zombieCall = { to: "0x2", data: "0x", value: 0n } as const;
    const buildAdjustTroveTransaction = vi.fn();
    const buildAdjustZombieTroveTransaction = vi
      .fn()
      .mockResolvedValue(zombieCall);

    const result = await buildAdjustTroveCall(
      {
        buildAdjustTroveTransaction,
        buildAdjustZombieTroveTransaction,
      } as never,
      "GBPm",
      params,
      "zombie",
    );

    expect(buildAdjustZombieTroveTransaction).toHaveBeenCalledWith(
      "GBPm",
      params,
    );
    expect(buildAdjustTroveTransaction).not.toHaveBeenCalled();
    expect(result).toBe(zombieCall);
  });
});
