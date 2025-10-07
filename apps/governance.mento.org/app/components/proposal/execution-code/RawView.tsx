import type { Transaction } from "../types/transaction";
import { CopyToClipboard } from "@repo/ui";

interface RawViewProps {
  transactions: Transaction[];
}

export function RawView({ transactions }: RawViewProps) {
  const jsonString = JSON.stringify(transactions, null, 2);

  return (
    <div className="relative">
      <pre className="bg-muted overflow-x-auto rounded-lg p-4">
        <code className="whitespace-pre-wrap break-words text-sm">
          {jsonString}
        </code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyToClipboard
          text={jsonString}
          toastMsg="Copied execution code to clipboard"
        />
      </div>
    </div>
  );
}
