import { useCallback } from "react";
import {
  useAccount,
  useConfig,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { Address, erc20Abi } from "viem";
import {
  waitForTransactionReceipt,
  WriteContractErrorType,
} from "wagmi/actions";
import { useContracts } from "../use-contracts";

interface ApproveParams {
  target: Address;
  amount: bigint;
  onSuccess?: () => void;
  onError?: (error?: WriteContractErrorType) => void;
  onConfirmation?: () => void;
}

const useApprove = () => {
  const contracts = useContracts();
  const {
    writeContract,
    isPending: isAwaitingUserSignature,
    data,
    ...restWrite
  } = useWriteContract();
  const { address } = useAccount();
  const config = useConfig();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash: data,
      pollingInterval: 1000,
    });
  const approveMento = useCallback(
    (params: ApproveParams) => {
      const { target, amount, onConfirmation, onError } = params;

      writeContract(
        {
          address: contracts.MentoToken.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [target, amount],
        },
        {
          onSuccess: async (data) => {
            try {
              await waitForTransactionReceipt(config, {
                hash: data,
                pollingInterval: 1000,
                confirmations: 2,
              });
              onConfirmation?.();
            } catch (error) {
              console.error(error);
            }
          },
          onError,
        },
      );
    },
    [
      address,
      config,
      contracts.Locking.address,
      contracts.MentoToken.address,
      writeContract,
    ],
  );

  return {
    hash: data,
    approveMento,
    isAwaitingUserSignature,
    isConfirming,
    isConfirmed,
    ...restWrite,
  };
};

export default useApprove;
