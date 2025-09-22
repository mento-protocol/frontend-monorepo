export interface DecodedArg {
  name: string;
  type: string;
  value: string | number | boolean | bigint;
}

export interface ContractInfo {
  address: string;
}

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
