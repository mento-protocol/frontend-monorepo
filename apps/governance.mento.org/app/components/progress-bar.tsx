"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@repo/ui";

interface ProgressSegmentProps {
  filled: boolean;
  color: "approve" | "reject" | "abstain" | "time" | "empty";
  isPartial?: boolean;
  mode: "vote" | "time";
  selected?: boolean;
  quorumNotMet?: boolean;
}

const ProgressSegment = ({
  filled,
  color,
  isPartial = false,
  mode,
  selected,
  quorumNotMet,
}: ProgressSegmentProps & { quorumNotMet?: boolean }) => {
  return (
    <div
      className={cn(
        "aspect-square transition-all duration-200",
        quorumNotMet
          ? [
              filled && !isPartial && color === "approve" && "bg-white",
              filled && !isPartial && color === "reject" && "bg-muted",
              filled && !isPartial && color === "abstain" && "bg-muted",
              filled && !isPartial && color === "empty" && "bg-muted-",
              filled && !isPartial && color === "time" && "bg-white",
              isPartial && "bg-muted",
              !filled && "bg-muted",
              mode === "vote" && "h-1 w-1",
              mode === "time" && "h-2 w-2",
              selected && "h-3 w-3 bg-white",
            ]
          : [
              filled && !isPartial && color === "approve" && "bg-success",
              filled && !isPartial && color === "reject" && "bg-destructive",
              filled && !isPartial && color === "abstain" && "bg-white",
              filled && !isPartial && color === "empty" && "bg-muted",
              filled && !isPartial && color === "time" && "bg-primary",
              isPartial && color === "abstain" && "bg-muted",
              isPartial && color === "time" && "bg-primary",
              !filled && "bg-muted",
              mode === "vote" && "h-1 w-1",
              mode === "time" && "h-2 w-2",
              selected && "bg-foreground h-3 w-3",
            ],
      )}
    />
  );
};

interface VoteData {
  mode: "vote";
  approve: { value: string; percentage: number };
  reject: { value: string; percentage: number };
  abstain?: { value: string; percentage: number };
  totalQuorum?: number;
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
  quorumNotMet?: boolean;
}

export const ProgressBar = ({
  mode,
  data,
  className,
  quorumNotMet,
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

    // If totalQuorum is provided, calculate segments based on quorum, otherwise use existing logic
    let approveSegments,
      abstainSegments,
      rejectSegments,
      unfilledSegments = 0;

    if (voteData.totalQuorum) {
      // Calculate segments based on actual votes vs total quorum
      const totalVotedPercentage =
        voteData.approve.percentage +
        voteData.reject.percentage +
        (voteData.abstain?.percentage || 0);
      const votedSegments = Math.round(
        (totalVotedPercentage / 100) * segmentCount,
      );
      unfilledSegments = segmentCount - votedSegments;

      // Calculate segments for each vote type based on their percentage of total quorum
      approveSegments = Math.round(
        (voteData.approve.percentage / 100) * segmentCount,
      );
      abstainSegments = voteData.abstain
        ? Math.round((voteData.abstain.percentage / 100) * segmentCount)
        : 0;
      rejectSegments = Math.round(
        (voteData.reject.percentage / 100) * segmentCount,
      );
    } else {
      // Original logic - calculate based on votes cast
      approveSegments = Math.round(
        (voteData.approve.percentage / 100) * segmentCount,
      );
      abstainSegments = voteData.abstain
        ? Math.round((voteData.abstain.percentage / 100) * segmentCount)
        : 0;
      rejectSegments = segmentCount - approveSegments - abstainSegments;
    }

    const segments: ProgressSegmentProps[] = [];

    // empty Segments if abstain is more than approve and reject
    if (abstainSegments > approveSegments + rejectSegments) {
      for (let i = 0; i < approveSegments; i++) {
        segments.push({ filled: true, color: "empty", mode: "vote" });
      }
      for (let i = 0; i < abstainSegments; i++) {
        segments.push({ filled: true, color: "abstain", mode: "vote" });
      }
      for (let i = 0; i < rejectSegments; i++) {
        segments.push({ filled: true, color: "empty", mode: "vote" });
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

    // Add unfilled segments (emptyed out) if using totalQuorum
    for (let i = 0; i < unfilledSegments; i++) {
      segments.push({ filled: false, color: "empty", mode: "vote" });
    }

    return (
      <div
        className={cn("space-y-4", quorumNotMet && "quorum-not-met", className)}
      >
        <div className="flex flex-col justify-between gap-2 text-sm xl:flex-row">
          <div className="flex items-center gap-2">
            <span
              className={cn(quorumNotMet ? "text-foreground" : "text-success")}
            >
              Yes:
            </span>
            <span
              className={cn(quorumNotMet ? "text-foreground" : "text-success")}
            >
              {(data as VoteData).approve.value}
            </span>
            <span className="text-muted-foreground">
              {(data as VoteData).approve.percentage}%
            </span>
          </div>

          {(data as VoteData).abstain && (
            <div className="flex items-center gap-2">
              <span className="text-foreground">Abstain:</span>
              <span className="text-foreground">
                {(data as VoteData).abstain?.value}
              </span>
              <span className="text-muted-foreground">
                {(data as VoteData).abstain?.percentage}%
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span
              className={cn(
                quorumNotMet ? "text-foreground" : "text-destructive",
              )}
            >
              No:
            </span>
            <span
              className={cn(
                quorumNotMet ? "text-foreground" : "text-destructive",
              )}
            >
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
            <ProgressSegment
              key={index}
              {...segment}
              mode="vote"
              quorumNotMet={quorumNotMet}
            />
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
