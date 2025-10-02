"use client";
import { CeloSepolia, Celo } from "@/config/chains";
import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  createStorage,
  useAccount,
  useDisconnect,
  useSwitchChain,
} from "wagmi";

export function EnsureChain({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const [switching, setSwitching] = useState(false);
  const [, setModalActive] = useState(false);

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
      } else if (
        storeData?.state.chainId !== Celo.id ||
        storeData?.state.chainId !== CeloSepolia.id
      ) {
        disconnect();
        setModalActive(true);
      } else {
        setModalActive(false);
      }
    }
    setSwitching(false);
  }, [disconnect, switchChain]);

  useEffect(() => {
    if (isConnected) {
      if (chainId !== Celo.id) setSwitching(true);
    }
  }, [chainId, isConnected, setUpAndSwitch, switchChain, switching]);

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
