"use client";

import { CopyToClipboard } from "@repo/ui";
import { Transaction, type DecodedTransaction } from "../types/transaction";
import { formatAddress } from "../utils/address-utils";
import { AddressLink } from "../components/AddressLink";
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
  if (!transaction) {
    return (
      <div className="p-4 rounded-lg border border-border">
        <p className="text-muted-foreground">Invalid transaction data</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-border">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-medium">Transaction {index + 1}</h4>
        <div className="gap-2 flex items-center">
          <span className="text-sm text-muted-foreground">Contract:</span>
          <AddressLink
            address={transaction.address}
            className="gap-1 text-sm flex items-center hover:underline"
          >
            {removeProxySuffix(contractName) ||
              formatAddress(transaction.address)}
          </AddressLink>
          <CopyToClipboard text={transaction.address} />
        </div>
      </div>

      {decoded ? (
        <div className="space-y-2">
          <div className="gap-2 flex items-center">
            <span className="font-mono text-sm">{decoded.functionName}</span>
            {transaction.value && Number(transaction.value) > 0 && (
              <span className="text-sm text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
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
