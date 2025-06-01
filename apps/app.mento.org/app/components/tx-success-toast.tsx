"use client";

import { toast } from "@repo/ui";
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
      duration: 15000,
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
      <br />
      <TextLink className="underline" href={`${explorerUrl}/tx/${txHash}`}>
        See Details
      </TextLink>
    </div>
  );
}
