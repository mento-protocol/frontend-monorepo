"use client";

import { toast } from "react-toastify";
import { TextLink } from "@/components/buttons/text-link";
import { type ChainId, chainIdToChain } from "@/lib/config/chains";

export function toastToYourSuccess(
  msg: string,
  txHash: string,
  chainId: ChainId,
) {
  const explorerUrl = chainIdToChain[chainId].explorerUrl;
  toast.success(
    <TxSuccessToast msg={msg} txHash={txHash} explorerUrl={explorerUrl} />,
    {
      autoClose: 15000,
    },
  );
}

export function TxSuccessToast({
  msg,
  txHash,
  explorerUrl,
}: {
  msg: string;
  txHash: string;
  explorerUrl: string;
}) {
  return (
    <div>
      {msg + " "}
      <TextLink className="underline" href={`${explorerUrl}/tx/${txHash}`}>
        See Details
      </TextLink>
    </div>
  );
}
