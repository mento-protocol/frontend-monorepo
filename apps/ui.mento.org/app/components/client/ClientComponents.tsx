"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CoinCard,
  CoinCardHeader,
  CoinCardHeaderGroup,
  CoinCardSymbol,
  CoinCardName,
  CoinCardLogo,
  CoinCardFooter,
  CoinCardOriginFlag,
  CoinCardOriginText,
  CoinCardOrigin,
  CoinCardSupply,
} from "@repo/ui";

import Image from "next/image";
import USFlag from "./icons/us";

import GeneralIcons from "../../../../../packages/ui/src/assets/general-icons.svg";

type IconProps = React.SVGProps<SVGSVGElement> & {
  name: string; // The ID of the symbol in the sprite
};

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg {...props}>
      <use href={`${GeneralIcons}#${name}`} />
    </svg>
  );
}

export function ClientComponents() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap gap-6">
        {/* Card Component */}
        <Card className="flex h-full w-[300px] flex-col">
          <CardHeader>
            <CardTitle>Card Component</CardTitle>
            <CardDescription>
              A versatile card component for displaying content.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <p>
              Cards can contain various elements and are perfect for organizing
              information.
            </p>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button size="sm">Learn More</Button>
          </CardFooter>
        </Card>

        {/* Button Showcase */}
        <Card className="flex h-full w-[300px] flex-col">
          <CardHeader>
            <CardTitle>Button Variants</CardTitle>
            <CardDescription>
              Different button styles for various use cases.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-grow flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="default">Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
          </CardContent>
        </Card>

        {/* Component With Content */}
        <Card className="flex h-full w-[300px] flex-col">
          <CardHeader>
            <CardTitle>Content Card</CardTitle>
            <CardDescription>A card with rich content example.</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <div className="space-y-4">
              <p>
                This card shows how you can display different types of content:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Text paragraphs</li>
                <li>Lists of items</li>
                <li>Images or media</li>
                <li>Interactive elements</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
            <Button size="sm">Save</Button>
          </CardFooter>
        </Card>

        {/* Interactive Card */}
        <Card className="flex h-full w-[300px] flex-col">
          <CardHeader>
            <CardTitle>Interactive Card</CardTitle>
            <CardDescription>
              Cards can contain interactive components.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <div className="space-y-4">
              <p>Click the buttons below to see different actions:</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="w-full">
                  Action 1
                </Button>
                <Button variant="outline" className="w-full">
                  Action 2
                </Button>
                <Button variant="outline" className="w-full">
                  Action 3
                </Button>
                <Button variant="outline" className="w-full">
                  Action 4
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feature Card */}
        <Card className="flex h-full w-[300px] flex-col">
          <CardHeader>
            <CardTitle>Feature Highlight</CardTitle>
            <CardDescription>
              Showcase a key feature of your application.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <div className="mb-4 flex h-[100px] items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Feature Preview
              </span>
            </div>
            <p>
              This card highlights a specific feature with a visual
              representation.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full">
              Try Feature
            </Button>
          </CardFooter>
        </Card>

        {/* Documentation Card */}
        <Card className="flex h-full w-[300px] flex-col">
          <CardHeader>
            <CardTitle>Documentation</CardTitle>
            <CardDescription>
              Access helpful resources and documentation.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <p>
              Find comprehensive guides, API references, and examples in our
              documentation.
            </p>
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button size="sm">View Docs</Button>
          </CardFooter>
        </Card>
      </div>

      <div className="flex flex-wrap gap-6">
        <Card className="flex h-full flex-grow flex-col">
          <CardContent className="flex flex-grow gap-6">
            <Button clipped="default">Swap to cUSD</Button>
            <Button disabled clipped="default">
              Swap to cUSD
            </Button>
          </CardContent>
          <CardContent className="flex flex-grow gap-6">
            <Button clipped="default" size="sm">
              Swap to cUSD
            </Button>
            <Button disabled clipped="default" size="sm">
              Swap to cUSD
            </Button>
          </CardContent>

          <CardContent className="flex flex-grow gap-6">
            <Button clipped="lg" size="lg">
              Swap to cUSD
            </Button>
            <Button disabled clipped="lg" size="lg">
              Swap to cUSD
            </Button>
          </CardContent>

          <Icon
            name="arrow-double-right"
            width="24"
            height="24"
            fill="currentColor"
          />

          <CardContent className="flex flex-grow gap-6">
            <Button variant="secondary" clipped="default">
              Swap to cUSD
            </Button>
            <Button variant="secondary" disabled clipped="default">
              Swap to cUSD
            </Button>
          </CardContent>

          <CardContent className="flex flex-grow gap-6">
            <Button variant="secondary" clipped="default" size="sm">
              Swap to cUSD
            </Button>
            <Button variant="secondary" disabled clipped="default" size="sm">
              Swap to cUSD
            </Button>
          </CardContent>

          <CardContent className="flex flex-grow gap-6">
            <Button variant="secondary" clipped="lg" size="lg">
              Swap to cUSD
            </Button>
            <Button variant="secondary" disabled clipped="lg" size="lg">
              Swap to cUSD
            </Button>
          </CardContent>
        </Card>

        <Card className="flex h-full flex-grow flex-col">
          <CardContent className="flex flex-grow gap-6">
            <Button clipped="default" variant="approve">
              Approve Proposal
            </Button>
            <Button clipped="default" variant="abstain">
              Abstain
            </Button>
            <Button clipped="default" variant="reject">
              Reject Proposal
            </Button>
          </CardContent>

          <CardContent className="flex flex-grow gap-6">
            <Button clipped="default" variant="approve" size="sm">
              Approve Proposal
            </Button>
            <Button clipped="default" variant="abstain" size="sm">
              Abstain
            </Button>
            <Button clipped="default" variant="reject" size="sm">
              Reject Proposal
            </Button>
          </CardContent>

          <CardContent className="flex flex-grow gap-6">
            <Button clipped="lg" variant="approve" size="lg">
              Approve Proposal
            </Button>
            <Button clipped="lg" variant="abstain" size="lg">
              Abstain
            </Button>
            <Button clipped="lg" variant="reject" size="lg">
              Reject Proposal
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-6">
        <CoinCard>
          <CoinCardHeader>
            <CoinCardHeaderGroup>
              <CoinCardSymbol>cUSD</CoinCardSymbol>
              <CoinCardName>Celo Dollar</CoinCardName>
            </CoinCardHeaderGroup>
            <CoinCardLogo>
              <Image
                src="/celoDollar.png"
                alt="Celo Dollar"
                width={56}
                height={56}
                className="h-14 w-14"
              />
            </CoinCardLogo>
          </CoinCardHeader>
          <CoinCardFooter>
            <CoinCardOrigin>
              <CoinCardOriginFlag>
                <USFlag className="h-4 w-4" />
              </CoinCardOriginFlag>
              <CoinCardOriginText>United States</CoinCardOriginText>
            </CoinCardOrigin>
            <CoinCardSupply>$464,278</CoinCardSupply>
          </CoinCardFooter>
        </CoinCard>
      </div>
    </div>
  );
}
