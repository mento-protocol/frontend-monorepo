import { describe, expect, it, vi } from "vitest";
import {
  buildCloseTroveApprovalCall,
  computeBufferedDebt,
} from "./close-trove-approval";

describe("computeBufferedDebt", () => {
  it("applies a 0.1% buffer", () => {
    expect(computeBufferedDebt(1000n)).toBe(1001n);
  });
});

describe("buildCloseTroveApprovalCall", () => {
  it("builds an approval for the buffered amount when allowance is insufficient", async () => {
    const approvalCall = { to: "0x1", data: "0x", value: 0n } as const;
    const getDebtAllowance = vi.fn().mockResolvedValue(0n);
    const buildDebtApprovalParams = vi.fn().mockResolvedValue(approvalCall);

    const result = await buildCloseTroveApprovalCall(
      { getDebtAllowance, buildDebtApprovalParams } as never,
      "GBPm",
      "0xaccount",
      "0xborrowerOps",
      1000n,
    );

    expect(buildDebtApprovalParams).toHaveBeenCalledWith(
      "GBPm",
      "0xborrowerOps",
      1001n,
    );
    expect(result).toBe(approvalCall);
  });

  it("resolves null when allowance already covers the buffered debt", async () => {
    const getDebtAllowance = vi.fn().mockResolvedValue(2000n);
    const buildDebtApprovalParams = vi.fn();

    const result = await buildCloseTroveApprovalCall(
      { getDebtAllowance, buildDebtApprovalParams } as never,
      "GBPm",
      "0xaccount",
      "0xborrowerOps",
      1000n,
    );

    expect(buildDebtApprovalParams).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("resolves null when allowance exactly equals the buffered debt", async () => {
    const getDebtAllowance = vi.fn().mockResolvedValue(1001n);
    const buildDebtApprovalParams = vi.fn();

    const result = await buildCloseTroveApprovalCall(
      { getDebtAllowance, buildDebtApprovalParams } as never,
      "GBPm",
      "0xaccount",
      "0xborrowerOps",
      1000n,
    );

    expect(buildDebtApprovalParams).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
