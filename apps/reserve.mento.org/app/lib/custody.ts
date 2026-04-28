import type { CustodianType } from "@/lib/types";

export type CustodyType = CustodianType;

export const CUSTODY_META: Record<
  CustodyType,
  { label: string; accent: string; color: string }
> = {
  cold: {
    label: "Cold",
    accent: "border-l-4 border-l-[#3D42CD]",
    color: "#3D42CD",
  },
  ops: {
    label: "Operational",
    accent: "border-l-4 border-l-[#66FFB8]",
    color: "#66FFB8",
  },
  hot: {
    label: "Hot",
    accent: "border-l-4 border-l-[#7006FC]",
    color: "#7006FC",
  },
};

export const CUSTODY_ORDER: CustodyType[] = ["cold", "ops", "hot"];
