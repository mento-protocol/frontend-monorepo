"use client";

import BigNumber from "bignumber.js";
import { useState } from "react";
import { NetworkModal } from "@/components/nav/network-modal";
import { STALE_BLOCK_TIME } from "@/lib/config/consts";
import { links } from "@/lib/config/links";
import type { BlockStub } from "@/features/blocks/types";
// import { useAtomValue } from "jotai";
// import { latestBlockAtom } from "@/features/blocks/block-atoms";
// import { Github, Moon, Sun, XIcon } from "lucide-react";
import { isStale } from "@/lib/utils/time";

import { IconBrandX, IconBrandGithub, IconBrandDiscord } from "@repo/ui/";

export function Footer() {
  return (
    <div className="">
      <div className="flex flex-row items-center justify-center gap-4">
        <a
          href={links.x}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X"
        >
          <IconBrandX />
        </a>
        <a
          href={links.github}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Github"
        >
          <IconBrandGithub />
        </a>
        <a
          href={links.discord}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discord"
        >
          <IconBrandDiscord />
        </a>
      </div>
      {/* <ThemeToggle /> */}
      {/* <BlockIndicator /> */}
    </div>
  );
}

// function ThemeToggle() {
//   const [isDarkMode, setIsDarkMode] = useState(false);

//   return (
//     <div
//       className="inline-flex cursor-pointer items-center justify-start gap-3"
//       onClick={() => setIsDarkMode(!isDarkMode)}
//     >
//       <div className="text-[15px] font-normal leading-tight text-gray-950 dark:text-neutral-400">
//         Theme
//       </div>
//       <div className="trainsition-color relative flex items-center justify-center gap-[5px] rounded-[32px] border border-gray-950 px-0.5 py-[1px] dark:bg-fuchsia-200">
//         <div className="relative flex h-5 w-4 flex-col items-start justify-start p-1 pr-0">
//           <Sun />
//         </div>
//         <div className="relative flex h-5 w-4 flex-col items-start justify-start py-1 pr-1">
//           <Moon />
//         </div>
//         <div
//           className={`absolute left-[2px] h-[18px] w-[18px] transform rounded-full border border-gray-950 bg-gray-950 transition ${
//             !isDarkMode ? "translate-x-[19px]" : ""
//           } `}
//         />
//       </div>
//     </div>
//   );
// }

// function BlockIndicator() {
//   const latestBlock = useAtomValue(latestBlockAtom);

//   const status = getStatusFromBlock(latestBlock);
//   let summary = "Connecting";
//   let classColor = "bg-yellow-300";
//   if (status === ConnStatus.Connected) {
//     summary = latestBlock!.number.toString();
//     classColor = "bg-emerald-500";
//   } else if (status === ConnStatus.Stale) {
//     summary = latestBlock!.number.toString();
//   } else if (status === ConnStatus.NotConnected) {
//     summary = "Not Connected";
//     classColor = "bg-red-600";
//   }

//   const [showNetworkModal, setShowNetworkModal] = useState(false);

//   return (
//     <>
//       <button
//         onClick={() => setShowNetworkModal(true)}
//         className="mt-2 inline-flex h-7 items-center justify-end gap-1.5 rounded-[100px] bg-gray-100 px-2.5 dark:bg-neutral-800"
//       >
//         <div className="text-right text-[15px] font-normal leading-tight text-gray-950 dark:text-white">
//           {summary}
//         </div>
//         <div
//           className={`relative h-2 w-2 rounded-[100px] bg-emerald-500 ${classColor}`}
//         />
//       </button>
//       {showNetworkModal && (
//         <NetworkModal
//           isOpen={showNetworkModal}
//           close={() => setShowNetworkModal(false)}
//         />
//       )}
//     </>
//   );
// }

enum ConnStatus {
  NotConnected = -1,
  Loading = 0,
  Stale = 1,
  Connected = 2,
}

function getStatusFromBlock(
  latestBlock: BlockStub | null | undefined,
): ConnStatus {
  if (latestBlock === undefined) return ConnStatus.Loading;

  if (latestBlock && latestBlock.number > 0 && latestBlock.timestamp > 0) {
    if (
      !isStale(
        new BigNumber(latestBlock.timestamp).toNumber() * 1000,
        STALE_BLOCK_TIME,
      )
    ) {
      return ConnStatus.Connected;
    } else {
      return ConnStatus.Stale;
    }
  }

  return ConnStatus.NotConnected;
}
