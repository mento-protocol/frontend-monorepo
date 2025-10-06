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
  ScrollArea,
  TokenIcon,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui";
import { useAccountBalances } from "@repo/web3";
import { useAccount, useChainId } from "@repo/web3/wagmi";
import { ChevronLeft, ChevronsRight, Search } from "lucide-react";
import { Fragment, useState } from "react";

import { TokenSymbol } from "@mento-protocol/mento-sdk";
import { Input } from "@repo/ui";
import {
  formatWithMaxDecimals,
  fromWeiRounded,
  useTokenOptions,
  useTradablePairs,
} from "@repo/web3";

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

  // Get tradable pairs if filterByTokenSymbol is provided
  const { data: tradableTokenSymbols, isLoading: isLoadingTradablePairs } =
    useTradablePairs(filterByTokenSymbol);
  // Filter tokens based on search input and exclude the token that's already selected
  const filteredTokens = (tokenInSymbol ? tokenOptions : allTokenOptions)
    .filter(
      (token) =>
        token.symbol.toLowerCase().includes(search.toLowerCase()) ||
        token.name.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((token) => token.symbol !== excludeTokenSymbol)
    .map((token) => {
      const balanceValue = balancesFromHook?.[token.symbol];
      const balance = fromWeiRounded(balanceValue, token.decimals);

      // Check if this token is a valid pair with the filterByTokenSymbol
      // Show as valid if: no filter, still loading, or token is in the valid list
      const isValidPair =
        !filterByTokenSymbol ||
        isLoadingTradablePairs ||
        !tradableTokenSymbols ||
        tradableTokenSymbols.includes(token.symbol as TokenSymbol);

      return {
        ...token,
        balance: formatWithMaxDecimals(balance),
        isValidPair: isValidPair,
      };
    })
    // Sort tokens so valid pairs maintain original order and invalid pairs move to the end
    .sort((a, b) => {
      // If one is valid and the other is invalid, valid comes first
      if (a.isValidPair && !b.isValidPair) return -1;
      if (!a.isValidPair && b.isValidPair) return 1;

      // If both have the same validity status, maintain original order
      return 0;
    });

  const handleTokenSelect = (TokenSymbol: TokenSymbol) => {
    onValueChange(TokenSymbol);
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
            <DialogTitle className="flex items-center gap-2 text-lg font-normal">
              <ChevronLeft />
              {title}
            </DialogTitle>
          </DialogClose>
        </DialogHeader>
        <div className="relative">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
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
            className="flex items-center justify-center py-8"
            data-testid="loader"
          >
            <IconLoading />
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-20rem)] pr-3">
            {filteredTokens.map((token, index) => (
              <Fragment key={token.symbol}>
                {!token.isValidPair ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            "hover:bg-accent group flex w-full items-center justify-between p-2 text-left opacity-50 hover:cursor-pointer",
                            value === token.symbol && "bg-accent",
                          )}
                          data-testid={`tokenOption_${token.symbol}_invalid`}
                          onClick={() => {
                            handleTokenSelect(token.symbol);
                          }}
                          onKeyUp={(e) => {
                            if (e.key === "Enter") {
                              handleTokenSelect(token.symbol);
                            }
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="group relative grid h-10 w-10 place-content-center">
                              <TokenIcon
                                token={{
                                  address: token.address,
                                  symbol: token.symbol,
                                  name: token.name,
                                  decimals: token.decimals || 18,
                                }}
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 group-hover:opacity-0"
                                size={24}
                              />
                              <div className="bg-primary text-primary-foreground absolute grid h-10 w-10 place-items-center opacity-0 group-hover:opacity-100">
                                <ChevronsRight />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div
                                className="font-medium"
                                data-testid={`invalidToken`}
                              >
                                {token.symbol}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {token.name}
                              </div>
                            </div>
                          </div>
                          {token.balance && token.balance !== "0" && (
                            <div className="text-sm">
                              {token.balance} {token.symbol}
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        className="!bg-incard"
                        sideOffset={6}
                        hideArrow
                      >
                        <p data-testid="invalidPairTooltip">
                          No route found to this token
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <div
                    className={cn(
                      "hover:bg-accent group flex w-full items-center justify-between p-2 text-left hover:cursor-pointer",
                      value === token.symbol && "bg-accent",
                    )}
                    data-testid={`tokenOption_${token.symbol}`}
                    onClick={() => {
                      handleTokenSelect(token.symbol);
                    }}
                    onKeyUp={(e) => {
                      if (e.key === "Enter") {
                        handleTokenSelect(token.symbol);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="group relative grid h-10 w-10 place-content-center">
                        <TokenIcon
                          token={{
                            address: token.address,
                            symbol: token.symbol,
                            name: token.name,
                            decimals: token.decimals || 18,
                          }}
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 group-hover:opacity-0"
                          size={24}
                        />
                        <div className="bg-primary text-primary-foreground absolute grid h-10 w-10 place-items-center opacity-0 group-hover:opacity-100">
                          <ChevronsRight />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="font-medium" data-testid={`validToken`}>
                          {token.symbol}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {token.name}
                        </div>
                      </div>
                    </div>
                    {token.balance && token.balance !== "0" && (
                      <div className="text-sm">
                        {token.balance} {token.symbol}
                      </div>
                    )}
                  </div>
                )}
                {index < filteredTokens.length - 1 && (
                  <hr className="border-[var(--border)]" />
                )}
              </Fragment>
            ))}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
