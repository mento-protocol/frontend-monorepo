import { formatUnits } from "viem";
import { getContractInfo, getAddressName } from "../utils/contract-registry";
import type { PatternRegistry } from "./types";

function formatTokenAmount(amount: string | number, decimals: number): string {
  try {
    const formatted = formatUnits(BigInt(amount), decimals);
    const num = parseFloat(formatted);

    // Use native Intl.NumberFormat for compact notation (K/M suffixes)
    const formatter = new Intl.NumberFormat("en-US", {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 4,
    });

    return formatter.format(num);
  } catch {
    return String(amount);
  }
}

export const reservePatterns: PatternRegistry = {
  "transferGold(address,uint256)": (contract, args) => {
    const [to, value] = args;
    if (!to || !value) return "Invalid transfer parameters";
    const toName = getAddressName(String(to.value));
    const formattedAmount = formatTokenAmount(String(value.value), 18);
    return `Transfer ${formattedAmount} CELO from Mento Reserve to ${toName}`;
  },

  "transferCollateralAsset(address,address,uint256)": (contract, args) => {
    const [asset, to, value] = args;
    if (!asset || !to || !value) return "Invalid transfer parameters";
    const assetInfo = getContractInfo(String(asset.value));
    const assetName = assetInfo?.symbol || getAddressName(String(asset.value));
    const toName = getAddressName(String(to.value));
    const formattedAmount = formatTokenAmount(
      String(value.value),
      assetInfo?.decimals || 18,
    );
    return `Transfer ${formattedAmount} ${assetName} from Mento Reserve to ${toName}`;
  },

  "addToken(address)": (contract, args) => {
    const [token] = args;
    if (!token) return "Invalid addToken parameters";
    const tokenInfo = getContractInfo(String(token.value));
    const tokenName = tokenInfo?.symbol || getAddressName(String(token.value));
    return `Add ${tokenName} to Reserve tokens`;
  },

  "removeToken(address,uint256)": (contract, args) => {
    const [token] = args;
    if (!token) return "Invalid removeToken parameters";
    const tokenInfo = getContractInfo(String(token.value));
    const tokenName = tokenInfo?.symbol || getAddressName(String(token.value));
    return `Remove ${tokenName} from Reserve tokens`;
  },

  "addCollateralAsset(address)": (contract, args) => {
    const [asset] = args;
    if (!asset) return "Invalid addCollateralAsset parameters";
    const assetInfo = getContractInfo(String(asset.value));
    const assetName = assetInfo?.symbol || getAddressName(String(asset.value));
    return `Add ${assetName} as Reserve collateral asset`;
  },

  "removeCollateralAsset(address,uint256)": (contract, args) => {
    const [asset] = args;
    if (!asset) return "Invalid removeCollateralAsset parameters";
    const assetInfo = getContractInfo(String(asset.value));
    const assetName = assetInfo?.symbol || getAddressName(String(asset.value));
    return `Remove ${assetName} from Reserve collateral assets`;
  },

  "setAssetAllocations(bytes32[],uint256[])": () => {
    return `Update Reserve asset allocation weights`;
  },

  "setDailySpendingRatio(uint256)": (contract, args) => {
    const [ratio] = args;
    if (!ratio) return "Invalid spending ratio parameters";
    const percentage = ((Number(ratio.value) / 1e18) * 100).toFixed(2);
    return `Set Reserve daily spending limit to ${percentage}%`;
  },

  "addSpender(address)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid addSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Add ${spenderName} as Reserve spender`;
  },

  "removeSpender(address)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid removeSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Remove ${spenderName} from Reserve spenders`;
  },

  "addExchangeSpender(address)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid addExchangeSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Add ${spenderName} as Reserve exchange spender`;
  },

  "removeExchangeSpender(address,uint256)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid removeExchangeSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Remove ${spenderName} from Reserve exchange spenders`;
  },
};
