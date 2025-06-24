import { Button, Logo } from "@repo/ui";
import {
  DollarSign,
  LayoutGrid,
  RefreshCw,
  Repeat,
  Droplets,
} from "lucide-react";
import Link from "next/link";
import { ConnectButton } from "@/components/nav/connect-button";

const navItems = [
  { href: "/v3/dashboard", icon: LayoutGrid, label: "Dashboard" },
  { href: "#", icon: DollarSign, label: "Trove" },
  { href: "#", icon: Repeat, label: "Redeem" },
  { href: "#", icon: Droplets, label: "Pools" },
];

export function V3Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex items-center justify-between p-4">
        <div className="flex items-center gap-8">
          <Link href="/v3/dashboard" className="flex items-center gap-2">
            <Logo />
            <span className="text-lg font-bold text-slate-800">Mento V3</span>
          </Link>
          <div className="hidden items-center gap-6 md:flex">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
