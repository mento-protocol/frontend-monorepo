"use client";

import { useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronsRight, Search } from "lucide-react";
import { useAccount, useChainId } from "wagmi";
import { useAccountBalances } from "@/features/accounts/use-account-balances";
import { cn, DialogClose, TokenIcon } from "@repo/ui";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui";

import { Input } from "@repo/ui";

interface TokenOption {
  id: string;
  name: string;
  symbol: string;
  balance?: string;
  color?: string;
  decimals?: number;
}

interface TokenDialogProps {
  value: string;
  onValueChange: (value: string) => void;
  trigger: React.ReactNode;
  title?: string;
  tokenOptions?: TokenOption[];
}

// Mock token options
const mockTokenOptions: TokenOption[] = [
  {
    id: "CELO" as TokenId,
    name: "Celo Token",
    symbol: "CELO",
    balance: "4007.12",
    color: "#FBCC5C",
    decimals: 18,
  },
  {
    id: "cUSD" as TokenId,
    name: "Celo USD",
    symbol: "cUSD",
    balance: "1000.00",
    color: "#35D07F",
    decimals: 18,
  },
  {
    id: "cEUR" as TokenId,
    name: "Celo Euro",
    symbol: "cEUR",
    balance: "607.25",
    color: "#8A2BE2",
    decimals: 18,
  },
  {
    id: "cREAL" as TokenId,
    name: "Celo Real",
    symbol: "cREAL",
    balance: "560.90",
    color: "#16A75C",
    decimals: 18,
  },
  {
    id: "USDC" as TokenId,
    name: "USD Coin",
    symbol: "USDC",
    balance: "2030.00",
    color: "#2775CA",
    decimals: 6,
  },
];

export default function TokenDialog({
  value,
  onValueChange,
  trigger,
  title = "Select asset to deposit",
  tokenOptions = mockTokenOptions,
}: TokenDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const [search, setSearch] = useState("");
  const { address } = useAccount();
  const chainId = useChainId();

  // Use the account balances hook to get real balances
  // In a real implementation, we would use these balances to update the token options
  const { data: balancesFromHook } = useAccountBalances({ address, chainId });

  // TODO: Update token balances with real data from balancesFromHook

  // Filter tokens based on search input
  const filteredTokens = tokenOptions.filter(
    (token) =>
      token.symbol.toLowerCase().includes(search.toLowerCase()) ||
      token.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
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
        <div>
          {filteredTokens.map((token, index) => (
            <>
              <div
                key={token.id}
                className={cn(
                  "hover:bg-input group flex w-full items-center justify-between p-2 text-left hover:cursor-pointer",
                  value === token.id && "bg-input",
                )}
                onClick={() => {
                  onValueChange(token.id);
                }}
                onKeyUp={(e) => {
                  if (e.key === "Enter") {
                    onValueChange(token.id);
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="relative h-10 w-10">
                    <TokenIcon
                      token={{
                        id: token.id,
                        symbol: token.symbol,
                        name: token.name,
                        color: token.color || "#000000",
                        decimals: token.decimals || 18,
                      }}
                      className="absolute transition-opacity group-hover:opacity-0"
                    />
                    <div className="bg-primary absolute grid h-10 w-10 place-items-center opacity-0 transition-opacity group-hover:opacity-100">
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
                {token.balance && (
                  <div className="text-sm">
                    {token.balance} {token.symbol}
                  </div>
                )}
              </div>
              {index < filteredTokens.length - 1 && <hr />}
            </>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
