"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import { Button3D, Button3DText } from "@/components/buttons/3-d-button";
import type { SwapFormValues } from "@/features/swap/types";
import { logger } from "@/lib/utils/logger";
import { useNetwork, useSwitchNetwork } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { resetSwapUiAtomsAtom } from "@/features/swap/swap-atoms";
import { resetLatestBlockAtom } from "@/features/blocks/block-atoms";
import { resetTokenPricesAtom } from "@/features/chart/token-price-atoms";
import type { FieldErrors as RHFFieldErrors } from "react-hook-form";

interface ISubmitButtonProps {
  isWalletConnected: boolean | undefined;
  isBalanceLoaded: boolean | undefined;
  isSubmitting: boolean;
  isValid: boolean; // May not be directly used if hasError logic is sufficient
  errors: RHFFieldErrors<SwapFormValues>;
  values: SwapFormValues;
}

export function SubmitButton({
  isWalletConnected,
  isBalanceLoaded,
  isSubmitting,
  isValid,
  errors,
  values,
}: ISubmitButtonProps) {
  const { chain, chains } = useNetwork();
  const { switchNetworkAsync } = useSwitchNetwork();
  const { openConnectModal } = useConnectModal();
  const queryClient = useQueryClient();
  const resetJotaiSwapState = useSetAtom(resetSwapUiAtomsAtom);
  const setResetLatestBlock = useSetAtom(resetLatestBlockAtom);
  const setResetTokenPrices = useSetAtom(resetTokenPricesAtom);

  const switchToNetwork = useCallback(async () => {
    try {
      if (!switchNetworkAsync) throw new Error("switchNetworkAsync undefined");
      logger.debug("Resetting and switching to Celo");
      await switchNetworkAsync(42220);
      setResetLatestBlock();
      resetJotaiSwapState();
      setResetTokenPrices();
    } catch (error) {
      logger.error("Error updating network", error);
      toast.error("Could not switch network, does wallet support switching?");
    }
  }, [
    switchNetworkAsync,
    resetJotaiSwapState,
    setResetLatestBlock,
    setResetTokenPrices,
  ]);

  const isOnCelo = chains.some((chn) => chn.id === chain?.id);

  const isAmountModified = useMemo(
    () => !!values.amount, // Simplified: check if amount has a value
    [values.amount],
  );

  const isQuoteStillLoading = useMemo(
    () =>
      values.amount &&
      values?.quote &&
      errors.amount?.message === "Amount Required",
    [values.amount, values.quote, errors.amount],
  );

  const hasError = useMemo(() => {
    if (!isAmountModified) return false;
    if (isQuoteStillLoading) return false;
    // Check if any error message exists
    return !!(
      errors.amount?.message ||
      errors.quote?.message ||
      errors.fromTokenId?.message ||
      errors.toTokenId?.message ||
      errors.slippage?.message
    );
  }, [isAmountModified, isQuoteStillLoading, errors]);

  const errorText = useMemo(
    () =>
      errors.amount?.message ||
      errors.quote?.message ||
      errors.fromTokenId?.message ||
      errors.toTokenId?.message ||
      errors.slippage?.message ||
      "",
    [errors],
  );

  const buttonType = useMemo(
    () => (isWalletConnected && !hasError ? "submit" : "button"),
    [isWalletConnected, hasError],
  );

  const buttonText = useMemo(() => {
    if (!isWalletConnected) return Button3DText.connectWallet;
    if (!isOnCelo) return Button3DText.switchToCeloNetwork;
    if (isWalletConnected && !isBalanceLoaded)
      return Button3DText.balanceStillLoading;
    if (hasError) return errorText;
    if (isSubmitting) return Button3DText.preparingSwap;
    return Button3DText.continue;
  }, [
    errorText,
    hasError,
    isWalletConnected,
    isOnCelo,
    isBalanceLoaded,
    isSubmitting,
  ]);

  const onClick = useMemo(() => {
    if (!isWalletConnected) return openConnectModal;
    if (!isOnCelo) return switchToNetwork;
    return undefined;
  }, [isWalletConnected, isOnCelo, openConnectModal, switchToNetwork]);

  const isDisabled = useMemo(() => {
    if (!isWalletConnected || hasError) return false; // Button might be clickable to show error or connect wallet
    if (buttonText === Button3DText.balanceStillLoading) return true;
    if (isSubmitting) return true;
    return !Number(values.quote); // Disabled if quote is not a positive number
  }, [isWalletConnected, hasError, buttonText, values.quote, isSubmitting]);

  return (
    <div className="flex w-full flex-col items-center justify-center">
      <Button3D
        isDisabled={isDisabled}
        isError={hasError}
        isFullWidth
        onClick={onClick}
        type={buttonType}
        isWalletConnected={isWalletConnected}
        isBalanceLoaded={isBalanceLoaded}
      >
        {buttonText}
      </Button3D>
    </div>
  );
}
