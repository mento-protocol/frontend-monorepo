"use client";

import { formatInTimeZone } from "date-fns-tz";
import { TimerIcon } from "lucide-react";
import { useEffect, useState } from "react";
import spacetime from "spacetime";

interface TimerProps {
  until: Date;
  label?: string;
  expiredLabel?: string;
}

interface TimeLeft {
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isFinished: boolean;
}

export const Timer = ({
  until,
  label = "Time left:",
  expiredLabel = "Voting ended",
}: TimerProps) => {
  // null before first tick (SSR + first client render) so an already-past
  // `until` doesn't flash "{label} 0m 0s" before the effect runs. SSR and
  // hydration both render the placeholder below, then the effect computes
  // the real state on mount — no hydration mismatch, no zero flash.
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = spacetime.now();
      const untilDate = spacetime(until);

      if (now.isAfter(untilDate)) {
        setTimeLeft({
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          isFinished: true,
        });
        return;
      }

      // Use untilDate.diff(now) to get a positive time difference
      const diff = untilDate.diff(now);

      // Calculate time units
      const totalSeconds = Math.floor(Math.abs(diff.milliseconds) / 1000);
      const totalMinutes = Math.floor(totalSeconds / 60);
      const totalHours = Math.floor(totalMinutes / 60);
      const totalDays = Math.floor(totalHours / 24);

      const weeks = Math.floor(totalDays / 7);
      const days = totalDays % 7;
      const hours = totalHours % 24;
      const minutes = totalMinutes % 60;
      const seconds = totalSeconds % 60;

      setTimeLeft({ weeks, days, hours, minutes, seconds, isFinished: false });
    };

    calculateTimeLeft();

    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [until]);

  const formatTimeLeft = (t: TimeLeft) => {
    const { weeks, days, hours, minutes, seconds } = t;

    // Format based on the largest non-zero unit
    if (weeks > 0) {
      return `${weeks}w ${days}d ${hours}h`;
    } else if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else {
      return `${minutes}m ${seconds}s`;
    }
  };

  const formatFinishDate = () => {
    return formatInTimeZone(until, "UTC", "MMM do, yyyy, HH:mm 'UTC'");
  };

  // First paint (SSR + pre-effect): icon + active label, no time. Prevents
  // "{label} 0m 0s" flash for already-past `until` values while keeping
  // SSR output stable for hydration.
  if (!timeLeft) {
    return (
      <div className="gap-2 flex items-center">
        <span className="gap-1 flex items-center">
          <TimerIcon size={16} />
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className="gap-2 flex items-center">
      {timeLeft.isFinished ? (
        <div className="gap-1 flex items-center">
          <TimerIcon size={16} />
          <div className="gap-2 flex items-center">
            <span>{expiredLabel}</span>
            <span className="text-muted-foreground">{formatFinishDate()}</span>
          </div>
        </div>
      ) : (
        <>
          <span className="gap-1 flex items-center">
            <TimerIcon size={16} />
            {label}
          </span>
          <span className="text-muted-foreground">
            {formatTimeLeft(timeLeft)}
          </span>
        </>
      )}
    </div>
  );
};
