"use client";

import {
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  IconLoading,
  Input,
  ScrollArea,
  TokenIcon,
} from "@repo/ui";
import {
  formatBalance,
  formatWithMaxDecimals,
  useAccountBalances,
  useTokenOptions,
  useTradablePairs,
} from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { ChevronLeft, ChevronsRight, Search } from "lucide-react";
import { useState } from "react";

interface TokenDialogProps {
  value: string;
  onValueChange: (value: string) => void;
  trigger: React.ReactNode;
  title?: string;
  tokenInSymbol?: TokenSymbol;
  excludeTokenSymbol?: TokenSymbol;
  filterByTokenSymbol?: TokenSymbol;
  onClose?: () => void;
}

interface TokenEntry {
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  balance: string;
  isValidPair: boolean;
}

export default function TokenDialog({
  value,
  onValueChange,
  trigger,
  title = "Select asset to sell",
  tokenInSymbol,
  excludeTokenSymbol,
  filterByTokenSymbol,
  onClose,
}: TokenDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { address } = useAccount();
  const chainId = useChainId();

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });

  const { tokenOptions, allTokenOptions } = useTokenOptions(
    tokenInSymbol,
    balancesFromHook,
  );

  const { data: tradableTokenSymbols, isLoading: isLoadingTradablePairs } =
    useTradablePairs(filterByTokenSymbol);

  const filteredTokens = (tokenInSymbol ? tokenOptions : allTokenOptions)
    .filter(
      (token) =>
        token.symbol.toLowerCase().includes(search.toLowerCase()) ||
        token.name?.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((token) => token.symbol !== excludeTokenSymbol)
    .map((token) => {
      const balanceValue = balancesFromHook?.[token.symbol as TokenSymbol];
      const balance = formatBalance(balanceValue ?? "0", token.decimals);

      const isValidPair =
        !filterByTokenSymbol ||
        isLoadingTradablePairs ||
        !tradableTokenSymbols ||
        tradableTokenSymbols.includes(token.symbol as TokenSymbol);

      return {
        ...token,
        balance: formatWithMaxDecimals(balance),
        isValidPair,
      };
    })
    .sort((a, b) => {
      if (a.isValidPair && !b.isValidPair) return -1;
      if (!a.isValidPair && b.isValidPair) return 1;
      return 0;
    });

  const validTokens = filteredTokens.filter((t) => t.isValidPair);
  const unavailableTokens = filteredTokens.filter((t) => !t.isValidPair);

  const showSectionHeaders = !isLoadingTradablePairs;

  const handleTokenSelect = (tokenSymbol: TokenSymbol) => {
    onValueChange(tokenSymbol);
    setIsOpen(false);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open && onClose) onClose();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="!pb-0 sm:max-w-md"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogClose>
            <DialogTitle className="gap-2 text-lg font-normal flex items-center">
              <ChevronLeft />
              {title}
            </DialogTitle>
          </DialogClose>
        </DialogHeader>
        <div className="relative">
          <Search className="left-3 h-4 w-4 absolute top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="search"
            autoFocus
            placeholder="Search..."
            className="h-12 !pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoadingTradablePairs && filterByTokenSymbol ? (
          <div
            className="py-8 flex items-center justify-center"
            data-testid="loader"
          >
            <IconLoading />
          </div>
        ) : (
          <ScrollArea className="pr-3 h-[calc(100vh-20rem)]">
            {showSectionHeaders && validTokens.length > 0 && (
              <SectionHeader label="Available Assets" className="pt-3" />
            )}
            {validTokens.map((token, index) => (
              <TokenRow
                key={token.symbol}
                token={token}
                isSelected={value === token.symbol}
                isLast={index === validTokens.length - 1}
                onSelect={() => handleTokenSelect(token.symbol as TokenSymbol)}
                testId={`tokenOption_${token.symbol}`}
              />
            ))}

            {showSectionHeaders && unavailableTokens.length > 0 && (
              <SectionHeader label="No route available" className="pt-4" />
            )}
            {unavailableTokens.map((token, index) => (
              <TokenRow
                key={token.symbol}
                token={token}
                isSelected={value === token.symbol}
                isLast={index === unavailableTokens.length - 1}
                onSelect={() => {}}
                testId={`tokenOption_${token.symbol}_invalid`}
                className="pointer-events-none opacity-50"
              />
            ))}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "top-0 px-2 pb-1 text-xs font-semibold tracking-wider sticky z-10 bg-card text-muted-foreground uppercase",
        className,
      )}
    >
      {label}
    </div>
  );
}

function TokenRow({
  token,
  isSelected,
  isLast,
  onSelect,
  testId,
  className,
}: {
  token: TokenEntry;
  isSelected: boolean;
  isLast: boolean;
  onSelect: () => void;
  testId: string;
  className?: string;
}) {
  return (
    <>
      <div
        className={cn(
          "group p-2 flex w-full items-center justify-between text-left hover:cursor-pointer hover:bg-accent",
          isSelected && "bg-accent",
          className,
        )}
        data-testid={testId}
        onClick={onSelect}
        onKeyUp={(e) => {
          if (e.key === "Enter") onSelect();
        }}
      >
        <div className="gap-2 flex items-center">
          <div className="group h-10 w-10 relative grid place-content-center">
            <TokenIcon
              token={{
                address: token.address,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
              }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 group-hover:opacity-0"
              size={24}
            />
            <div className="h-10 w-10 absolute grid place-items-center bg-primary text-primary-foreground opacity-0 group-hover:opacity-100">
              <ChevronsRight />
            </div>
          </div>
          <div className="gap-2 flex items-center">
            <div className="font-medium">{token.symbol}</div>
            <div className="text-xs text-muted-foreground">{token.name}</div>
          </div>
        </div>
        {token.balance && token.balance !== "0" && (
          <div className="text-sm">
            {token.balance} {token.symbol}
          </div>
        )}
      </div>
      {!isLast && <hr className="border-[var(--border)]" />}
    </>
  );
}
