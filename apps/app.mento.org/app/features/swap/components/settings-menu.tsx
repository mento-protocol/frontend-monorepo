"use client";

import { SwitchButton } from "@/components/buttons/switch-button";
import { config } from "@/lib/config/config";
import { useAtom } from "jotai/react";
import { showSlippageAtom, showChartAtom } from "../swap-atoms";
import { Cog } from "lucide-react";
import { DropdownModal } from "@/components/layout/dropdown";

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
    <DropdownModal
      placement="left"
      placementOffset={8}
      buttonContent={(open) => (
        <span
          className={`${
            open
              ? "bg-primary-dark border dark:border-[#545457] dark:bg-transparent"
              : "dark:border-none dark:bg-[#545457]"
          } border-primary-dark item-center flex h-9 w-9 justify-center rounded-full border`}
        >
          <Cog
            className={`${open ? "block" : "hidden"} m-0 dark:block`}
            size={18}
          />
          <Cog
            className={`${open ? "hidden" : ""} m-0 dark:hidden`}
            size={18}
          />
        </span>
      )}
      buttonTitle="Settings"
      buttonClasses="p-1 flex items-center justify-center "
      modalContent={() => (
        <div className="p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="whitespace-nowrap">Show Slippage</div>
            <SwitchButton checked={showSlippage} onChange={onToggleSlippage} />
          </div>
          {config.showPriceChart && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <div>Toggle Chart</div>
              <SwitchButton checked={showChart} onChange={onToggleChart} />
            </div>
          )}
        </div>
      )}
      modalClasses="rounded-xl border border-primary-dark dark:border-none dark:bg-[#404043] dark:text-white"
    />
  );
}
