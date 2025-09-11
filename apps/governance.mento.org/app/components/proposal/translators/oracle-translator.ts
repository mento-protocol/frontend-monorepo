import { DecodedArg } from "../types/transaction";
import { getRateFeedName } from "../hooks/useContractRegistry";
import {
  getArgValue,
  getArgValueAsString,
  ContractParam,
  translateOracleOperation,
} from "./utils";

/**
 * Oracle-related function translations
 */
export const oraclePatterns: Record<
  string,
  (
    contract: ContractParam,
    args: DecodedArg[],
    value: string | number,
  ) => string
> = {
  // SortedOracles functions
  "report(address,uint256,address,address)": (contract, args) => {
    const token = getArgValue(args, 0);
    const value = getArgValue(args, 1);

    if (!token || !value) return "Invalid oracle report parameters";

    const rateFeedName = getRateFeedName(getArgValueAsString(token));
    return `Report price for the ${rateFeedName}`;
  },

  "addOracle(address,address)": (contract, args) => {
    return translateOracleOperation("Add", args, 0, 1);
  },

  "removeOracle(address,address,uint256)": (contract, args) => {
    return translateOracleOperation("Remove", args, 0, 1);
  },

  // Protocol oracle functions
  "setReserveRatio(uint256)": (contract, args) => {
    const ratio = getArgValue(args, 0);
    if (!ratio) return "Invalid setReserveRatio parameters";
    return `Update the reserve ratio to ${Number(ratio.value) / 100}%`;
  },

  "updateOracle(address)": (contract, args) => {
    const oracle = getArgValue(args, 0);
    if (!oracle) return "Invalid updateOracle parameters";

    const oracleName = getArgValueAsString(oracle);
    return `Update price oracle to ${oracleName}`;
  },
};
