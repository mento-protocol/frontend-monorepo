import { ensureChainId } from "@/lib/helpers/ensure-chain-id";
import { useAccount } from "wagmi";

export const useEnsureChainId = () => {
  const { chainId } = useAccount();
  const ensuredChainId = ensureChainId(chainId);
  return ensuredChainId;
};
