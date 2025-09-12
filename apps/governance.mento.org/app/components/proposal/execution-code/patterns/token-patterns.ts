import { getContractInfo, getAddressName } from "../utils/contract-registry";
import type { PatternRegistry } from "./types";
import { formatTokenAmount } from "./utils";

export const tokenPatterns: PatternRegistry = {
  "transfer(address,uint256)": (contract, args) => {
    const [recipient, amount] = args;
    if (!recipient || !amount) return "Invalid transfer parameters";
    const recipientName = getAddressName(String(recipient.value));
    const token = getContractInfo(contract.address);
    const formattedAmount = formatTokenAmount(
      String(amount.value),
      token?.decimals || 18,
    );

    return `Send ${formattedAmount} ${token?.symbol || "tokens"} to ${recipientName}`;
  },

  "approve(address,uint256)": (contract, args) => {
    const [spender, amount] = args;
    if (!spender || !amount) return "Invalid approve parameters";
    const spenderName = getAddressName(String(spender.value));
    const token = getContractInfo(contract.address);
    const formattedAmount = formatTokenAmount(
      String(amount.value),
      token?.decimals || 18,
    );

    return `Approve ${spenderName} to spend ${formattedAmount} ${token?.symbol || "tokens"}`;
  },

  "mint(address,uint256)": (contract, args) => {
    const [recipient, amount] = args;
    if (!recipient || !amount) return "Invalid mint parameters";
    const recipientName = getAddressName(String(recipient.value));
    const token = getContractInfo(contract.address);
    const formattedAmount = formatTokenAmount(
      String(amount.value),
      token?.decimals || 18,
    );

    return `Mint ${formattedAmount} ${token?.symbol || "tokens"} to ${recipientName}`;
  },

  "burn(uint256)": (contract, args) => {
    const [amount] = args;
    if (!amount) return "Invalid burn parameters";
    const token = getContractInfo(contract.address);
    const formattedAmount = formatTokenAmount(
      String(amount.value),
      token?.decimals || 18,
    );

    return `Burn ${formattedAmount} ${token?.symbol || "tokens"}`;
  },

  // veMENTO functions
  "lock(address,address,uint96,uint32,uint32)": (contract, args) => {
    const [account, , amount, slopePeriod, cliff] = args;
    if (!account || !amount || !cliff || !slopePeriod)
      return "Invalid lock parameters";
    const accountName = getAddressName(String(account.value));
    const formattedAmount = formatTokenAmount(String(amount.value), 18);
    return `Lock ${formattedAmount} MENTO for ${accountName} with ${String(cliff.value)} weeks cliff and ${String(slopePeriod.value)} weeks slope period`;
  },

  "delegateTo(uint256,address)": (contract, args) => {
    const [id, newDelegate] = args;
    if (!id || !newDelegate) return "Invalid delegation parameters";
    const delegateName = getAddressName(String(newDelegate.value));
    return `Delegate voting power from lock #${id.value} to ${delegateName}`;
  },
};
