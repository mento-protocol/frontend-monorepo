import { useState, useEffect, useRef } from "react";
import type {
  Transaction,
  TransactionSummary,
  DecodedTransaction,
} from "../../types/transaction";
import { fetchTransactionData } from "../utils/fetchTransactionData";
import { processTransaction } from "../transaction-translator";

interface UseExecutionCodeDataResult {
  // For SimpleView
  summaries: TransactionSummary[];
  // For TechnicalView
  decodedTransactions: (DecodedTransaction | null)[];
  // Shared
  contractNames: Record<string, string>;
  isLoading: boolean;
}

export function useExecutionCodeData(
  transactions: Transaction[],
): UseExecutionCodeDataResult {
  const [summaries, setSummaries] = useState<TransactionSummary[]>([]);
  const [decodedTransactions, setDecodedTransactions] = useState<
    (DecodedTransaction | null)[]
  >([]);
  const [contractNames, setContractNames] = useState<Record<string, string>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    // Prevent multiple simultaneous processing
    if (isProcessingRef.current || transactions.length === 0) {
      return;
    }

    const processTransactions = async () => {
      isProcessingRef.current = true;
      setIsLoading(true);

      try {
        // Fetch all required data once
        const { abiMap, contractNameMap } =
          await fetchTransactionData(transactions);
        setContractNames(contractNameMap);

        // Process all transactions efficiently in one pass
        const processedTransactions = await Promise.all(
          transactions.map((tx) =>
            processTransaction(tx, abiMap, contractNameMap),
          ),
        );

        // Extract summaries and decoded transactions
        const translatedSummaries = processedTransactions.map(
          (result) => result.summary,
        );
        const decodedTxs = processedTransactions.map(
          (result) => result.decoded,
        );

        setSummaries(translatedSummaries);
        setDecodedTransactions(decodedTxs);
      } catch (error) {
        console.error("Error processing transactions:", error);
        // Fallback for both views
        setSummaries(createFallbackSummaries(transactions));
        setDecodedTransactions(transactions.map(() => null));
      } finally {
        isProcessingRef.current = false;
        setIsLoading(false);
      }
    };

    processTransactions();
  }, [transactions]);

  return { summaries, decodedTransactions, contractNames, isLoading };
}

// Helper function to create fallback summaries
function createFallbackSummaries(
  transactions: Transaction[],
): TransactionSummary[] {
  return transactions.map((tx) => ({
    description: `Execute transaction on ${tx.address}`,
    confidence: "low" as const,
  }));
}
