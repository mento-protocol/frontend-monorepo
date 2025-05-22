import { Button } from "@repo/ui";
import NewSwapForm from "./new-swap-form";

import { SlidersHorizontal } from "lucide-react";
import NewSwapConfirmCard from "./new-swap-confirm-card";
import { NewSlippageModal } from "./new-slippage-modal";

export function NewSwapFormCard() {
  return (
    <>
      <div className="bg-card flex flex-col space-y-6 p-6">
        <div className="flex flex-row items-center justify-between gap-6">
          <h2>Swap</h2>
          <div>
            <NewSlippageModal />
          </div>
        </div>
        <div>
          <NewSwapForm />
          {/* <NewSwapConfirmCard /> */}
        </div>
      </div>
    </>
  );
}
