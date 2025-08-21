import { links } from "@/lib/links.js";
import { cn } from "@/lib/utils.js";
import IconDiscord from "./icons/discord.js";
import IconGithub from "./icons/github.js";
import IconX from "./icons/x.js";

const linkClassName =
  "text-muted-foreground text-base md:text-sm shrink-0 hover:text-white";

export interface FooterProps {
  type?: "swap" | "reserve" | "governance";
}

export function Footer({ type = "swap" }: FooterProps) {
  return (
    <footer className="border-border relative z-40 flex flex-col items-center justify-center gap-6 border-t p-4 md:!flex-row md:!justify-between">
      <span className="text-muted-foreground shrink-0 text-xs md:text-sm">
        ©2025 Mento Labs. All rights reserved.
      </span>
      <div className="mt-auto flex flex-row items-center justify-center gap-5 md:absolute md:left-1/2 md:-translate-x-1/2">
        <a
          href={links.x}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X"
          data-testid="x-link-button"
        >
          <IconX />
        </a>
        <a
          href={links.github}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Github"
          data-testid="github-link-button"
        >
          <IconGithub />
        </a>
        <a
          href={links.discord}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord"
          data-testid="discord-link-button"
        >
          <IconDiscord />
        </a>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-5">
        <a
          href="https://mento.org"
          className={cn(linkClassName)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mento.org
        </a>
        {(type === "governance" || type === "swap") && (
          <a
            href="https://reserve.mento.org"
            className={cn(linkClassName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Reserve
          </a>
        )}
        {(type === "reserve" || type === "swap") && (
          <a
            href="https://governance.mento.org"
            className={cn(linkClassName)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Governance
          </a>
        )}
        <a
          href="https://mento.org/privacy"
          className={cn(linkClassName)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>
      </div>
    </footer>
  );
}
