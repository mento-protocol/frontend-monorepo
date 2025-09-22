import type { PatternRegistry } from "./types";
import { createPattern, DEFAULT_TOKEN_DECIMALS } from "./base-pattern";
import {
  getContractInfo,
  getAddressNameFromCache,
} from "../../services/address-resolver-service";
import { formatTokenAmount } from "./utils";

export const reservePatterns: PatternRegistry = {
  "transferGold(address,uint256)": createPattern(
    (contract, args) => {
      const [to, value] = args;
      const toName = getAddressNameFromCache(String(to!.value));
      const formattedAmount = formatTokenAmount(String(value!.value), 18);
      return `Transfer ${formattedAmount} CELO from Mento Reserve to ${toName}`;
    },
    2,
    "transferGold",
  ),

  "transferCollateralAsset(address,address,uint256)": createPattern(
    (contract, args) => {
      const [asset, to, value] = args;
      const assetInfo = getContractInfo(String(asset!.value));
      const assetName =
        assetInfo?.symbol || getAddressNameFromCache(String(asset!.value));
      const toName = getAddressNameFromCache(String(to!.value));
      const formattedAmount = formatTokenAmount(
        String(value!.value),
        assetInfo?.decimals || DEFAULT_TOKEN_DECIMALS,
      );
      return `Transfer ${formattedAmount} ${assetName} from Mento Reserve to ${toName}`;
    },
    3,
    "transferCollateralAsset",
  ),

  "addToken(address)": createPattern(
    (contract, args) => {
      const [token] = args;
      const tokenInfo = getContractInfo(String(token!.value));
      const tokenName =
        tokenInfo?.symbol || getAddressNameFromCache(String(token!.value));
      return `Add ${tokenName} to Reserve tokens`;
    },
    1,
    "addToken",
  ),

  "removeToken(address,uint256)": createPattern(
    (contract, args) => {
      const [token] = args;
      const tokenInfo = getContractInfo(String(token!.value));
      const tokenName =
        tokenInfo?.symbol || getAddressNameFromCache(String(token!.value));
      return `Remove ${tokenName} from Reserve tokens`;
    },
    2,
    "removeToken",
  ),

  "addCollateralAsset(address)": createPattern(
    (contract, args) => {
      const [asset] = args;
      const assetInfo = getContractInfo(String(asset!.value));
      const assetName =
        assetInfo?.symbol || getAddressNameFromCache(String(asset!.value));
      return `Add ${assetName} as Reserve collateral asset`;
    },
    1,
    "addCollateralAsset",
  ),

  "removeCollateralAsset(address,uint256)": createPattern(
    (contract, args) => {
      const [asset] = args;
      const assetInfo = getContractInfo(String(asset!.value));
      const assetName =
        assetInfo?.symbol || getAddressNameFromCache(String(asset!.value));
      return `Remove ${assetName} from Reserve collateral assets`;
    },
    2,
    "removeCollateralAsset",
  ),

  "setAssetAllocations(bytes32[],uint256[])": createPattern(
    () => {
      return `Update Reserve asset allocation weights`;
    },
    0,
    "setAssetAllocations",
  ),

  "setDailySpendingRatio(uint256)": createPattern(
    (contract, args) => {
      const [ratio] = args;
      const percentage = ((Number(ratio!.value) / 1e18) * 100).toFixed(2);
      return `Set Reserve daily spending limit to ${percentage}%`;
    },
    1,
    "setDailySpendingRatio",
  ),

  "addSpender(address)": createPattern(
    (contract, args) => {
      const [spender] = args;
      const spenderName = getAddressNameFromCache(String(spender!.value));
      return `Add ${spenderName} as Reserve spender`;
    },
    1,
    "addSpender",
  ),

  "removeSpender(address)": createPattern(
    (contract, args) => {
      const [spender] = args;
      const spenderName = getAddressNameFromCache(String(spender!.value));
      return `Remove ${spenderName} from Reserve spenders`;
    },
    1,
    "removeSpender",
  ),

  "addExchangeSpender(address)": createPattern(
    (contract, args) => {
      const [spender] = args;
      const spenderName = getAddressNameFromCache(String(spender!.value));
      return `Add ${spenderName} as Reserve exchange spender`;
    },
    1,
    "addExchangeSpender",
  ),

  "removeExchangeSpender(address,uint256)": createPattern(
    (contract, args) => {
      const [spender] = args;
      const spenderName = getAddressNameFromCache(String(spender!.value));
      return `Remove ${spenderName} from Reserve exchange spenders`;
    },
    2,
    "removeExchangeSpender",
  ),
};
