"use client";

import { type ChartConfig, ChartContainer } from "@repo/ui";
import { useInterestRateChartData, selectedDebtTokenAtom } from "@repo/web3";
import { useAtomValue } from "jotai";
import { parseUnits } from "viem";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface InterestRateChartProps {
  selectedRate: string;
}

const chartConfig = {
  debt: {
    label: "Total Debt",
    color: "hsl(var(--primary))",
  },
  currentDebt: {
    label: "Your Rate",
    color: "hsl(var(--chart-1, 220 70% 50%))",
  },
} satisfies ChartConfig;

function parseRateToBigint(pctString: string): bigint | null {
  const num = Number(pctString);
  if (isNaN(num) || num <= 0) return null;
  const decimalStr = (num / 100).toFixed(18);
  try {
    return parseUnits(decimalStr, 18);
  } catch {
    return null;
  }
}

function formatDebtCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

export function InterestRateChart({ selectedRate }: InterestRateChartProps) {
  const debtToken = useAtomValue(selectedDebtTokenAtom);
  const rateBigint = parseRateToBigint(selectedRate);
  const chartData = useInterestRateChartData(rateBigint, debtToken.symbol);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="text-sm flex h-[200px] items-center justify-center text-muted-foreground">
        No interest rate data available
      </div>
    );
  }

  return (
    <div className="gap-2 flex flex-col">
      <span className="font-semibold tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
        Rate Distribution
      </span>
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="rate"
            tickFormatter={(v: number) => `${v}%`}
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={formatDebtCompact}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            formatter={(value: number | undefined) => [
              formatDebtCompact(value ?? 0),
              "Debt",
            ]}
            labelFormatter={(label: number) => `${label}%`}
          />
          <Bar dataKey="debt" radius={[2, 2, 0, 0]}>
            {chartData.map((point, index) => (
              <Cell
                key={`bar-${index}`}
                fill={
                  point.isCurrentRate
                    ? "var(--color-currentDebt)"
                    : "var(--color-debt)"
                }
                opacity={point.isCurrentRate ? 1 : 0.6}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
