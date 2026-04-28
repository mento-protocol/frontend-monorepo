"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  TokenIcon,
} from "@repo/ui";
import { useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";

export interface TokenDropdownOption {
  symbol: string;
  disabled?: boolean;
  badge?: string;
}

interface TokenDropdownProps {
  value: string;
  onValueChange: (symbol: string) => void;
  options: TokenDropdownOption[];
  disabled?: boolean;
  triggerClassName?: string;
}

export function TokenDropdown({
  value,
  onValueChange,
  options,
  disabled = false,
  triggerClassName,
}: TokenDropdownProps) {
  const chainId = useChainId();

  const getAddress = (symbol: string) => {
    try {
      return getTokenAddress(chainId, symbol as TokenSymbol);
    } catch {
      return undefined;
    }
  };

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={
          triggerClassName ??
          "gap-2 px-3 py-2 font-medium w-auto border border-border bg-transparent shadow-none"
        }
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => {
          const address = getAddress(option.symbol);
          return (
            <SelectItem
              key={option.symbol}
              value={option.symbol}
              disabled={option.disabled}
              className="py-2.5 pl-3 pr-9"
            >
              <div className="gap-2.5 flex items-center">
                {address && (
                  <TokenIcon
                    token={{
                      address,
                      symbol: option.symbol,
                    }}
                    size={22}
                    className="rounded-full"
                  />
                )}
                {option.symbol}
                {option.badge && (
                  <Badge
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px]"
                  >
                    {option.badge}
                  </Badge>
                )}
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
