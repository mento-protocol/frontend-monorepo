"use client";

import { BalancesSummary } from "@/components/balances-summary";
import { BalancesSummaryMento } from "@/components/balances-summary-mento";
import { Identicon } from "@/components/identicon";
import { NetworkDialog } from "@/components/network-dialog";
import { cleanupStaleWalletSessions } from "@/config/wallets";
import { tryClipboardSet } from "@/utils/clipboard";
import { WalletHelper } from "@/utils/wallet.helper";
import {
  ConnectButton as RainbowConnectButton,
  useAccountModal,
  useChainModal,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import { toast } from "@repo/ui";
import {
  ChevronDown,
  ClipboardCopy,
  LogOut,
  Network as NetworkIcon,
} from "lucide-react";
import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";

import {
  Button,
  ButtonProps,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui";

type ConnectButtonProps = ButtonProps & {
  size?: "sm" | "lg";
  text?: string;
  fullWidth?: boolean;
  balanceMode?: "all" | "mento";
};

interface ConnectedDropdownProps {
  account: { address: string };
  fullWidth?: boolean;
  balanceMode?: "all" | "mento";
}

function ConnectedDropdown({
  account,
  fullWidth,
  balanceMode = "all",
}: ConnectedDropdownProps) {
  const { openChainModal } = useChainModal();
  const { openAccountModal } = useAccountModal();
  const { disconnect } = useDisconnect();
  const [showNetworkDialog, setShowNetworkDialog] = useState(false);

  const onClickCopy = async () => {
    if (!account.address) return;
    try {
      await tryClipboardSet(account.address);
      toast.success("Address copied to clipboard", { duration: 2000 });
    } catch (error) {
      console.error("Failed to copy address", error);
    }
  };

  const onClickChangeNetwork = () => {
    if (openChainModal) {
      openChainModal();
    } else {
      setShowNetworkDialog(true);
    }
  };

  const iconSize = 18;
  const iconStrokeWidth = 1.5;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 justify-start gap-2 px-4 py-2 font-medium",
              "text-accent-foreground border-border-secondary",
              fullWidth ? "w-full" : "w-42",
            )}
          >
            <Identicon address={account.address} size={20} />
            <span>{WalletHelper.getShortAddress(account.address)}</span>
            <ChevronDown size={20} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={cn(
            balanceMode === "mento" ? "w-64" : "w-42",
            fullWidth && "w-full",
          )}
        >
          {balanceMode === "mento" ? (
            <BalancesSummaryMento />
          ) : (
            <BalancesSummary />
          )}
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
          {openAccountModal && (
            <DropdownMenuItem
              onClick={openAccountModal}
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
              <span>Account Settings</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => disconnect()}
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
      {showNetworkDialog && (
        <NetworkDialog
          isOpen={showNetworkDialog}
          close={() => setShowNetworkDialog(false)}
        />
      )}
    </>
  );
}

export function ConnectButton({
  className,
  size = "sm",
  text = "Connect Wallet",
  fullWidth,
  balanceMode = "all",
}: ConnectButtonProps) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const onClickConnect = () => {
    cleanupStaleWalletSessions();
    openConnectModal?.();
  };

  // Use RainbowKit's ConnectButton.Custom when available for better integration
  if (RainbowConnectButton?.Custom) {
    return (
      <RainbowConnectButton.Custom>
        {({
          account,
          chain,
          openConnectModal: rainbowOpenConnectModal,
          mounted,
        }) => {
          if (!mounted) return <></>;
          const connected = !!account && !!chain;

          return (
            <div
              className={cn(
                "relative flex justify-end",
                fullWidth ? "w-full" : "w-auto",
                className,
              )}
            >
              {!connected ? (
                <Button
                  size={size === "lg" ? "lg" : "sm"}
                  onClick={() => {
                    cleanupStaleWalletSessions();
                    rainbowOpenConnectModal?.();
                  }}
                  className={cn(fullWidth ? "w-full" : "w-auto")}
                  type="button"
                  variant="default"
                  clipped="default"
                >
                  {text}
                </Button>
              ) : (
                <ConnectedDropdown
                  account={account}
                  fullWidth={!!fullWidth}
                  balanceMode={balanceMode}
                />
              )}
            </div>
          );
        }}
      </RainbowConnectButton.Custom>
    );
  }

  // Fallback to basic implementation
  return (
    <div
      className={cn(
        "relative flex justify-end",
        fullWidth ? "w-full" : "w-auto",
        className,
      )}
    >
      {address && isConnected ? (
        <ConnectedDropdown
          account={{ address }}
          fullWidth={!!fullWidth}
          balanceMode={balanceMode}
        />
      ) : (
        <Button
          size={size === "lg" ? "lg" : "sm"}
          onClick={onClickConnect}
          className={cn(fullWidth ? "w-full" : "w-auto")}
          type="button"
          clipped={size === "lg" ? "lg" : "sm"}
        >
          {text}
        </Button>
      )}
    </div>
  );
}
