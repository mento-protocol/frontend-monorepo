"use client";

import { CoinInput } from "@repo/ui";
import { formatCompactBalance, tryParseUnits } from "@repo/web3";
import { useAccount, useReadContract, useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";
import { erc20Abi, formatUnits, type Address } from "viem";

interface CollateralInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function CollateralInput({ value, onChange }: CollateralInputProps) {
  const { address } = useAccount();
  const chainId = useChainId();

  const collateralAddress = getTokenAddress(chainId, "USDm" as TokenSymbol) as
    | Address
    | undefined;

  const { data: balance } = useReadContract({
    address: collateralAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!collateralAddress },
  });

  const formattedBalance = balance ? formatUnits(balance, 18) : "0";

  const parsedAmount = tryParseUnits(value, 18);
  const insufficient =
    parsedAmount !== null && balance !== undefined && parsedAmount > balance;

  const handleMax = () => {
    onChange(formattedBalance);
  };

  return (
    <div className="gap-2 flex flex-col">
      <div className="flex items-center justify-between">
        <div className="gap-2 flex items-center">
          <span className="text-sm font-medium">Collateral</span>
          <span className="text-sm text-muted-foreground">USDm</span>
        </div>
        <div className="text-sm text-muted-foreground">
          Balance: {formatCompactBalance(formattedBalance)}{" "}
          <button
            type="button"
            className="font-medium cursor-pointer text-primary hover:underline"
            onClick={handleMax}
          >
            MAX
          </button>
        </div>
      </div>
      <CoinInput
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
        placeholder="0"
        className={`shadow-xs h-10 px-3 text-sm placeholder:text-sm border border-input focus-within:border-primary focus:border-primary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${insufficient ? "border-destructive" : ""}`}
      />
      {insufficient && (
        <p className="text-xs text-destructive">Insufficient USDm balance</p>
      )}
    </div>
  );
}
