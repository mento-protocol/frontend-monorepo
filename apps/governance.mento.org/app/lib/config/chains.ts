import { addresses, ContractAddresses } from "@mento-protocol/mento-sdk";
import { Address, defineChain } from "viem";
import { celo, celoAlfajores } from "wagmi/chains";
import { MentoChain, MentoChainContracts } from "@/lib/types";

export const Celo: MentoChain = defineChain({
  ...celo,
  contracts: {
    ...celo.contracts,
    ...transformToChainContracts(addresses[celo.id]),
  },
});

export const Alfajores: MentoChain = defineChain({
  ...celoAlfajores,
  blockExplorers: {
    default: {
      name: "Celoscan",
      url: "https://alfajores.celoscan.io",
      apiUrl: "https://api-alfajores.celoscan.io/api",
    },
  },
  contracts: {
    ...celoAlfajores.contracts,
    ...transformToChainContracts(addresses[celoAlfajores.id]),
  },
});

/**
 * Transforms the specified Mento contract addresses to the format used by Viem.
 * @param contractAddresses The Mento contract addresses to be transformed.
 * @returns Mento contract addresses in the format used by Viem.
 */
function transformToChainContracts(
  contractAddresses: ContractAddresses | undefined,
): MentoChainContracts {
  if (!contractAddresses) throw new Error("Contract addresses not found");
  const chainContracts: Partial<MentoChainContracts> = {};

  Object.keys(contractAddresses).forEach((key) => {
    const contractKey = key as keyof ContractAddresses;
    chainContracts[contractKey] = {
      address: contractAddresses[contractKey] as Address,
    };
  });

  return chainContracts as MentoChainContracts;
}
