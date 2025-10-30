# Withdrawal Calculation Fix

## Issues Identified

1. **Expired locks showing original amount**: Locks that had withdrawals after expiration were not being processed because the algorithm excluded locks where `expiryTimestamp <= withdrawalTimestamp`.

2. **Active locks showing 0 MENTO**: The algorithm was processing withdrawals in reverse chronological order (newest first) and subtracting from remaining amounts, which was backwards.

3. **Delegated locks showing 0**: Same root cause as issue #2.

## Root Cause

The original algorithm had two fundamental flaws:

### Flaw 1: Processing Order

```typescript
// WRONG: Newest to oldest
const sortedWithdrawals = [...withdrawals].sort(
  (a, b) => Number(b.timestamp) - Number(a.timestamp),
);
```

This caused the algorithm to process recent withdrawals first and work backwards, which doesn't match the actual chronological flow of events.

### Flaw 2: Expiry Check

```typescript
// WRONG: Excluded expired locks
return (
  lockCreateTimestamp <= withdrawalTimestamp &&
  expiryTimestamp > withdrawalTimestamp // ❌ This prevented processing expired locks
);
```

This prevented locks from being included in withdrawal calculations if the withdrawal happened after the lock expired, even though the withdrawal could have come from that lock.

## Solution

### Fix 1: Chronological Processing

```typescript
// CORRECT: Oldest to newest
const sortedWithdrawals = [...withdrawals].sort(
  (a, b) => Number(a.timestamp) - Number(b.timestamp),
);
```

Process withdrawals in the order they actually occurred.

### Fix 2: Remove Expiry Check

```typescript
// CORRECT: Include all locks that existed at withdrawal time
return lockCreateTimestamp <= withdrawalTimestamp;
```

A lock should be included in withdrawal calculations if it existed at the time of withdrawal, regardless of whether it had expired.

### Fix 3: Track Withdrawals, Not Remaining

```typescript
// WRONG: Track remaining and subtract
const lockAmountsMap = new Map<string, bigint>();
for (const lock of ownedLocks) {
  lockAmountsMap.set(lock.lockId, BigInt(lock.amount));
}
// ... subtract withdrawals from remaining

// CORRECT: Track total withdrawn and calculate remaining
const withdrawnMap = new Map<string, bigint>();
for (const lock of ownedLocks) {
  withdrawnMap.set(lock.lockId, 0n);
}
// ... add to withdrawn amounts
// Then: remaining = original - withdrawn
```

## Algorithm Flow (After Fix)

1. **Initialize**: Track total withdrawn per lock (starts at 0)

2. **Process withdrawals chronologically** (oldest → newest):
   - For each withdrawal at timestamp T:
     - Find all locks that existed at time T (created before T)
     - Calculate vested amount for each lock at time T
     - Allocate withdrawal proportionally based on vested amounts
     - Add allocated amount to each lock's total withdrawn

3. **Calculate final amounts**:
   - For each lock:
     - `remaining = original - totalWithdrawn`
     - `veMENTO = calculateVeMento(remaining, timeUntilExpiry)`

## Example Scenario

User has 2 locks:

- Lock A: Created Jan 1, 100 MENTO, expires Mar 1
- Lock B: Created Feb 1, 200 MENTO, expires Apr 1

Withdrawals:

- Feb 15: Withdraw 50 MENTO
- Mar 15: Withdraw 100 MENTO

### Processing Feb 15 Withdrawal (50 MENTO)

- Lock A exists: 50% vested (50 MENTO)
- Lock B exists: 10% vested (20 MENTO)
- Total vested: 70 MENTO
- Allocation:
  - Lock A: (50/70) × 50 = 35.7 MENTO withdrawn
  - Lock B: (20/70) × 50 = 14.3 MENTO withdrawn

### Processing Mar 15 Withdrawal (100 MENTO)

- Lock A exists: 100% vested (expired, 100 MENTO)
- Lock B exists: 40% vested (80 MENTO)
- Total vested: 180 MENTO
- Allocation:
  - Lock A: (100/180) × 100 = 55.6 MENTO withdrawn
  - Lock B: (80/180) × 100 = 44.4 MENTO withdrawn

### Final Amounts

- Lock A: 100 - (35.7 + 55.6) = 8.7 MENTO remaining
- Lock B: 200 - (14.3 + 44.4) = 141.3 MENTO remaining

## Testing Recommendations

Test cases to verify:

1. **Expired locks with post-expiry withdrawals**
   - Lock expires at T1
   - Withdrawal at T2 (T2 > T1)
   - Expected: Lock should show 0 remaining (fully withdrawn)

2. **Active locks with partial withdrawals**
   - Lock still vesting
   - Partial withdrawal occurred
   - Expected: Lock shows reduced amount, not 0

3. **Multiple locks with multiple withdrawals**
   - Verify proportional allocation is correct
   - Verify sum of remaining amounts matches expected total

4. **Delegated locks (received from others)**
   - Should show original amount (no withdrawal tracking for other owners)
   - Expected: Full original amount displayed
