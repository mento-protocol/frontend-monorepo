import { useAccount, useReadContract } from "wagmi";
import { GnosisSafeABI, useEnsureChainId } from "@repo/web3";
import { getWatchdogMultisigAddress } from "@/config";

export const useIsWatchdog = () => {
  const { address, chainId } = useAccount();
  const ensuredChainId = useEnsureChainId();
  const watchdogAddress = getWatchdogMultisigAddress(chainId);

  // Check if connected address is the multisig itself
  const isWatchdogSafe =
    address?.toLowerCase() === watchdogAddress.toLowerCase();

  // Fetch multisig owners
  const { data: owners } = useReadContract({
    address: watchdogAddress,
    abi: GnosisSafeABI,
    functionName: "getOwners",
    chainId: ensuredChainId,
    query: { enabled: !!address && !isWatchdogSafe },
  });

  const isWatchdogSigner =
    owners?.some((owner) => owner.toLowerCase() === address?.toLowerCase()) ??
    false;

  return { isWatchdog: isWatchdogSafe || isWatchdogSigner };
};
