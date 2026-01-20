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
    <section className="xl:px-22 mb-8 px-4 md:mb-20 md:px-20 w-full">
      <div
        data-slot="community-card"
        className={cn(
          "xl:after:bg-card gap-4 p-6 md:h-[320px] md:justify-center md:p-8 xl:relative xl:mt-32 xl:after:absolute xl:after:-left-20 xl:after:-top-20 xl:after:block xl:after:h-20 xl:after:w-20 relative flex w-full flex-col bg-card text-card-foreground",
          className,
        )}
        {...props}
      >
        <img
          src={`${process.env.NEXT_PUBLIC_STORAGE_URL}/shared/join-community-mobile.png`}
          className="inset-0 max-h-80 md:hidden absolute z-0 h-full w-full object-cover"
          alt="Community background"
        />
        <img
          src={`${process.env.NEXT_PUBLIC_STORAGE_URL}/shared/join-community.png`}
          className="inset-0 max-w-2xl max-md:hidden absolute z-0 h-full object-cover"
          alt="Community background"
        />

        <div className="max-w-md pt-64 md:pt-0 relative z-10 ml-auto">
          <h3 className="mb-2 font-medium text-3xl">{title}</h3>
          <p className="mb-10 text-muted-foreground">{description}</p>
          <a href={buttonHref}>
            <Button className="w-fit" size="lg" clipped="default">
              <IconBrandDiscord />
              {buttonText}
              <ChevronsRight size={20} />
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

export { CommunityCard };
