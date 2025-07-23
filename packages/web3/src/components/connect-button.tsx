"use client";

import { Identicon } from "@/components/identicon";
import { BalancesSummary } from "@/components/balances-summary";
import { NetworkDialog } from "@/components/network-dialog";
import { cleanupStaleWalletSessions } from "@/config/wallets";
import { shortenAddress } from "@/utils/addresses";
import { tryClipboardSet } from "@/utils/clipboard";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ChevronDown,
  ClipboardCopy,
  LogOut,
  Network as NetworkIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "@repo/ui";
import { useAccount, useDisconnect } from "wagmi";

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui";

export function ConnectButton({
  size = "sm",
  text = "Connect Wallet",
}: {
  size?: "sm" | "lg";
  text?: string;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);

  const onClickConnect = () => {
    cleanupStaleWalletSessions();
    openConnectModal?.();
  };

  const onClickCopy = async () => {
    if (!address) return;
    await tryClipboardSet(address);
    toast.success("Address copied to clipboard", { duration: 2000 });
  };

  const onClickChangeNetwork = () => {
    setShowNetworkDialog(true);
  };

  const onClickDisconnect = () => {
    disconnect();
  };

  const iconSize = 18;
  const iconStrokeWidth = 1.5;

  return (
    <div className="relative flex w-full justify-end">
      {address && isConnected ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-9 w-full justify-start gap-2 px-4 py-2 font-medium",
                "text-accent-foreground w-42 border-border-secondary",
              )}
            >
              <Identicon address={address} size={20} />
              <span>{shortenAddress(address)}</span>
              <ChevronDown size={20} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-42">
            <BalancesSummary />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onClickCopy}
              className={cn(
                "cursor-pointer gap-3 py-3",
                "focus:bg-accent focus:text-accent-foreground",
              )}
            >
              <ClipboardCopy
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                className="text-muted-foreground"
              />
              <span>Copy Address</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onClickChangeNetwork}
              className={cn(
                "cursor-pointer gap-3 py-3",
                "focus:bg-accent focus:text-accent-foreground",
              )}
            >
              <NetworkIcon
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                className="text-muted-foreground"
              />
              <span>Change Network</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onClickDisconnect}
              className={cn(
                "cursor-pointer gap-3 py-3",
                "text-destructive",
                "focus:text-destructive-foreground",
              )}
            >
              <LogOut
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                className="text-destructive"
              />
              <span>Disconnect</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          size={size === "lg" ? "lg" : "sm"}
          onClick={onClickConnect}
          className="w-full"
          type="button"
          clipped={size === "lg" ? "lg" : "sm"}
        >
          {text}
        </Button>
      )}
      {showNetworkDialog && (
        <NetworkDialog
          isOpen={showNetworkDialog}
          close={() => setShowNetworkDialog(false)}
        />
      )}
    </div>
  );
}
