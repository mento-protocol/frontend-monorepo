"use client";

import Link from "next/link";

import {
  cn,
  Logo,
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@repo/ui";
import { ConnectButton } from "@repo/web3";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();

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
                <NavigationMenuLink
                  className={cn(pathname === "/" && "bg-accent")}
                  asChild
                >
                  <Link href="/">Home</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  className={cn(pathname === "/create-proposal" && "bg-accent")}
                  asChild
                >
                  <Link href="/create-proposal">Create Proposal</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink
                  className={cn(pathname === "/voting-power" && "bg-accent")}
                  asChild
                >
                  <Link href="/voting-power">My Voting Power</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <a
                    href="https://forum.mento.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Governance Forum
                  </a>
                </NavigationMenuLink>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
        </div>
        <div className="flex flex-row items-center justify-between gap-2 px-4 md:px-6">
          <ConnectButton balanceMode="mento" />
        </div>
      </div>
    </header>
  );
}
