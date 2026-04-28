import type { PoolDisplay } from "./types";

export type RebalanceSeverity = "balanced" | "mild" | "moderate" | "severe";

export interface SeverityInfo {
  severity: RebalanceSeverity;
  label: string;
  description: string;
  deviationPercent: number;
}

export interface SeverityColors {
  badge: string;
  badgeHover: string;
  accent: string;
  dot: string;
  button: string;
  panelBg: string;
  panelBorder: string;
  accentLine: string;
  labelColor: string;
}

export function getPoolSeverity(pool: PoolDisplay): SeverityInfo {
  const deviation =
    pool.priceAlignment.priceDifferencePercent ??
    (pool.pricing?.deviationBps ? pool.pricing.deviationBps / 100 : 0);

  const absDeviation = Math.abs(deviation);

  if (absDeviation < 10) {
    return {
      severity: "balanced",
      label: "",
      description: "",
      deviationPercent: absDeviation,
    };
  }

  if (absDeviation < 25) {
    return {
      severity: "mild",
      label: "Rebalance",
      description: "Pool needs rebalancing",
      deviationPercent: absDeviation,
    };
  }

  if (absDeviation < 40) {
    return {
      severity: "moderate",
      label: "Imbalanced",
      description: "Pool is imbalanced",
      deviationPercent: absDeviation,
    };
  }

  return {
    severity: "severe",
    label: "Critical",
    description: "Pool is critical",
    deviationPercent: absDeviation,
  };
}

export function getSeverityColors(
  severity: RebalanceSeverity,
): SeverityColors | null {
  switch (severity) {
    case "balanced":
      return null;
    case "mild":
      return {
        badge:
          "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
        badgeHover: "hover:bg-amber-200 dark:hover:bg-amber-500/30",
        accent: "from-amber-500/50 to-transparent",
        dot: "bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]",
        button: "bg-amber-600 hover:bg-amber-700 text-white",
        panelBg: "bg-amber-500/5",
        panelBorder: "border-amber-500/10",
        accentLine: "from-amber-500/60 to-transparent",
        labelColor: "text-amber-600 dark:text-amber-400",
      };
    case "moderate":
      return {
        badge:
          "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
        badgeHover: "hover:bg-orange-200 dark:hover:bg-orange-500/30",
        accent: "from-orange-500/50 to-transparent",
        dot: "bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.5)]",
        button: "bg-orange-600 hover:bg-orange-700 text-white",
        panelBg: "bg-orange-500/5",
        panelBorder: "border-orange-500/10",
        accentLine: "from-orange-500/60 to-transparent",
        labelColor: "text-orange-600 dark:text-orange-400",
      };
    case "severe":
      return {
        badge: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
        badgeHover: "hover:bg-red-200 dark:hover:bg-red-500/30",
        accent: "from-red-500/50 to-transparent",
        dot: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
        button: "bg-red-600 hover:bg-red-700 text-white",
        panelBg: "bg-red-500/5",
        panelBorder: "border-red-500/10",
        accentLine: "from-red-500/60 to-transparent",
        labelColor: "text-red-600 dark:text-red-400",
      };
  }
}
