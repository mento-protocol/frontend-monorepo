import { cn } from "@repo/ui";

export type RiskLevel = "low" | "medium" | "higher";

const riskConfig: Record<
  RiskLevel,
  { label: string; dotClass: string; textClass: string; bgClass: string }
> = {
  low: {
    label: "Lower risk",
    dotClass: "bg-emerald-400",
    textClass: "text-emerald-400",
    bgClass: "bg-emerald-400/8 border-emerald-400/10",
  },
  medium: {
    label: "Medium risk",
    dotClass: "bg-amber-400",
    textClass: "text-amber-400",
    bgClass: "bg-amber-400/8 border-amber-400/10",
  },
  higher: {
    label: "Higher risk",
    dotClass: "bg-orange-400",
    textClass: "text-orange-400",
    bgClass: "bg-orange-400/8 border-orange-400/10",
  },
};

export function RiskBadge({
  level,
  className,
}: {
  level: RiskLevel;
  className?: string;
}) {
  const config = riskConfig[level];
  return (
    <span
      className={cn(
        "gap-1.5 px-2 py-0.5 inline-flex items-center rounded-md border",
        config.bgClass,
        className,
      )}
    >
      <span className={cn("h-[5px] w-[5px] rounded-full", config.dotClass)} />
      <span
        className={cn("font-mono font-semibold text-[10px]", config.textClass)}
      >
        {config.label}
      </span>
    </span>
  );
}
