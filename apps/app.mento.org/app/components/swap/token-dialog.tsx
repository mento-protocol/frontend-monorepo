"use client";

import { useAccountBalances } from "@/features/accounts/use-account-balances";
import {
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  ScrollArea,
  TokenIcon,
} from "@repo/ui";
import { ChevronLeft, ChevronsRight, Search } from "lucide-react";
import { Fragment, useState } from "react";
import { useAccount, useChainId } from "wagmi";

import { useTokenOptions } from "@/features/swap/hooks/use-token-options";
import type { TokenId } from "@/features/swap/types";
import { fromWeiRounded } from "@/lib/utils/amount";
import { Input } from "@repo/ui";

interface TokenDialogProps {
  value: string;
  onValueChange: (value: string) => void;
  trigger: React.ReactNode;
  title?: string;
  fromTokenId?: TokenId;
  excludeTokenId?: string;
}

export default function TokenDialog({
  value,
  onValueChange,
  trigger,
  title = "Select asset to sell",
  fromTokenId,
  excludeTokenId,
}: TokenDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const [search, setSearch] = useState("");
  const { address } = useAccount();
  const chainId = useChainId();

  const { data: balancesFromHook } = useAccountBalances({ address, chainId });
  const { tokenOptions, allTokenOptions } = useTokenOptions(
    fromTokenId,
    balancesFromHook,
  );

  // Filter tokens based on search input
  const filteredTokens = (fromTokenId ? tokenOptions : allTokenOptions)
    .filter(
      (token) =>
        token.symbol.toLowerCase().includes(search.toLowerCase()) ||
        token.name.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((token) => token.id !== excludeTokenId)
    .map((token) => {
      const balanceValue = balancesFromHook?.[token.id];
      const balance = fromWeiRounded(balanceValue, token.decimals);

      return {
        ...token,
        balance,
      };
    });

  const handleTokenSelect = (tokenId: TokenId) => {
    onValueChange(tokenId);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="!pb-0 sm:max-w-md">
        <DialogHeader>
          <DialogClose>
            <DialogTitle className="flex items-center gap-2 text-lg font-normal">
              <ChevronLeft />
              {title}
            </DialogTitle>
          </DialogClose>
        </DialogHeader>
        <div className="relative">
          <Search
            className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"
            size={24}
          />
          <Input
            placeholder="Search..."
            className="h-12 !pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ScrollArea className="h-[calc(100vh-20rem)]">
          {filteredTokens.map((token, index) => (
            <Fragment key={token.id}>
              <div
                className={cn(
                  "hover:bg-accent group flex w-full items-center justify-between p-2 text-left hover:cursor-pointer",
                  value === token.id && "bg-accent",
                )}
                onClick={() => {
                  handleTokenSelect(token.id);
                }}
                onKeyUp={(e) => {
                  if (e.key === "Enter") {
                    handleTokenSelect(token.id);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="group relative grid h-10 w-10 place-content-center">
                    <TokenIcon
                      token={{
                        id: token.id,
                        symbol: token.symbol,
                        name: token.name,
                        color: token.color || "#000000",
                        decimals: token.decimals || 18,
                      }}
                      className="absolute transition-opacity group-hover:opacity-0"
                      size={24}
                    />
                    <div className="bg-primary text-primary-foreground absolute grid h-10 w-10 place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <ChevronsRight />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{token.symbol}</div>
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
              {index < filteredTokens.length - 1 && (
                <hr className="border-[var(--border)]" />
              )}
            </Fragment>
          ))}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
