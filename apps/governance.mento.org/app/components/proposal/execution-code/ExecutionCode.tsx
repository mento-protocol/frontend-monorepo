"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import { useMemo, useState } from "react";
import { DecodedTransaction } from "./DecodedTransaction";
import { translateTransaction } from "./transaction-translator";
import { FormattedTransactionText } from "../components/FormattedTransactionText";

interface Transaction {
  address: string;
  value: string | number;
  data: string;
}

interface ExecutionCodeProps {
  transactions: Transaction[];
  className?: string;
}

export function ExecutionCode({ transactions, className }: ExecutionCodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const summaries = useMemo(() => {
    return transactions.map((tx) => translateTransaction(tx));
  }, [transactions]);

  // Check if this is empty execution code (null transaction)
  const isEmptyExecution = useMemo(() => {
    return (
      transactions.length === 1 &&
      transactions[0] &&
      transactions[0].address ===
        "0x0000000000000000000000000000000000000000" &&
      (transactions[0].data === "0x" || transactions[0].data === "") &&
      Number(transactions[0].value) === 0
    );
  }, [transactions]);

  if (!transactions || transactions.length === 0) {
    return null;
  }

  return (
    <Card className={cn("border-border", className)}>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-2xl">What This Proposal Will Do</CardTitle>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          {isEmptyExecution ? (
            <div className="bg-muted/50 flex items-center gap-3 rounded-lg p-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
                <span className="text-blue-500">ℹ</span>
              </div>
              <div>
                <p className="text-foreground font-medium">
                  This is an informational proposal
                </p>
                <p className="text-muted-foreground text-sm">
                  No on-chain actions will be executed if this proposal passes.
                </p>
              </div>
            </div>
          ) : (
            <Tabs defaultValue="simple">
              <TabsList>
                <TabsTrigger value="simple">Simple View</TabsTrigger>
                <TabsTrigger value="technical">Technical View</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="simple" className="mt-6">
                <ul className="space-y-3">
                  {summaries.map((summary, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-muted-foreground">•</span>
                      <FormattedTransactionText
                        text={summary.description}
                        transaction={transactions[index]}
                      />
                    </li>
                  ))}
                </ul>
              </TabsContent>

              <TabsContent value="technical" className="mt-6">
                <div className="space-y-4">
                  {transactions.map((tx, index) => (
                    <DecodedTransaction
                      key={index}
                      transaction={tx}
                      index={index}
                    />
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="raw" className="mt-6">
                <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-sm">
                  <code>{JSON.stringify(transactions, null, 2)}</code>
                </pre>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      )}
    </Card>
  );
}
