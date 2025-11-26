import { parseAbi } from "viem";

/**
 * Reserve contract ABI
 * Includes methods for checking collateral assets and managing reserve operations
 */
export const ReserveABI = parseAbi([
  // Collateral asset check
  "function isCollateralAsset(address collateralAsset) view returns (bool)",

  // Transfer functions
  "function transferGold(address to, uint256 value) returns (bool)",
  "function transferCollateralAsset(address collateralAsset, address to, uint256 value) returns (bool)",
  "function transferExchangeGold(address to, uint256 value) returns (bool)",
  "function transferExchangeCollateralAsset(address collateralAsset, address to, uint256 value) returns (bool)",

  // Asset management
  "function addToken(address token) returns (bool)",
  "function removeToken(address token, uint256 index) returns (bool)",
  "function addCollateralAsset(address collateralAsset) returns (bool)",
  "function removeCollateralAsset(address collateralAsset, uint256 index) returns (bool)",

  // Configuration
  "function setAssetAllocations(bytes32[] symbols, uint256[] weights)",
  "function setDailySpendingRatio(uint256 ratio)",
  "function setDailySpendingRatioForCollateralAssets(address[] _collateralAssets, uint256[] collateralAssetDailySpendingRatios)",
  "function setFrozenGold(uint256 frozenGold, uint256 frozenDays)",
  "function setTobinTax(uint256 value)",
  "function setTobinTaxReserveRatio(uint256 value)",
  "function setTobinTaxStalenessThreshold(uint256 value)",

  // Spender management
  "function addSpender(address spender)",
  "function removeSpender(address spender)",
  "function addExchangeSpender(address spender)",
  "function removeExchangeSpender(address spender, uint256 index)",
  "function addOtherReserveAddress(address reserveAddress) returns (bool)",
  "function removeOtherReserveAddress(address reserveAddress, uint256 index) returns (bool)",

  // Ownership
  "function transferOwnership(address newOwner)",
  "function renounceOwnership()",
]);
