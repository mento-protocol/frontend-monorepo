"use client";

import { Pie, PieChart, Cell, Sector } from "recharts";
import { type ChartConfig, ChartContainer } from "./chart.js";
import { useEffect, useState } from "react";
import { PieSectorDataItem } from "recharts/types/polar/Pie.js";

export interface ChartSegment {
  name: string;
  value: number;
  color: string;
  [key: string]: unknown;
}

export interface ReserveChartProps {
  data: ChartSegment[];
  centerText?: string;
  centerLogoSvgString?: string; // This will be an SVG string directly
  className?: string;
  innerRingOpacity?: number; // Opacity for the inner ring, e.g., 0.5
  activeSegment?: string; // Active segment name
  onActiveChanged?: (name: string | undefined) => void; // Event handler for active segment changes
}

// Helper function to convert hex to rgba
function hexToRgba(hex: string, opacity: number): string {
  let r_hex: string;
  let g_hex: string;
  let b_hex: string;

  if (hex.length === 4) {
    // #RGB
    r_hex = `0x${hex[1]}${hex[1]}`;
    g_hex = `0x${hex[2]}${hex[2]}`;
    b_hex = `0x${hex[3]}${hex[3]}`;
  } else if (hex.length === 7) {
    // #RRGGBB
    r_hex = `0x${hex[1]}${hex[2]}`;
    g_hex = `0x${hex[3]}${hex[4]}`;
    b_hex = `0x${hex[5]}${hex[6]}`;
  } else {
    // Return a default color or throw an error for invalid hex format
    console.warn(`Invalid hex color format: ${hex}. Using default black.`);
    return `rgba(0,0,0,${opacity})`;
  }
  return `rgba(${+r_hex},${+g_hex},${+b_hex},${opacity})`;
}

export function ReserveChart({
  data,
  className,
  innerRingOpacity = 0.8, // Default opacity for the inner ring
  activeSegment,
  onActiveChanged,
}: ReserveChartProps) {
  const [activeSegmentInternal, setActiveSegmentInternal] = useState<
    string | undefined
  >(activeSegment);

  useEffect(() => {
    setActiveSegmentInternal(activeSegment);
  }, [activeSegment]);

  const handleActiveChanged = (name: string | undefined) => {
    setActiveSegmentInternal(name);
    onActiveChanged?.(name);
  };

  if (!data || data.length === 0) {
    return (
      <div
        className={
          className ||
          "mx-auto flex aspect-square max-h-[250px] items-center justify-center"
        }
      >
        No data to display.
      </div>
    );
  }

  const chartConfig = data.reduce((acc, item) => {
    acc[item.name] = { label: item.name, color: item.color };
    return acc;
  }, {} as ChartConfig);
  chartConfig.value = {};

  const value = data.filter((d) => d.name === activeSegmentInternal)[0]?.value;
  const tokenName = data.filter((d) => d.name === activeSegmentInternal)[0]
    ?.name;

  return (
    <div className={`relative ${className || "mx-auto aspect-square h-full"}`}>
      <div className="p-8 pointer-events-none absolute top-1/2 left-1/2 z-0 h-fit w-fit -translate-x-1/2 -translate-y-1/2 rounded-full bg-card">
        <svg
          width="45"
          height="45"
          viewBox="0 0 45 45"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Logo</title>
          <path
            d="M28.3682 0.0238037H11.6119V11.5735H25.6661C30.3828 11.5735 33.3568 14.2882 33.3568 19.043V33.1629H44.8367V16.3283C44.8367 6.81869 37.8176 0.0238037 28.3682 0.0238037ZM19.3186 33.1629C14.5859 33.1629 11.6119 30.4482 11.6119 25.6934V11.5735H0.147949V28.4081C0.147949 37.9177 7.16705 44.7126 16.6164 44.7126H33.3568V33.1629H19.3186Z"
            fill="#F7F7F7"
          />
        </svg>
      </div>
      <ChartContainer config={chartConfig} className="h-full w-full">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="60%" // Adjusted for inner ring space
            outerRadius="90%"
            strokeWidth={0} // stroke="var(--background)"
            onMouseEnter={(_, index) => {
              if (data[index]) handleActiveChanged(data[index].name);
            }}
            onMouseLeave={() => {
              handleActiveChanged(undefined);
            }}
            shape={(props: PieSectorDataItem & { isActive?: boolean }) => {
              const { outerRadius = 0, isActive, ...rest } = props;
              const isActiveSegment =
                isActive || rest.name === activeSegmentInternal;
              if (isActiveSegment) {
                return (
                  <g>
                    <Sector
                      {...rest}
                      outerRadius={outerRadius + 10}
                      fill={props.payload?.color}
                    />
                    <Sector
                      {...rest}
                      outerRadius={outerRadius + 15}
                      innerRadius={outerRadius + 9}
                      fill={props.payload?.color}
                    />
                  </g>
                );
              }
              return <Sector {...rest} outerRadius={outerRadius} />;
            }}
          >
            {data.map((entry) => (
              <Cell key={`cell-outer-${entry.name}`} fill={entry.color} />
            ))}
          </Pie>
          {/* Inner Ring (Opaque) */}
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="60%" // Ends where the outer ring begins
            strokeWidth={0}
            onMouseEnter={(_, index) => {
              if (data[index]) handleActiveChanged(data[index].name);
            }}
            onMouseLeave={() => {
              handleActiveChanged(undefined);
            }}
          >
            {data.map((entry) => (
              <Cell
                key={`cell-inner-${entry.name}`}
                fill={hexToRgba(entry.color, innerRingOpacity)}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      {value && (
        <div className="mt-4 gap-2 p-2 text-white mx-auto flex w-fit flex-row items-center justify-start bg-[var(--new-muted-color)]">
          <img
            src={`/tokens/${tokenName}.svg`}
            alt={tokenName}
            className="h-8 w-8 inline-block"
            width={32}
            height={32}
          />
          <span>{value.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
}
