import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui";
import { ExternalLink } from "lucide-react";
import type { TroveStatus } from "@repo/web3";

interface TroveStatusBadgeProps {
  status: TroveStatus | null | undefined;
}

const ZOMBIE_TROVE_DOCS_URL = "https://docs.mento.org/mento-v3/dive-deeper/cdp";

export function TroveStatusBadge({ status }: TroveStatusBadgeProps) {
  if (status !== "zombie") return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          asChild
          variant="outline"
          className="border-red-500/20 bg-red-500/10 font-mono font-semibold tracking-wider text-red-500 hover:border-red-500/30 hover:bg-red-500/15 text-[11px] uppercase transition-colors"
        >
          <button
            type="button"
            aria-label="What is a zombie trove?"
            className="cursor-help"
          >
            Zombie
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="space-y-2 max-w-[240px]">
        <p className="leading-relaxed">
          A zombie trove is still your position, but its debt fell below the
          protocol minimum. This can happen after a redemption.
        </p>
        <a
          href={ZOMBIE_TROVE_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="gap-1.5 inline-flex items-center text-primary hover:underline"
        >
          Learn about Troves and redemptions
          <ExternalLink className="h-3 w-3" />
        </a>
      </TooltipContent>
    </Tooltip>
  );
}
