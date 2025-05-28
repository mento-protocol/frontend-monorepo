"use client";

import { SwitchButton } from "@/components/buttons/switch-button";
import { config } from "@/lib/config/config";
import { useAtom } from "jotai/react";
import { showSlippageAtom, showChartAtom } from "../swap-atoms";
import { Cog } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui";

export function SettingsMenu() {
  const [showSlippage, setShowSlippage] = useAtom(showSlippageAtom);
  const [showChart, setShowChart] = useAtom(showChartAtom);

  const onToggleSlippage = (checked: boolean) => {
    setShowSlippage(checked);
  };

  const onToggleChart = (checked: boolean) => {
    setShowChart(checked);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="border-border bg-background hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground h-9 w-9 rounded-full"
          aria-label="Settings"
        >
          <Cog size={18} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="left"
        sideOffset={8}
        className="w-56"
      >
        <DropdownMenuItem
          className="flex cursor-default items-center justify-between gap-3 py-3"
          onSelect={(e) => e.preventDefault()}
        >
          <span className="text-sm font-medium">Show Slippage</span>
          <SwitchButton checked={showSlippage} onChange={onToggleSlippage} />
        </DropdownMenuItem>
        {config.showPriceChart && (
          <DropdownMenuItem
            className="flex cursor-default items-center justify-between gap-3 py-3"
            onSelect={(e) => e.preventDefault()}
          >
            <span className="text-sm font-medium">Toggle Chart</span>
            <SwitchButton checked={showChart} onChange={onToggleChart} />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
