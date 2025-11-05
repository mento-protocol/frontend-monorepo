import { tokenPatterns } from "./token-patterns";
import { oraclePatterns } from "./oracle-patterns";
import { governancePatterns } from "./governance-patterns";
import { reservePatterns } from "./reserve-patterns";
import { proxyPatterns } from "./proxy-patterns";
import { utilityPatterns } from "./utility-patterns";
import type { PatternRegistry, PatternManager, PatternCategory } from "./types";
// Combine all pattern categories
const patternCategories: Record<string, PatternCategory> = {
  token: {
    name: "Token Operations",
    patterns: tokenPatterns,
  },
  oracle: {
    name: "Oracle Management",
    patterns: oraclePatterns,
  },
  governance: {
    name: "Governance Operations",
    patterns: governancePatterns,
  },
  reserve: {
    name: "Reserve Management",
    patterns: reservePatterns,
  },
  proxy: {
    name: "Proxy Administration",
    patterns: proxyPatterns,
  },
  utility: {
    name: "Utility Functions",
    patterns: utilityPatterns,
  },
};

// Create the combined pattern registry
const allPatterns: PatternRegistry = Object.values(patternCategories).reduce(
  (acc, category) => ({ ...acc, ...category.patterns }),
  {} as PatternRegistry,
);

// Pattern manager implementation
class PatternManagerImpl implements PatternManager {
  getPattern(signature: string) {
    return allPatterns[signature];
  }

  getAllPatterns(): PatternRegistry {
    return { ...allPatterns };
  }

  getCategoryPatterns(category: string): PatternRegistry {
    return patternCategories[category]?.patterns || {};
  }

  getCategories(): Record<string, PatternCategory> {
    return { ...patternCategories };
  }
}

// Export the singleton instance
export const patternManager = new PatternManagerImpl();

// Export individual pattern categories for direct access if needed

// Export the combined patterns for backward compatibility
