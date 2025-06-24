"use client";

import { useState, useMemo } from "react";
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
import { YourTroves } from "../../components/v3/your-troves";
import { USDm, EURm } from "@/lib/config/tokens";

const collateralTokens = [USDm];
const debtTokens = [EURm];

const MOCK_INTEREST_RATE = 2.0; // %
const MIN_COLLATERALIZATION_RATIO = 110; // %

export default function TrovePage() {
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [selectedCollateralToken, setSelectedCollateralToken] = useState(USDm);
  const [selectedDebtToken, setSelectedDebtToken] = useState(EURm);
  const [interestRate, setInterestRate] = useState(2.0);

  // Mock price data - in real app this would come from an API
  const mockPrices = {
    [USDm.id]: 1.0,
    [EURm.id]: 0.92,
  };

  const {
    collateralValue,
    debtValue,
    currentCollateralizationRatio,
    liquidationPrice,
    canOpenTrove,
  } = useMemo(() => {
    const collAmount = parseFloat(collateralAmount);
    const borrAmount = parseFloat(borrowAmount);
    const collTokenPrice = mockPrices[selectedCollateralToken.id] || 0;

    if (
      isNaN(collAmount) ||
      isNaN(borrAmount) ||
      collAmount <= 0 ||
      borrAmount <= 0 ||
      collTokenPrice <= 0
    ) {
      return {
        collateralValue: 0,
        debtValue: 0,
        currentCollateralizationRatio: 0,
        liquidationPrice: 0,
        canOpenTrove: false,
      };
    }

    const cVal = collAmount * collTokenPrice;
    const dVal = borrAmount; // Assuming debt token is stablecoin pegged to $1
    const cRatio = (cVal / dVal) * 100;
    const lPrice = (dVal * (MIN_COLLATERALIZATION_RATIO / 100)) / collAmount;

    return {
      collateralValue: cVal,
      debtValue: dVal,
      currentCollateralizationRatio: cRatio,
      liquidationPrice: lPrice,
      canOpenTrove: cRatio >= MIN_COLLATERALIZATION_RATIO,
    };
  }, [
    collateralAmount,
    borrowAmount,
    selectedCollateralToken,
    mockPrices,
    MIN_COLLATERALIZATION_RATIO,
  ]);

  const handleOpenTrove = () => {
    if (!canOpenTrove || !collateralAmount || !borrowAmount) {
      alert(
        "Please ensure all fields are filled and collateralization ratio is above minimum.",
      );
      return;
    }
    alert("Trove opened successfully! (This is a demo)");
    setCollateralAmount("");
    setBorrowAmount("");
  };

  const formatPrice = (price: number, decimals = 2) =>
    `$${price.toFixed(decimals)}`;

  return (
    <div className="container mx-auto max-w-2xl space-y-8 p-4 md:p-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="mb-2 text-3xl font-bold text-slate-800">
          Borrow {selectedDebtToken.symbol} with{" "}
          {selectedCollateralToken.symbol}
        </h1>
        <p className="text-slate-800 dark:text-slate-500">
          Open a Trove to borrow stablecoins against your collateral.
        </p>
      </div>

      {/* Main Form */}
      <Card className="space-y-6 p-6">
        {/* Collateral Input */}
        <div className="space-y-2">
          <Label
            htmlFor="collateral"
            className="text-sm font-medium text-slate-300 dark:text-slate-700"
          >
            Collateral
          </Label>
          <div className="relative">
            <Input
              id="collateral"
              type="number"
              placeholder="0.00"
              className="h-16 pr-32 text-2xl"
              value={collateralAmount}
              onChange={(e) => setCollateralAmount(e.target.value)}
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              <Select
                value={selectedCollateralToken.id}
                onValueChange={(val) =>
                  setSelectedCollateralToken(
                    collateralTokens.find((t) => t.id === val) || USDm,
                  )
                }
              >
                <SelectTrigger className="h-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  <div className="flex items-center gap-2">
                    <TokenIcon token={selectedCollateralToken} size={20} />
                    <span className="text-slate-900 dark:text-white">
                      {selectedCollateralToken.symbol}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-white text-slate-900 dark:bg-slate-800 dark:text-white">
                  {collateralTokens.map((token) => (
                    <SelectItem
                      key={token.id}
                      value={token.id}
                      className="hover:bg-slate-100 dark:hover:bg-slate-700"
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
          <div className="flex justify-between text-sm text-slate-400 dark:text-slate-500">
            <span>Value: {formatPrice(collateralValue)}</span>
            <span>
              {selectedCollateralToken.symbol} Price:{" "}
              {formatPrice(mockPrices[selectedCollateralToken.id] || 0)}
            </span>
          </div>
        </div>

        {/* Loan Input */}
        <div className="space-y-2">
          <Label
            htmlFor="loan"
            className="text-sm font-medium text-slate-300 dark:text-slate-700"
          >
            Loan
          </Label>
          <div className="relative">
            <Input
              id="loan"
              type="number"
              placeholder="0.00"
              className="h-16 pr-32 text-2xl"
              value={borrowAmount}
              onChange={(e) => setBorrowAmount(e.target.value)}
            />
            <div className="absolute inset-y-0 right-0 flex items-center">
              <Select
                value={selectedDebtToken.id}
                onValueChange={(val) =>
                  setSelectedDebtToken(
                    debtTokens.find((t) => t.id === val) || EURm,
                  )
                }
              >
                <SelectTrigger className="h-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  <div className="flex items-center gap-2">
                    <TokenIcon token={selectedDebtToken} size={20} />
                    <span className="text-slate-900 dark:text-white">
                      {selectedDebtToken.symbol}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-white text-slate-900 dark:bg-slate-800 dark:text-white">
                  {debtTokens.map((token) => (
                    <SelectItem
                      key={token.id}
                      value={token.id}
                      className="hover:bg-slate-100 dark:hover:bg-slate-700"
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
          <div className="flex justify-between text-sm text-slate-400 dark:text-slate-500">
            <span>Value: {formatPrice(debtValue)}</span>
            <span>Min. Collateral Ratio: {MIN_COLLATERALIZATION_RATIO}%</span>
          </div>
        </div>

        {/* Interest Rate Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium text-slate-300 dark:text-slate-700">
              Interest Rate
            </Label>
            <span className="text-sm font-semibold text-slate-900">
              {interestRate.toFixed(2)}%
            </span>
          </div>
          <div className="space-y-2">
            <input
              type="range"
              min="0.5"
              max="15.0"
              step="0.1"
              value={interestRate}
              onChange={(e) => setInterestRate(parseFloat(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 dark:bg-slate-700"
              style={{
                background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${((interestRate - 0.5) / 14.5) * 100}%, #e2e8f0 ${((interestRate - 0.5) / 14.5) * 100}%, #e2e8f0 100%)`,
              }}
            />
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>0.5%</span>
              <span>15.0%</span>
            </div>
          </div>
        </div>

        <Button
          onClick={handleOpenTrove}
          className="h-12 w-full text-lg"
          disabled={!canOpenTrove}
        >
          Open Trove
        </Button>
      </Card>

      {/* Understanding Troves */}
      <Card className="border-l-4 border-purple-500 border-slate-200 bg-purple-50 p-6 dark:border-slate-700 dark:bg-slate-800/50">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
          <div>
            <h3 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
              Understanding Troves
            </h3>
            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <p>
                A Trove is a Collateralized Debt Position (CDP). You lock
                collateral ({selectedCollateralToken.symbol}) and can borrow
                stablecoins ({selectedDebtToken.symbol}) against it.
              </p>
              <p>
                Your Trove must remain above the minimum collateralization ratio
                ({MIN_COLLATERALIZATION_RATIO}%) to avoid liquidation. If the
                price of {selectedCollateralToken.symbol} drops and your ratio
                falls below this minimum, your collateral may be sold to repay
                your debt.
              </p>
              <p>
                A one-time borrowing fee and ongoing interest apply. Manage your
                Trove by adding more collateral or repaying debt to improve its
                health.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Your Existing Troves */}
      <div>
        <h2 className="mb-4 text-center text-2xl font-bold text-slate-800">
          Your Existing Troves
        </h2>
        <YourTroves />
      </div>
    </div>
  );
}
