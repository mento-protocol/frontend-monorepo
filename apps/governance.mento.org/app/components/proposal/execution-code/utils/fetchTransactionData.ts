import { ABIResponse } from "@/api/contract/types";
import { Transaction } from "../../types/transaction";
import { isEmptyTransaction } from "../patterns/utils";
import { ContractAPIService } from "../../services/contract-api-service";
import { getContractInfo } from "../../hooks/useContractRegistry";

interface FetchedData {
  abiMap: Map<string, ABIResponse | null>;
  contractNameMap: Record<string, string>;
}

// Helper function to fetch all required data (ABIs and contract names)
export async function fetchTransactionData(
  transactions: Transaction[],
): Promise<FetchedData> {
  const [abiResults, contractNameResults] = await Promise.all([
    Promise.all(transactions.map(fetchTransactionABI)),
    Promise.all(transactions.map(fetchTransactionContractName)),
  ]);

  const abiMap = new Map(
    abiResults.map((result) => [result.address, result.abiResponse]),
  );

  const contractNameMap = contractNameResults.reduce(
    (acc, result) => {
      if (result.name) {
        acc[result.address] = result.name;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  return { abiMap, contractNameMap };
}

// Helper function to fetch ABI for a single transaction
async function fetchTransactionABI(
  tx: Transaction,
): Promise<{ address: string; abiResponse: ABIResponse | null }> {
  if (isEmptyTransaction(tx)) {
    return { address: tx.address, abiResponse: null };
  }

  const abiResponse = await fetchContractABI(tx.address);
  return { address: tx.address, abiResponse };
}

// Helper function to fetch contract name for a single transaction
async function fetchTransactionContractName(
  tx: Transaction,
): Promise<{ address: string; name: string | null }> {
  if (isEmptyTransaction(tx)) {
    return { address: tx.address, name: null };
  }

  // First, check the local contract registry
  const localContractInfo = getContractInfo(tx.address);
  if (localContractInfo?.name) {
    return { address: tx.address, name: localContractInfo.name };
  }

  // If not in local registry, try the API
  try {
    const contractAPIService = new ContractAPIService();
    const contractInfo = await contractAPIService.getContractInfo(tx.address);
    return { address: tx.address, name: contractInfo?.name || null };
  } catch (error) {
    console.warn(`Failed to fetch contract name for ${tx.address}:`, error);
    return { address: tx.address, name: null };
  }
}

/**
 * Fetch ABI for a contract address from our /abi endpoint
 */
export async function fetchContractABI(
  address: string,
): Promise<ABIResponse | null> {
  try {
    const response = await fetch(`/api/contract/abi?address=${address}`);

    if (!response.ok) {
      console.warn(`Failed to fetch ABI for ${address}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data as ABIResponse;
  } catch (error) {
    console.warn(`Error fetching ABI for ${address}:`, error);
    return null;
  }
}
