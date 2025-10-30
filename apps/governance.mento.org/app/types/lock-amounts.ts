/**
 * Type definitions for lock amounts calculated from withdrawal events
 */

/**
 * Represents the calculated amounts for a single lock
 */
export interface LockAmounts {
  /** The unique identifier for the lock */
  lockId: string;

  /** The exact remaining MENTO amount in this lock (in wei) */
  remainingMento: bigint;

  /** The current veMENTO amount based on remaining MENTO and time until expiration (in wei) */
  currentVeMento: bigint;

  /** The original locked amount when the lock was created (in wei) */
  originalAmount: bigint;

  /** The total amount that has been withdrawn from this lock (in wei) */
  withdrawn: bigint;
}

/**
 * Result returned by useLockAmountsFromWithdrawals hook
 */
export interface UseLockAmountsFromWithdrawalsResult {
  /** Array of lock amounts for all locks */
  lockAmounts: LockAmounts[];

  /** Map for O(1) lookup of lock amounts by lockId */
  lockAmountsMap: Map<string, LockAmounts>;

  /** Loading state while fetching withdrawal events */
  loading: boolean;

  /** Error if the withdrawal events query failed */
  error?: Error;
}

/**
 * Example usage:
 *
 * ```typescript
 * const { lockAmountsMap, loading } = useLockAmountsFromWithdrawals({
 *   locks,
 *   address,
 * });
 *
 * if (loading) return <Spinner />;
 *
 * const amounts = lockAmountsMap.get("123");
 * if (amounts) {
 *   console.log("Remaining:", formatUnits(amounts.remainingMento, 18));
 *   console.log("veMENTO:", formatUnits(amounts.currentVeMento, 18));
 *   console.log("Withdrawn:", formatUnits(amounts.withdrawn, 18));
 * }
 * ```
 */
