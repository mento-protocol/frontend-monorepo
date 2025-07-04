"use client";
import NumbersService from "@/lib/helpers/numbers";
import useTokens from "@/lib/hooks/use-tokens";
import { Button } from "@repo/ui";
import { ChevronsRight, Zap } from "lucide-react";
import Link from "next/link";
import { formatUnits } from "viem";

export const VotingPowerCard = () => {
  const { veMentoBalance, mentoBalance } = useTokens();

  return (
    <div className="bg-card w-full">
      <h3 className="bg-incard flex items-center gap-2 px-6 py-5 text-2xl">
        <Zap /> Voting Power
      </h3>
      <div className="flex flex-col gap-4 px-6 pt-6 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">MENTO</span>
          <span>
            {NumbersService.parseNumericValue(
              formatUnits(mentoBalance.value, mentoBalance.decimals),
            )}
          </span>
        </div>
        <hr />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">veMENTO</span>
          <span>
            {NumbersService.parseNumericValue(
              formatUnits(veMentoBalance.value, veMentoBalance.decimals),
            )}
          </span>
        </div>
        <hr />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Expires</span>
          <span>{"17.10.2027"}</span>
        </div>
      </div>
      <div className="p-6">
        <Link href="/voting-power">
          <Button className="h-10 w-full" clipped="sm">
            Manage
            <ChevronsRight size={20} />
          </Button>
        </Link>
      </div>
    </div>
  );
};
