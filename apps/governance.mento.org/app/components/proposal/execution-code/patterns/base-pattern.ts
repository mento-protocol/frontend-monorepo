import type { DecodedArg, ContractInfo } from "./types";

// Constants for common values
export const DEFAULT_TOKEN_DECIMALS = 18;

/**
 * Simple pattern function type that uses the base pattern error handling
 */
type StandardPatternFunction = (
  contract: ContractInfo,
  args: DecodedArg[],
  value?: string | number,
) => string;

/**
 * Create a pattern function with standardized error handling
 */
export function createPattern(
  fn: (
    contract: ContractInfo,
    args: DecodedArg[],
    value?: string | number,
  ) => string,
  requiredArgsCount?: number,
  functionName?: string,
): StandardPatternFunction {
  return (
    contract: ContractInfo,
    args: DecodedArg[],
    value?: string | number,
  ): string => {
    try {
      // Validate arguments if specified
      if (requiredArgsCount !== undefined && functionName) {
        if (args.length < requiredArgsCount) {
          return `Error: ${functionName} requires at least ${requiredArgsCount} arguments, got ${args.length}`;
        }

        // Check that required arguments have values
        for (let i = 0; i < requiredArgsCount; i++) {
          if (
            !args[i] ||
            args[i]?.value === undefined ||
            args[i]?.value === null
          ) {
            return `Error: Missing required argument ${i + 1} for ${functionName}`;
          }
        }
      }

      return fn(contract, args, value);
    } catch (error) {
      console.error(
        `Pattern execution error for ${functionName || "unknown function"}:`,
        error,
      );
      return `Error: Failed to process ${functionName || "function"} call`;
    }
  };
}
