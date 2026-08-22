import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forkDeadline,
  hasFxOpenRunway,
  isFxMarketOpen,
  selectSafeFxForkTimestamp,
} from "./fork-test-clock.mjs";

const utc = (value) => BigInt(Date.parse(value) / 1_000);

test("matches every MarketHoursBreaker weekend boundary", () => {
  assert.equal(isFxMarketOpen(utc("2026-08-21T20:59:59Z")), true);
  assert.equal(isFxMarketOpen(utc("2026-08-21T21:00:00Z")), false);
  assert.equal(isFxMarketOpen(utc("2026-08-22T12:00:00Z")), false);
  assert.equal(isFxMarketOpen(utc("2026-08-23T22:59:59Z")), false);
  assert.equal(isFxMarketOpen(utc("2026-08-23T23:00:00Z")), true);
});

test("matches every MarketHoursBreaker year-end holiday boundary", () => {
  assert.equal(isFxMarketOpen(utc("2026-12-24T21:59:59Z")), true);
  assert.equal(isFxMarketOpen(utc("2026-12-24T22:00:00Z")), false);
  assert.equal(isFxMarketOpen(utc("2026-12-25T12:00:00Z")), false);
  assert.equal(isFxMarketOpen(utc("2026-12-31T21:59:59Z")), true);
  assert.equal(isFxMarketOpen(utc("2026-12-31T22:00:00Z")), false);
  assert.equal(isFxMarketOpen(utc("2026-01-01T12:00:00Z")), false);
});

test("requires the complete two-hour interval to stay open", () => {
  assert.equal(hasFxOpenRunway(utc("2026-08-21T18:59:59Z")), true);
  assert.equal(hasFxOpenRunway(utc("2026-08-21T19:00:00Z")), false);
});

test("moves the observed Saturday failure to the exact Sunday opening", () => {
  assert.deepEqual(
    selectSafeFxForkTimestamp({
      forkTimestamp: 1_787_421_695n,
      wallTimestamp: 1_787_421_720n,
    }),
    {
      reason: "advanced-from-closed-market",
      targetTimestamp: 1_787_526_000n,
    },
  );
});

test("searches safely across a holiday and weekend combination", () => {
  const selected = selectSafeFxForkTimestamp({
    forkTimestamp: utc("2027-12-24T20:59:00Z"),
    wallTimestamp: utc("2027-12-24T21:00:00Z"),
  });
  assert.equal(selected.targetTimestamp, utc("2027-12-26T23:00:00Z"));
});

test("fails clearly when the bounded search cannot reach an opening", () => {
  assert.throws(
    () =>
      selectSafeFxForkTimestamp({
        forkTimestamp: utc("2026-08-22T12:00:00Z"),
        wallTimestamp: utc("2026-08-22T12:00:00Z"),
        maxSearchSeconds: 3_600n,
      }),
    /No FX-open fork timestamp/,
  );
});

test("preserves a safe ahead-of-wall fork timestamp on the second seed", () => {
  const selected = selectSafeFxForkTimestamp({
    forkTimestamp: utc("2026-08-23T23:05:00Z"),
    wallTimestamp: utc("2026-08-22T18:05:00Z"),
  });
  assert.deepEqual(selected, {
    reason: "preserved-safe-fork-time",
    targetTimestamp: utc("2026-08-23T23:05:00Z"),
  });
});

test("advances an unsafe ahead-of-wall fork and never rewinds", () => {
  const forkTimestamp = utc("2026-08-23T22:59:00Z");
  const selected = selectSafeFxForkTimestamp({
    forkTimestamp,
    wallTimestamp: utc("2026-08-22T18:05:00Z"),
  });
  assert.equal(selected.targetTimestamp, utc("2026-08-23T23:00:00Z"));
  assert.ok(selected.targetTimestamp > forkTimestamp);
});

test("uses an open wall timestamp when it has enough runway", () => {
  const wallTimestamp = utc("2026-08-20T12:34:56Z");
  assert.deepEqual(
    selectSafeFxForkTimestamp({
      forkTimestamp: wallTimestamp - 600n,
      wallTimestamp,
    }),
    { reason: "wall-time-open-with-runway", targetTimestamp: wallTimestamp },
  );
});

test("derives raw seed-swap deadlines from the selected fork clock", () => {
  const selectedForkTime = utc("2026-08-23T23:00:00Z");
  const runnerTime = utc("2026-08-22T18:02:00Z");
  const deadline = forkDeadline(selectedForkTime);
  assert.equal(deadline, selectedForkTime + 3_600n);
  assert.ok(deadline > runnerTime + 3_600n);
});
