import type { PatternRegistry } from "./types";
import { formatTokenAmount } from "./utils";
import { createPattern, DEFAULT_TOKEN_DECIMALS } from "./base-pattern";
import {
  getContractInfo,
  getAddressNameFromCache,
} from "../../services/address-resolver-service";

export const tokenPatterns: PatternRegistry = {
  "transfer(address,uint256)": createPattern(
    (contract, args) => {
      const [recipient, amount] = args;
      const recipientName = getAddressNameFromCache(String(recipient!.value));
      const token = getContractInfo(contract.address);
      const formattedAmount = formatTokenAmount(
        String(amount!.value),
        token?.decimals || DEFAULT_TOKEN_DECIMALS,
      );

      return `Send ${formattedAmount} ${token?.symbol || "tokens"} to ${recipientName}`;
    },
    2,
    "transfer",
  ),

  "approve(address,uint256)": createPattern(
    (contract, args) => {
      const [spender, amount] = args;
      const spenderName = getAddressNameFromCache(String(spender!.value));
      const token = getContractInfo(contract.address);
      const formattedAmount = formatTokenAmount(
        String(amount!.value),
        token?.decimals || DEFAULT_TOKEN_DECIMALS,
      );

      return `Approve ${spenderName} to spend ${formattedAmount} ${token?.symbol || "tokens"}`;
    },
    2,
    "approve",
  ),

  "mint(address,uint256)": createPattern(
    (contract, args) => {
      const [recipient, amount] = args;
      const recipientName = getAddressNameFromCache(String(recipient!.value));
      const token = getContractInfo(contract.address);
      const formattedAmount = formatTokenAmount(
        String(amount!.value),
        token?.decimals || DEFAULT_TOKEN_DECIMALS,
      );

      return `Mint ${formattedAmount} ${token?.symbol || "tokens"} to ${recipientName}`;
    },
    2,
    "mint",
  ),

  "burn(uint256)": createPattern(
    (contract, args) => {
      const [amount] = args;
      const token = getContractInfo(contract.address);
      const formattedAmount = formatTokenAmount(
        String(amount!.value),
        token?.decimals || DEFAULT_TOKEN_DECIMALS,
      );

      return `Burn ${formattedAmount} ${token?.symbol || "tokens"}`;
    },
    1,
    "burn",
  ),

  // veMENTO functions
  "lock(address,address,uint96,uint32,uint32)": createPattern(
    (contract, args) => {
      const [account, , amount, slopePeriod, cliff] = args;
      const accountName = getAddressNameFromCache(String(account!.value));
      const formattedAmount = formatTokenAmount(String(amount!.value), 18);
      return `Lock ${formattedAmount} MENTO for ${accountName} with ${String(cliff!.value)} weeks cliff and ${String(slopePeriod!.value)} weeks slope period`;
    },
    5,
    "lock",
  ),

  "delegateTo(uint256,address)": createPattern(
    (contract, args) => {
      const [id, newDelegate] = args;
      const delegateName = getAddressNameFromCache(String(newDelegate!.value));
      return `Delegate voting power from lock #${id!.value} to ${delegateName}`;
    },
    2,
    "delegateTo",
  ),
};
