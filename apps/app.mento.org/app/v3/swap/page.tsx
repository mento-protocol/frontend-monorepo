"use client";

import { IconCheck, Toaster } from "@repo/ui";
import { V3SwapForm } from "../../components/v3/v3-swap-form";

export default function V3SwapPage() {
  return (
    <>
      <Toaster
        position="top-right"
        duration={5000}
        icons={{
          success: <IconCheck className="text-success" />,
        }}
        closeButton
        toastOptions={{
          classNames: {
            toast: "toast",
            title: "title",
            description: "description",
            actionButton: "action-button",
            cancelButton: "cancel-button",
            closeButton: "close-button",
            icon: "icon",
          },
        }}
        offset={{ top: "80px" }}
        mobileOffset={{ top: "96px" }}
      />
      <div className="container mx-auto max-w-2xl space-y-8 p-4 md:p-8">
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-slate-900">
            V3 Token Swap
          </h1>
          <p className="text-slate-700">
            Swap tokens directly through FPMM pools on Mento V3.
          </p>
        </div>

        <V3SwapForm />
      </div>
    </>
  );
}
