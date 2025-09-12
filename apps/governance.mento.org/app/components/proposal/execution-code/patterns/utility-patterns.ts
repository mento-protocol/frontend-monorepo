import { getContractInfo, getAddressName } from "../utils/contract-registry";
import type { PatternRegistry } from "./types";

export const utilityPatterns: PatternRegistry = {
  "pause()": (contract) => {
    const contractInfo = getContractInfo(contract.address);
    if (contractInfo?.symbol) {
      return `Disable token transfers for the ${contractInfo.symbol || contractInfo.name} token`;
    }
    const contractName = getAddressName(contract.address);
    return `Pause operations on ${contractName}`;
  },

  "unpause()": (contract) => {
    const contractInfo = getContractInfo(contract.address);
    if (contractInfo?.symbol) {
      return `Enable token transfers for the ${contractInfo.symbol || contractInfo.name} token`;
    }
    const contractName = getAddressName(contract.address);
    return `Enable operations on ${contractName}`;
  },
};
