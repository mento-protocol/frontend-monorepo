import { keccak256, encodePacked } from "viem";

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
        ("0x" + "0".repeat(64)) as `0x${string}`,
      ],
    ),
  );
}
