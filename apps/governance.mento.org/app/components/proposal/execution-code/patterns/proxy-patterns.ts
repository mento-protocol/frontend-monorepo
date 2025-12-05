import type { PatternRegistry } from "./types";
import { createPattern } from "./base-pattern";
import {
  getAddressNameFromCache,
  getContractInfo,
} from "../../services/address-resolver-service";
import { removeProxySuffix } from "../utils/removeProxySuffix";

export const proxyPatterns: PatternRegistry = {
  "changeProxyAdmin(address,address)": createPattern(
    (contract, args) => {
      const [proxy, newAdmin] = args;
      const proxyName = getAddressNameFromCache(String(proxy!.value));
      const adminName = getAddressNameFromCache(String(newAdmin!.value));
      return `Change proxy admin for ${proxyName} to ${adminName}`;
    },
    2,
    "changeProxyAdmin",
  ),

  "upgrade(address,address)": createPattern(
    (contract, args) => {
      const [proxy, implementation] = args;
      const proxyName = getAddressNameFromCache(String(proxy!.value));
      const implName = getAddressNameFromCache(String(implementation!.value));
      return `Upgrade ${proxyName} to implementation ${implName}`;
    },
    2,
    "upgrade",
  ),

  "upgradeAndCall(address,address,bytes)": createPattern(
    (contract, args) => {
      const [proxy, implementation] = args;
      const proxyName = getAddressNameFromCache(String(proxy!.value));
      const implName = getAddressNameFromCache(String(implementation!.value));
      return `Upgrade ${proxyName} to implementation ${implName} and execute initialization`;
    },
    3,
    "upgradeAndCall",
  ),

  "_setImplementation(address)": createPattern(
    (contract, args) => {
      const [implementation] = args;
      const contractInfo = getContractInfo(contract.address);
      const contractName = removeProxySuffix(
        contractInfo?.friendlyName ||
          contractInfo?.name ||
          getAddressNameFromCache(contract.address),
      );
      // Include the implementation address in the description so AddressParser can make it a link
      // The address will be resolved to its friendly name (if available) and become clickable
      const implAddress = String(implementation!.value);
      return `Set implementation for ${contractName} to ${implAddress}`;
    },
    1,
    "_setImplementation",
  ),
};
