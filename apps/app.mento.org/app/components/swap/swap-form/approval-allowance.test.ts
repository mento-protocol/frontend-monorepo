import { describe, expect, it, vi } from "vitest";

import { waitForSufficientAllowance } from "./approval-allowance";

const retryOptions = {
  initialRetryDelayMs: 10,
  maxAttempts: 3,
};

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
