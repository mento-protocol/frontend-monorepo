import { keccak256, encodePacked } from "viem";

/**
 * Zero salt used by the Governor contract for proposal hashing.
 * The Governor contract uses a zero salt (0x00...00) when creating proposal IDs,
 * which allows the same proposal to be queued in the Timelock only once.
 */
const TIMELOCK_SALT = ("0x" + "0".repeat(64)) as `0x${string}`;

/**
 * Calculate the operation ID for a timelock operation.
 * This matches the hashing algorithm used by the TimelockController contract.
 *
 * @param targets - Array of target contract addresses
 * @param values - Array of ETH values to send
 * @param calldatas - Array of encoded function call data
 * @param descriptionHash - Hash of the proposal description
 * @returns The operation ID (bytes32)
 */
export function getTimelockOperationId(
  targets: readonly string[],
  values: readonly bigint[],
  calldatas: readonly `0x${string}`[],
  descriptionHash: `0x${string}`,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
      [
        targets as readonly `0x${string}`[],
        values,
        calldatas,
        descriptionHash,
        TIMELOCK_SALT,
      ],
    ),
  );
}
