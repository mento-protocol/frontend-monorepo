import { ensureChainId } from "@/utils/ensure-chain-id";
import { useAccount } from "@repo/web3/wagmi";

export const useEnsureChainId = () => {
  const { chainId } = useAccount();
  const ensuredChainId = ensureChainId(chainId);
  return ensuredChainId;
};
