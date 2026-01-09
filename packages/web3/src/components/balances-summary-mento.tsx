"use client";

import { NumbersService } from "@/utils/numbers";
import { IconMento } from "@repo/ui";
import { useAddTokens, useTokens } from "@repo/web3";

export function BalancesSummaryMento() {
  const { mentoBalance, veMentoBalance } = useTokens();
  const { addMento, addVeMento } = useAddTokens();

  const totalVotingPower =
    Number(veMentoBalance.formatted) > 1
      ? NumbersService.parseNumericValue(veMentoBalance.formatted, 1)
      : Number(veMentoBalance.formatted).toLocaleString(undefined, {
          maximumFractionDigits: 3,
        });

  return (
    <div className="flex w-full flex-col">
      <div
        title="Click to add MENTO to your wallet"
        onClick={addMento}
        className="px-2 py-3 flex w-full cursor-pointer flex-row justify-between"
      >
        <div className="font-medium flex flex-row items-center">
          <IconMento className="mr-2" height={24} width={24} />
          <span>{mentoBalance.symbol}</span>
        </div>
        <div className="font-medium flex flex-row items-center justify-center">
          {NumbersService.parseNumericValue(mentoBalance.formatted, 1)}
        </div>
      </div>
      <hr className="mx-auto w-[calc(100%_-_32px)] border-border" />
      <div
        title="Click to add veMENTO to your wallet"
        onClick={addVeMento}
        className="px-2 py-3 flex w-full cursor-pointer flex-row justify-between"
      >
        <div className="font-medium flex flex-row items-center">
          <IconMento className="mr-2" height={24} width={24} />
          <span>{veMentoBalance.symbol}</span>
        </div>
        <div className="font-medium flex flex-row items-center justify-center">
          {totalVotingPower}
        </div>
      </div>
    </div>
  );
}
