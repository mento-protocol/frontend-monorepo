"use client";

import { env } from "@/env.mjs";

export function Banner() {
  const text = env.NEXT_PUBLIC_BANNER_TEXT;
  const link = env.NEXT_PUBLIC_BANNER_LINK;

  if (!text) return null;

  const content = <p className="text-sm font-medium text-white">{text}</p>;

  if (link) {
    return (
      <div className="relative z-50 w-full bg-primary">
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="gap-2 px-4 py-2 flex items-center justify-center transition-opacity hover:opacity-90"
        >
          {content}
          <span className="text-white/80 text-sm">→</span>
        </a>
      </div>
    );
  }

  return (
    <div className="px-4 py-2 relative z-50 flex w-full items-center justify-center bg-primary">
      {content}
    </div>
  );
}
