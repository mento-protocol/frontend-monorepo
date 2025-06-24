import { WelcomeBanner } from "../../components/v3/welcome-banner";
import { MarketOverview } from "../../components/v3/market-overview";
import { YourTroves } from "../../components/v3/your-troves";

export default function V3DashboardPage() {
  return (
    <div className="container mx-auto space-y-8 p-4 md:p-8">
      <WelcomeBanner />
      <MarketOverview />
      <YourTroves />
    </div>
  );
}
