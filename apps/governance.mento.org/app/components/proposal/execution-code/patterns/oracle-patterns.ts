import { getAddressName, getRateFeedName } from "../utils/contract-registry";
import type { PatternRegistry } from "./types";

export const oraclePatterns: PatternRegistry = {
  "addOracle(address,address)": (contract, args) => {
    const [token, oracle] = args;
    if (!token || !oracle) return "Invalid addOracle parameters";
    const rateFeedName = getRateFeedName(String(token.value));
    const oracleName = getAddressName(String(oracle.value));
    return `Add ${oracleName} as price oracle for the ${rateFeedName}`;
  },

  "removeOracle(address,address,uint256)": (contract, args) => {
    const [token, oracle] = args;
    if (!token || !oracle) return "Invalid removeOracle parameters";
    const rateFeedName = getRateFeedName(String(token.value));
    const oracleName = getAddressName(String(oracle.value));
    return `Remove ${oracleName} as price oracle for the ${rateFeedName}`;
  },
};
