import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateLockAmountsFromWithdrawals } from "./calculate-lock-amounts-from-withdrawals";

const account = "0x00000000000000000000000000000000000000aa";
const week = 7 * 24 * 60 * 60;
function lock(
  id: string,
  options: {
    owner?: string;
    amount?: bigint;
    cliff?: number;
    slope?: number;
    expiryOffsetWeeks?: number;
    createdAt?: number;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    lockId: id,
    owner: { id: options.owner ?? account },
    delegate: { id: account },
    amount: String(options.amount ?? 104n * 10n ** 18n),
    cliff: options.cliff ?? 0,
    slope: options.slope ?? 104,
    expiration: new Date(
      (now + (options.expiryOffsetWeeks ?? 52) * week) * 1000,
    ),
    lockCreate:
      options.createdAt === undefined
        ? []
        : [{ timestamp: String(options.createdAt) }],
  } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("calculateLockAmountsFromWithdrawals", () => {
  it("handles missing locks and accounts", () => {
    expect(calculateLockAmountsFromWithdrawals([], [], account)).toEqual([]);
    expect(
      calculateLockAmountsFromWithdrawals([lock("1")], [], undefined),
    ).toEqual([]);
    expect(
      calculateLockAmountsFromWithdrawals(
        [lock("1", { owner: "0xother" })],
        [],
        account,
      ),
    ).toEqual([]);
  });

  it("keeps full amounts without withdrawals across cliff, slope, and expiry", () => {
    const result = calculateLockAmountsFromWithdrawals(
      [
        lock("cliff", { cliff: 10, slope: 20, expiryOffsetWeeks: 25 }),
        lock("slope", { cliff: 0, slope: 104, expiryOffsetWeeks: 52 }),
        lock("expired", { expiryOffsetWeeks: -1 }),
      ],
      [],
      account,
    );
    expect(result).toHaveLength(3);
    expect(result[0]?.withdrawn).toBe(0n);
    expect(result[0]?.currentVeMento).toBeGreaterThan(0n);
    expect(result[2]?.currentVeMento).toBe(0n);
  });

  it("uses the latest withdrawal and ignores newer locks", () => {
    const now = Math.floor(Date.now() / 1000);
    const withdrawals = [
      { timestamp: String(now - week) },
      { timestamp: String(now) },
    ] as never;
    const result = calculateLockAmountsFromWithdrawals(
      [
        lock("new", { createdAt: now + 1 }),
        lock("cliff", {
          cliff: 100,
          slope: 4,
          expiryOffsetWeeks: 103,
          createdAt: now - week,
        }),
      ],
      withdrawals,
      account,
    );
    expect(result[0]?.withdrawn).toBe(0n);
    expect(result[1]?.withdrawn).toBe(0n);
  });

  it("calculates partial and full withdrawals", () => {
    const now = Math.floor(Date.now() / 1000);
    const result = calculateLockAmountsFromWithdrawals(
      [
        lock("partial", {
          cliff: 0,
          slope: 10,
          expiryOffsetWeeks: 5,
          createdAt: now - 20 * week,
        }),
        lock("expiredAtWithdrawal", {
          cliff: 0,
          slope: 1,
          expiryOffsetWeeks: -1,
          createdAt: now - 20 * week,
        }),
      ],
      [{ timestamp: String(now) }] as never,
      account,
    );
    expect(result[0]?.withdrawn).toBeGreaterThan(0n);
    expect(result[0]?.remainingMento).toBeGreaterThan(0n);
    expect(result[1]?.remainingMento).toBe(0n);
  });
});
