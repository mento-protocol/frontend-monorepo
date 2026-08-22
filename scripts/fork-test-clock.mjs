const HOUR_SECONDS = 3_600n;
const DAY_SECONDS = 24n * HOUR_SECONDS;

const FX_OPEN_RUNWAY_SECONDS = 2n * HOUR_SECONDS;
const FX_CLOCK_SEARCH_LIMIT_SECONDS = 8n * DAY_SECONDS;

function exactTimestamp(value, name) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error(`${name} must be a non-negative integer timestamp`);
}

function utcDate(timestampSeconds) {
  const timestamp = exactTimestamp(timestampSeconds, "timestampSeconds");
  const date = new Date(Number(timestamp) * 1_000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("timestampSeconds is outside the supported UTC range");
  }
  return date;
}

function nextUtcHour(timestampSeconds) {
  const timestamp = exactTimestamp(timestampSeconds, "timestampSeconds");
  const remainder = timestamp % HOUR_SECONDS;
  return remainder === 0n ? timestamp : timestamp + HOUR_SECONDS - remainder;
}

/**
 * Reproduces the deployed MarketHoursBreaker UTC calendar.
 *
 * @param {bigint | number} timestampSeconds
 */
export function isFxMarketOpen(timestampSeconds) {
  const date = utcDate(timestampSeconds);
  const month = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  const dayOfWeek = date.getUTCDay();
  const hour = date.getUTCHours();

  if (
    (month === 1 && dayOfMonth === 1) ||
    (month === 12 && dayOfMonth === 25)
  ) {
    return false;
  }
  if (month === 12 && (dayOfMonth === 24 || dayOfMonth === 31) && hour >= 22) {
    return false;
  }
  if (dayOfWeek === 5 && hour >= 21) return false;
  if (dayOfWeek === 6) return false;
  if (dayOfWeek === 0 && hour < 23) return false;
  return true;
}

/**
 * Returns true only when the complete interval stays inside an open FX window.
 * MarketHoursBreaker transitions occur on exact UTC hours, so checking each
 * hour boundary and the interval end covers the full interval.
 *
 * @param {bigint | number} timestampSeconds
 * @param {bigint | number} runwaySeconds
 */
export function hasFxOpenRunway(
  timestampSeconds,
  runwaySeconds = FX_OPEN_RUNWAY_SECONDS,
) {
  const timestamp = exactTimestamp(timestampSeconds, "timestampSeconds");
  const runway = exactTimestamp(runwaySeconds, "runwaySeconds");
  if (!isFxMarketOpen(timestamp)) return false;

  const end = timestamp + runway;
  let checkpoint = nextUtcHour(timestamp);
  if (checkpoint === timestamp) checkpoint += HOUR_SECONDS;
  while (checkpoint <= end) {
    if (!isFxMarketOpen(checkpoint)) return false;
    checkpoint += HOUR_SECONDS;
  }
  return isFxMarketOpen(end);
}

/**
 * Selects an advance-only fork timestamp with a complete open-market runway.
 *
 * @param {{forkTimestamp: bigint | number, wallTimestamp: bigint | number, runwaySeconds?: bigint | number, maxSearchSeconds?: bigint | number}} options
 */
export function selectSafeFxForkTimestamp({
  forkTimestamp,
  wallTimestamp,
  runwaySeconds = FX_OPEN_RUNWAY_SECONDS,
  maxSearchSeconds = FX_CLOCK_SEARCH_LIMIT_SECONDS,
}) {
  const fork = exactTimestamp(forkTimestamp, "forkTimestamp");
  const wall = exactTimestamp(wallTimestamp, "wallTimestamp");
  const runway = exactTimestamp(runwaySeconds, "runwaySeconds");
  const maxSearch = exactTimestamp(maxSearchSeconds, "maxSearchSeconds");
  const start = fork > wall ? fork : wall;

  if (hasFxOpenRunway(start, runway)) {
    return {
      reason:
        fork > wall ? "preserved-safe-fork-time" : "wall-time-open-with-runway",
      targetTimestamp: start,
    };
  }

  const reason = isFxMarketOpen(start)
    ? "advanced-for-open-market-runway"
    : "advanced-from-closed-market";
  const searchEnd = start + maxSearch;
  for (
    let candidate = nextUtcHour(start);
    candidate <= searchEnd;
    candidate += HOUR_SECONDS
  ) {
    if (hasFxOpenRunway(candidate, runway)) {
      return { reason, targetTimestamp: candidate };
    }
  }
  throw new Error(
    `No FX-open fork timestamp with ${runway}s runway found within ${maxSearch}s after ${start}`,
  );
}

/**
 * Derives an on-chain deadline from the fork clock instead of the runner clock.
 *
 * @param {bigint | number} blockTimestamp
 * @param {bigint | number} ttlSeconds
 */
export function forkDeadline(blockTimestamp, ttlSeconds = HOUR_SECONDS) {
  const timestamp = exactTimestamp(blockTimestamp, "blockTimestamp");
  const ttl = exactTimestamp(ttlSeconds, "ttlSeconds");
  if (ttl === 0n) throw new Error("ttlSeconds must be greater than zero");
  return timestamp + ttl;
}
