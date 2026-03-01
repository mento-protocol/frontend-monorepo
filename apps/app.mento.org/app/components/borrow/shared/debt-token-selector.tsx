"use client";

import { useAtom } from "jotai";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
} from "@repo/ui";
import {
  selectedDebtTokenAtom,
  DEBT_TOKEN_CONFIGS,
  type DebtTokenConfig,
} from "@repo/web3";

interface DebtTokenOption {
  config: DebtTokenConfig;
  comingSoon: boolean;
}

const DEBT_TOKEN_OPTIONS: DebtTokenOption[] = [
  { config: DEBT_TOKEN_CONFIGS.GBPm!, comingSoon: false },
  {
    config: { symbol: "CHFm", currencySymbol: "Fr", currencyCode: "CHF", locale: "de-CH" },
    comingSoon: true,
  },
  {
    config: { symbol: "JPYm", currencySymbol: "¥", currencyCode: "JPY", locale: "ja-JP" },
    comingSoon: true,
  },
];

export function DebtTokenSelector() {
  const [selectedToken, setSelectedToken] = useAtom(selectedDebtTokenAtom);

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
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DEBT_TOKEN_OPTIONS.map((option) => (
          <SelectItem
            key={option.config.symbol}
            value={option.config.symbol}
            disabled={option.comingSoon}
          >
            <span className="flex items-center gap-2">
              {option.config.symbol}
              {option.comingSoon && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Soon
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
