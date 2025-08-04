import { ensureChainId } from "@/utils/ensure-chain-id";
import { useAccount } from "wagmi";

export const useEnsureChainId = () => {
  const { chainId } = useAccount();
  const ensuredChainId = ensureChainId(chainId);
  return ensuredChainId;
};
