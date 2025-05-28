import { links } from "@/lib/config/links";

import { IconBrandDiscord, IconBrandGithub, IconBrandX } from "@repo/ui";

export function Footer() {
  return (
    <div className="fixed bottom-0 flex w-full flex-row items-center justify-center gap-4 p-4">
      <a
        href={links.x}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="X"
      >
        <IconBrandX />
      </a>
      <a
        href={links.github}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Github"
      >
        <IconBrandGithub />
      </a>
      <a
        href={links.discord}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Discord"
      >
        <IconBrandDiscord />
      </a>
    </div>
  );
}
