// Single source of truth lives in @repo/web3. Re-export from there so
// existing import paths keep working without drift risk.
export {
  DEBT_TOKEN_CONFIGS,
  getDebtTokenConfig,
  type DebtTokenConfig,
} from "@repo/web3";
