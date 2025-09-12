import type { Abi } from "viem";

// Server-side ABI validation function (duplicated from @repo/web3 to avoid client-side import issues)
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
