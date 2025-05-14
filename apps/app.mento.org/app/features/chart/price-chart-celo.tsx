"use client";

import type { TokenId } from "@/lib/config/tokens";
import { ReactFrappeChart } from "@/features/chart/react-frappe-chart";
import { tokenPriceHistoryToChartData } from "@/features/chart/utils";
import { FloatingBox } from "@/components/layout/floating-box";
import { Color } from "@/lib/styles/color";

interface PriceChartProps {
  stableTokenId: TokenId;
  containerClasses?: string;
  height?: number;
}

type FrappeAxisMode = "tick" | "span";

interface PriceChartAxisOptions {
  xAxisMode?: FrappeAxisMode;
  yAxisMode?: FrappeAxisMode;
  xIsSeries?: 0 | 1;
}

interface ChartConfigType {
  colors: string[];
  axis: PriceChartAxisOptions;
  tooltipOptions: {
    formatTooltipY: (d: number | null) => string | null;
  };
}

export function PriceChartCelo(props: PriceChartProps) {
  const { stableTokenId, containerClasses, height } = props;

  // const dispatch = useAppDispatch()
  // useEffect(() => {
  //   dispatch(
  //     fetchTokenPrice({
  //       kit,
  //       baseCurrency: TokenId.CELO,
  //     })
  //   )
  //     .unwrap()
  //     .catch((err) => {
  //       toast.warn('Error retrieving chart data')
  //       logger.error('Failed to token prices', err)
  //     })
  // }, [dispatch, kit, initialised, network])

  const stableTokenPrices = undefined;
  const chartData = tokenPriceHistoryToChartData(stableTokenPrices);
  const chartHeight = height || 250;

  // Only show chart for Mainnet
  // if (network?.chainId !== Mainnet.chainId) return null

  return (
    <FloatingBox width="w-96" classes={`overflow-hidden ${containerClasses}`}>
      <div className="flex justify-between">
        <h2 className="text-md py-1 pl-3 font-medium">CELO Price (USD)</h2>
        {/* TODO duration toggle */}
        <div />
      </div>
      <div className="-my-1 -ml-6 -mr-4">
        <ReactFrappeChart
          type="line"
          colors={chartConfig.colors}
          height={chartHeight}
          axisOptions={chartConfig.axis}
          tooltipOptions={chartConfig.tooltipOptions}
          // @ts-ignore TODO find issue, works in Celo Wallet
          data={chartData}
        />
      </div>
    </FloatingBox>
  );
}

const chartConfig: ChartConfigType = {
  colors: [Color.celoGold],
  axis: { xAxisMode: "tick" },
  tooltipOptions: {
    formatTooltipY: (d: number | null) => (d ? `$${d.toFixed(2)}` : null),
  },
};
