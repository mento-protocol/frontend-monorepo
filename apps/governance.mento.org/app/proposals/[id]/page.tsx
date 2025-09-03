import { ProposalContent } from "@/components/proposal/content";
import { env } from "@/env.mjs";
import { Metadata } from "next";

const GET_PROPOSAL_METADATA = `
  query GetProposalMetadata($id: BigInt) {
    proposals(where: { proposalId: $id }) {
      proposalId
      description
    }
  }
`;

function extractTitleFromContent(description: string): string {
  if (!description) return "Unknown";

  try {
    const parsed = JSON.parse(description);
    if (parsed && typeof parsed.title === "string" && parsed.title.trim()) {
      return parsed.title.trim();
    }
  } catch (error) {
    console.error("Error parsing proposal metadata", error);
  }

  const cleanDescription = description
    ?.split("\n")[0]
    ?.replace(/^#\s+/, "")
    .trim();

  return cleanDescription || "Unknown";
}

function extractDescriptionFromContent(description: string): string {
  if (!description) return "View proposal details";

  try {
    const parsed = JSON.parse(description);
    if (
      parsed &&
      typeof parsed.description === "string" &&
      parsed.description.trim()
    ) {
      let desc = parsed.description.trim();
      if (desc.length > 160) {
        desc = desc.substring(0, 157) + "...";
      }
      return desc;
    }
  } catch (error) {
    console.error("Error parsing proposal metadata", error);
  }

  let cleanDescription = description
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanDescription.length > 160) {
    cleanDescription = cleanDescription.substring(0, 157) + "...";
  }

  return cleanDescription || "View proposal details";
}

async function fetchProposalData(id: string) {
  const isAlfajores = env.NEXT_PUBLIC_VERCEL_ENV !== "production";
  const subgraphUrl = isAlfajores
    ? env.NEXT_PUBLIC_SUBGRAPH_URL_ALFAJORES
    : env.NEXT_PUBLIC_SUBGRAPH_URL;
  const apiKey = isAlfajores
    ? env.NEXT_PUBLIC_GRAPH_API_KEY_ALFAJORES
    : env.NEXT_PUBLIC_GRAPH_API_KEY;

  if (!subgraphUrl) {
    throw new Error("Subgraph URL not configured");
  }

  const response = await fetch(subgraphUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify({
      query: GET_PROPOSAL_METADATA,
      variables: { id },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  return result.data;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const data = await fetchProposalData(id);

    if (data?.proposals?.[0]) {
      const proposal = data.proposals[0];
      const title = extractTitleFromContent(proposal.description);
      const description = extractDescriptionFromContent(proposal.description);

      const ogPath = `/og?title=${encodeURIComponent(title)}`;

      return {
        title: `${title}`,
        description,
        openGraph: {
          title: `${title}`,
          description,
          type: "website",
          images: [ogPath],
        },
        twitter: {
          card: "summary_large_image",
          title: `${title}`,
          description,
          images: [ogPath],
        },
      };
    }
  } catch (error) {
    console.error("Error fetching proposal metadata:", error);
  }

  // Fallback metadata
  return {
    title: `Proposal #${id}`,
    description: "View proposal details on Mento Governance",
  };
}

export default function ProposalPage() {
  return (
    <main className="md:px-22 relative w-full px-4 py-8 md:py-16">
      <ProposalContent />
    </main>
  );
}
