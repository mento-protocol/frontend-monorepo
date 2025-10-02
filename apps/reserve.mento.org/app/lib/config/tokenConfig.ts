// Token and chain configuration for reserve.mento.org
// Now uses TokenSymbol from mento-sdk for consistency

import { TokenSymbol } from "@mento-protocol/mento-sdk";

// Chain IDs
export enum ChainId {
  Celo = "42220",
  CeloSepolia = "11142220",
}

// Re-export TokenSymbol from SDK as TokenId for backwards compatibility
export { TokenSymbol };
export type TokenId = TokenSymbol;
export const TokenId = TokenSymbol;

// Token addresses on different chains
export const TokenAddresses: Record<ChainId, Record<TokenId, string>> = {
  [ChainId.Celo]: {
    [TokenId.CELO]: "0x471EcE3750Da237f93B8E339c536989b8978a438",
    [TokenId.cUSD]: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    [TokenId.cEUR]: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
    [TokenId.cREAL]: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787",
    [TokenId.eXOF]: "0x73F93dcc49cB8A239e2032663e9475dd5ef29A08",
    [TokenId.USDC]: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    [TokenId.USDT]: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    [TokenId.axlUSDC]: "0xEB466342C4d449BC9f53A865D5Cb90586f405215",
    [TokenId.axlEUROC]: "0x061cc5a2C863E0C1Cb404006D559dB18A34C762d",
    [TokenId.cKES]: "0x456a3D042C0DbD3db53D5489e98dFb038553B0d0",
    [TokenId.PUSO]: "0x105d4A9306D2E55a71d2Eb95B81553AE1dC20d7B",
    [TokenId.cCOP]: "0x8A567e2aE79CA692Bd748aB832081C45de4041eA",
    [TokenId.cGHS]: "0xfAeA5F3404bbA20D3cc2f8C4B0A888F55a3c7313",
    [TokenId.cGBP]: "0xCCF663b1fF11028f0b19058d0f7B674004a40746",
    [TokenId.cZAR]: "0x4c35853A3B4e647fD266f4de678dCc8fEC410BF6",
    [TokenId.cCAD]: "0xff4Ab19391af240c311c54200a492233052B6325",
    [TokenId.cAUD]: "0x7175504C455076F15c04A2F90a8e352281F492F9",
    [TokenId.cCHF]: "0xb55a79F398E759E43C95b979163f30eC87Ee131D",
    [TokenId.cJPY]: "0xc45eCF20f3CD864B32D9794d6f76814aE8892e20",
    [TokenId.cNGN]: "0xE2702Bd97ee33c88c8f6f92DA3B733608aa76F71",
  },
  [ChainId.CeloSepolia]: {
    // TODO: Update these addresses from mento-sdk v1.11.0 once installed
    [TokenId.CELO]: "0xF194afDf50B03e69Bd7D057c1Aa9e10c9954E4C9",
    [TokenId.cUSD]: "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1",
    [TokenId.cEUR]: "0x10c892A6EC43a53E45D0B916B4b7D383B1b78C0F",
    [TokenId.cREAL]: "0xE4D517785D091D3c54818832dB6094bcc2744545",
    [TokenId.eXOF]: "0xB0FA15e002516d0301884059c0aaC0F0C72b019D",
    [TokenId.USDC]: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
    [TokenId.USDT]: "0xBba91F588d031469ABCCA566FE80fB1Ad8Ee3287",
    [TokenId.axlUSDC]: "0x87D61dA3d668797786D73BC674F053f87111570d",
    [TokenId.axlEUROC]: "0x6e673502c5b55F3169657C004e5797fFE5be6653",
    [TokenId.cKES]: "0x1E0433C1769271ECcF4CFF9FDdD515eefE6CdF92",
    [TokenId.PUSO]: "0x5E0E3c9419C42a1B04e2525991FB1A2C467AB8bF",
    [TokenId.cCOP]: "0xe6A57340f0df6E020c1c0a80bC6E13048601f0d4",
    [TokenId.cGHS]: "0x295B66bE7714458Af45E6A6Ea142A5358A6cA375",
    [TokenId.cGBP]: "0x47f2Fb88105155a18c390641C8a73f1402B2BB12",
    [TokenId.cZAR]: "0x1e5b44015Ff90610b54000DAad31C89b3284df4d",
    [TokenId.cCAD]: "0x02EC9E0D2Fd73e89168C1709e542a48f58d7B133",
    [TokenId.cAUD]: "0x84CBD49F5aE07632B6B88094E81Cce8236125Fe0",
    [TokenId.cCHF]: "0xADC57C2C34aD021Df4421230a6532F4e2E1dCE4F",
    [TokenId.cJPY]: "0x2E51F41238cA36a421C9B8b3e189e8Cc7653FE67",
    [TokenId.cNGN]: "0x4a5b03B8b16122D330306c65e4CA4BC5Dd6511d0",
  },
};

// Helper function to get token address
export function getTokenAddress(
  tokenSymbol: string,
  chainId: ChainId,
): string | undefined {
  // Convert token symbol to TokenId if possible
  const tokenId = tokenSymbol as TokenId;

  // Check if the token exists in the TokenAddresses for the given chain
  if (TokenAddresses[chainId] && TokenAddresses[chainId][tokenId]) {
    return TokenAddresses[chainId][tokenId];
  }

  return undefined;
}
