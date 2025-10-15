export interface DecodedArg {
  name: string;
  type: string;
  value: string | number | boolean | bigint;
}

export interface ContractInfo {
  address: string;
}

// knip ignore because it doesn't understand the implicit need of the PatternManagerImpl of this interface
/** @public */
export interface PatternFunction {
  (contract: ContractInfo, args: DecodedArg[], value: string | number): string;
}

export type PatternRegistry = Record<string, PatternFunction>;

export interface PatternCategory {
  name: string;
  patterns: PatternRegistry;
}

export interface PatternManager {
  getPattern(signature: string): PatternFunction | undefined;
  getAllPatterns(): PatternRegistry;
  getCategoryPatterns(category: string): PatternRegistry;
}
