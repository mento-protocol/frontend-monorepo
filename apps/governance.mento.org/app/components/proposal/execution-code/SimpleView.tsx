import type {
  Transaction,
  TransactionSummary,
  DecodedTransaction,
} from "../types/transaction";
import { FormattedTransactionText } from "../components/FormattedTransactionText";
import { LoadingState } from "./LoadingState";

interface SimpleViewProps {
  isLoading: boolean;
  summaries: TransactionSummary[];
  transactions: Transaction[];
  decodedTransactions: (DecodedTransaction | null)[];
}

export function SimpleView({
  isLoading,
  summaries,
  transactions,
  decodedTransactions,
}: SimpleViewProps) {
  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <ul className="space-y-3">
      {summaries.map((summary, index) => (
        <li key={index} className="flex items-start gap-2">
          <span className="text-muted-foreground">•</span>
          <FormattedTransactionText
            text={summary.description}
            transaction={transactions[index]}
            decodedTransaction={decodedTransactions[index] || undefined}
          />
        </li>
      ))}
    </ul>
  );
}
