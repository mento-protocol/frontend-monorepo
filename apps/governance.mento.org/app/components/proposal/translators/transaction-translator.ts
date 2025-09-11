import { formatUnits } from "viem";
import { Transaction, TransactionSummary } from "../types/transaction";
import { getAddressName, getContractInfo } from "../hooks/useContractRegistry";
import { decodeTransaction } from "../lib/decoder-utils";
import { tokenPatterns } from "./token-translator";
import { governancePatterns } from "./governance-translator";
import { reservePatterns } from "./reserve-translator";
import { oraclePatterns } from "./oracle-translator";
import { proxyPatterns } from "./proxy-translator";

// Combine all pattern modules
const functionPatterns = {
  ...tokenPatterns,
  ...governancePatterns,
  ...reservePatterns,
  ...oraclePatterns,
  ...proxyPatterns,
};

/**
 * Translate a raw transaction into human-readable description
 */
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
