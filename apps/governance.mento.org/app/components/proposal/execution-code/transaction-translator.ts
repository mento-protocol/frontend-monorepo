import { formatUnits } from "viem";
import {
  getContractInfo,
  getAddressName,
  getRateFeedName,
} from "../lib/contract-registry";
import { decodeTransaction } from "../lib/decoder-utils";

interface Transaction {
  address: string;
  value: string | number;
  data: string;
}

interface TransactionSummary {
  description: string;
  confidence: "high" | "medium" | "low";
}

interface ContractParam {
  address: string;
}

interface DecodedArg {
  name: string;
  type: string;
  value: string | number | boolean | bigint;
}

// Function patterns for natural language translation
const functionPatterns: Record<
  string,
  (
    contract: ContractParam,
    args: DecodedArg[],
    value: string | number,
  ) => string
> = {
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

  "setReserveRatio(uint256)": (contract, args) => {
    const [ratio] = args;
    if (!ratio) return "Invalid setReserveRatio parameters";
    return `Update the reserve ratio to ${Number(ratio.value) / 100}%`;
  },

  "updateOracle(address)": (contract, args) => {
    const [oracle] = args;
    if (!oracle) return "Invalid updateOracle parameters";
    const oracleName = getAddressName(String(oracle.value));
    return `Update price oracle to ${oracleName}`;
  },

  "addMember(address)": (contract, args) => {
    const [member] = args;
    if (!member) return "Invalid addMember parameters";
    const memberName = getAddressName(String(member.value));
    return `Add ${memberName} as a member`;
  },

  "removeMember(address)": (contract, args) => {
    const [member] = args;
    if (!member) return "Invalid removeMember parameters";
    const memberName = getAddressName(String(member.value));
    return `Remove ${memberName} from members`;
  },

  // veMENTO functions
  "lock(address,address,uint96,uint32,uint32)": (contract, args) => {
    const [account, , amount, , cliff] = args;
    if (!account || !amount || !cliff) return "Invalid lock parameters";
    const accountName = getAddressName(String(account.value));
    const formattedAmount = formatTokenAmount(String(amount.value), 18);
    return `Lock ${formattedAmount} MENTO for ${accountName} with ${String(cliff.value)} weeks cliff`;
  },

  "delegateTo(uint256,address)": (contract, args) => {
    const [id, newDelegate] = args;
    if (!id || !newDelegate) return "Invalid delegation parameters";
    const delegateName = getAddressName(String(newDelegate.value));
    return `Delegate voting power from lock #${id.value} to ${delegateName}`;
  },

  // SortedOracles functions
  "report(address,uint256,address,address)": (contract, args) => {
    const [token, value] = args;
    if (!token || !value) return "Invalid oracle report parameters";
    const rateFeedName = getRateFeedName(String(token.value));
    return `Report price for the ${rateFeedName}`;
  },

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

  // Governance functions
  "castVote(uint256,uint8)": (contract, args) => {
    const [proposalId, support] = args;
    if (!proposalId || support === undefined) return "Invalid vote parameters";
    const voteType =
      Number(support.value) === 1
        ? "FOR"
        : Number(support.value) === 0
          ? "AGAINST"
          : "ABSTAIN";
    return `Vote ${voteType} on proposal #${proposalId.value}`;
  },

  "queue(uint256)": (contract, args) => {
    const [proposalId] = args;
    if (!proposalId) return "Invalid queue parameters";
    return `Queue proposal #${proposalId.value} for execution`;
  },

  "execute(uint256)": (contract, args) => {
    const [proposalId] = args;
    if (!proposalId) return "Invalid execute parameters";
    return `Execute proposal #${proposalId.value}`;
  },

  // Reserve functions
  "transferGold(address,uint256)": (contract, args) => {
    const [to, value] = args;
    if (!to || !value) return "Invalid transfer parameters";
    const toName = getAddressName(String(to.value));
    const formattedAmount = formatTokenAmount(String(value.value), 18);
    return `Transfer ${formattedAmount} CELO from Mento Reserve to ${toName}`;
  },

  "transferCollateralAsset(address,address,uint256)": (contract, args) => {
    const [asset, to, value] = args;
    if (!asset || !to || !value) return "Invalid transfer parameters";
    const assetInfo = getContractInfo(String(asset.value));
    const assetName = assetInfo?.symbol || getAddressName(String(asset.value));
    const toName = getAddressName(String(to.value));
    const formattedAmount = formatTokenAmount(
      String(value.value),
      assetInfo?.decimals || 18,
    );
    return `Transfer ${formattedAmount} ${assetName} from Mento Reserve to ${toName}`;
  },

  "addToken(address)": (contract, args) => {
    const [token] = args;
    if (!token) return "Invalid addToken parameters";
    const tokenInfo = getContractInfo(String(token.value));
    const tokenName = tokenInfo?.symbol || getAddressName(String(token.value));
    return `Add ${tokenName} to Reserve tokens`;
  },

  "removeToken(address,uint256)": (contract, args) => {
    const [token] = args;
    if (!token) return "Invalid removeToken parameters";
    const tokenInfo = getContractInfo(String(token.value));
    const tokenName = tokenInfo?.symbol || getAddressName(String(token.value));
    return `Remove ${tokenName} from Reserve tokens`;
  },

  "addCollateralAsset(address)": (contract, args) => {
    const [asset] = args;
    if (!asset) return "Invalid addCollateralAsset parameters";
    const assetInfo = getContractInfo(String(asset.value));
    const assetName = assetInfo?.symbol || getAddressName(String(asset.value));
    return `Add ${assetName} as Reserve collateral asset`;
  },

  "removeCollateralAsset(address,uint256)": (contract, args) => {
    const [asset] = args;
    if (!asset) return "Invalid removeCollateralAsset parameters";
    const assetInfo = getContractInfo(String(asset.value));
    const assetName = assetInfo?.symbol || getAddressName(String(asset.value));
    return `Remove ${assetName} from Reserve collateral assets`;
  },

  "setAssetAllocations(bytes32[],uint256[])": () => {
    return `Update Reserve asset allocation weights`;
  },

  "setDailySpendingRatio(uint256)": (contract, args) => {
    const [ratio] = args;
    if (!ratio) return "Invalid spending ratio parameters";
    const percentage = ((Number(ratio.value) / 1e18) * 100).toFixed(2);
    return `Set Reserve daily spending limit to ${percentage}%`;
  },

  "addSpender(address)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid addSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Add ${spenderName} as Reserve spender`;
  },

  "removeSpender(address)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid removeSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Remove ${spenderName} from Reserve spenders`;
  },

  "addExchangeSpender(address)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid addExchangeSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Add ${spenderName} as Reserve exchange spender`;
  },

  "removeExchangeSpender(address,uint256)": (contract, args) => {
    const [spender] = args;
    if (!spender) return "Invalid removeExchangeSpender parameters";
    const spenderName = getAddressName(String(spender.value));
    return `Remove ${spenderName} from Reserve exchange spenders`;
  },

  // Proxy Admin functions
  "changeProxyAdmin(address,address)": (contract, args) => {
    const [proxy, newAdmin] = args;
    if (!proxy || !newAdmin) return "Invalid changeProxyAdmin parameters";
    const proxyName = getAddressName(String(proxy.value));
    const adminName = getAddressName(String(newAdmin.value));
    return `Change proxy admin for ${proxyName} to ${adminName}`;
  },

  "upgrade(address,address)": (contract, args) => {
    const [proxy, implementation] = args;
    if (!proxy || !implementation) return "Invalid upgrade parameters";
    const proxyName = getAddressName(String(proxy.value));
    const implName = getAddressName(String(implementation.value));
    return `Upgrade ${proxyName} to implementation ${implName}`;
  },

  "upgradeAndCall(address,address,bytes)": (contract, args) => {
    const [proxy, implementation] = args;
    if (!proxy || !implementation) return "Invalid upgradeAndCall parameters";
    const proxyName = getAddressName(String(proxy.value));
    const implName = getAddressName(String(implementation.value));
    return `Upgrade ${proxyName} to implementation ${implName} and execute initialization`;
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

function formatTokenAmount(amount: string | number, decimals: number): string {
  try {
    const formatted = formatUnits(BigInt(amount), decimals);
    const num = parseFloat(formatted);

    // Format with appropriate precision and thousand separators
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    } else {
      return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
  } catch {
    return String(amount);
  }
}

export function translateTransaction(
  transaction: Transaction,
): TransactionSummary {
  try {
    // Check for empty execution (null transaction)
    if (
      transaction.address === "0x0000000000000000000000000000000000000000" &&
      (transaction.data === "0x" || transaction.data === "") &&
      Number(transaction.value) === 0
    ) {
      return {
        description: "No on-chain actions (informational proposal)",
        confidence: "high",
      };
    }

    const decoded = decodeTransaction(transaction);

    if (!decoded) {
      return {
        description: `Execute transaction on ${getAddressName(transaction.address)}`,
        confidence: "low",
      };
    }

    // Check if we have a specific pattern for this function
    const pattern = functionPatterns[decoded.functionSignature];
    if (pattern) {
      const contractInfo = { address: transaction.address };
      const description = pattern(
        contractInfo,
        decoded.args || [],
        transaction.value,
      );
      return {
        description,
        confidence: "high",
      };
    }

    // Generic function call description
    const contractName =
      getContractInfo(transaction.address)?.name ||
      getAddressName(transaction.address);
    let description = `Call ${decoded.functionName} on ${contractName}`;

    if (transaction.value && Number(transaction.value) > 0) {
      description += ` with ${formatUnits(BigInt(transaction.value), 18)} CELO`;
    }

    return {
      description,
      confidence: "medium",
    };
  } catch (error) {
    console.error("Error translating transaction:", error);
    return {
      description: `Execute transaction on ${getAddressName(transaction.address)}`,
      confidence: "low",
    };
  }
}
