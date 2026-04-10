// Single source of truth lives in @repo/web3. Re-export from there so
// server-side route utilities and client components share the same registry.
export {
  type DebtTokenConfig,
  DEBT_TOKEN_CONFIGS,
  getDebtTokenConfig,
} from "@repo/web3";
