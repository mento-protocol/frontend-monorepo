import type { PatternRegistry } from "./types";
import { createPattern } from "./base-pattern";
import {
  getAddressNameFromCache,
  addressResolverService,
} from "../../services/address-resolver-service";

export const oraclePatterns: PatternRegistry = {
  "addOracle(address,address)": createPattern(
    (contract, args) => {
      const [token, oracle] = args;
      // Use sync resolution for rate feeds from local registry
      const rateFeedName = addressResolverService.resolveFromCache(
        String(token!.value),
      ).name;
      const oracleAddress = String(oracle!.value);
      const oracleDisplay = getAddressNameFromCache(oracleAddress);
      return `Add ${oracleDisplay} as price oracle for the ${rateFeedName}`;
    },
    2,
    "addOracle",
  ),

  "removeOracle(address,address,uint256)": createPattern(
    (contract, args) => {
      const [token, oracle] = args;
      // Use sync resolution for rate feeds from local registry
      const rateFeedName = addressResolverService.resolveFromCache(
        String(token!.value),
      ).name;
      const oracleAddress = String(oracle!.value);
      const oracleDisplay = getAddressNameFromCache(oracleAddress);
      return `Remove ${oracleDisplay} as price oracle for the ${rateFeedName}`;
    },
    3,
    "removeOracle",
  ),
};
