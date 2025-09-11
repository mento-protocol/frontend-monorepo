import { DecodedArg } from "../types/transaction";
import { getAddressName, getContractInfo } from "../hooks/useContractRegistry";
import {
  formatTokenAmount,
  getArgValue,
  getArgValueAsString,
  ContractParam,
} from "./utils";

/**
 * Reserve-related function translations
 */
export const reservePatterns: Record<
  string,
  (
    contract: ContractParam,
    args: DecodedArg[],
    value: string | number,
  ) => string
> = {
  // Reserve transfer functions
  "transferGold(address,uint256)": (contract, args) => {
    const to = getArgValue(args, 0);
    const value = getArgValue(args, 1);

    if (!to || !value) return "Invalid transfer parameters";

    const toName = getAddressName(getArgValueAsString(to));
    const formattedAmount = formatTokenAmount(getArgValueAsString(value), 18);
    return `Transfer ${formattedAmount} CELO from Mento Reserve to ${toName}`;
  },

  "transferCollateralAsset(address,address,uint256)": (contract, args) => {
    const asset = getArgValue(args, 0);
    const to = getArgValue(args, 1);
    const value = getArgValue(args, 2);

    if (!asset || !to || !value) return "Invalid transfer parameters";

    const assetInfo = getContractInfo(getArgValueAsString(asset));
    const assetName =
      assetInfo?.symbol || getAddressName(getArgValueAsString(asset));
    const toName = getAddressName(getArgValueAsString(to));
    const formattedAmount = formatTokenAmount(
      getArgValueAsString(value),
      assetInfo?.decimals || 18,
    );

    return `Transfer ${formattedAmount} ${assetName} from Mento Reserve to ${toName}`;
  },

  // Asset management
  "addToken(address)": (contract, args) => {
    const token = getArgValue(args, 0);
    if (!token) return "Invalid addToken parameters";

    const tokenInfo = getContractInfo(getArgValueAsString(token));
    const tokenName =
      tokenInfo?.symbol || getAddressName(getArgValueAsString(token));
    return `Add ${tokenName} to Reserve tokens`;
  },

  "removeToken(address,uint256)": (contract, args) => {
    const token = getArgValue(args, 0);
    if (!token) return "Invalid removeToken parameters";

    const tokenInfo = getContractInfo(getArgValueAsString(token));
    const tokenName =
      tokenInfo?.symbol || getAddressName(getArgValueAsString(token));
    return `Remove ${tokenName} from Reserve tokens`;
  },

  "addCollateralAsset(address)": (contract, args) => {
    const asset = getArgValue(args, 0);
    if (!asset) return "Invalid addCollateralAsset parameters";

    const assetInfo = getContractInfo(getArgValueAsString(asset));
    const assetName =
      assetInfo?.symbol || getAddressName(getArgValueAsString(asset));
    return `Add ${assetName} as Reserve collateral asset`;
  },

  "removeCollateralAsset(address,uint256)": (contract, args) => {
    const asset = getArgValue(args, 0);
    if (!asset) return "Invalid removeCollateralAsset parameters";

    const assetInfo = getContractInfo(getArgValueAsString(asset));
    const assetName =
      assetInfo?.symbol || getAddressName(getArgValueAsString(asset));
    return `Remove ${assetName} from Reserve collateral assets`;
  },

  // Configuration
  "setAssetAllocations(bytes32[],uint256[])": () => {
    return `Update Reserve asset allocation weights`;
  },

  "setDailySpendingRatio(uint256)": (contract, args) => {
    const ratio = getArgValue(args, 0);
    if (!ratio) return "Invalid spending ratio parameters";

    const percentage = ((Number(ratio.value) / 1e18) * 100).toFixed(2);
    return `Set Reserve daily spending limit to ${percentage}%`;
  },

  // Spender management
  "addSpender(address)": (contract, args) => {
    const spender = getArgValue(args, 0);
    if (!spender) return "Invalid addSpender parameters";

    const spenderName = getAddressName(getArgValueAsString(spender));
    return `Add ${spenderName} as Reserve spender`;
  },

  "removeSpender(address)": (contract, args) => {
    const spender = getArgValue(args, 0);
    if (!spender) return "Invalid removeSpender parameters";

    const spenderName = getAddressName(getArgValueAsString(spender));
    return `Remove ${spenderName} from Reserve spenders`;
  },

  "addExchangeSpender(address)": (contract, args) => {
    const spender = getArgValue(args, 0);
    if (!spender) return "Invalid addExchangeSpender parameters";

    const spenderName = getAddressName(getArgValueAsString(spender));
    return `Add ${spenderName} as Reserve exchange spender`;
  },

  "removeExchangeSpender(address,uint256)": (contract, args) => {
    const spender = getArgValue(args, 0);
    if (!spender) return "Invalid removeExchangeSpender parameters";

    const spenderName = getAddressName(getArgValueAsString(spender));
    return `Remove ${spenderName} from Reserve exchange spenders`;
  },
};
