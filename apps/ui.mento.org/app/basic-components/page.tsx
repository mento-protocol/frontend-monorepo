"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconCheck,
  IconDiscord,
  IconGithub,
  IconInfo,
  IconLoading,
  IconMento,
  IconX,
  ModeToggle,
  TokenIcon,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui";

const tokenSymbols = [
  "CELO",
  "BTC",
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
              <Button clipped="default">Default</Button>
              <Button variant="secondary" clipped="default">
                Secondary
              </Button>
              <Button variant="outline" clipped="default">
                Outline
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" clipped="default">
                Ghost
              </Button>
              <Button variant="link" clipped="default">
                Link
              </Button>
              <Button variant="destructive" clipped="default">
                Destructive
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" clipped="sm">
                Small
              </Button>
              <Button size="lg" clipped="lg">
                Large
              </Button>
              <Button disabled clipped="default">
                Disabled
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Theme Toggle */}
        <Card>
          <CardHeader>
            <CardTitle>Theme Toggle</CardTitle>
            <CardDescription>
              Switch between light and dark modes
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-6">
            <ModeToggle />
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
              {tokenSymbols.map((token) => (
                <Tooltip key={token}>
                  <TooltipTrigger>
                    <TokenIcon
                      token={{
                        address: "0x0000000000000000000000000000000000000000",
                        symbol: token,
                        name: token,
                        decimals: 18,
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
