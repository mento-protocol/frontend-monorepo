"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import { useMemo, useState } from "react";
import type { Transaction } from "../types/transaction";
import { useExecutionCodeData } from "./hooks/useExecutionCodeData";
import { EmptyExecutionMessage } from "./EmptyExecutionMessage";
import { SimpleView } from "./SimpleView";
import { TechnicalView } from "./TechnicalView";
import { RawView } from "./RawView";
import { isEmptyTransaction } from "./patterns/utils";

interface ExecutionCodeProps {
  transactions: Transaction[];
  className?: string;
}

export function ExecutionCode({ transactions, className }: ExecutionCodeProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { summaries, decodedTransactions, contractNames, isLoading } =
    useExecutionCodeData(transactions);

  const isEmptyExecutionCode = useMemo(() => {
    return (
      transactions.length === 1 &&
      transactions[0] &&
      isEmptyTransaction(transactions[0])
    );
  }, [transactions]);

  const hasTransactions = transactions && transactions.length > 0;

  return (
    <Card className={cn("border-border", className)}>
      <CardHeader
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-2xl">Execution Code</CardTitle>
        <CardDescription>What This Proposal Will Do</CardDescription>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          {!hasTransactions || isEmptyExecutionCode ? (
            <EmptyExecutionMessage />
          ) : (
            <Tabs defaultValue="simple">
              <TabsList>
                <TabsTrigger value="simple">Simple View</TabsTrigger>
                <TabsTrigger value="technical">Technical View</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="simple" className="mt-6">
                <SimpleView
                  isLoading={isLoading}
                  summaries={summaries}
                  transactions={transactions}
                  decodedTransactions={decodedTransactions}
                />
              </TabsContent>

              <TabsContent value="technical" className="mt-6">
                <TechnicalView
                  isLoading={isLoading}
                  transactions={transactions}
                  decodedTransactions={decodedTransactions}
                  contractNames={contractNames}
                />
              </TabsContent>

              <TabsContent value="raw" className="mt-6">
                <RawView transactions={transactions} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      )}
    </Card>
  );
}
