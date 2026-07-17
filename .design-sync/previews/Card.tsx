import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  Button,
} from "@mento-protocol/ui";

export const ReserveStatCard = () => (
  <div style={{ maxWidth: 360 }}>
    <Card>
      <CardHeader>
        <CardTitle>Reserve Holdings</CardTitle>
        <CardDescription>Total value backing Mento stablecoins</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-semibold text-3xl">$142,830,912</p>
        <p className="text-sm text-muted-foreground">
          Collateralization ratio: 2.3x
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="outline" clipped="default">
          View reserve
        </Button>
      </CardFooter>
    </Card>
  </div>
);

export const CardWithAction = () => (
  <div style={{ maxWidth: 360 }}>
    <Card>
      <CardHeader>
        <CardTitle>USDm Supply</CardTitle>
        <CardDescription>Mento Dollar in circulation</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm">
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="font-semibold text-2xl">16,904,872 USDm</p>
      </CardContent>
    </Card>
  </div>
);
