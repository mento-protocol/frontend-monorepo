"use client";

export const Tooltip = ({ text, dataTestId = "tooltipText" }: TooltipProps) => (
  <div className="absolute bottom-[-150%] z-10 -translate-x-[30%] transform rounded-none bg-[rgb(29,29,32)] px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
    <span datatest-id={dataTestId}>{text}</span>
  </div>
);

interface TooltipProps {
  text: string;
}
