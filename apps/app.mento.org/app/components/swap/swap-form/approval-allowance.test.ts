import { describe, expect, it, vi } from "vitest";

import {
  buildApprovalIdentity,
  canReuseConfirmedApproval,
  isSameApprovalRequirement,
  waitForSufficientAllowance,
} from "./approval-allowance";

const retryOptions = {
  initialRetryDelayMs: 10,
  maxAttempts: 3,
};

describe("approval requirement context", () => {
  const identity = buildApprovalIdentity({
    account: "account",
    chainId: 42220,
    tokenInSymbol: "USDm",
  });
  const confirmed = { amount: "1000", identity };

  it("keys approval reuse by chain, account, and sell token", () => {
    expect(identity).toBe("42220:account:USDm");
    expect(
      buildApprovalIdentity({
        account: "account",
        chainId: 42220,
        tokenInSymbol: "USDm",
      }),
    ).toBe(identity);
    expect(
      buildApprovalIdentity({
        account: "other-account",
        chainId: 42220,
        tokenInSymbol: "USDm",
      }),
    ).not.toBe(identity);
    expect(
      buildApprovalIdentity({
        account: "account",
        chainId: 42220,
        tokenInSymbol: "EURm",
      }),
    ).not.toBe(identity);
    expect(
      buildApprovalIdentity({
        account: "account",
        chainId: 44787,
        tokenInSymbol: "USDm",
      }),
    ).not.toBe(identity);
  });

  it("reuses a confirmed approval for the same or a smaller amount", () => {
    expect(canReuseConfirmedApproval(confirmed, confirmed)).toBe(true);
    expect(
      canReuseConfirmedApproval(confirmed, { ...confirmed, amount: "999" }),
    ).toBe(true);
  });

  it("does not reuse it for a larger amount or a different allowance identity", () => {
    expect(
      canReuseConfirmedApproval(confirmed, { ...confirmed, amount: "1001" }),
    ).toBe(false);
    expect(
      canReuseConfirmedApproval(confirmed, {
        ...confirmed,
        identity: "42220:other-account:USDm",
      }),
    ).toBe(false);
  });

  it("distinguishes allowance reads for different required amounts", () => {
    expect(isSameApprovalRequirement(confirmed, confirmed)).toBe(true);
    expect(
      isSameApprovalRequirement(confirmed, { ...confirmed, amount: "999" }),
    ).toBe(false);
  });
});

describe("waitForSufficientAllowance", () => {
  it("accepts an allowance equal to the required amount on the first read", async () => {
    const readAllowance = vi.fn().mockResolvedValue("1000");
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForSufficientAllowance({
        requiredAmount: "1000",
        readAllowance,
        wait,
        ...retryOptions,
      }),
    ).resolves.toBe("1000");
    expect(readAllowance).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("retries stale allowance reads with exponential backoff", async () => {
    const readAllowance = vi
      .fn()
      .mockResolvedValueOnce("999")
      .mockResolvedValueOnce("999")
      .mockResolvedValueOnce("1000");
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForSufficientAllowance({
        requiredAmount: "1000",
        readAllowance,
        wait,
        ...retryOptions,
      }),
    ).resolves.toBe("1000");
    expect(readAllowance).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 10);
    expect(wait).toHaveBeenNthCalledWith(2, 20);
  });

  it("recovers from a transient read error", async () => {
    const readAllowance = vi
      .fn()
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce("1001");
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForSufficientAllowance({
        requiredAmount: "1000",
        readAllowance,
        wait,
        ...retryOptions,
      }),
    ).resolves.toBe("1001");
    expect(readAllowance).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(10);
  });

  it("cancels a deferred read when the approval context changes", async () => {
    let resolveAllowance: ((value: string) => void) | undefined;
    let isCurrent = true;
    const readAllowance = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAllowance = resolve;
        }),
    );
    const wait = vi.fn().mockResolvedValue(undefined);

    const verification = waitForSufficientAllowance({
      requiredAmount: "1000",
      readAllowance,
      isVerificationCurrent: () => isCurrent,
      wait,
      ...retryOptions,
    });
    isCurrent = false;
    resolveAllowance?.("1000");

    await expect(verification).rejects.toThrow(
      "Allowance verification context changed",
    );
    expect(readAllowance).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails after the bounded attempts are exhausted", async () => {
    const readAllowance = vi.fn().mockResolvedValue("999");
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForSufficientAllowance({
        requiredAmount: "1000",
        readAllowance,
        wait,
        ...retryOptions,
      }),
    ).rejects.toThrow(
      "Allowance remained below 1000 after 3 attempts (last observed 999)",
    );
    expect(readAllowance).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 10);
    expect(wait).toHaveBeenNthCalledWith(2, 20);
  });
});
