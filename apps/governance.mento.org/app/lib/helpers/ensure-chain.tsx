"use client";
import { Alfajores, Celo } from "@/lib/config/chains";
import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  useAccount,
  useSwitchChain,
  createStorage,
  useDisconnect,
} from "wagmi";
import { IS_PROD } from "../../middleware";
import { isDevModeEnabled } from "./dev-mode";

export function EnsureChain({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const [switching, setSwitching] = useState(false);
  const [, setModalActive] = useState(false);
  const [devModeActive, setDevModeActive] = useState(false);

  // Check dev mode status on mount and when URL changes
  useEffect(() => {
    setDevModeActive(isDevModeEnabled());
  }, []);

  const setUpAndSwitch = useCallback(async () => {
    const storage = createStorage({ storage: localStorage });
    const recentConnectorId = await storage.getItem("recentConnectorId");
    switchChain({
      chainId: Celo.id,
    });
    if (recentConnectorId === "me.rainbow") {
      const directId = window.ethereum.chainId;
      const storeData: {
        state: {
          chainId: number;
        };
      } | null = await storage.getItem("store");
      // Adding networks not available on Rainbow wallet
      if (directId) {
        if (directId !== "0xa4ec" || directId !== "0xaef3") {
          disconnect();
          setModalActive(true);
        } else {
          setModalActive(false);
        }
      } else if (storeData?.state.chainId === Celo.id) {
        setModalActive(false);
      } else if (
        storeData?.state.chainId === Alfajores.id &&
        (!IS_PROD || devModeActive)
      ) {
        setModalActive(false);
      } else {
        disconnect();
        setModalActive(true);
      }
    } else {
      const storeData: {
        state: {
          chainId: number;
        };
      } | null = await storage.getItem("store");

      if (
        storeData?.state.chainId !== Celo.id &&
        (storeData?.state.chainId !== Alfajores.id ||
          (IS_PROD && !devModeActive))
      ) {
        disconnect();
        setModalActive(true);
      } else {
        setModalActive(false);
      }
    }
    setSwitching(false);
  }, [disconnect, switchChain, devModeActive]);

  useEffect(() => {
    if (isConnected) {
      const allowAlfajores = !IS_PROD || devModeActive;

      if (
        (IS_PROD && !devModeActive && chainId !== Celo.id) ||
        (!allowAlfajores && chainId !== Celo.id && chainId !== Alfajores.id)
      ) {
        if (!switching) {
          setSwitching(true);
        }
      }
    }
  }, [
    chainId,
    isConnected,
    setUpAndSwitch,
    switchChain,
    switching,
    devModeActive,
  ]);

  useEffect(() => {
    if (switching) {
      setUpAndSwitch();
    }
  }, [setUpAndSwitch, switching]);

  return (
    <>
      {children}
      {/* {incompatibleWalletModalActive && <IncompatibleWallet />} */}
    </>
  );
}
