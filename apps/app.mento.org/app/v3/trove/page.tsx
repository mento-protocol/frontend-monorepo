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
  Toaster,
  IconCheck,
} from "@repo/ui";
import { Info } from "lucide-react";
import { YourTroves } from "../../components/v3/your-troves";
import { USDm, EURm } from "@/lib/config/tokens";
import { useV3Price } from "@/features/v3/hooks/use-v3-price";
import { useV3OpenTrove } from "@/features/v3/hooks/use-v3-open-trove";
import { useAccount } from "wagmi";

const collateralTokens = [USDm];
const debtTokens = [EURm];

const MIN_COLLATERALIZATION_RATIO = 110; // %

export default function TrovePage() {
  const { address } = useAccount();
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [selectedCollateralToken, setSelectedCollateralToken] = useState(USDm);
  const [selectedDebtToken, setSelectedDebtToken] = useState(EURm);
  const [interestRate, setInterestRate] = useState(2.0);

  // Get real price data from V3 oracle
  const { data: priceData, isLoading: isPriceLoading } = useV3Price();
  const openTroveMutation = useV3OpenTrove();

  // Use real price if available, fallback to 1.0 for USD.m
  const usdmPrice = 1.0; // USD.m is always $1
  const eurmPrice = priceData?.price
    ? parseFloat(priceData.price.toString())
    : 0.92;

  const {
    collateralValue,
    debtValue,
    currentCollateralizationRatio,
    liquidationPrice,
    canOpenTrove,
  } = useMemo(() => {
    const collAmount = parseFloat(collateralAmount);
    const borrAmount = parseFloat(borrowAmount);
    const collTokenPrice =
      selectedCollateralToken.id === USDm.id ? usdmPrice : eurmPrice;

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
    usdmPrice,
    eurmPrice,
    MIN_COLLATERALIZATION_RATIO,
  ]);

  const handleOpenTrove = async () => {
    if (!address) {
      return;
    }

    if (!canOpenTrove || !collateralAmount || !borrowAmount) {
      return;
    }

    try {
      await openTroveMutation.mutateAsync({
        collateralAmount,
        borrowAmount,
        interestRate: interestRate.toString(),
      });

      // Clear form on success
      setCollateralAmount("");
      setBorrowAmount("");
      setInterestRate(2.0);
    } catch (error: any) {
      // Error handling is done in the hook via toast
    }
  };

  const formatPrice = (price: number, decimals = 2) =>
    `$${price.toFixed(decimals)}`;

  if (!address) {
    return (
      <>
        <Toaster
          position="top-right"
          duration={5000}
          icons={{
            success: <IconCheck className="text-success" />,
          }}
          closeButton
          toastOptions={{
            classNames: {
              toast: "toast",
              title: "title",
              description: "description",
              actionButton: "action-button",
              cancelButton: "cancel-button",
              closeButton: "close-button",
              icon: "icon",
            },
          }}
          offset={{ top: "80px" }}
          mobileOffset={{ top: "96px" }}
        />
        <div className="container mx-auto max-w-2xl space-y-8 p-4 md:p-8">
          <div className="rounded-lg border-2 border-dashed py-12 text-center">
            <p className="text-slate-500">
              Connect your wallet to open a trove.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Toaster
        position="top-right"
        duration={5000}
        icons={{
          success: <IconCheck className="text-success" />,
        }}
        closeButton
        toastOptions={{
          classNames: {
            toast: "toast",
            title: "title",
            description: "description",
            actionButton: "action-button",
            cancelButton: "cancel-button",
            closeButton: "close-button",
            icon: "icon",
          },
        }}
        offset={{ top: "80px" }}
        mobileOffset={{ top: "96px" }}
      />
      <div className="container mx-auto max-w-2xl space-y-8 overflow-x-hidden p-4 md:p-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-slate-900">
            Borrow {selectedDebtToken.symbol} with{" "}
            {selectedCollateralToken.symbol}
          </h1>
          <p className="text-slate-700">
            Open a Trove to borrow stablecoins against your collateral.
          </p>
        </div>

        {/* Main Form */}
        <Card className="relative space-y-6 overflow-hidden p-6">
          {/* Collateral Input */}
          <div className="space-y-2">
            <Label
              htmlFor="collateral"
              className="text-sm font-medium text-slate-900"
            >
              Collateral
            </Label>
            <div className="relative overflow-hidden">
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
                  <SelectTrigger className="h-full w-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900">
                    <div className="flex items-center gap-2">
                      <TokenIcon token={selectedCollateralToken} size={20} />
                      <span className="text-slate-900">
                        {selectedCollateralToken.symbol}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-white text-slate-900">
                    {collateralTokens.map((token) => (
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
              {/* <span>Value: {formatPrice(collateralValue)}</span> */}
              <span>
                {selectedCollateralToken.symbol} Price:{" "}
                {isPriceLoading
                  ? "Loading..."
                  : formatPrice(
                      selectedCollateralToken.id === USDm.id
                        ? usdmPrice
                        : eurmPrice,
                    )}
              </span>
            </div>
          </div>

          {/* Loan Input */}
          <div className="space-y-2">
            <Label
              htmlFor="loan"
              className="text-sm font-medium text-slate-900"
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
                  <SelectTrigger className="h-full min-w-24 rounded-l-none border-l border-slate-300 bg-white px-4 text-slate-900">
                    <div className="flex items-center gap-2">
                      <TokenIcon token={selectedDebtToken} size={20} />
                      <span className="text-slate-900">
                        {selectedDebtToken.symbol}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-white text-slate-900">
                    {debtTokens.map((token) => (
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
              {/* <span>Value: {formatPrice(debtValue)}</span> */}
              <span>Min. Collateral Ratio: {MIN_COLLATERALIZATION_RATIO}%</span>
            </div>
          </div>

          {/* Interest Rate Slider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-slate-900">
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
                className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200"
                style={{
                  background: `linear-gradient(to right, #8B5CF6 0%, #8B5CF6 ${((interestRate - 0.5) / 14.5) * 100}%, #e2e8f0 ${((interestRate - 0.5) / 14.5) * 100}%, #e2e8f0 100%)`,
                }}
              />
              <div className="flex justify-between text-xs text-slate-700">
                <span>0.5%</span>
                <span>15.0%</span>
              </div>
            </div>
          </div>

          <Button
            onClick={handleOpenTrove}
            className="h-12 w-full text-lg"
            disabled={!canOpenTrove || openTroveMutation.isPending}
          >
            {openTroveMutation.isPending ? "Opening Trove..." : "Open Trove"}
          </Button>
        </Card>

        {/* Understanding Troves */}
        <Card className="border-l-4 border-purple-500 bg-purple-50/80 p-6">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-purple-500" />
            <div>
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Understanding Troves
              </h3>
              <div className="space-y-2 text-sm text-slate-700">
                <p>
                  A Trove is a Collateralized Debt Position (CDP). You lock
                  collateral ({selectedCollateralToken.symbol}) and can borrow
                  stablecoins ({selectedDebtToken.symbol}) against it.
                </p>
                <p>
                  Your Trove must remain above the minimum collateralization
                  ratio ({MIN_COLLATERALIZATION_RATIO}%) to avoid liquidation.
                  If the price of {selectedCollateralToken.symbol} drops and
                  your ratio falls below this minimum, your collateral may be
                  sold to repay your debt.
                </p>
                <p>
                  A one-time borrowing fee and ongoing interest apply. Manage
                  your Trove by adding more collateral or repaying debt to
                  improve its health.
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Your Existing Troves */}
        <div>
          <h2 className="mb-4 text-center text-2xl font-bold text-slate-900">
            Your Existing Troves
          </h2>
          <YourTroves />
        </div>
      </div>
    </>
  );
}
