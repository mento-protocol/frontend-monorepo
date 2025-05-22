"use client";
import type * as React from "react";
import { cn } from "@/lib/utils.js";
import { ChevronsRight, Search } from "lucide-react";
import { Button } from "./button.js";

interface CommunityCardProps extends React.ComponentProps<"div"> {
  title?: string;
  images?: {
    mobile?: string;
    desktop?: string;
  };
  description?: string;
  buttonText?: string;
  buttonHref?: string;
}

function CommunityCard({
  className,
  title = "Join our community",
  description = "If you're interested in learning more about Mento, finding out what the team is working on now, or would like to contribute, please join our discord server.",
  buttonText = "Join our community",
  buttonHref = "#",
  images,
  ...props
}: CommunityCardProps) {
  return (
    <div
      data-slot="community-card"
      className={cn(
        "bg-card text-card-foreground relative flex w-full flex-col gap-4 overflow-hidden p-6 md:h-[320px] md:justify-center md:p-8",
        className,
      )}
      {...props}
    >
      <img
        src={images?.mobile}
        className="absolute inset-0 z-0 h-full max-h-80 w-full object-cover md:hidden"
        alt="Community background"
      />
      <img
        src={images?.desktop}
        className="absolute inset-0 z-0 hidden h-full max-w-2xl object-cover md:block"
        alt="Community background"
      />

      <div className="relative z-10 ml-auto max-w-md pt-64 md:pt-0">
        <h3 className="mb-2 text-3xl font-medium">{title}</h3>
        <p className="text-muted-foreground mb-10 text-sm leading-6">
          {description}
        </p>
        <a href={buttonHref}>
          <Button className="w-fit" size="lg" clipped="default">
            <Search size={20} />
            {buttonText}
            <ChevronsRight size={20} />
          </Button>
        </a>
      </div>
    </div>
  );
}

export { CommunityCard };
