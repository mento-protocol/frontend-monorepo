"use client";
import { cn } from "@/lib/utils.js";
import { ChevronsRight } from "lucide-react";
import * as React from "react";
import IconBrandDiscord from "../icons/discord.js";
import { Button } from "./button.js";

interface CommunityCardProps extends React.ComponentProps<"div"> {
  title?: string;
  description?: string;
  buttonText?: string;
  buttonHref?: string;
}

function CommunityCard({
  className,
  title = "Join our community",
  description = "If you're interested in learning more about Mento, finding out what the team is working on now, or would like to contribute, please join our discord server.",
  buttonText = "Join our community",
  buttonHref = "http://discord.mento.org",
  ...props
}: CommunityCardProps) {
  return (
    <div
      data-slot="community-card"
      className={cn(
        "bg-card text-card-foreground xl:after:bg-card relative flex w-full flex-col gap-4 p-6 md:h-[320px] md:justify-center md:p-8 xl:relative xl:mt-32 xl:after:absolute xl:after:-left-20 xl:after:-top-20 xl:after:block xl:after:h-20 xl:after:w-20",
        className,
      )}
      {...props}
    >
      <img
        src={`${process.env.NEXT_PUBLIC_STORAGE_URL}/shared/join-community-mobile.png`}
        className="absolute inset-0 z-0 h-full max-h-80 w-full object-cover md:hidden"
        alt="Community background"
      />
      <img
        src={`${process.env.NEXT_PUBLIC_STORAGE_URL}/shared/join-community-desktop.png`}
        className="absolute inset-0 z-0 hidden h-full max-w-2xl object-cover md:block"
        alt="Community background"
      />

      <div className="relative z-10 ml-auto max-w-md pt-64 md:pt-0">
        <h3 className="mb-2 text-3xl font-medium">{title}</h3>
        <p className="text-muted-foreground mb-10">{description}</p>
        <a href={buttonHref}>
          <Button className="w-fit" size="lg" clipped="default">
            <IconBrandDiscord />
            {buttonText}
            <ChevronsRight size={20} />
          </Button>
        </a>
      </div>
    </div>
  );
}

export { CommunityCard };
