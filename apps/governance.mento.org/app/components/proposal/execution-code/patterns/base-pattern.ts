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
) => string | null;

/**
 * Create a pattern function with standardized error handling.
 * Returns `null` when the shape of the decoded args doesn't match what the
 * pattern expects, so callers can fall back to the generic description
 * instead of rendering a misleading summary.
 */
export function createPattern(
  fn: (
    contract: ContractInfo,
    args: DecodedArg[],
    value?: string | number,
  ) => string | null,
  requiredArgsCount?: number,
  functionName?: string,
): StandardPatternFunction {
  return (
    contract: ContractInfo,
    args: DecodedArg[],
    value?: string | number,
  ): string | null => {
    try {
      // Validate arguments if specified
      if (requiredArgsCount !== undefined && functionName) {
        if (args.length < requiredArgsCount) {
          return null;
        }

        // Check that required arguments have values
        for (let i = 0; i < requiredArgsCount; i++) {
          if (
            !args[i] ||
            args[i]?.value === undefined ||
            args[i]?.value === null
          ) {
            return null;
          }
        }
      }

      return fn(contract, args, value);
    } catch (error) {
      console.error(
        `Pattern execution error for ${functionName || "unknown function"}:`,
        error,
      );
      return null;
    }
  };
}
