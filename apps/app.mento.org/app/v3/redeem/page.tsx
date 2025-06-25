"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TokenIcon,
} from "@repo/ui";
import { Info } from "lucide-react";
import { cUSD, cEUR } from "@/lib/config/tokens";

const redeemableTokens = [cUSD, cEUR];

export default function RedeemPage() {
  const [redeemAmount, setRedeemAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState(cUSD);

  // Mock price data
  const mockPrices = {
    [cUSD.id]: 1.0,
    [cEUR.id]: 0.92,
  };

  const handleRedeem = () => {
    if (!redeemAmount || parseFloat(redeemAmount) <= 0) {
      alert("Please enter a valid amount to redeem.");
      return;
    }
    alert(`Redeeming ${redeemAmount} ${selectedToken.symbol} (This is a demo)`);
    setRedeemAmount("");
  };

  const formatPrice = (price: number, decimals = 2) =>
    `$${price.toFixed(decimals)}`;

  const redeemValue = parseFloat(redeemAmount) || 0;

  return (
    <div className="container mx-auto max-w-2xl space-y-8 p-4 md:p-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="mb-2 text-3xl font-bold text-slate-900">
          Redeem Collateral
        </h1>
        <p className="text-slate-700">
          Exchange cUSD for system collateral at face value.
        </p>
      </div>

      {/* Main Form */}
      <Card className="space-y-6 p-6">
        {/* Amount to Redeem Input */}
        <div className="space-y-2">
          <Label
            htmlFor="redeem-amount"
            className="text-sm font-medium text-slate-900"
          >
            Amount to Redeem
          </Label>
          <div className="relative">
            <Input
              id="redeem-amount"
              type="number"
              placeholder="0.00"
              className="h-16 pr-32 text-2xl"
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(e.target.value)}
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              <Select
                value={selectedToken.id}
                onValueChange={(val) =>
                  setSelectedToken(
                    redeemableTokens.find((t) => t.id === val) || cUSD,
                  )
                }
              >
                <SelectTrigger className="h-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4">
                  <div className="flex items-center gap-2">
                    <TokenIcon token={selectedToken} size={20} />
                    <span className="text-slate-800">
                      {selectedToken.symbol}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-white text-slate-900">
                  {redeemableTokens.map((token) => (
                    <SelectItem
                      key={token.id}
                      value={token.id}
                      className="hover:bg-slate-100"
                    >
                      <div className="flex items-center gap-2">
                        <TokenIcon token={token} size={16} />
                        {token.symbol}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-between text-sm text-slate-700">
            <span>
              Value:{" "}
              {formatPrice(redeemValue * (mockPrices[selectedToken.id] || 0))}
            </span>
            <span>
              {selectedToken.symbol} Price:{" "}
              {formatPrice(mockPrices[selectedToken.id] || 0)}
            </span>
          </div>
        </div>

        <Button
          onClick={handleRedeem}
          className="h-12 w-full text-lg"
          disabled={!redeemAmount || parseFloat(redeemAmount) <= 0}
        >
          Redeem {selectedToken.symbol}
        </Button>
      </Card>

      {/* Redemptions Explained */}
      <Card className="border-l-4 border-purple-500 bg-purple-50/80 p-6">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-900">
              Redemptions Explained
            </h3>
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                Redemptions are a key mechanism for maintaining the peg of Mento
                stablecoins (like cUSD). When you redeem, you exchange your cUSD
                for an equivalent USD value of collateral (e.g., CELO) from the
                system.
              </p>
              <p>
                This process targets the riskiest Troves (those with the lowest
                collateralization ratios). The redeemed collateral is taken from
                these Troves, and their debt is reduced accordingly.
              </p>
              <p>
                Redemptions are always processed at face value (e.g., 1 cUSD for
                $1 worth of collateral), regardless of the current market price
                of the stablecoin. This creates an arbitrage opportunity if the
                stablecoin trades below its peg, incentivizing users to redeem
                and push the price back up.
              </p>
              <p>A small redemption fee may apply.</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
