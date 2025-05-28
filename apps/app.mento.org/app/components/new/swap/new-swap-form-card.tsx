import { SlippageModal } from "./new-slippage-modal";
import SwapForm from "./new-swap-form";

export function SwapFormCard() {
  return (
    <>
      <div className="bg-card flex flex-col space-y-6 p-6">
        <div className="flex flex-row items-center justify-between gap-6">
          <h2>Swap</h2>
          <div>
            <SlippageModal />
          </div>
        </div>
        <div>
          <SwapForm />
        </div>
      </div>
    </>
  );
}
