"use client";

import { CopyToClipboard } from "@repo/ui";
import { Transaction, type DecodedTransaction } from "../types/transaction";
import { useExplorerUrl, formatAddress } from "../utils/address-utils";
import { removeProxySuffix } from "./utils/removeProxySuffix";
import { LoadingState } from "./LoadingState";

interface TechnicalViewProps {
  isLoading: boolean;
  transactions: Transaction[];
  decodedTransactions: (DecodedTransaction | null)[];
  contractNames: Record<string, string>;
}

export function TechnicalView({
  isLoading,
  transactions,
  decodedTransactions,
  contractNames,
}: TechnicalViewProps) {
  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="space-y-4">
      {transactions.map((transaction, index) => (
        <DecodedTransactionView
          key={index}
          transaction={transaction}
          decoded={decodedTransactions[index] || null}
          index={index}
          contractName={contractNames[transaction.address]}
        />
      ))}
    </div>
  );
}

interface DecodedTransactionViewProps {
  transaction: Transaction;
  decoded: DecodedTransaction | null;
  index: number;
  contractName?: string;
}

function DecodedTransactionView({
  transaction,
  decoded,
  index,
  contractName,
}: DecodedTransactionViewProps) {
  const explorerUrl = useExplorerUrl();

  if (!transaction) {
    return (
      <div className="border-border rounded-lg border p-4">
        <p className="text-muted-foreground">Invalid transaction data</p>
      </div>
    );
  }

  return (
    <div className="border-border rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-medium">Transaction {index + 1}</h4>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Contract:</span>
          {explorerUrl ? (
            <a
              href={`${explorerUrl}/address/${transaction.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm hover:underline"
            >
              {removeProxySuffix(contractName) ||
                formatAddress(transaction.address)}
            </a>
          ) : (
            <span className="text-sm">
              {removeProxySuffix(contractName) ||
                formatAddress(transaction.address)}
            </span>
          )}
          <CopyToClipboard text={transaction.address} />
        </div>
      </div>

      {decoded ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm">{decoded.functionName}</span>
            {transaction.value && Number(transaction.value) > 0 && (
              <span className="text-muted-foreground text-sm">
                (with {transaction.value} ETH)
              </span>
            )}
          </div>
          {decoded.args && decoded.args.length > 0 && (
            <div className="ml-4 space-y-1">
              {decoded.args.map(
                (
                  arg: {
                    name: string;
                    type: string;
                    value: string | number | boolean | bigint;
                  },
                  i: number,
                ) => (
                  <div key={i} className="text-sm">
                    <span className="text-muted-foreground">{arg.name}:</span>{" "}
                    <span className="font-mono">{String(arg.value)}</span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Unable to decode transaction data
          </p>
          <div className="overflow-x-auto">
            <code className="text-xs">{transaction.data}</code>
          </div>
        </div>
      )}
    </div>
  );
}
