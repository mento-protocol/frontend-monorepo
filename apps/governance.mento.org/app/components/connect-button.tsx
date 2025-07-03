"use client";

import {
  ConnectButton as RainbowConnectButton,
  useAccountModal,
  useChainModal,
} from "@rainbow-me/rainbowkit";
import {
  Button,
  ButtonProps,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@repo/ui";
import {
  ChevronDown,
  ClipboardCopy,
  LogOut,
  Network as NetworkIcon,
} from "lucide-react";
import { useDisconnect } from "wagmi";

// Local imports
import NumbersService from "@/lib/helpers/numbers";
import WalletHelper from "@/lib/helpers/wallet.helper";
import { useAddTokens } from "@/lib/hooks/use-add-tokens";
import useTokens from "@/lib/hooks/use-tokens";
import { MentoIcon } from "@repo/ui";

/**
 * Custom component to show token balances
 */
const BalancesSummary = () => {
  const { mentoBalance, veMentoBalance } = useTokens();
  const { addMento, addVeMento } = useAddTokens();

  return (
    <div className="flex w-full flex-col">
      <div
        title="Click to add MENTO to your wallet"
        onClick={addMento}
        className="flex w-full cursor-pointer flex-row justify-between px-2 py-3"
      >
        <div className="flex flex-row items-center font-medium">
          <MentoIcon className="mr-2" height={24} width={24} />
          <span>{mentoBalance.symbol}</span>
        </div>
        <div className="flex flex-row items-center justify-center font-medium">
          {NumbersService.parseNumericValue(mentoBalance.formatted, 1)}
        </div>
      </div>
      <hr className="border-border mx-auto w-[calc(100%_-_32px)]" />
      <div
        title="Click to add veMENTO to your wallet"
        onClick={addVeMento}
        className="flex w-full cursor-pointer flex-row justify-between px-2 py-3"
      >
        <div className="flex flex-row items-center font-medium">
          <MentoIcon className="mr-2" height={24} width={24} />
          <span>{veMentoBalance.symbol}</span>
        </div>
        <div className="flex flex-row items-center justify-center font-medium">
          {NumbersService.parseNumericValue(veMentoBalance.formatted, 1)}
        </div>
      </div>
    </div>
  );
};

/**
 * ConnectedDropdown component displays the wallet information and options
 */
const ConnectedDropdown = ({
  account,
  fullwidth,
}: {
  account: { address: string };
  fullwidth?: boolean;
}) => {
  const { openChainModal } = useChainModal();
  const { openAccountModal } = useAccountModal();
  const { disconnect } = useDisconnect();

  const onClickCopy = async () => {
    if (!account.address) return;
    try {
      await navigator.clipboard.writeText(account.address);
      toast.success("Address copied to clipboard", { duration: 2000 });
    } catch (error) {
      console.error("Failed to copy address", error);
    }
  };

  const iconSize = 18;
  const iconStrokeWidth = 1.5;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 justify-start gap-2 px-4 py-2 font-medium",
            "text-accent-foreground border-border-secondary",
            fullwidth ? "w-full" : "w-42",
          )}
        >
          <div className="bg-background flex aspect-square h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
            <img
              src={`https://effigy.im/a/${account.address}.svg`}
              alt="Wallet avatar"
              className="h-full w-full"
            />
          </div>
          <span>{WalletHelper.getShortAddress(account.address)}</span>
          <ChevronDown size={20} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn("w-64", fullwidth ? "w-full" : "w-64")}
      >
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
          onClick={openChainModal}
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
  );
};

type ConnectButtonProps = ButtonProps & {
  size?: "sm" | "lg";
  text?: string;
  fullwidth?: boolean;
};

/**
 * Main ConnectButton component
 */
export const ConnectButton = ({
  className,
  size = "sm",
  text = "Connect Wallet",
  fullwidth,
}: ConnectButtonProps) => {
  return (
    <RainbowConnectButton.Custom>
      {({ account, chain, openConnectModal, mounted }) => {
        if (!mounted) return <></>;
        const connected = !!account && !!chain;

        return (
          <div
            className={cn(
              "relative flex justify-end",
              fullwidth ? "w-full" : "w-auto",
              className,
            )}
          >
            {!connected ? (
              <Button
                size={size === "lg" ? "lg" : "sm"}
                onClick={openConnectModal}
                className={cn(fullwidth ? "w-full" : "w-auto")}
                type="button"
                variant="default"
                clipped="default"
              >
                {text}
              </Button>
            ) : (
              <ConnectedDropdown account={account} fullwidth={!!fullwidth} />
            )}
          </div>
        );
      }}
    </RainbowConnectButton.Custom>
  );
};
