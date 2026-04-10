"use client";

import type { RiskLevel } from "@repo/web3";

interface LTVBarProps {
  ltv: number;
  maxLtv: number;
  risk: RiskLevel | null;
}

export function LTVBar({ ltv, maxLtv, risk }: LTVBarProps) {
  const hasValue = ltv > 0;
  const riskLabels: Record<RiskLevel, string> = {
    low: "Safe",
    medium: "Moderate",
    high: "At Risk",
  };
  const riskColors: Record<RiskLevel, string> = {
    low: "text-green-400",
    medium: "text-amber-400",
    high: "text-red-400",
  };
  const riskBg: Record<RiskLevel, string> = {
    low: "bg-green-400/10",
    medium: "bg-amber-400/10",
    high: "bg-red-400/10",
  };
  const segments = [
    {
      end: 40,
      label: "SAFE",
      color: "bg-green-400",
      textColor: "text-green-400/30",
    },
    {
      end: 60,
      label: "MODERATE",
      color: "bg-amber-400",
      textColor: "text-amber-400/30",
    },
    {
      end: 80,
      label: "RISKY",
      color: "bg-orange-400",
      textColor: "text-orange-400/30",
    },
    {
      end: 90,
      label: "LIQ",
      color: "bg-red-400",
      textColor: "text-red-400/30",
    },
  ];

  const getProgressColor = (value: number): string => {
    if (value < 40) return "from-green-400 to-green-400";
    if (value < 60) return "from-green-400 to-amber-400";
    if (value < 80) return "from-green-400 to-orange-400";
    return "from-green-400 to-red-400";
  };

  const getGlowColor = (value: number): string => {
    if (value < 40) return "shadow-green-400/40";
    if (value < 60) return "shadow-amber-400/40";
    if (value < 80) return "shadow-orange-400/40";
    return "shadow-red-400/40";
  };

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-baseline justify-between">
        <div className="gap-2.5 flex items-center">
          <span
            className={`text-2xl font-bold tracking-tight ${
              hasValue && risk ? riskColors[risk] : "text-muted-foreground/15"
            }`}
          >
            {hasValue ? `${ltv.toFixed(1)}%` : "\u2014"}
          </span>
          {hasValue && risk && (
            <span
              className={`rounded px-2 py-0.5 font-mono font-semibold tracking-wider text-[11px] uppercase ${riskColors[risk]} ${riskBg[risk]}`}
            >
              {riskLabels[risk]}
            </span>
          )}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground/30">
          Liquidation at {Math.round(maxLtv)}%
        </span>
      </div>

      <div className="h-2 relative w-full overflow-hidden rounded-full bg-muted/30">
        <div className="inset-0 absolute flex overflow-hidden rounded-full">
          {segments.map((seg, i) => {
            const prevEnd = i === 0 ? 0 : (segments[i - 1]?.end ?? 0);
            const width = ((seg.end - prevEnd) / maxLtv) * 100;
            return (
              <div
                key={i}
                className={`${seg.color} opacity-[0.06]`}
                style={{ width: `${width}%` }}
              />
            );
          })}
        </div>
        {hasValue && (
          <div
            className={`inset-y-0 left-0 absolute rounded-full bg-gradient-to-r ${getProgressColor(ltv)} shadow-lg ${getGlowColor(ltv)} ease-out transition-[width] duration-300`}
            style={{ width: `${Math.min((ltv / maxLtv) * 100, 100)}%` }}
          />
        )}
      </div>

      <div className="mt-3 flex">
        {segments.map((seg, i) => {
          const prevEnd = i === 0 ? 0 : (segments[i - 1]?.end ?? 0);
          const width = ((seg.end - prevEnd) / maxLtv) * 100;
          return (
            <div key={i} className="text-center" style={{ width: `${width}%` }}>
              <span
                className={`font-mono tracking-wider text-[9px] ${seg.textColor}`}
              >
                {seg.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
