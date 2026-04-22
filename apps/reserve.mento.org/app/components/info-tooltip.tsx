"use client";

import { IconInfo, Tooltip, TooltipTrigger, TooltipContent } from "@repo/ui";

export function InfoTooltip({
  children,
  label = "More information",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger aria-label={label} className="flex items-center">
        <IconInfo />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" hideArrow>
        <p>{children}</p>
      </TooltipContent>
    </Tooltip>
  );
}
