import { Abi } from "viem";

/**
 * Type guard to check if an unknown value is a valid ABI array
 * @param abi - The value to check
 * @returns True if the value is a valid ABI array, false otherwise
 */
export function isAbi(abi: unknown): abi is Abi {
  return (
    Array.isArray(abi) &&
    abi.every((item) => {
      return (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        typeof (item as { type: string }).type === "string"
      );
    })
  );
}
