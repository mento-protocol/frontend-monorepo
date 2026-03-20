"use client";

import { Cell, Pie, PieChart } from "recharts";
import { type ChartConfig, ChartContainer } from "./chart.js";

/** Needle rendered as a custom SVG element inside the PieChart */
function GaugeNeedle({
  cx,
  cy,
  outerRadius,
  angleDeg,
}: {
  cx: number;
  cy: number;
  outerRadius: number;
  angleDeg: number;
}) {
  const RADIAN = Math.PI / 180;
  const needleLen = outerRadius * 0.78;
  const needleBase = 4;
  const rad = angleDeg * RADIAN;

  const tipX = cx + needleLen * Math.cos(rad);
  const tipY = cy - needleLen * Math.sin(rad);
  const baseLeftX = cx + needleBase * Math.cos(rad + Math.PI / 2);
  const baseLeftY = cy - needleBase * Math.sin(rad + Math.PI / 2);
  const baseRightX = cx + needleBase * Math.cos(rad - Math.PI / 2);
  const baseRightY = cy - needleBase * Math.sin(rad - Math.PI / 2);

  return (
    <g>
      <polygon
        points={`${tipX},${tipY} ${baseLeftX},${baseLeftY} ${baseRightX},${baseRightY}`}
        fill="white"
        opacity={0.9}
      />
      <circle cx={cx} cy={cy} r={5} fill="white" opacity={0.9} />
      <circle cx={cx} cy={cy} r={2.5} fill="#12131A" />
    </g>
  );
}

export interface BalanceGaugeProps {
  /** Left-side percentage (0–100) */
  token0Percent: number;
  /** Right-side percentage (0–100) */
  token1Percent: number;
  /** Compact reserve label for left side, e.g. "333K" */
  token0Reserves: string;
  /** Compact reserve label for right side, e.g. "667K" */
  token1Reserves: string;
  /** Symbol for token0, e.g. "GBPm" */
  token0Symbol: string;
  /** Symbol for token1, e.g. "USDm" */
  token1Symbol: string;
  /** Oracle price formatted, e.g. "1.30" */
  oraclePrice?: string;
  /** Pool price formatted, e.g. "1.42" */
  poolPrice?: string;
  /** Formatted exchange rate number, e.g. "1.33" */
  exchangeRate: string;
  /** Symbol for exchange rate input side */
  inputSymbol: string;
  /** Symbol for exchange rate output side */
  outputSymbol: string;
  /** Primary arc color CSS value, defaults to "var(--primary)" */
  primaryColor?: string;
  /** Secondary arc color CSS value, defaults to "var(--primary-border)" */
  secondaryColor?: string;
}

export function BalanceGauge({
  token0Percent,
  token1Percent,
  token0Reserves,
  token1Reserves,
  token0Symbol,
  token1Symbol,
  oraclePrice,
  poolPrice,
  exchangeRate,
  inputSymbol,
  outputSymbol,
  primaryColor = "var(--primary)",
  secondaryColor = "var(--primary-border)",
}: BalanceGaugeProps) {
  const gaugeData = [
    { name: "token0", value: token0Percent },
    { name: "token1", value: token1Percent },
  ];

  // Needle angle: 0% -> 180° (far left), 100% -> 0° (far right), 50% -> 90° (top center)
  const needleAngle = 180 - (token0Percent / 100) * 180;

  const chartConfig: ChartConfig = {
    token0: { label: token0Symbol, color: primaryColor },
    token1: { label: token1Symbol, color: secondaryColor },
    value: {},
  };

  // The PieChart renders into a 208x112 viewport. The Pie is centered at cx=50%, cy=100%
  // which in a 208-wide responsive container means cx≈104, cy≈112.
  const needleCx = 104;
  const needleCy = 112;
  const needleOuterRadius = 80;

  return (
    <div className="w-52 flex flex-col items-center">
      {/* Gauge */}
      <div className="h-28 w-52 relative">
        <ChartContainer config={chartConfig} className="h-28 w-52 aspect-auto!">
          <PieChart>
            <Pie
              data={gaugeData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={60}
              outerRadius={80}
              strokeWidth={0}
              paddingAngle={1}
              cornerRadius={3}
            >
              <Cell fill={primaryColor} />
              <Cell fill={secondaryColor} opacity={0.4} />
            </Pie>
          </PieChart>
        </ChartContainer>

        {/* Needle overlay */}
        <svg
          className="inset-0 pointer-events-none absolute h-full w-full"
          viewBox="0 0 208 112"
          preserveAspectRatio="xMidYMax meet"
        >
          <GaugeNeedle
            cx={needleCx}
            cy={needleCy}
            outerRadius={needleOuterRadius}
            angleDeg={needleAngle}
          />
        </svg>

        {/* Center reserve values */}
        <div className="inset-x-0 bottom-1 pointer-events-none absolute flex flex-col items-center">
          <span className="font-mono text-base font-bold leading-tight tabular-nums">
            {token0Reserves} <span className="text-muted-foreground/50">/</span>{" "}
            {token1Reserves}
          </span>
        </div>
      </div>

      {/* Percentages */}
      <div className="mt-0.5 px-1 flex w-full justify-between">
        <span className="font-mono text-xs font-semibold text-green-500">
          {token0Percent.toFixed(1)}%
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {token1Percent.toFixed(1)}%
        </span>
      </div>

      {/* Token symbol labels */}
      <div className="px-1 flex w-full justify-between">
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {token0Symbol}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {token1Symbol}
        </span>
      </div>

      {/* Prices & exchange rate */}
      <div className="mt-2 space-y-0.5 text-center">
        {oraclePrice && poolPrice && (
          <div className="font-mono text-[10px] text-muted-foreground/60">
            Oracle: {oraclePrice} | Pool: {poolPrice}
          </div>
        )}
        <div className="font-mono text-xs text-muted-foreground">
          1 {inputSymbol} = {exchangeRate} {outputSymbol}
        </div>
      </div>
    </div>
  );
}
