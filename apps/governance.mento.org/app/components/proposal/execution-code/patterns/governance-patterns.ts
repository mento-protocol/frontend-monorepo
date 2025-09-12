import type { PatternRegistry } from "./types";

export const governancePatterns: PatternRegistry = {
  "castVote(uint256,uint8)": (contract, args) => {
    const [proposalId, support] = args;
    if (!proposalId || support === undefined) return "Invalid vote parameters";
    const voteType =
      Number(support.value) === 1
        ? "FOR"
        : Number(support.value) === 0
          ? "AGAINST"
          : "ABSTAIN";
    return `Vote ${voteType} on proposal #${proposalId.value}`;
  },

  "queue(uint256)": (contract, args) => {
    const [proposalId] = args;
    if (!proposalId) return "Invalid queue parameters";
    return `Queue proposal #${proposalId.value} for execution`;
  },

  "execute(uint256)": (contract, args) => {
    const [proposalId] = args;
    if (!proposalId) return "Invalid execute parameters";
    return `Execute proposal #${proposalId.value}`;
  },
};
