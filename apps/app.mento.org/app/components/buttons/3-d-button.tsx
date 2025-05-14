"use client";

import type { PropsWithChildren } from "react";

type BaseButtonProps = {
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  isError?: boolean;
  isFullWidth?: boolean;
  isDisabled?: boolean;
  isWalletConnected?: boolean;
  isBalanceLoaded?: boolean;
};

export enum Button3DText {
  connectWallet = "Connect Wallet",
  continue = "Continue",
  balanceStillLoading = "Balance still loading...",
  switchToCeloNetwork = "Switch to Celo Network",
  preparingSwap = "Preparing Swap...",
}

export const Button3D = ({
  children,
  onClick,
  type = "button",
  isError,
  isFullWidth,
  isDisabled,
  isWalletConnected,
  isBalanceLoaded,
}: PropsWithChildren<BaseButtonProps>) => {
  return (
    <button
      className={isFullWidth ? "w-full" : ""}
      onClick={onClick}
      type={type}
      disabled={isDisabled}
    >
      <span
        className={`font-inter group cursor-pointer outline-offset-4 ${getShadowButtonColor(
          {
            isDisabled,
            isWalletConnected,
            isError,
            isBalanceLoaded,
          },
        )} ${
          isFullWidth ? "w-full" : ""
        } border-primary-dark inline-block select-none rounded-lg border-b font-medium`}
      >
        <span
          className={`block py-[18px] pl-10 pr-10 transition-transform delay-[250] group-active:-translate-y-[2px] hover:translate-y-[${
            isDisabled ? "-4px" : "6px"
          }] border-primary-dark -translate-y-[4px] rounded-lg border text-[15px] font-medium leading-5 ${getButtonColor(
            {
              isDisabled,
              isWalletConnected,
              isError,
              isBalanceLoaded,
            },
          )} ${isFullWidth ? "flex w-full items-center justify-center" : ""} `}
        >
          <span className="flex items-center">{children}</span>
        </span>
      </span>
    </button>
  );
};

function getShadowButtonColor({
  isDisabled,
  isWalletConnected,
  isError,
  isBalanceLoaded,
}: IGetButtonColorArgs) {
  switch (true) {
    case isDisabled:
    case isWalletConnected && !isBalanceLoaded:
      return "bg-[#666666]";
    case isError && isWalletConnected:
      return "bg-[#863636]";
    default:
      return "bg-[#2A326A]";
  }
}

function getButtonColor({
  isDisabled,
  isWalletConnected,
  isError,
  isBalanceLoaded,
}: IGetButtonColorArgs) {
  switch (true) {
    case isDisabled:
    case isWalletConnected && !isBalanceLoaded:
      return "bg-[#888888] text-white cursor-not-allowed";
    case isError && isWalletConnected:
      return "bg-[#E14F4F] text-white";
    default:
      return "bg-[#4D62F0] text-white ";
  }
}

interface IGetButtonColorArgs {
  isWalletConnected: boolean | undefined;
  isBalanceLoaded: boolean | undefined;
  isDisabled: boolean | undefined;
  isError: boolean | undefined;
}
