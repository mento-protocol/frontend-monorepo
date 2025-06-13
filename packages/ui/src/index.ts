"use client";

// Export all components from a single file for easier imports
export * from "./components/dropdown-menu.js";
export * from "./components/mode-toggle.js";

export * from "./components/ui/button.js";
export * from "./components/ui/card.js";
export * from "./components/ui/coin-card.js";
export * from "./components/ui/sidebar.js";
export * from "./components/ui/tabs.js";
export * from "./components/ui/reserve-chart.js";
export * from "./components/ui/community-card.js";
export * from "./components/theme-provider.js";
export * from "./components/logo.js";
export * from "./components/navigation.js";

export * from "./components/ui/form.js";
export * from "./components/ui/coin-input.js";
export * from "./components/ui/input.js";
export * from "./components/ui/label.js";
export * from "./components/ui/coin-select.js";
export * from "./components/ui/select.js";
export * from "./components/ui/dialog.js";
export * from "./components/ui/radio-group-buttons.js";
export * from "./components/ui/radio-group.js";
export * from "./components/ui/sonner.js";
export * from "./components/token-icon.js";
export * from "./components/ui/scroll-area.js";
export * from "./components/ui/tooltip.js";
export * from "./components/ui/collapsible.js";
export * from "./components/ui/accordion.js";
export * from "./components/ui/popover.js";
export * from "./components/footer.js";
export * from "./components/ui/proposal-card.js";

// Also export any utility functions or types that might be needed
export * from "./lib/index.js";

// Export types from components if they are meant to be used externally
export type {
  ChartSegment,
  ReserveChartProps,
} from "./components/ui/reserve-chart.js";
export { default as IconDiscord } from "./components/icons/discord.js";
export { default as IconGithub } from "./components/icons/github.js";
export { default as IconX } from "./components/icons/x.js";
export { default as IconCheck } from "./components/icons/check.js";
export { default as IconInfo } from "./components/icons/info.js";
export { default as IconLoading } from "./components/icons/loading.js";
export { default as IconChevron } from "./components/icons/chevron.js";

export * as links from "./lib/links.js";
