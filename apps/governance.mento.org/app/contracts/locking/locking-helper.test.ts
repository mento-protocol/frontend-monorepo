import { addWeeks, isWednesday, nextWednesday, startOfWeek } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LockingHelper from "./locking-helper";

// A known Wednesday used to pin "now" so week-based arithmetic is deterministic.
const PINNED_NOW = new Date("2026-07-01T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calculateMaxExtensionWeeks", () => {
  it("returns 0 when lockTime is undefined", () => {
    expect(LockingHelper.calculateMaxExtensionWeeks(10, undefined, 100)).toBe(
      0,
    );
  });

  it("returns 0 when lockSlope is undefined", () => {
    expect(LockingHelper.calculateMaxExtensionWeeks(10, 5, undefined)).toBe(0);
  });

  it("computes remaining weeks plus weeks passed for typical values", () => {
    // 104 - 100 + (10 - 5) = 4 + 5 = 9
    expect(LockingHelper.calculateMaxExtensionWeeks(10, 5, 100)).toBe(9);
  });

  it("clamps to 0 when the slope exceeds the remaining budget", () => {
    expect(LockingHelper.calculateMaxExtensionWeeks(5, 5, 110)).toBe(0);
  });

  it("returns 0 at the boundary where lockSlope equals the max duration", () => {
    expect(LockingHelper.calculateMaxExtensionWeeks(5, 5, 104)).toBe(0);
  });
});

describe("calculateExpirationDate", () => {
  it("expires N weeks after the pinned now's week start for a typical lock", () => {
    const startOfCurrentWeek = startOfWeek(PINNED_NOW, { weekStartsOn: 3 });
    // weeksPassed (10 - 8 = 2) cancels out with totalLockDuration (0 + 4 = 4),
    // leaving the expiration 2 weeks after the current week start.
    const expected = addWeeks(startOfCurrentWeek, 2);

    expect(LockingHelper.calculateExpirationDate(10, 8, 0, 4)).toEqual(
      expected,
    );
  });

  it("handles a max-cliff lock", () => {
    const startOfCurrentWeek = startOfWeek(PINNED_NOW, { weekStartsOn: 3 });
    // weeksPassed is 0, totalLockDuration is 103 + 1 = 104
    const expected = addWeeks(startOfCurrentWeek, 104);

    expect(LockingHelper.calculateExpirationDate(5, 5, 103, 1)).toEqual(
      expected,
    );
  });
});

describe("getDateInFutureAsWeeks", () => {
  it("returns 0 for a date in the past", () => {
    const pastDate = new Date(PINNED_NOW.getTime() - 1000 * 60 * 60);
    expect(LockingHelper.getDateInFutureAsWeeks(pastDate)).toBe(0);
  });

  it("returns N for a date exactly N weeks ahead (floor rounding)", () => {
    const futureDate = addWeeks(PINNED_NOW, 5);
    expect(LockingHelper.getDateInFutureAsWeeks(futureDate)).toBe(5);
  });
});

describe("addYearsAndAdjustToNextWednesday", () => {
  it("returns the same date when it already falls on a Wednesday", () => {
    expect(isWednesday(PINNED_NOW)).toBe(true);
    const result = LockingHelper.addYearsAndAdjustToNextWednesday(
      0,
      PINNED_NOW,
    );
    expect(result).toEqual(PINNED_NOW);
  });

  it("moves forward to the next Wednesday when the input is not a Wednesday", () => {
    const thursday = new Date("2026-07-02T12:00:00Z");
    expect(isWednesday(thursday)).toBe(false);

    const result = LockingHelper.addYearsAndAdjustToNextWednesday(0, thursday);
    expect(result).toEqual(nextWednesday(thursday));
  });
});
