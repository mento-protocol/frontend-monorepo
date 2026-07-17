import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  Button,
} from "@mento-protocol/ui";

export const ActionsMenu = () => (
  <DropdownMenu defaultOpen>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" clipped="default">
        Open menu
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>Actions</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>View on explorer</DropdownMenuItem>
      <DropdownMenuItem>Copy address</DropdownMenuItem>
      <DropdownMenuItem>Disconnect</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
