import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  Button,
} from "@mento-protocol/ui";

export const InfoPopover = () => (
  <Popover defaultOpen>
    <PopoverTrigger asChild>
      <Button variant="outline" clipped="default">
        Slippage settings
      </Button>
    </PopoverTrigger>
    <PopoverContent>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 className="font-medium">Max slippage</h4>
        <p className="text-sm text-muted-foreground">
          Your transaction will revert if the price moves more than this
          percentage.
        </p>
      </div>
    </PopoverContent>
  </Popover>
);
