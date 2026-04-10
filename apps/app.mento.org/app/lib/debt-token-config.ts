// Single source of truth lives in @repo/web3/borrow-server — a server-safe
// entry point with no "use client" transitive dependencies. Re-export from
// there so server-side route utilities and client components share the same
// registry without pulling in wagmi/react client code.
export {
  type DebtTokenConfig,
  DEBT_TOKEN_CONFIGS,
  getDebtTokenConfig,
} from "@repo/web3/borrow-server";
