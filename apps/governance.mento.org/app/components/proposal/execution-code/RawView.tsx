import type { Transaction } from "../types/transaction";

interface RawViewProps {
  transactions: Transaction[];
}

export function RawView({ transactions }: RawViewProps) {
  return (
    <pre className="bg-muted overflow-x-auto rounded-lg p-4">
      <code className="text-sm">{JSON.stringify(transactions, null, 2)}</code>
    </pre>
  );
}
