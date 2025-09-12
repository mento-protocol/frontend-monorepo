// Re-export everything from the new hook-based registry
export {
  useContractInfo,
  useContractName,
  useAddressName,
  useAllContractMappings,
  useRateFeedName,
  getContractInfo,
  getAddressName,
  getRateFeedName,
} from "../../hooks/useContractRegistry";

// Re-export utilities
export { formatAddress } from "../../utils/address-utils";

// Legacy function name compatibility
export { getAddressName as getContractName } from "../../hooks/useContractRegistry";
export const getAllContractMappings = () => {
  // This will be replaced by useAllContractMappings hook in components
  console.warn(
    "getAllContractMappings is deprecated, use useAllContractMappings hook instead",
  );
  return [];
};
