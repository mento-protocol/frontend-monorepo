"use client";

import { useAtom } from "jotai";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  TokenIcon,
} from "@repo/ui";
import {
  selectedDebtTokenAtom,
  DEBT_TOKEN_CONFIGS,
  type DebtTokenConfig,
} from "@repo/web3";
import { useChainId } from "@repo/web3/wagmi";
import { getTokenAddress, type TokenSymbol } from "@mento-protocol/mento-sdk";

interface DebtTokenOption {
  config: DebtTokenConfig;
  comingSoon: boolean;
}

const DEBT_TOKEN_OPTIONS: DebtTokenOption[] = [
  { config: DEBT_TOKEN_CONFIGS.GBPm!, comingSoon: false },
  {
    config: {
      symbol: "CHFm",
      currencySymbol: "Fr",
      currencyCode: "CHF",
      locale: "de-CH",
    },
    comingSoon: true,
  },
  {
    config: {
      symbol: "JPYm",
      currencySymbol: "¥",
      currencyCode: "JPY",
      locale: "ja-JP",
    },
    comingSoon: true,
  },
];

export function DebtTokenSelector() {
  const [selectedToken, setSelectedToken] = useAtom(selectedDebtTokenAtom);
  const chainId = useChainId();

  const getAddress = (symbol: string) => {
    try {
      return getTokenAddress(chainId, symbol as TokenSymbol);
    } catch {
      return undefined;
    }
  };

  return (
    <Select
      value={selectedToken.symbol}
      onValueChange={(symbol) => {
        const option = DEBT_TOKEN_OPTIONS.find(
          (o) => o.config.symbol === symbol,
        );
        if (option && !option.comingSoon) {
          setSelectedToken(option.config);
        }
      }}
    >
      <SelectTrigger className="gap-2 px-3 py-2 font-medium w-auto border border-border bg-transparent shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DEBT_TOKEN_OPTIONS.map((option) => {
          const address = getAddress(option.config.symbol);
          return (
            <SelectItem
              key={option.config.symbol}
              value={option.config.symbol}
              disabled={option.comingSoon}
              className="py-2.5 pl-3 pr-9"
            >
              <div className="gap-2.5 flex items-center">
                {address && (
                  <TokenIcon
                    token={{
                      address,
                      symbol: option.config.symbol,
                    }}
                    size={22}
                    className="rounded-full"
                  />
                )}
                {option.config.symbol}
                {option.comingSoon && (
                  <Badge
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px]"
                  >
                    Soon
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
