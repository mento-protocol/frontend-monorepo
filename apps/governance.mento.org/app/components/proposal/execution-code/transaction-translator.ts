import { formatUnits } from "viem";
import { getAddressName, getContractInfo } from "../hooks/useContractRegistry";
import { decodeTransaction } from "./utils/decodeTransaction";
import type {
  DecodedTransaction,
  TransactionSummary,
  Transaction,
} from "../types/transaction";
import { patternManager } from "./patterns";
import { ABIResponse } from "@/api/contract/types";
import { isEmptyTransaction } from "./patterns/utils";
import { removeProxySuffix } from "./utils/removeProxySuffix";

// Combined result for both views
export interface ProcessedTransaction {
  summary: TransactionSummary;
  decoded: DecodedTransaction | null;
}
/**
 * Process a transaction to get both decoded data and summary (efficient for both views)
 */
export async function processTransaction(
  rawTx: Transaction,
  abiMap: Map<string, ABIResponse | null>,
  contractNameMap: Record<string, string>,
): Promise<ProcessedTransaction> {
  if (isEmptyTransaction(rawTx)) {
    return {
      summary: {
        description: "No on-chain actions (informational proposal)",
        confidence: "high",
      },
      decoded: null,
    };
  }

  try {
    // Decode the transaction once
    const decodedTx = await decodeTransaction(rawTx, abiMap);

    if (decodedTx) {
      const summary = await translateDecodedTransaction(
        rawTx,
        decodedTx,
        contractNameMap[rawTx.address],
      );
      return { summary, decoded: decodedTx };
    }

    // If decoding failed, return generic description
    return {
      summary: {
        description: `Execute transaction on ${rawTx.address}`,
        confidence: "low" as const,
      },
      decoded: null,
    };
  } catch (error) {
    console.error("Error processing transaction:", error);
    return {
      summary: {
        description: `Execute transaction on ${rawTx.address}`,
        confidence: "low" as const,
      },
      decoded: null,
    };
  }
}

export async function translateDecodedTransaction(
  transaction: Transaction,
  decoded: DecodedTransaction,
  contractName?: string,
): Promise<TransactionSummary> {
  try {
    // Check if we have a specific pattern for this function
    const pattern = patternManager.getPattern(decoded.functionSignature);
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

    // Use provided contract name, or fall back to local registry, or formatted address
    const localContractInfo = getContractInfo(transaction.address);
    const contractNameClean = removeProxySuffix(
      contractName ||
        localContractInfo?.name ||
        getAddressName(transaction.address),
    );

    // Create a generic description using ABI-decoded function info
    let description = `Call ${decoded.functionName} on ${removeProxySuffix(contractNameClean)}`;

    if (transaction.value && Number(transaction.value) > 0) {
      const valueInEth = formatUnits(BigInt(transaction.value), 18);
      description += ` with ${valueInEth} ETH`;
    }

    return {
      description,
      confidence: "medium",
    };
  } catch (error) {
    console.error("Error translating transaction with decoded data:", error);
    return {
      description: `Execute transaction on ${removeProxySuffix(getAddressName(transaction.address))}`,
      confidence: "low",
    };
  }
}
