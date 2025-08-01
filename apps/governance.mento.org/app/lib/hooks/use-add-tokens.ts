"use client";
import { useCallback } from "react";
import * as mento from "@mento-protocol/mento-sdk";
import { useAccount, useClient, useConfig } from "@repo/web3/wagmi";
import { Alfajores, Celo } from "@/lib/config/chains";
import { getConnectorClient } from "wagmi/actions";
import { watchAsset } from "viem/actions";

export const useAddTokens = () => {
  const { chainId } = useAccount();
  const client = useClient();
  const config = useConfig();

  const addMento = useCallback(async () => {
    const mentoTokenAddress =
      mento.addresses[chainId === Celo.id ? Celo.id : Alfajores.id]?.MentoToken;
    if (!mentoTokenAddress) throw new Error("Mento token address not found");
    const connectorClient = await getConnectorClient(config);

    return await watchAsset(connectorClient, {
      type: "ERC20",
      options: {
        address: mentoTokenAddress,
        symbol: "MENTO",
        decimals: 18,
      },
    });
  }, [chainId, config]);

  const addVeMento = useCallback(async () => {
    if (!chainId || !client?.request) return;
    const veMentoTokenAddress =
      mento.addresses[chainId === Celo.id ? Celo.id : Alfajores.id]?.Locking;
    if (!veMentoTokenAddress)
      throw new Error("veMento token address not found");
    const connectorClient = await getConnectorClient(config);

    return await watchAsset(connectorClient, {
      type: "ERC20",
      options: {
        address: veMentoTokenAddress,
        symbol: "veMENTO",
        decimals: 18,
      },
    });
  }, [chainId, client?.request, config]);

  return {
    addMento,
    addVeMento,
  };
};
