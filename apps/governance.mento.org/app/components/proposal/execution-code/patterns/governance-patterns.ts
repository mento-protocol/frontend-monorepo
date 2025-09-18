import type { PatternRegistry } from "./types";
import { createPattern } from "./base-pattern";

export const governancePatterns: PatternRegistry = {
  "castVote(uint256,uint8)": createPattern(
    (contract, args) => {
      const [proposalId, support] = args;
      const voteType =
        Number(support!.value) === 1
          ? "FOR"
          : Number(support!.value) === 0
            ? "AGAINST"
            : "ABSTAIN";
      return `Vote ${voteType} on proposal #${proposalId!.value}`;
    },
    2,
    "castVote",
  ),

  "queue(uint256)": createPattern(
    (contract, args) => {
      const [proposalId] = args;
      return `Queue proposal #${proposalId!.value} for execution`;
    },
    1,
    "queue",
  ),

  "execute(uint256)": createPattern(
    (contract, args) => {
      const [proposalId] = args;
      return `Execute proposal #${proposalId!.value}`;
    },
    1,
    "execute",
  ),
};
