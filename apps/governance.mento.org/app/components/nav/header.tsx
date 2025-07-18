"use client";

import Link from "next/link";
import { ConnectButton } from "../connect-button";

import {
  Logo,
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from "@repo/ui";

export function Header() {
  return (
    <header className="relative z-10">
      <div className="flex h-20 flex-row items-center justify-between gap-6">
        <div className="flex flex-row items-center justify-start gap-10">
          <a
            href="https://www.mento.org"
            className="flex items-center"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Mento.org"
          >
            <Logo />
          </a>
          <NavigationMenu className="hidden md:flex">
            <NavigationMenuList className="gap-6">
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link href="/">Home</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link href="/create-proposal">My Voting Power</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
        <div className="flex flex-row items-center justify-between gap-2 px-4 md:px-6">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
