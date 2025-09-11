import { formatUnits } from "viem";
import { DecodedArg } from "../types/transaction";
import {
  getAddressName,
  getContractInfo,
  getRateFeedName,
} from "../hooks/useContractRegistry";

/**
 * Format token amount with appropriate precision and thousand separators
 */
export function formatTokenAmount(
  amount: string | number,
  decimals: number,
): string {
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

/**
 * Safely get argument value with null checks
 */
export function getArgValue(
  args: DecodedArg[],
  index: number,
): DecodedArg | null {
  if (!args || index >= args.length || index < 0) {
    return null;
  }
  return args[index] || null;
}

/**
 * Safely convert argument value to string
 */
export function getArgValueAsString(arg: DecodedArg | null): string {
  if (!arg || arg.value === null || arg.value === undefined) {
    return "";
  }
  return String(arg.value);
}

/**
 * Get contract parameter with address validation
 */
export interface ContractParam {
  address: string;
}

export function validateContractParam(
  contract: ContractParam | null,
): contract is ContractParam {
  return !!(contract?.address && typeof contract.address === "string");
}

/**
 * Common translation pattern for token operations
 */
export function translateTokenOperation(
  operation: string,
  contract: ContractParam,
  args: DecodedArg[],
  recipientIndex: number = 0,
  amountIndex: number = 1,
): string {
  const recipient = getArgValue(args, recipientIndex);
  const amount = getArgValue(args, amountIndex);

  if (!recipient || !amount) {
    return `Invalid ${operation} parameters`;
  }

  const recipientName = getAddressName(getArgValueAsString(recipient));
  const token = getContractInfo(contract.address);
  const formattedAmount = formatTokenAmount(
    getArgValueAsString(amount),
    token?.decimals || 18,
  );

  return `${operation} ${formattedAmount} ${token?.symbol || "tokens"} ${recipientIndex === 0 ? "to" : "from"} ${recipientName}`;
}

/**
 * Common translation pattern for oracle operations
 */
export function translateOracleOperation(
  operation: string,
  args: DecodedArg[],
  tokenIndex: number = 0,
  oracleIndex: number = 1,
): string {
  const token = getArgValue(args, tokenIndex);
  const oracle = getArgValue(args, oracleIndex);

  if (!token || !oracle) {
    return `Invalid ${operation} parameters`;
  }

  const rateFeedName = getRateFeedName(getArgValueAsString(token));
  const oracleName = getAddressName(getArgValueAsString(oracle));

  return `${operation} ${oracleName} as price oracle for the ${rateFeedName}`;
}
