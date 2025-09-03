import { ImageResponse } from "next/og";

// Edge runtime is required for Vercel OG image generation
export const runtime = "edge";

// 1200x630 is the recommended size for Open Graph images
const WIDTH = 1200;
const HEIGHT = 630;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // Fallback title if none provided
  let title = searchParams.get("title") || "Mento Governance Proposal";

  // Truncate very long titles for aesthetics
  if (title.length > 100) {
    title = title.substring(0, 97) + "...";
  }

  return new ImageResponse(
    (
      <div tw="flex w-full h-full items-center justify-center text-white relative">
        <img
          src="https://klbko5u0yg957qmk.public.blob.vercel-storage.com/shared/placeholder-og.png"
          alt=""
          tw="w-full h-full"
        />
        <div tw="absolute bottom-[36%] -translate-x-1/2 -translate-y-1/2 flex text-center items-center flex-col">
          <h1 tw="text-3xl font-bold max-w-2xl px-12 mb-12">{title}</h1>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
    },
  );
}
