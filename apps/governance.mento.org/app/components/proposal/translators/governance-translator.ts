import { DecodedArg } from "../types/transaction";
import { getAddressName } from "../hooks/useContractRegistry";
import { getArgValue, getArgValueAsString, ContractParam } from "./utils";

/**
 * Governance-related function translations
 */
export const governancePatterns: Record<
  string,
  (
    contract: ContractParam,
    args: DecodedArg[],
    value: string | number,
  ) => string
> = {
  // Governance functions
  "castVote(uint256,uint8)": (contract, args) => {
    const proposalId = getArgValue(args, 0);
    const support = getArgValue(args, 1);

    if (!proposalId || support === null) return "Invalid vote parameters";

    const voteType =
      Number(support.value) === 1
        ? "FOR"
        : Number(support.value) === 0
          ? "AGAINST"
          : "ABSTAIN";
    return `Vote ${voteType} on proposal #${proposalId.value}`;
  },

  "queue(uint256)": (contract, args) => {
    const proposalId = getArgValue(args, 0);
    if (!proposalId) return "Invalid queue parameters";
    return `Queue proposal #${proposalId.value} for execution`;
  },

  "execute(uint256)": (contract, args) => {
    const proposalId = getArgValue(args, 0);
    if (!proposalId) return "Invalid execute parameters";
    return `Execute proposal #${proposalId.value}`;
  },

  // veMENTO functions
  "lock(address,address,uint96,uint32,uint32)": (contract, args) => {
    const account = getArgValue(args, 0);
    const amount = getArgValue(args, 2);
    const cliff = getArgValue(args, 4);

    if (!account || !amount || !cliff) return "Invalid lock parameters";

    const accountName = getAddressName(getArgValueAsString(account));
    const formattedAmount = (Number(amount.value) / 1e18).toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2,
      },
    );

    return `Lock ${formattedAmount} MENTO for ${accountName} with ${String(cliff.value)} weeks cliff`;
  },

  "delegateTo(uint256,address)": (contract, args) => {
    const id = getArgValue(args, 0);
    const newDelegate = getArgValue(args, 1);

    if (!id || !newDelegate) return "Invalid delegation parameters";

    const delegateName = getAddressName(getArgValueAsString(newDelegate));
    return `Delegate voting power from lock #${id.value} to ${delegateName}`;
  },

  // Member management
  "addMember(address)": (contract, args) => {
    const member = getArgValue(args, 0);
    if (!member) return "Invalid addMember parameters";

    const memberName = getAddressName(getArgValueAsString(member));
    return `Add ${memberName} as a member`;
  },

  "removeMember(address)": (contract, args) => {
    const member = getArgValue(args, 0);
    if (!member) return "Invalid removeMember parameters";

    const memberName = getAddressName(getArgValueAsString(member));
    return `Remove ${memberName} from members`;
  },
};
