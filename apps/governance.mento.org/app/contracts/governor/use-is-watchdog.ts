import { getWatchdogMultisigAddress } from "@/config";
import { GnosisSafeABI, useEnsureChainId } from "@repo/web3";
import { useAccount, useReadContract } from "wagmi";

interface UseIsWatchdogResult {
  /** True if connected AS the Safe itself (via WalletConnect) OR as one of its signers */
  isWatchdog: boolean;
  /** True if connected AS the Safe itself (via WalletConnect from Safe UI) */
  isWatchdogSafe: boolean;
}

/**
 * Hook to check if the connected wallet is the watchdog multisig or one of its signers
 * @returns Object with watchdog status details
 */
export const useIsWatchdog = (): UseIsWatchdogResult => {
  const { address, chainId } = useAccount();
  const ensuredChainId = useEnsureChainId();
  const watchdogAddress = getWatchdogMultisigAddress(chainId);

  // Check if connected address is the multisig itself
  const isWatchdogSafe =
    address?.toLowerCase() === watchdogAddress.toLowerCase();

  // Fetch multisig owners to check if connected address is a signer
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

  return {
    isWatchdog: isWatchdogSafe || isWatchdogSigner,
    isWatchdogSafe,
  };
};
