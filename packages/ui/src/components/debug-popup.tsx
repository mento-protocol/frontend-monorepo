"use client";

import { useState, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import faviconImage from "../assets/favicon-32x32.png";

const FORK_MODE_KEY = "mento_use_fork";

/**
 * DebugPopup component provides different dev tools.
 *
 * Features:
 * - Press Ctrl+M+D to show/hide the debug popup
 * - Toggle to enable/disable fork mode for chains
 * - Persists preference in localStorage
 * - Automatically reloads the page when toggling to apply changes
 *
 * Only visible if explicitly set via env variable and activated via hotkey.
 */
export function DebugPopup() {
  const [isVisible, setIsVisible] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [useFork, setUseFork] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(FORK_MODE_KEY);
      setUseFork(stored === "true");
    }
  }, []);

  useHotkeys("ctrl+m+d", () => setIsVisible((previous) => !previous), {
    preventDefault: true,
  });

  const handleToggleFork = () => {
    const newValue = !useFork;
    setUseFork(newValue);

    if (typeof window !== "undefined") {
      localStorage.setItem(FORK_MODE_KEY, String(newValue));

      console.debug(
        `Fork mode ${newValue ? "enabled" : "disabled"}. Reloading...`,
      );
      window.location.reload();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="bottom-4 right-4 gap-2 fixed z-[9999] flex flex-col items-end font-sans"
      data-testid="debug-popup-button"
    >
      {isOpen && (
        <div
          className="mb-2 border-gray-300 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900 rounded-lg border"
          data-testid="debug-popup-container"
        >
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Debug Settings
          </h3>

          <div className="mb-4 gap-4 flex items-center justify-between">
            <div className="flex flex-col">
              <label
                htmlFor="fork-mode-toggle"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Use Forked Chains
              </label>
            </div>

            <button
              id="fork-mode-toggle"
              type="button"
              role="switch"
              aria-checked={useFork}
              onClick={handleToggleFork}
              className={`h-6 w-11 focus:ring-blue-500 relative inline-flex items-center rounded-full transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none ${
                useFork ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`h-4 w-4 bg-white inline-block transform rounded-full transition-transform ${
                  useFork ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen((previous) => !previous)}
        className="h-14 w-14 bg-purple-600 shadow-xl hover:shadow-2xl focus:ring-purple-500 dark:bg-purple-600 flex items-center justify-center rounded-full transition-all hover:scale-105 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        aria-label="Toggle debug menu"
        type="button"
      >
        <img
          src={faviconImage}
          alt="Mento debug"
          className="h-8 w-8"
          width={32}
          height={32}
        />
      </button>
    </div>
  );
}

/**
 * Utility function to check if fork mode is enabled.
 * Can be used in configuration files to determine which chains to use.
 *
 * @returns true if fork mode is enabled, false otherwise
 */
export function isForkModeEnabled(): boolean {
  if (typeof window === "undefined") {
    // During SSR, check environment variable
    return process.env.NEXT_PUBLIC_USE_FORK === "true";
  }

  // In browser, check localStorage first, then environment variable
  const storedValue = localStorage.getItem(FORK_MODE_KEY);
  if (storedValue !== null) {
    return storedValue === "true";
  }

  return process.env.NEXT_PUBLIC_USE_FORK === "true";
}
