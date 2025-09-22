import type { PatternRegistry } from "./types";
import { createPattern } from "./base-pattern";
import {
  getContractInfo,
  getAddressNameFromCache,
} from "../../services/address-resolver-service";

export const utilityPatterns: PatternRegistry = {
  "pause()": createPattern(
    (contract) => {
      const contractInfo = getContractInfo(contract.address);
      if (contractInfo?.symbol) {
        return `Disable token transfers for the ${contractInfo.symbol || contractInfo.name} token`;
      }
      const contractName = getAddressNameFromCache(contract.address);
      return `Pause operations on ${contractName}`;
    },
    0,
    "pause",
  ),

  "unpause()": createPattern(
    (contract) => {
      const contractInfo = getContractInfo(contract.address);
      if (contractInfo?.symbol) {
        return `Enable token transfers for the ${contractInfo.symbol || contractInfo.name} token`;
      }
      const contractName = getAddressNameFromCache(contract.address);
      return `Enable operations on ${contractName}`;
    },
    0,
    "unpause",
  ),
};
