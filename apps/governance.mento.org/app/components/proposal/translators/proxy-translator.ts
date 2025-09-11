import { DecodedArg } from "../types/transaction";
import { getAddressName } from "../hooks/useContractRegistry";
import { getArgValue, getArgValueAsString, ContractParam } from "./utils";

/**
 * Proxy admin and upgrade-related function translations
 */
export const proxyPatterns: Record<
  string,
  (
    contract: ContractParam,
    args: DecodedArg[],
    value: string | number,
  ) => string
> = {
  // Proxy Admin functions
  "changeProxyAdmin(address,address)": (contract, args) => {
    const proxy = getArgValue(args, 0);
    const newAdmin = getArgValue(args, 1);

    if (!proxy || !newAdmin) return "Invalid changeProxyAdmin parameters";

    const proxyName = getAddressName(getArgValueAsString(proxy));
    const adminName = getAddressName(getArgValueAsString(newAdmin));
    return `Change proxy admin for ${proxyName} to ${adminName}`;
  },

  "upgrade(address,address)": (contract, args) => {
    const proxy = getArgValue(args, 0);
    const implementation = getArgValue(args, 1);

    if (!proxy || !implementation) return "Invalid upgrade parameters";

    const proxyName = getAddressName(getArgValueAsString(proxy));
    const implName = getAddressName(getArgValueAsString(implementation));
    return `Upgrade ${proxyName} to implementation ${implName}`;
  },

  "upgradeAndCall(address,address,bytes)": (contract, args) => {
    const proxy = getArgValue(args, 0);
    const implementation = getArgValue(args, 1);

    if (!proxy || !implementation) return "Invalid upgradeAndCall parameters";

    const proxyName = getAddressName(getArgValueAsString(proxy));
    const implName = getAddressName(getArgValueAsString(implementation));
    return `Upgrade ${proxyName} to implementation ${implName} and execute initialization`;
  },
};
