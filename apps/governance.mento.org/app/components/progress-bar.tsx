"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@repo/ui";

interface ProgressSegmentProps {
  filled: boolean;
  color: "approve" | "reject" | "abstain" | "time" | "gray";
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
        filled && !isPartial && color === "abstain" && "bg-white",
        filled && !isPartial && color === "gray" && "bg-muted",
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

interface VoteData {
  mode: "vote";
  approve: { value: string; percentage: number };
  reject: { value: string; percentage: number };
  abstain?: { value: string; percentage: number };
}

interface TimeData {
  mode: "time";
  labels: {
    start: string;
    middle: string;
    end: string;
  };
  currentValue: number;
  maxValue: number;
  valueLabel?: string;
}

interface ProgressBarProps {
  mode: "vote" | "time";
  data: VoteData | TimeData;
  className?: string;
}

export const ProgressBar = ({ mode, data, className }: ProgressBarProps) => {
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
      const clampedSegments = Math.max(20, Math.min(120, maxSegments));

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

  if (mode === "vote" && "approve" in data && "reject" in data) {
    // Calculate segments for each section with dynamic segment count
    const voteData = data as VoteData;
    const approveSegments = Math.round(
      (voteData.approve.percentage / 100) * segmentCount,
    );
    const abstainSegments = voteData.abstain
      ? Math.round((voteData.abstain.percentage / 100) * segmentCount)
      : 0;
    const rejectSegments = segmentCount - approveSegments - abstainSegments;

    // console.log("approveSegments: ", approveSegments);
    // console.log("abstainSegments: ", abstainSegments);
    // console.log("rejectSegments: ", rejectSegments);

    const segments: ProgressSegmentProps[] = [];

    // Gray Segments if abstain is more than approve and reject
    if (abstainSegments > approveSegments + rejectSegments) {
      for (let i = 0; i < approveSegments; i++) {
        segments.push({ filled: true, color: "gray", mode: "vote" });
      }
      for (let i = 0; i < abstainSegments; i++) {
        segments.push({ filled: true, color: "abstain", mode: "vote" });
      }
      for (let i = 0; i < rejectSegments; i++) {
        segments.push({ filled: true, color: "gray", mode: "vote" });
      }
    } else {
      // Create segments array
      for (let i = 0; i < approveSegments; i++) {
        segments.push({ filled: true, color: "approve", mode: "vote" });
      }
      for (let i = 0; i < abstainSegments; i++) {
        segments.push({ filled: true, color: "abstain", mode: "vote" });
      }
      for (let i = 0; i < rejectSegments; i++) {
        segments.push({ filled: true, color: "reject", mode: "vote" });
      }
    }

    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex flex-col justify-between gap-2 text-sm xl:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-success">Approve:</span>
            <span className="text-success">
              {(data as VoteData).approve.value}
            </span>
            <span className="text-muted-foreground">
              {(data as VoteData).approve.percentage}%
            </span>
          </div>

          {(data as VoteData).abstain && (
            <div className="flex items-center gap-2">
              <span className="text-white">Abstain:</span>
              <span className="text-white">
                {(data as VoteData).abstain?.value}
              </span>
              <span className="text-muted-foreground">
                {(data as VoteData).abstain?.percentage}%
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-destructive">Reject:</span>
            <span className="text-destructive">
              {(data as VoteData).reject.value}
            </span>
            <span className="text-muted-foreground">
              {(data as VoteData).reject.percentage}%
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

  if (mode === "time" && "currentValue" in data && "maxValue" in data) {
    // Calculate filled segments based on current value and max value
    const timeData = data as TimeData;
    const progressPercentage =
      (timeData.currentValue / timeData.maxValue) * 100;
    const filledSegments = Math.floor(
      (progressPercentage / 100) * segmentCount,
    );
    const partialProgress = ((progressPercentage / 100) * segmentCount) % 1;
    const hasPartial = partialProgress > 0.1; // Only show partial if it's significant

    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {(data as TimeData).labels.start}
          </span>
          <span className="text-foreground">
            {(data as TimeData).labels.middle}
          </span>
          <span className="text-muted-foreground">
            {(data as TimeData).labels.end}
          </span>
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

        {(data as TimeData).valueLabel && (
          <div className="text-center font-medium">
            {(data as TimeData).valueLabel}
          </div>
        )}
      </div>
    );
  }

  return null;
};
