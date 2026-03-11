"use client";

import Image from "next/image";
import { Button } from "@repo/ui";
import { ArrowRightLeft, ExternalLink } from "lucide-react";

export function BridgeView() {
  return (
    <div className="max-w-5xl space-y-6 px-4 pt-6 md:px-0 md:pt-0 pb-16 relative min-h-[550px] w-full">
      {/* Header */}
      <div className="relative">
        <div className="top-decorations after:-top-15 before:-left-5 before:-top-5 before:h-5 before:w-5 after:left-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-primary after:absolute after:block after:bg-card"></div>
        <div className="p-6 flex items-center justify-between bg-card">
          <div>
            <span className="font-medium tracking-widest font-mono text-[11px] text-muted-foreground uppercase">
              Cross-Chain
            </span>
            <h1 className="mt-2 font-bold text-3xl">Bridge</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bridge Mento tokens between supported networks.
            </p>
          </div>
        </div>
      </div>

      {/* Placeholder card */}
      <div className="px-6 py-14 relative overflow-hidden rounded-xl border border-border bg-card text-center">
        {/* Top accent line */}
        <div className="top-0 w-48 absolute left-1/2 h-[2px] -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        {/* Bridge illustration */}
        <div className="mb-7 flex justify-center">
          <div className="gap-4 flex items-center">
            {/* Celo network icon */}
            <div className="h-14 w-14 shadow-lg flex items-center justify-center rounded-full bg-[#FCFF52] shadow-[#FCFF52]/20">
              <Image
                src="/tokens/CELO.svg"
                alt="Celo"
                width={40}
                height={40}
                className="h-10 w-10"
              />
            </div>

            {/* Bridge arrows */}
            <div className="gap-1 flex flex-col items-center">
              <div className="w-16 h-[2px] bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              <div className="w-16 h-[2px] bg-gradient-to-r from-primary/60 via-primary to-primary/60" />
            </div>

            {/* Monad network icon */}
            <div className="h-14 w-14 shadow-lg flex items-center justify-center rounded-full shadow-[#836EF9]/20">
              <Image
                src="/networks/monad.svg"
                alt="Monad"
                width={56}
                height={56}
                className="h-14 w-14"
              />
            </div>
          </div>
        </div>

        <h2 className="mb-2.5 text-xl font-bold tracking-tight">Coming Soon</h2>
        <p className="mb-8 max-w-sm text-sm leading-relaxed mx-auto text-muted-foreground">
          Soon you will be able to bridge Mento tokens between Celo and Monad
          here. Until then, you can use Portal Bridge.
        </p>

        {/* CTA */}
        <a
          href="https://portalbridge.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="lg" className="gap-2.5">
            <ExternalLink className="h-4 w-4" />
            Visit Portal Bridge
          </Button>
        </a>
      </div>

      <div className="bottom-decorations after:-bottom-15 before:-bottom-5 before:-right-5 before:h-5 before:w-5 after:right-0 after:h-10 after:w-10 md:block hidden before:absolute before:block before:bg-card before:invert after:absolute after:block after:bg-card"></div>
    </div>
  );
}
