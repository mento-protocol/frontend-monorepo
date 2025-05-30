"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";
import { Button } from "./ui/button.js";

export function ReserveHoldingsTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">Hover</Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Add to library</p>
      </TooltipContent>
    </Tooltip>
  );
}
