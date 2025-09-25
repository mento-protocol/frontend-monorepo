"use client";

import { useAddTokens } from "@/features/governance/use-add-tokens";
import { useTokens } from "@/features/governance/use-tokens";
import { NumbersService } from "@/utils/numbers";
import { IconMento } from "@repo/ui";
import { formatUnits } from "viem";

export function BalancesSummaryMento() {
  const { mentoBalance, veMentoBalance } = useTokens();
  const { addMento, addVeMento } = useAddTokens();

  return (
    <div className="flex w-full flex-col">
      <div
        title="Click to add MENTO to your wallet"
        onClick={addMento}
        className="flex w-full cursor-pointer flex-row justify-between px-2 py-3"
      >
        <div className="flex flex-row items-center font-medium">
          <IconMento className="mr-2" height={24} width={24} />
          <span>{mentoBalance.symbol}</span>
        </div>
        <div className="flex flex-row items-center justify-center font-medium">
          {NumbersService.formatCompactNumber(formatUnits(mentoBalance.value, mentoBalance.decimals))}
        </div>
      </div>
      <hr className="border-border mx-auto w-[calc(100%_-_32px)]" />
      <div
        title="Click to add veMENTO to your wallet"
        onClick={addVeMento}
        className="flex w-full cursor-pointer flex-row justify-between px-2 py-3"
      >
        <div className="flex flex-row items-center font-medium">
          <IconMento className="mr-2" height={24} width={24} />
          <span>{veMentoBalance.symbol}</span>
        </div>
        <div className="flex flex-row items-center justify-center font-medium">
          {NumbersService.formatCompactNumber(formatUnits(veMentoBalance.value, veMentoBalance.decimals))}
        </div>
      </div>
    </div>
  );
}
