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
  "USDm",
  "EURm",
  "BRLm",
  "KESm",
  "XOFm",
  "PHPm",
  "COPm",
  "GHSm",
  "GBPm",
  "ZARm",
  "CADm",
  "AUDm",
  "CHFm",
  "JPYm",
  "NGNm",
];

export default function BasicComponentsPage() {
  return (
    <div className="gap-8 p-6 flex w-full flex-col">
      <div className="space-y-2">
        <h1 className="font-bold text-3xl">Basic Components</h1>
        <p className="text-muted-foreground">Fundamental UI building blocks</p>
      </div>

      <div className="gap-6 md:grid-cols-2 lg:grid-cols-3 grid grid-cols-1">
        {/* Buttons */}
        <Card>
          <CardHeader>
            <CardTitle>Buttons</CardTitle>
            <CardDescription>Various button styles and states</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="gap-2 flex flex-wrap">
              <Button clipped="default">Default</Button>
              <Button variant="secondary" clipped="default">
                Secondary
              </Button>
              <Button variant="outline" clipped="default">
                Outline
              </Button>
            </div>
            <div className="gap-2 flex flex-wrap">
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
            <div className="gap-2 flex flex-wrap">
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
          <CardContent className="py-6 flex items-center justify-center">
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
            <div className="gap-2 flex flex-wrap">
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
          <CardContent className="gap-4 flex flex-col">
            <span className="text-sm text-muted-foreground">
              Custom UI icons
            </span>
            <div className="gap-4 flex items-center">
              <IconCheck className="h-6 w-6" />
              <IconDiscord className="h-6 w-6" />
              <IconGithub className="h-6 w-6" />
              <IconInfo className="h-6 w-6" />
              <IconLoading className="h-6 w-6" />
              <IconMento width={24} height={24} />
              <IconX className="h-6 w-6" />
            </div>
            <span className="text-sm text-muted-foreground">Token icons</span>
            <div className="gap-4 flex flex-wrap items-center">
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
