import { getAddressName } from "../utils/contract-registry";
import type { PatternRegistry } from "./types";

export const proxyPatterns: PatternRegistry = {
  "changeProxyAdmin(address,address)": (contract, args) => {
    const [proxy, newAdmin] = args;
    if (!proxy || !newAdmin) return "Invalid changeProxyAdmin parameters";
    const proxyName = getAddressName(String(proxy.value));
    const adminName = getAddressName(String(newAdmin.value));
    return `Change proxy admin for ${proxyName} to ${adminName}`;
  },

  "upgrade(address,address)": (contract, args) => {
    const [proxy, implementation] = args;
    if (!proxy || !implementation) return "Invalid upgrade parameters";
    const proxyName = getAddressName(String(proxy.value));
    const implName = getAddressName(String(implementation.value));
    return `Upgrade ${proxyName} to implementation ${implName}`;
  },

  "upgradeAndCall(address,address,bytes)": (contract, args) => {
    const [proxy, implementation] = args;
    if (!proxy || !implementation) return "Invalid upgradeAndCall parameters";
    const proxyName = getAddressName(String(proxy.value));
    const implName = getAddressName(String(implementation.value));
    return `Upgrade ${proxyName} to implementation ${implName} and execute initialization`;
  },
};
