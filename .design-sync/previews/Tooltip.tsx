import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  Button,
} from "@mento-protocol/ui";

// TooltipContent is `bg-card` (white) with no border, so it is invisible on the
// white preview page. Render the demo on the page's own `--background` (a light
// lavender) with generous padding so both the outline trigger and the white
// tooltip bubble (which sits above the trigger) read clearly.
const surface: React.CSSProperties = {
  background: "var(--background)",
  padding: "72px 48px 32px",
  display: "flex",
  justifyContent: "center",
};

export const HoverTooltip = () => (
  <TooltipProvider>
    <div style={surface}>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline" clipped="default">
            Exchange rate
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Rate refreshes from the on-chain oracle every 5 seconds.</p>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
);
