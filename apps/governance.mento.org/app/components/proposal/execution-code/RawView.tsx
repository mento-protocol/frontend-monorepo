import type { Transaction } from "../types/transaction";
import { CopyToClipboard } from "@repo/ui";

interface RawViewProps {
  transactions: Transaction[];
}

export function RawView({ transactions }: RawViewProps) {
  const jsonString = JSON.stringify(transactions, null, 2);

  return (
    <div className="relative">
      <pre className="p-4 overflow-x-auto rounded-lg bg-muted">
        <code className="text-sm break-words whitespace-pre-wrap">
          {jsonString}
        </code>
      </pre>
      <div className="right-2 top-2 absolute">
        <CopyToClipboard
          text={jsonString}
          toastMsg="Copied execution code to clipboard"
        />
      </div>
    </div>
  );
}
