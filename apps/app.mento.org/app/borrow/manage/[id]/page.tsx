import { BorrowView } from "@/components/borrow/borrow-view";
import { ManageTroveView } from "@/components/borrow/manage-trove/manage-trove-view";
import { getDebtTokenConfig } from "@repo/web3";

export default async function BorrowManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const tokenSymbol = Array.isArray(token) ? token[0] : token;

  return (
    <div className="md:items-center flex h-full w-full flex-wrap items-start justify-center">
      <BorrowView
        unsupportedDebtToken={
          tokenSymbol ? getDebtTokenConfig(tokenSymbol) : undefined
        }
      >
        <ManageTroveView troveId={id} tokenSymbol={tokenSymbol} />
      </BorrowView>
    </div>
  );
}
