"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  ClipboardCopy,
  LogOut,
  Network as NetworkIcon,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";
import { Identicon } from "@/components/identicon";
import { SolidButton } from "@/components/buttons/solid-button";
import { BalancesSummary } from "@/components/nav/balances-summary";
import { NetworkModal } from "@/components/nav/network-modal";
import { cleanupStaleWalletSessions } from "@/lib/config/wallets";
import { DropdownModal } from "@/components/layout/dropdown";
import { shortenAddress } from "@/lib/utils/addresses";
import { tryClipboardSet } from "@/lib/utils/clipboard";
import { useAccount, useDisconnect } from "wagmi";

import { Button } from "@repo/ui";

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();

  const onClickConnect = () => {
    cleanupStaleWalletSessions();
    openConnectModal?.();
  };

  const onClickCopy = async () => {
    if (!address) return;
    await tryClipboardSet(address);
    toast.success("Address copied to clipboard", { autoClose: 1200 });
  };

  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const onClickChangeNetwork = () => {
    setShowNetworkModal(true);
  };

  const onClickDisconnect = () => {
    disconnect();
  };

  const iconSize = 18;
  const iconStrokeWidth = 1.5;

  return (
    <div className="relative mb-1 flex justify-end opacity-90">
      {address && isConnected ? (
        <DropdownModal
          placement="bottom-end"
          buttonContent={() => (
            <div className="flex items-center">
              <Identicon address={address} size={26} />
              <div className="ml-[12px] hidden sm:block">
                {shortenAddress(address)}
              </div>
            </div>
          )}
          buttonClasses={
            styles.walletButtonConnected + " " + styles.walletButtonDefault
          }
          modalContent={() => (
            <div className="py-5 font-medium leading-5">
              <BalancesSummary />

              <div className={styles.menuOption} onClick={onClickCopy}>
                <ClipboardCopy
                  size={iconSize}
                  strokeWidth={iconStrokeWidth}
                  className="mr-3 text-black dark:text-white"
                />
                <div className="transition-colors duration-200 hover:text-gray-500 active:text-gray-200">
                  Copy Address
                </div>
              </div>
              <div className={styles.menuOption} onClick={onClickChangeNetwork}>
                <NetworkIcon
                  size={iconSize}
                  strokeWidth={iconStrokeWidth}
                  className="mr-3 text-black dark:text-white"
                />
                <div className="transition-colors duration-200 hover:text-gray-500 active:text-gray-200">
                  Change Network
                </div>
              </div>
              <hr className="mx-5 mt-4 dark:border-[#333336]" />
              <div className={styles.menuOption} onClick={onClickDisconnect}>
                <LogOut
                  size={iconSize}
                  strokeWidth={iconStrokeWidth}
                  className="dark:text-primary-blush dark:group-hover:text-primary-blush mr-3 text-black group-hover:text-gray-500"
                />
                <div className="dark:text-primary-blush transition-colors duration-200 hover:text-gray-500 active:text-gray-200">
                  Disconnect
                </div>
              </div>
            </div>
          )}
          modalClasses="right-px min-w-[272px] border border-solid border-black dark:border-[#333336] text-sm !rounded-[16px] !shadow-lg2 dark:bg-[#1D1D20]/[1]"
        />
      ) : (
        <>
          <Button clipped="sm" onClick={onClickConnect}>
            Connect Wallet
          </Button>
          {/* <SolidButton
            color="black"
            classes={styles.walletButtonDefault}
            icon={
              <Wallet
                size={iconSize}
                strokeWidth={iconStrokeWidth}
                className="mr-3 text-black dark:text-white"
              />
            }
            onClick={onClickConnect}
          >
            <div className="hidden sm:block">Connect</div>
          </SolidButton> */}
        </>
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

const styles = {
  walletButtonDefault:
    "shadow-md h-[52px] min-w-[137px] py-[16px] !pl-[20px] !pr-[24px] sm:px-4 rounded-lg border border-solid border-black dark:border-white font-medium leading-5 dark:text-white bg-neutral-800 flex items-center justify-center",
  walletButtonConnected:
    "flex items-center justify-center bg-neutral-800 text-black rounded-full shadow-md transition-all duration-300",
  menuOption:
    "group flex items-center cursor-pointer rounded px-5 pt-4 dark:text-white",
};
