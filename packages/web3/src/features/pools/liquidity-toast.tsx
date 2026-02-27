import { chainIdToChain, CELO_EXPLORER } from "@/config/chains";
import { getExplorerUrl } from "@/utils/chain";
import { toast } from "@repo/ui";

export function showLiquiditySuccessToast({
  action,
  token0Symbol,
  token1Symbol,
  txHash,
  chainId,
}: {
  action: "added" | "removed";
  token0Symbol: string;
  token1Symbol: string;
  txHash: string;
  chainId: number;
}) {
  const explorerUrl = getExplorerUrl(chainId);
  const chain = chainIdToChain[chainId];
  const explorerName =
    chain?.blockExplorers?.default?.name || CELO_EXPLORER.name;
  const title = action === "added" ? "Liquidity Added" : "Liquidity Removed";
  const message = `You've ${action} liquidity ${action === "added" ? "to" : "from"} the ${token0Symbol}/${token1Symbol} pool.`;

  toast.success(
    <>
      <h4>{title}</h4>
      <span className="mt-2 block text-muted-foreground">{message}</span>
      {txHash && (
        <a
          href={`${explorerUrl}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground underline"
        >
          View Transaction on {explorerName}
        </a>
      )}
    </>,
  );
}
