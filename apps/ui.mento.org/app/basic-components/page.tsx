"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  IconCheck,
  IconInfo,
  IconLoading,
  IconDiscord,
  IconGithub,
  IconMento,
  IconX,
  TokenIcon,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@repo/ui";

const tokens = [
  "CELO",
  "BTC",
  "sDAI",
  "ETH",
  "USDC",
  "EURC",
  "stEUR",
  "sDAI",
  "stETH",
  "USDT",
  "cEUR",
  "cUSD",
  "cREAL",
  "cKES",
  "eXOF",
  "PUSO",
  "cCOP",
  "USDGLO",
  "cGHS",
];

export default function BasicComponentsPage() {
  return (
    <div className="flex w-full flex-col gap-8 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Basic Components</h1>
        <p className="text-muted-foreground">Fundamental UI building blocks</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Buttons */}
        <Card>
          <CardHeader>
            <CardTitle>Buttons</CardTitle>
            <CardDescription>Various button styles and states</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </div>
          </CardContent>
        </Card>

        {/* Badges */}
        <Card>
          <CardHeader>
            <CardTitle>Badges</CardTitle>
            <CardDescription>Status indicators and labels</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="destructive">Destructive</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Icons */}
        <Card className="gap-0">
          <CardHeader>
            <CardTitle>Icons</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <span className="text-muted-foreground text-sm">
              Custom UI icons
            </span>
            <div className="flex items-center gap-4">
              <IconCheck className="h-6 w-6" />
              <IconDiscord className="h-6 w-6" />
              <IconGithub className="h-6 w-6" />
              <IconInfo className="h-6 w-6" />
              <IconLoading className="h-6 w-6" />
              <IconMento width={24} height={24} />
              <IconX className="h-6 w-6" />
            </div>
            <span className="text-muted-foreground text-sm">Token icons</span>
            <div className="flex flex-wrap items-center gap-4">
              {tokens.map((token) => (
                <Tooltip key={token}>
                  <TooltipTrigger>
                    <TokenIcon
                      token={{
                        symbol: token,
                        name: token,
                        color: "#000000",
                        decimals: 18,
                        id: token,
                      }}
                      className="h-6 w-6"
                    />
                  </TooltipTrigger>
                  <TooltipContent>{token}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
