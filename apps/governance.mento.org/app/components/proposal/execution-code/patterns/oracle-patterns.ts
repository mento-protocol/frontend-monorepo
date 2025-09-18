import {
  getRateFeedName,
  getAddressName,
} from "../../hooks/useContractRegistry";
import type { PatternRegistry } from "./types";

export const oraclePatterns: PatternRegistry = {
  "addOracle(address,address)": (contract, args) => {
    const [token, oracle] = args;
    if (!token || !oracle) return "Invalid addOracle parameters";
    const rateFeedName = getRateFeedName(String(token.value));
    const oracleAddress = String(oracle.value);
    const oracleDisplay = getAddressName(oracleAddress);
    return `Add ${oracleDisplay} as price oracle for the ${rateFeedName}`;
  },

  "removeOracle(address,address,uint256)": (contract, args) => {
    const [token, oracle] = args;
    if (!token || !oracle) return "Invalid removeOracle parameters";
    const rateFeedName = getRateFeedName(String(token.value));
    const oracleAddress = String(oracle.value);
    const oracleDisplay = getAddressName(oracleAddress);
    return `Remove ${oracleDisplay} as price oracle for the ${rateFeedName}`;
  },
};
