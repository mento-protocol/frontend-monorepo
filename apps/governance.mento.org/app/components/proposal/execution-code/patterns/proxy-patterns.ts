import type { PatternRegistry } from "./types";
import { createPattern } from "./base-pattern";
import { getAddressNameFromCache } from "../../services/address-resolver-service";

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
};
