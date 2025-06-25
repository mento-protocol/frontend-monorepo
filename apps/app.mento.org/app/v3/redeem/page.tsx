"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Input,
  Label,
  TokenIcon,
  Toaster,
  IconCheck,
} from "@repo/ui";
import { Info } from "lucide-react";
import { useV3Redeem } from "@/features/v3/hooks/use-v3-redeem";
import { useAccount } from "wagmi";
import { EURm } from "@/lib/config/tokens";

export default function RedeemPage() {
  const { address } = useAccount();
  const [redeemAmount, setRedeemAmount] = useState("");
  const redeemMutation = useV3Redeem();

  const handleRedeem = async () => {
    if (!address) {
      return;
    }

    if (!redeemAmount || parseFloat(redeemAmount) <= 0) {
      return;
    }

    try {
      await redeemMutation.mutateAsync({ amount: redeemAmount });
      setRedeemAmount("");
    } catch (error: any) {
      // Error handling is done in the hook via toast
    }
  };

  const redeemValue = parseFloat(redeemAmount) || 0;

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
              Connect your wallet to redeem EUR.m tokens.
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
      <div className="container mx-auto max-w-2xl space-y-8 p-4 md:p-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-slate-900">
            Redeem Collateral
          </h1>
          <p className="text-slate-700">
            Burn EUR.m to receive USD.m collateral at face value.
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
              <div className="absolute inset-y-0 right-0 flex items-center pr-4">
                <div className="flex items-center gap-2">
                  <TokenIcon token={EURm} size={20} />
                  <span className="font-medium text-slate-800">
                    {EURm.symbol}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex justify-between text-sm text-slate-700">
              <span>You will receive: ~{redeemValue.toFixed(4)} USD.m</span>
              <span>Rate: 1 EUR.m ≈ 1 USD.m</span>
            </div>
          </div>

          <Button
            onClick={handleRedeem}
            className="h-12 w-full text-lg"
            disabled={
              !redeemAmount ||
              parseFloat(redeemAmount) <= 0 ||
              redeemMutation.isPending
            }
          >
            {redeemMutation.isPending ? "Redeeming..." : "Redeem EUR.m"}
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
                  Redemptions are a key mechanism for maintaining the peg of
                  Mento V3 stablecoins. When you redeem, you burn your EUR.m
                  tokens to receive USD.m collateral from the system at face
                  value.
                </p>
                <p>
                  This process targets the riskiest Troves (those with the
                  lowest collateralization ratios). The redeemed collateral is
                  taken from these Troves, and their debt is reduced
                  accordingly.
                </p>
                <p>
                  Redemptions are always processed at face value (1 EUR.m for
                  approximately 1 USD.m worth of collateral), regardless of the
                  current market price of the stablecoin. This creates an
                  arbitrage opportunity if EUR.m trades below its peg,
                  incentivizing users to redeem and push the price back up.
                </p>
                <p>
                  A small redemption fee may apply. The system automatically
                  handles up to 20 iterations to find suitable Troves.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
