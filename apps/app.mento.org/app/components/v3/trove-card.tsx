import { Button, Card, TokenIcon } from "@repo/ui";
import { X } from "lucide-react";

type Trove = {
  name: string;
  pair: { collateral: string; debt: string };
  collateral: string;
  debt: string;
  interestRate: string;
  liquidationPrice: string;
  collateralizationRatio: string;
  collateralizationValue: number;
};

function TroveDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

export function TroveCard({ trove }: { trove: Trove }) {
  const getCRatioColor = (ratio: number) => {
    if (ratio < 150) return "bg-red-500";
    if (ratio < 200) return "bg-yellow-500";
    return "bg-purple-500";
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-slate-800">
            {trove.name.split(" ")[0]}{" "}
            <span className="font-mono text-sm text-slate-400">
              {trove.name.split(" ")[1]}
            </span>
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <TokenIcon
              symbol={trove.pair.collateral as any}
              className="h-5 w-5"
            />
            <span className="text-slate-500">/</span>
            <TokenIcon symbol={trove.pair.debt as any} className="h-5 w-5" />
            <span className="text-sm text-slate-600">
              {trove.pair.collateral} / {trove.pair.debt}
            </span>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <TroveDetailRow label="Collateral" value={trove.collateral} />
        <TroveDetailRow label="Debt" value={trove.debt} />
        <TroveDetailRow label="Interest Rate" value={trove.interestRate} />
        <TroveDetailRow
          label={`Liquidation Price (${trove.pair.collateral})`}
          value={trove.liquidationPrice}
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-slate-500">Collateralization Ratio</span>
          <span
            className={`font-bold ${
              trove.collateralizationValue < 150
                ? "text-red-500"
                : "text-green-600"
            }`}
          >
            {trove.collateralizationRatio}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-200">
          <div
            className={`h-2 rounded-full ${getCRatioColor(
              trove.collateralizationValue,
            )}`}
            style={{
              width: `${Math.min(trove.collateralizationValue / 3, 100)}%`,
            }}
          />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <Button variant="outline">Manage</Button>
        <Button variant="destructive">
          <X className="mr-2 h-4 w-4" />
          Close
        </Button>
      </div>
    </Card>
  );
}
