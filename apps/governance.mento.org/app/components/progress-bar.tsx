"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@repo/ui";

interface ProgressSegmentProps {
  filled: boolean;
  color: "approve" | "reject" | "abstain" | "time";
  isPartial?: boolean;
  mode: "vote" | "time";
  selected?: boolean;
}

const ProgressSegment = ({
  filled,
  color,
  isPartial = false,
  mode,
  selected,
}: ProgressSegmentProps) => {
  return (
    <div
      className={cn(
        "aspect-square transition-all duration-200",
        filled && !isPartial && color === "approve" && "bg-success",
        filled && !isPartial && color === "reject" && "bg-destructive",
        filled && !isPartial && color === "abstain" && "bg-muted",
        filled && !isPartial && color === "time" && "bg-primary",
        isPartial && color === "abstain" && "bg-muted",
        isPartial && color === "time" && "bg-primary",
        !filled && "bg-muted-foreground",
        mode === "vote" && "h-1 w-1",
        mode === "time" && "h-2 w-2",
        selected && "bg-foreground h-3 w-3",
      )}
    />
  );
};

interface ProgressBarProps {
  mode: "vote" | "time";
  data: any;
  className?: string;
}

export const ProgressBar = ({
  mode = "vote",
  data,
  className,
}: ProgressBarProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [segmentCount, setSegmentCount] = useState(50);

  useEffect(() => {
    if (!containerRef.current) return;

    const calculateSegments = () => {
      if (!containerRef.current) return;

      const containerWidth = containerRef.current.offsetWidth;
      const segmentSize = mode === "vote" ? 4 : 8;
      const gapSize = mode === "vote" ? 6 : 12;
      const totalSizePerSegment = segmentSize + gapSize;

      // Calculate max segments that fit, with a min of 20 and max of 80
      const maxSegments = Math.floor(
        (containerWidth + gapSize) / totalSizePerSegment,
      );
      const clampedSegments = Math.max(20, Math.min(80, maxSegments));

      setSegmentCount(clampedSegments);
    };

    // Initial calculation
    calculateSegments();

    // Create ResizeObserver
    const resizeObserver = new ResizeObserver(calculateSegments);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [mode]);

  if (mode === "vote") {
    // Calculate segments for each section with dynamic segment count
    const approveSegments = Math.round(
      (data.approve.percentage / 100) * segmentCount,
    );
    const abstainSegments = data.abstain
      ? Math.round((data.abstain.percentage / 100) * segmentCount)
      : 0;
    const rejectSegments = segmentCount - approveSegments - abstainSegments;

    // Create segments array
    const segments: ProgressSegmentProps[] = [];
    for (let i = 0; i < approveSegments; i++) {
      segments.push({ filled: true, color: "approve", mode: "vote" });
    }
    for (let i = 0; i < abstainSegments; i++) {
      segments.push({ filled: true, color: "abstain", mode: "vote" });
    }
    for (let i = 0; i < rejectSegments; i++) {
      segments.push({ filled: true, color: "reject", mode: "vote" });
    }

    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex justify-between text-sm">
          <div className="flex items-center gap-2">
            <span className="text-success">Approve:</span>
            <span className="text-success">{data.approve.value}</span>
            <span className="text-success/80">{data.approve.percentage}%</span>
          </div>

          {data.abstain && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Abstain:</span>
              <span className="text-muted-foreground">
                {data.abstain.value}
              </span>
              <span className="text-muted-foreground/80">
                {data.abstain.percentage}%
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-destructive">Reject:</span>
            <span className="text-destructive">{data.reject.value}</span>
            <span className="text-destructive/80">
              {data.reject.percentage}%
            </span>
          </div>
        </div>

        <div
          ref={containerRef}
          className="flex items-center gap-1.5 overflow-hidden"
        >
          {segments.map((segment, index) => (
            <ProgressSegment key={index} {...segment} mode="vote" />
          ))}
        </div>
      </div>
    );
  }

  if (mode === "time") {
    // Calculate filled segments based on current value and max value
    const progressPercentage = (data.currentValue / data.maxValue) * 100;
    const filledSegments = Math.floor(
      (progressPercentage / 100) * segmentCount,
    );
    const partialProgress = ((progressPercentage / 100) * segmentCount) % 1;
    const hasPartial = partialProgress > 0.1; // Only show partial if it's significant

    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex justify-between text-sm text-gray-400">
          <span>{data.labels.start}</span>
          <span>{data.labels.middle}</span>
          <span>{data.labels.end}</span>
        </div>

        <div
          ref={containerRef}
          className="flex items-center gap-3 overflow-hidden"
        >
          {Array.from({ length: segmentCount }).map((_, index) => (
            <ProgressSegment
              key={index}
              filled={index < filledSegments}
              color="time"
              isPartial={index === filledSegments && hasPartial}
              selected={index === filledSegments}
              mode="time"
            />
          ))}
        </div>

        {data.valueLabel && (
          <div className="text-center text-lg font-medium">
            {data.valueLabel}
          </div>
        )}
      </div>
    );
  }

  return null;
};

// Example usage showing responsive behavior
export default function ProgressBarDemo() {
  const voteData1 = {
    approve: { value: "920K", percentage: 76.7 },
    reject: { value: "280K", percentage: 23.3 },
  };

  const voteData2 = {
    approve: { value: "70K", percentage: 16.7 },
    abstain: { value: "620K", percentage: 76.7 },
    reject: { value: "80K", percentage: 6.6 },
  };

  const timeData = {
    labels: {
      start: "1 week",
      middle: "13 months",
      end: "2 years",
    },
    currentValue: 13,
    maxValue: 24,
    valueLabel: "100,000 veMENTO",
  };

  return (
    <div className="bg-background min-h-screen space-y-12 p-8">
      <div className="space-y-8">
        {/* Full width */}
        <div className="bg-card rounded-lg p-6">
          <h3 className="text-foreground mb-4">Full Width Container</h3>
          <ProgressBar mode="vote" data={voteData1} />
        </div>

        {/* Different container sizes to show responsiveness */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="bg-card rounded-lg p-6">
            <h3 className="text-foreground mb-4">Medium Container</h3>
            <ProgressBar mode="vote" data={voteData2} />
          </div>

          <div className="bg-card rounded-lg p-6">
            <h3 className="text-foreground mb-4">Time Mode</h3>
            <ProgressBar mode="time" data={timeData} />
          </div>
        </div>

        {/* Small container */}
        <div className="mx-auto max-w-sm">
          <div className="bg-card rounded-lg p-6">
            <h3 className="text-foreground mb-4">Small Container</h3>
            <ProgressBar mode="vote" data={voteData1} />
          </div>
        </div>

        {/* Info */}
        <div className="bg-muted rounded-lg p-6 text-center">
          <p className="text-muted-foreground">
            The progress bar automatically adjusts the number of segments based
            on container width.
            <br />
            Try resizing your browser window to see it in action!
          </p>
        </div>
      </div>
    </div>
  );
}
