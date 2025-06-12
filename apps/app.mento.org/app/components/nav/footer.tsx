import { links } from "@/lib/config/links";

import { IconDiscord, IconGithub, IconX } from "@repo/ui";

export function Footer() {
  return (
    <div className="mb-8 mt-auto flex w-full flex-row items-center justify-center gap-4 p-4">
      <a
        href={links.x}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="X"
      >
        <IconX />
      </a>
      <a
        href={links.github}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Github"
      >
        <IconGithub />
      </a>
      <a
        href={links.discord}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Discord"
      >
        <IconDiscord />
      </a>
    </div>
  );
}
