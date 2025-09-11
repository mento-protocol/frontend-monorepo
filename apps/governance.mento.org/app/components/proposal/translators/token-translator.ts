import { DecodedArg } from "../types/transaction";
import { getAddressName, getContractInfo } from "../hooks/useContractRegistry";
import {
  formatTokenAmount,
  getArgValue,
  getArgValueAsString,
  ContractParam,
  translateTokenOperation,
} from "./utils";

/**
 * Token-related function translations
 */
export const tokenPatterns: Record<
  string,
  (
    contract: ContractParam,
    args: DecodedArg[],
    value: string | number,
  ) => string
> = {
  "transfer(address,uint256)": (contract, args) => {
    return translateTokenOperation("Send", contract, args, 0, 1);
  },

  "approve(address,uint256)": (contract, args) => {
    const spender = getArgValue(args, 0);
    const amount = getArgValue(args, 1);

    if (!spender || !amount) return "Invalid approve parameters";

    const spenderName = getAddressName(getArgValueAsString(spender));
    const token = getContractInfo(contract.address);
    const formattedAmount = formatTokenAmount(
      getArgValueAsString(amount),
      token?.decimals || 18,
    );

    return `Approve ${spenderName} to spend ${formattedAmount} ${token?.symbol || "tokens"}`;
  },

  "mint(address,uint256)": (contract, args) => {
    return translateTokenOperation("Mint", contract, args, 0, 1);
  },

  "burn(uint256)": (contract, args) => {
    const amount = getArgValue(args, 0);
    if (!amount) return "Invalid burn parameters";

    const token = getContractInfo(contract.address);
    const formattedAmount = formatTokenAmount(
      getArgValueAsString(amount),
      token?.decimals || 18,
    );

    return `Burn ${formattedAmount} ${token?.symbol || "tokens"}`;
  },

  // Pause/Unpause functions
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
