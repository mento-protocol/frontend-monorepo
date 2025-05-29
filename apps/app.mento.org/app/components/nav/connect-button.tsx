"use client";

import { Identicon } from "@/components/identicon";
import { BalancesSummary } from "@/components/nav/balances-summary";
import { NetworkModal } from "@/components/nav/network-modal";
import { cleanupStaleWalletSessions } from "@/lib/config/wallets";
import { shortenAddress } from "@/lib/utils/addresses";
import { tryClipboardSet } from "@/lib/utils/clipboard";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ChevronDown,
  ClipboardCopy,
  LogOut,
  Network as NetworkIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";
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
  const [showNetworkModal, setShowNetworkModal] = useState(false);

  const onClickConnect = () => {
    cleanupStaleWalletSessions();
    openConnectModal?.();
  };

  const onClickCopy = async () => {
    if (!address) return;
    await tryClipboardSet(address);
    toast.success("Address copied to clipboard", { autoClose: 1200 });
  };

  const onClickChangeNetwork = () => {
    setShowNetworkModal(true);
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
                "h-9 w-full justify-start gap-2 p-2 font-medium",
                "text-accent-foreground w-42 border-border-darker",
              )}
            >
              <Identicon address={address} size={20} />
              <span className="truncate">{shortenAddress(address)}</span>
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
                "focus:bg-destructive focus:text-destructive-foreground",
                "text-destructive",
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
      {showNetworkModal && (
        <NetworkModal
          isOpen={showNetworkModal}
          close={() => setShowNetworkModal(false)}
        />
      )}
    </div>
  );
}
