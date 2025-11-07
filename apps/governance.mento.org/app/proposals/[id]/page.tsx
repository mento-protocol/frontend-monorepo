import { ProposalContent } from "@/components/proposal/content";
import { env } from "@/env.mjs";
import { Metadata } from "next";
import createDOMPurify from "isomorphic-dompurify";

const GET_PROPOSAL_METADATA = `
  query GetProposalMetadata($id: BigInt) {
    proposals(where: { proposalId: $id }) {
      proposalId
      description
    }
  }
`;

/**
 * Safely sanitize text for metadata extraction, removing all HTML tags including <script> tags
 * Uses DOMPurify to ensure dangerous content is removed
 */
function sanitizeMetaText(input: string): string {
  // First sanitize to remove dangerous tags like <script>
  const sanitized = createDOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
  // Then extract text content by removing markdown and HTML
  return sanitized
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<a[^>]*>(.*?)<\/a>/gi, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleFromContent(description: string): string {
  if (!description) return "Unknown";

  try {
    const parsed = JSON.parse(description);
    if (parsed && typeof parsed.title === "string" && parsed.title.trim()) {
      return sanitizeMetaText(parsed.title.trim());
    }
  } catch (error) {
    console.error("Error parsing proposal metadata", error);
  }

  const firstLine = description?.split("\n")[0] ?? "";
  const withoutHeading = firstLine.replace(/^#\s+/, "").trim();
  const cleanTitle = sanitizeMetaText(withoutHeading);

  return cleanTitle || "Unknown";
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
      let desc = sanitizeMetaText(parsed.description.trim());
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
    .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, "");

  cleanDescription = sanitizeMetaText(cleanDescription);

  if (cleanDescription.length > 160) {
    cleanDescription = cleanDescription.substring(0, 157) + "...";
  }

  return cleanDescription || "View proposal details";
}

async function fetchProposalData(id: string) {
  const isCeloSepolia = env.NEXT_PUBLIC_VERCEL_ENV !== "production";
  const subgraphUrl = isCeloSepolia
    ? env.NEXT_PUBLIC_SUBGRAPH_URL_CELO_SEPOLIA
    : env.NEXT_PUBLIC_SUBGRAPH_URL;
  const apiKey = env.NEXT_PUBLIC_GRAPH_API_KEY;

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
