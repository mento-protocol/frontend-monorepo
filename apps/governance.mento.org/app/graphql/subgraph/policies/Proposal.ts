import type { Account, Address } from "viem";
import { makeVar, type TypePolicy } from "@apollo/client/cache";
import {
  ProposalState,
  ProposalSupport,
  ProposalVotes,
  Scalars,
  VoteCast,
  VoteReceipt,
} from "@/graphql/subgraph/generated/subgraph";

type ProposalID = Scalars["ID"]["output"];
type ProposalToState = Record<ProposalID, ProposalState>;
const proposalToStateVar = makeVar<ProposalToState>({});

export const ProposalPolicy: TypePolicy = {
  fields: {
    state: {
      read(_, { readField }): ProposalState {
        const id = readField<string>("proposalId");
        const proposalToState = proposalToStateVar();
        return proposalToState[id!] || ProposalState.NoState;
      },
    },
    metadata: {
      read(_, { readField }): { title: string; description: string } {
        const rawMetadata = readField<string>("description") || "";
        let metadata;
        try {
          metadata = JSON.parse(readField<string>("description")!);
        } catch {
          metadata = {
            title: rawMetadata.split("\n")[0],
            description: rawMetadata,
          };
        }

        return {
          title: metadata.title || "Missing title",
          description: metadata.description || "Missing description",
        };
      },
    },
    votes: {
      read(_, { readField }): ProposalVotes {
        const votecastRefs = readField<Array<VoteCast>>("votecast") || [];

        return votecastRefs.reduce(
          (acc: ProposalVotes, votecastRef) => {
            const receiptRef = readField<VoteReceipt>("receipt", votecastRef);
            if (!receiptRef) return acc;

            const voterRef = readField<Account>("voter", receiptRef);
            const supportRef = readField<ProposalSupport>(
              "support",
              receiptRef,
            );
            const weight = BigInt(
              readField<string>("weight", receiptRef) || "0",
            );

            if (!voterRef || !supportRef) return acc;

            const address = readField<string>("id", voterRef) as Address;
            const support = readField<number>("support", supportRef);

            switch (support) {
              case 0: // AGAINST
                acc.against.total += weight;
                acc.against.participants.push({ address, weight });
                break;

              case 1: // FOR
                acc.for.total += weight;
                acc.for.participants.push({ address, weight });
                break;

              case 2: // ABSTAIN
                acc.abstain.total += weight;
                acc.abstain.participants.push({ address, weight });
                break;

              default:
                throw new Error(`Invalid support type: ${support}`);
            }
            acc.total += weight;

            return acc;
          },
          {
            for: { participants: [], total: 0n },
            against: { participants: [], total: 0n },
            abstain: { participants: [], total: 0n },
            total: 0n,
          },
        );
      },
    },
  },
};
