import {
  getContractInfo,
  getAddressNameFromCache,
} from "../../services/address-resolver-service";
import type { DecodedArg, ContractInfo } from "./types";

// Constants for common values
export const DEFAULT_TOKEN_DECIMALS = 18;

/**
 * Base class for pattern functions with standardized error handling
 */
export abstract class BasePattern {
  /**
   * Standardized error handling for pattern functions
   */
  protected handleError(context: string, details?: string): string {
    const message = details ? `${context}: ${details}` : context;
    console.warn(`Pattern error - ${message}`);
    return `Error: ${message}`;
  }

  /**
   * Validate that required arguments are present
   */
  protected validateArgs(args: DecodedArg[], requiredCount: number): boolean {
    if (args.length < requiredCount) {
      return false;
    }

    // Check that required arguments have values
    for (let i = 0; i < requiredCount; i++) {
      if (!args[i] || args[i]!.value === undefined || args[i]!.value === null) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get contract information with fallback
   */
  protected getContractInfo(
    address: string,
  ): { name?: string; symbol?: string; decimals?: number } | null {
    return getContractInfo(address);
  }

  /**
   * Get address name synchronously
   */
  protected getAddressName(address: string): string {
    return getAddressNameFromCache(address);
  }

  /**
   * Get token decimals with fallback to default
   */
  protected getTokenDecimals(
    contractInfo: { decimals?: number } | null,
  ): number {
    return contractInfo?.decimals || DEFAULT_TOKEN_DECIMALS;
  }

  /**
   * Get token symbol with fallback
   */
  protected getTokenSymbol(contractInfo: { symbol?: string } | null): string {
    return contractInfo?.symbol || "tokens";
  }

  /**
   * Abstract method that subclasses must implement
   */
  abstract execute(
    contract: ContractInfo,
    args: DecodedArg[],
    value?: string | number,
  ): string;
}

/**
 * Simple pattern function type that uses the base pattern error handling
 */
export type StandardPatternFunction = (
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

/**
 * Helper function to safely get argument value (validated by createPattern)
 */
export function getArgValue(
  arg: DecodedArg,
): string | number | boolean | bigint {
  return arg.value;
}

/**
 * Type-safe pattern function that ensures arguments are validated
 */
export type SafePatternFunction = (
  contract: ContractInfo,
  args: (DecodedArg & { value: NonNullable<DecodedArg["value"]> })[],
  value?: string | number,
) => string;
