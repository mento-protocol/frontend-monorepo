"use client";
import { Dialog, Transition } from "@headlessui/react";
import { Fragment, type PropsWithChildren } from "react";
import { X } from "lucide-react";

export function Modal({
  isOpen,
  title,
  close,
  width,
  children,
}: PropsWithChildren<{
  isOpen: boolean;
  title: string;
  close: () => void;
  width?: string;
}>) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={close}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-950 bg-opacity-60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel
                className={`w-full ${
                  width || "max-w-xs"
                } border-primary-dark max-h-[90vh] transform overflow-auto rounded-2xl border bg-white text-left shadow-lg transition-all dark:border-zinc-800 dark:bg-zinc-900`}
              >
                <div className="inline-flex h-20 w-full items-center justify-between px-6 py-4 sm:py-6">
                  <div className="text-[26px] font-medium leading-10 text-gray-950 sm:text-[32px] dark:text-white">
                    <span>{title}</span>
                  </div>
                  <div className="flex items-start justify-start rounded-[32px] border border-gray-950 p-1 dark:border-zinc-600 dark:bg-zinc-600">
                    <div className="relative h-6 w-6">
                      <X />
                    </div>
                  </div>
                </div>
                {children}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
